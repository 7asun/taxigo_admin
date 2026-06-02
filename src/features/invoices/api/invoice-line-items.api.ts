/**
 * invoice-line-items.api.ts
 *
 * Service for building and persisting invoice line items.
 *
 * The central function `buildLineItemsFromTrips` converts raw trip rows into
 * invoice line item snapshots. This is where the data is **frozen** — after
 * this function runs, the line items are independent of the trips table and
 * will not change even if the trips are later edited.
 *
 * ─── Snapshot principle ────────────────────────────────────────────────────
 * Line items are always created FROM trips, never edited after creation.
 * If the data is wrong, the invoice must be storniert and a new one created.
 * This is intentional — it matches German legal requirements for invoice
 * immutability (§14 UStG: Rechnungen dürfen nicht nachträglich geändert werden).
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  listPricingRulesForPayer,
  type BillingPricingRuleRow
} from '@/features/payers/api/billing-pricing-rules.api';
import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { resolveTaxRate } from '../lib/tax-calculator';
import { resolvePricingRule } from '../lib/resolve-pricing-rule';
import { resolveTripPrice as resolveTripPricePure } from '../lib/resolve-trip-price';
import {
  resolveEffectiveDistanceKm,
  type ClientKmOverrideLike
} from '../lib/resolve-effective-distance';
import { validateLineItems } from '../lib/invoice-validators';
import { buildTripMetaFromTrip } from '../lib/trip-meta-snapshot';
import type {
  BillingPricingRuleLike,
  ClientPriceTagLike
} from '../types/pricing.types';
import { listClientPriceTagsForClientIds } from '@/features/payers/api/client-price-tags.service';
import { listClientKmOverridesForClientIds } from '@/features/invoices/api/client-km-overrides.api';
import type { PriceResolution } from '../types/pricing.types';
import type {
  TripForInvoice,
  CancelledTripRow,
  BuilderCancelledTripRow,
  BuilderLineItem,
  InvoiceLineItemRow,
  TaxBreakdown,
  TotalsLineShape
} from '../types/invoice.types';

/**
 * Canonical `trips.status` literal for cancellations — filters must use this (not scattered strings)
 * so PostgREST and admin-facing logic stay aligned with driver-RPC / dispatcher updates.
 */
export const CANCELLED_STATUS = 'cancelled' as const;

/** True when line gross must use `price_resolution.gross × qty` (not derived net × VAT). */
export function isGrossAnchorClientPriceTag(pr: PriceResolution): boolean {
  return pr.strategy_used === 'client_price_tag' && pr.gross != null;
}

// ─── Fetch trips for the invoice builder ──────────────────────────────────────

export interface FetchTripsForBuilderParams {
  payer_id: string;
  billing_type_id?: string | null; // null = all billing types (per_client / legacy)
  /**
   * Monthly / single_trip: optional Abrechnungsfamilien subset (billing_types.id).
   * Union of variants is resolved in {@link resolveBillingVariantFilters}.
   */
  billing_type_ids?: string[] | null;
  /** Optional: scope to exactly one Unterart (billing_variants.id). */
  billing_variant_id?: string | null; // null = all variants (subject to billing_type_id filter)
  /**
   * Monthly subset: explicit Unterarten under exactly one billing type in scope.
   * Empty / null = all variants of that type (same as omitting this field).
   */
  billing_variant_ids?: string[] | null;
  period_from: string; // ISO date string
  period_to: string; // ISO date string
  client_id?: string | null; // only for per_client mode
}

/** Pure precedence for tests — keep in sync with {@link resolveBillingVariantFilters}. */
export type BillingVariantFetchBranch =
  | { branch: 'subset'; billingTypeId: string; requestedIds: string[] }
  | { branch: 'single'; variantId: string }
  | { branch: 'multiTypes'; billingTypeIds: string[] }
  | { branch: 'allVariantsOfType'; billingTypeId: string }
  | { branch: 'noVariantFilter' };

export function billingVariantFetchBranchFromParams(
  params: Pick<
    FetchTripsForBuilderParams,
    | 'billing_type_id'
    | 'billing_type_ids'
    | 'billing_variant_id'
    | 'billing_variant_ids'
  >
): BillingVariantFetchBranch {
  const legacyTypeId =
    params.billing_type_id && params.billing_type_id.length > 0
      ? params.billing_type_id
      : null;
  const typeIdsSorted =
    params.billing_type_ids && params.billing_type_ids.length > 0
      ? [...params.billing_type_ids].sort()
      : null;
  const multiLen = typeIdsSorted?.length ?? 0;

  const subset =
    params.billing_variant_ids && params.billing_variant_ids.length > 0
      ? params.billing_variant_ids
      : null;
  const single =
    params.billing_variant_id && params.billing_variant_id.length > 0
      ? params.billing_variant_id
      : null;

  // why: Unterarten subset is only defined when exactly one Abrechnungsfamilie is in scope (monthly array length 1, or per_client legacy type id).
  const effectiveSingleTypeForSubset: string | null =
    multiLen === 1
      ? typeIdsSorted![0]!
      : multiLen === 0 && legacyTypeId
        ? legacyTypeId
        : null;

  // why: explicit monthly subset wins over single-Unterart — do not overload billing_variant_id from the subset UI.
  if (subset && effectiveSingleTypeForSubset) {
    return {
      branch: 'subset',
      billingTypeId: effectiveSingleTypeForSubset,
      requestedIds: subset
    };
  }

  if (single) {
    return { branch: 'single', variantId: single };
  }

  // why: multi-family scope = union of all variants for selected billing_type_ids (one DB round-trip in resolver).
  if (multiLen > 1) {
    return { branch: 'multiTypes', billingTypeIds: typeIdsSorted! };
  }

  if (multiLen === 1) {
    return { branch: 'allVariantsOfType', billingTypeId: typeIdsSorted![0]! };
  }

  if (legacyTypeId) {
    return { branch: 'allVariantsOfType', billingTypeId: legacyTypeId };
  }

  return { branch: 'noVariantFilter' };
}

/** Shared payer/period/variant shaping for billing vs cancelled-trip fetches — keeps filters identical. */
async function resolveBillingVariantFilters(
  params: FetchTripsForBuilderParams
): Promise<{
  variantId: string | null;
  variantIdsForType: string[] | null;
  /** billing_type scoped but zero variants resolve — callers return empty arrays */
  abortEmpty: boolean;
}> {
  const supabase = createClient();
  const plan = billingVariantFetchBranchFromParams(params);

  if (plan.branch === 'subset') {
    const { data: rows, error: vErr } = await supabase
      .from('billing_variants')
      .select('id')
      .eq('billing_type_id', plan.billingTypeId)
      .in('id', plan.requestedIds);
    if (vErr) throw toQueryError(vErr);
    const ids = (rows ?? []).map((r) => r.id).sort();
    if (ids.length === 0) {
      return { variantId: null, variantIdsForType: null, abortEmpty: true };
    }
    return { variantId: null, variantIdsForType: ids, abortEmpty: false };
  }

  if (plan.branch === 'single') {
    return {
      variantId: plan.variantId,
      variantIdsForType: null,
      abortEmpty: false
    };
  }

  if (plan.branch === 'multiTypes') {
    const { data: rows, error: vErr } = await supabase
      .from('billing_variants')
      .select('id')
      .in('billing_type_id', plan.billingTypeIds);
    if (vErr) throw toQueryError(vErr);
    const variantIdsForType = (rows ?? []).map((r) => r.id).sort();
    if (variantIdsForType.length === 0) {
      return { variantId: null, variantIdsForType: null, abortEmpty: true };
    }
    return { variantId: null, variantIdsForType, abortEmpty: false };
  }

  if (plan.branch === 'allVariantsOfType') {
    const { data: variants, error: vErr } = await supabase
      .from('billing_variants')
      .select('id')
      .eq('billing_type_id', plan.billingTypeId);
    if (vErr) throw toQueryError(vErr);
    const variantIdsForType = (variants ?? []).map((v) => v.id);
    if (variantIdsForType.length === 0) {
      return { variantId: null, variantIdsForType: null, abortEmpty: true };
    }
    return { variantId: null, variantIdsForType, abortEmpty: false };
  }

  return { variantId: null, variantIdsForType: null, abortEmpty: false };
}

function legacyPriceSource(
  src: string
): 'client_price_tag' | 'trip_price' | null {
  if (src === 'client_price_tag') return 'client_price_tag';
  if (src === 'trip_price') return 'trip_price';
  return null;
}

/**
 * Recompute price_resolution when the user edits the net unit price in step 3.
 * Manual edit affects base net only — `approach_fee_net` is preserved as-is from the original resolution.
 */
export function applyManualUnitNetToResolution(
  item: BuilderLineItem,
  unitNet: number
): PriceResolution {
  const qty = item.quantity;
  const tr = item.tax_rate;
  const netTotal = Math.round(unitNet * qty * 100) / 100;
  const grossTotal = Math.round(netTotal * (1 + tr) * 100) / 100;
  const prevNote = item.price_resolution.note;
  const manualNote = 'Manuell angepasst';
  const note =
    prevNote && !prevNote.includes(manualNote)
      ? `${prevNote} · ${manualNote}`
      : prevNote && prevNote.includes(manualNote)
        ? prevNote
        : manualNote;
  return {
    ...item.price_resolution,
    unit_price_net: unitNet,
    net: netTotal,
    gross: grossTotal,
    tax_rate: tr,
    strategy_used: 'manual_trip_price',
    source: 'trip_price',
    note
  };
}

/**
 * Fetches trips for inclusion in an invoice, scoped by payer, date range,
 * and optionally by billing_type and client.
 *
 * Billing-type filter uses `billing_variants.billing_type_id` (not variant id).
 *
 * @param params - Filter parameters from the builder step 2.
 * @returns       Trips plus active `client_price_tags` for embedded clients (invoice resolution STEP 0).
 */
export async function fetchTripsForBuilder(
  params: FetchTripsForBuilderParams
): Promise<{
  trips: TripForInvoice[];
  clientPriceTags: ClientPriceTagLike[];
  clientKmOverrides: ClientKmOverrideLike[];
}> {
  const supabase = createClient();

  const { variantId, variantIdsForType, abortEmpty } =
    await resolveBillingVariantFilters(params);
  if (abortEmpty) {
    return { trips: [], clientPriceTags: [], clientKmOverrides: [] };
  }

  // why: include `trips.client_name` so line-item snapshots can show Fahrgast when `client_id`
  // is null but the trip carries a denormalized name (named-but-unlinked — trip-client-linking.md).
  let query = supabase
    .from('trips')
    .select(
      `
      id,
      payer_id,
      status,
      scheduled_at,
      net_price,
      base_net_price,
      approach_fee_net,
      manual_gross_price,
      driving_distance_km,
      manual_distance_km,
      billing_variant_id,
      pickup_address,
      dropoff_address,
      kts_document_applies,
      no_invoice_required,
      is_wheelchair,
      link_type,
      linked_trip_id,
      client_name,
      driver:accounts!trips_driver_id_fkey(name),
      payer:payers(rechnungsempfaenger_id, manual_km_enabled),
      billing_variant:billing_variants(
        id, code, name, billing_type_id, rechnungsempfaenger_id,
        billing_type:billing_types(name, rechnungsempfaenger_id)
      ),
      client:clients(id, first_name, last_name, price_tag, reference_fields)
    `
    )
    .eq('payer_id', params.payer_id)
    .gte('scheduled_at', params.period_from)
    .lte('scheduled_at', params.period_to + 'T23:59:59.999Z')
    // Defence in depth: billing must never see cancelled rows even if other layers regress.
    .neq('status', CANCELLED_STATUS)
    .order('scheduled_at', { ascending: true });

  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }

  if (params.client_id) {
    // Trips with client_id = null are excluded here by design.
    // Best-effort resolution at trip creation ensures client_id is set
    // when a Stammdaten match exists. See docs/trip-client-linking.md.
    query = query.eq('client_id', params.client_id);
  }

  const { data, error } = await query;

  if (error) throw toQueryError(error);
  const trips = (data ?? []) as unknown as TripForInvoice[];
  const clientIds = [
    ...new Set(
      trips
        .map((t) => t.client?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  ];
  const [clientPriceTags, clientKmOverrides] = await Promise.all([
    listClientPriceTagsForClientIds(clientIds),
    listClientKmOverridesForClientIds(clientIds)
  ]);
  return { trips, clientPriceTags, clientKmOverrides };
}

/**
 * Batch-fetch `trips.is_wheelchair` for edit-mode hydration (not on invoice_line_items).
 */
export async function fetchTripWheelchairFlags(
  tripIds: string[]
): Promise<Record<string, boolean>> {
  if (tripIds.length === 0) return {};
  const supabase = createClient();
  const { data, error } = await supabase
    .from('trips')
    .select('id, is_wheelchair')
    .in('id', tripIds);
  if (error) throw toQueryError(error);
  const out: Record<string, boolean> = {};
  for (const row of data ?? []) {
    out[row.id] = row.is_wheelchair === true;
  }
  return out;
}

/**
 * Cancelled trips for the same scope as {@link fetchTripsForBuilder}.
 *
 * The extended select includes all pricing fields needed for billing opt-in
 * (`buildCancelledTripBillingState`). The narrow passive-appendix path still
 * works — unused pricing fields are simply ignored there.
 *
 * Also returns `clientPriceTags` and `clientKmOverrides` for the cancelled trip
 * clients — necessary because some clients may have zero normal trips in the
 * period and their entries would otherwise be absent from the cache seeded by
 * `fetchTripsForBuilder`. Without this, `buildCancelledTripBillingState` would
 * resolve the wrong pricing rule for those clients.
 */
export async function fetchCancelledTripsForBuilder(
  params: FetchTripsForBuilderParams
): Promise<{
  trips: CancelledTripRow[];
  clientPriceTags: ClientPriceTagLike[];
  clientKmOverrides: ClientKmOverrideLike[];
}> {
  const supabase = createClient();

  const { variantId, variantIdsForType, abortEmpty } =
    await resolveBillingVariantFilters(params);
  if (abortEmpty) {
    return { trips: [], clientPriceTags: [], clientKmOverrides: [] };
  }

  // why: select mirrors fetchTripsForBuilder — pricing fields are needed when the
  // admin opts a cancelled trip into billing; unused for passive €0 display.
  let query = supabase
    .from('trips')
    .select(
      `
      id,
      payer_id,
      scheduled_at,
      pickup_address,
      dropoff_address,
      canceled_reason_notes,
      client_name,
      net_price,
      base_net_price,
      approach_fee_net,
      manual_gross_price,
      driving_distance_km,
      manual_distance_km,
      billing_variant_id,
      kts_document_applies,
      no_invoice_required,
      is_wheelchair,
      link_type,
      linked_trip_id,
      driver:accounts!trips_driver_id_fkey(name),
      payer:payers(rechnungsempfaenger_id, manual_km_enabled),
      billing_variant:billing_variants(
        id, code, name, billing_type_id, rechnungsempfaenger_id,
        billing_type:billing_types(name, rechnungsempfaenger_id)
      ),
      client:clients(id, first_name, last_name, price_tag, reference_fields)
    `
    )
    .eq('payer_id', params.payer_id)
    .eq('status', CANCELLED_STATUS)
    .gte('scheduled_at', params.period_from)
    .lte('scheduled_at', params.period_to + 'T23:59:59.999Z')
    .order('scheduled_at', { ascending: true });

  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }

  if (params.client_id) {
    query = query.eq('client_id', params.client_id);
  }

  const { data, error } = await query;
  if (error) throw toQueryError(error);
  const trips = (data ?? []) as unknown as CancelledTripRow[];
  const clientIds = [
    ...new Set(
      trips
        .map((t) => t.client?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  ];
  const [clientPriceTags, clientKmOverrides] = await Promise.all([
    listClientPriceTagsForClientIds(clientIds),
    listClientKmOverridesForClientIds(clientIds)
  ]);
  return { trips, clientPriceTags, clientKmOverrides };
}

/**
 * Prices a single cancelled trip for billing opt-in — runs the same cascade as
 * `buildLineItemsFromTrips` for one row. Returns the pricing state to merge into
 * the `BuilderCancelledTripRow` in the hook.
 *
 * Requires the trip to have been fetched with the extended pricing fields from
 * `fetchCancelledTripsForBuilder`.
 */
export function buildCancelledTripBillingState(
  trip: CancelledTripRow,
  rules: BillingPricingRuleLike[],
  clientPriceTags: ClientPriceTagLike[] = [],
  clientKmOverrides: ClientKmOverrideLike[] = []
): Partial<BuilderCancelledTripRow> {
  const effectiveDistanceKm = resolveEffectiveDistanceKm({
    manualDistanceKm: trip.manual_distance_km ?? null,
    drivingDistanceKm: trip.driving_distance_km ?? null,
    clientId: trip.client?.id ?? null,
    payerId: trip.payer_id ?? null,
    billingVariantId: trip.billing_variant_id ?? null,
    clientKmOverrides
  });

  const { rate: taxRate } = resolveTaxRate(effectiveDistanceKm);

  const rule = resolvePricingRule({
    rules,
    // why: payer_id may be null on old cancelled trips; empty string falls through to default rule
    payerId: trip.payer_id ?? '',
    billingTypeId: trip.billing_variant?.billing_type_id ?? null,
    billingVariantId: trip.billing_variant_id ?? null,
    clientId: trip.client?.id ?? null,
    clientPriceTags
  });

  const priceResolution = resolveTripPricePure(
    {
      kts_document_applies: trip.kts_document_applies === true,
      net_price: trip.net_price ?? null,
      base_net_price: trip.base_net_price ?? null,
      manual_gross_price: trip.manual_gross_price ?? null,
      driving_distance_km: effectiveDistanceKm,
      scheduled_at: trip.scheduled_at,
      // why: narrow client to only price_tag which is what resolveTripPricePure expects
      client: trip.client ? { price_tag: trip.client.price_tag ?? null } : null
    },
    taxRate,
    rule
  );

  const clientName = trip.client
    ? [trip.client.first_name, trip.client.last_name].filter(Boolean).join(' ')
    : trip.client_name?.trim() || null;
  void clientName;

  return {
    price_resolution: priceResolution,
    resolved_rule: rule ?? null,
    unit_price: priceResolution.unit_price_net,
    tax_rate: taxRate,
    quantity: priceResolution.quantity,
    approach_fee_net: priceResolution.approach_fee_net ?? null,
    approach_fee_gross:
      priceResolution.approach_fee_net != null
        ? Math.round(priceResolution.approach_fee_net * (1 + taxRate) * 100) /
          100
        : null,
    effective_distance_km: effectiveDistanceKm,
    original_distance_km: trip.driving_distance_km ?? null,
    kts_override: priceResolution.strategy_used === 'kts_override',
    originalPriceResolution: priceResolution,
    manualGrossTotal: null,
    manualApproachFeeGross: null,
    isManualOverride: false,
    manualDistanceKm: null,
    isManualKmOverride: false,
    billing_variant_code: trip.billing_variant?.code ?? null,
    billing_variant_name: trip.billing_variant?.name ?? null,
    billing_type_name: trip.billing_variant?.billing_type?.name ?? null
  };
}

/** Maps DB pricing rule rows to the shape expected by pure resolvers. */
export function mapBillingPricingRuleRowsToLike(
  rows: BillingPricingRuleRow[]
): BillingPricingRuleLike[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    company_id: r.company_id,
    payer_id: r.payer_id,
    billing_type_id: r.billing_type_id,
    billing_variant_id: r.billing_variant_id,
    strategy: r.strategy as BillingPricingRuleLike['strategy'],
    config: r.config,
    pricing_basis: r.pricing_basis ?? 'net',
    is_active: r.is_active === true
  }));
}

/**
 * Loads trips for the builder; optionally reuses pre-fetched rules (e.g. from
 * `referenceKeys.billingPricingRules` via TanStack `fetchQuery`).
 */
export async function fetchBuilderTripsAndRules(
  params: FetchTripsForBuilderParams,
  preloadedRules?: BillingPricingRuleLike[]
): Promise<{
  trips: TripForInvoice[];
  rules: BillingPricingRuleLike[];
  clientPriceTags: ClientPriceTagLike[];
  clientKmOverrides: ClientKmOverrideLike[];
}> {
  const { trips, clientPriceTags, clientKmOverrides } =
    await fetchTripsForBuilder(params);
  let rules: BillingPricingRuleLike[];
  if (preloadedRules !== undefined) {
    rules = preloadedRules;
  } else {
    const rulesRows = await listPricingRulesForPayer(params.payer_id);
    rules = mapBillingPricingRuleRowsToLike(rulesRows);
  }
  return { trips, rules, clientPriceTags, clientKmOverrides };
}

// ─── Build line items ─────────────────────────────────────────────────────────

/**
 * Converts trip rows into BuilderLineItem objects (in-memory, not yet saved).
 * Uses Spec C cascade via `resolveTripPrice` + `resolvePricingRule`.
 */
export function buildLineItemsFromTrips(
  trips: TripForInvoice[],
  rules: BillingPricingRuleLike[],
  clientPriceTags: ClientPriceTagLike[] = [],
  clientKmOverrides: ClientKmOverrideLike[] = []
): BuilderLineItem[] {
  const rawItems = trips.map((trip, index) => {
    // why: VAT and pricing must use the same distance the business intends to bill;
    // resolving once avoids split-brain between §12 UStG tiering and per-km rules.
    const effectiveDistanceKm = resolveEffectiveDistanceKm({
      manualDistanceKm: trip.manual_distance_km ?? null,
      drivingDistanceKm: trip.driving_distance_km ?? null,
      clientId: trip.client?.id ?? null,
      payerId: trip.payer_id ?? null,
      billingVariantId: trip.billing_variant_id ?? null,
      clientKmOverrides
    });

    const { rate: taxRate } = resolveTaxRate(effectiveDistanceKm);

    const rule = resolvePricingRule({
      rules,
      payerId: trip.payer_id,
      billingTypeId: trip.billing_variant?.billing_type_id ?? null,
      billingVariantId: trip.billing_variant_id,
      clientId: trip.client?.id ?? null,
      clientPriceTags
    });

    // manual_gross_price: persisted taxameter — P0 in resolveTripPrice (trips are SSOT).
    const priceResolution = resolveTripPricePure(
      {
        kts_document_applies: trip.kts_document_applies === true,
        net_price: trip.net_price ?? null,
        base_net_price: trip.base_net_price ?? null,
        manual_gross_price: trip.manual_gross_price ?? null,
        driving_distance_km: effectiveDistanceKm,
        scheduled_at: trip.scheduled_at,
        client: trip.client
      },
      taxRate,
      rule
    );

    const kts_override = priceResolution.strategy_used === 'kts_override';
    const unitPrice = priceResolution.unit_price_net;
    const quantity = priceResolution.quantity;

    // why: monthly batches include “named but not registered” trips (`client_id` null,
    // `trips.client_name` set per docs/trip-client-linking.md). Stammdaten wins when linked;
    // otherwise snapshot the trip-level display name so PDF appendix Fahrgast is not blank.
    const clientName = trip.client
      ? [trip.client.first_name, trip.client.last_name]
          .filter(Boolean)
          .join(' ')
      : trip.client_name?.trim() || null;

    const dateStr = trip.scheduled_at
      ? new Date(trip.scheduled_at).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })
      : null;

    const description = [
      dateStr ? `Fahrt vom ${dateStr}` : 'Fahrt (kein Datum)',
      clientName
    ]
      .filter(Boolean)
      .join(' – ');

    return {
      trip_id: trip.id,
      position: index + 1,
      line_date: trip.scheduled_at,
      description,
      client_name: clientName,
      pickup_address: trip.pickup_address,
      dropoff_address: trip.dropoff_address,
      distance_km: trip.driving_distance_km,
      effective_distance_km: effectiveDistanceKm,
      original_distance_km: trip.driving_distance_km ?? null,
      manual_km_enabled: trip.payer?.manual_km_enabled ?? false,
      unit_price: unitPrice,
      quantity,
      tax_rate: taxRate,
      billing_variant_code: trip.billing_variant?.code ?? null,
      // Snapshot semantics:
      // - billing_variant_* = Unterart (billing_variants)
      // - billing_type_name = Abrechnungsfamilie label (billing_types)
      // Both are frozen on invoice creation (§14 UStG) for audit and PDF output.
      billing_variant_name: trip.billing_variant?.name ?? null,
      billing_type_name: trip.billing_variant?.billing_type?.name ?? null,
      kts_document_applies: trip.kts_document_applies === true,
      no_invoice_warning: trip.no_invoice_required === true,
      // why: snapshot at build time — invoice_line_items has no wheelchair column;
      // edit mode batch-fetches live trips.is_wheelchair on hydration instead.
      is_wheelchair: trip.is_wheelchair ?? false,
      price_resolution: priceResolution,
      resolved_rule: rule ?? null,
      kts_override,
      approach_fee_net: priceResolution.approach_fee_net ?? null,
      approach_fee_gross:
        priceResolution.approach_fee_net != null
          ? Math.round(priceResolution.approach_fee_net * (1 + taxRate) * 100) /
            100
          : null,
      originalPriceResolution: priceResolution,
      manualGrossTotal: null,
      manualApproachFeeGross: null,
      isManualOverride: false,
      // why: normal trips are always included in billing by default; admin can opt out in Step 3.
      billingInclusion: { included: true, reason: '' },
      trip_meta: buildTripMetaFromTrip(trip),
      price_source: legacyPriceSource(priceResolution.source),
      // why: When net is set, value is line net (transport + approach_fee_net) rounded to
      // cents — not transport-only; old helper used unit×qty only. Fallback keeps legacy
      // transport-only from display fields. Discarded before validateLineItems.
      _totalPrice:
        priceResolution.net !== null && priceResolution.net !== undefined
          ? Math.round(
              (priceResolution.net + (priceResolution.approach_fee_net ?? 0)) *
                100
            ) / 100
          : unitPrice !== null && unitPrice !== undefined
            ? Math.round(unitPrice * quantity * 100) / 100
            : null
    } as Omit<BuilderLineItem, 'warnings'> & { _totalPrice: number | null };
  });

  return validateLineItems(
    rawItems.map((row) => {
      const { _totalPrice: _tp, ...rest } = row;
      void _tp;
      return rest;
    })
  );
}

export function frozenPriceResolutionForInsert(
  item: TotalsLineShape
): PriceResolution {
  const u = item.unit_price;
  const pr = item.price_resolution;
  if (u === null || u === undefined) {
    return pr;
  }
  const prev = pr.unit_price_net;
  if (prev === null || prev === undefined || Math.abs(prev - u) > 0.0001) {
    // why: apply manual unit net using the minimal fields available on TotalsLineShape
    const qty = item.quantity;
    const tr = item.tax_rate;
    const netTotal = Math.round(u * qty * 100) / 100;
    const grossTotal = Math.round(netTotal * (1 + tr) * 100) / 100;
    const prevNote = pr.note;
    const manualNote = 'Manuell angepasst';
    const note =
      prevNote && !prevNote.includes(manualNote)
        ? `${prevNote} · ${manualNote}`
        : prevNote && prevNote.includes(manualNote)
          ? prevNote
          : manualNote;
    return {
      ...pr,
      unit_price_net: u,
      net: netTotal,
      gross: grossTotal,
      tax_rate: tr,
      strategy_used: 'manual_trip_price',
      source: 'trip_price',
      note
    };
  }
  return pr;
}

// ─── Calculate invoice totals ─────────────────────────────────────────────────

/**
 * Calculates invoice totals (subtotal, tax, grand total) and tax breakdown
 * from a list of builder line items.
 *
 * **`client_price_tag` (gross-anchor):** `insertLineItems` and this function use
 * `price_resolution.gross × quantity` plus grossed-up `approach_fee_net` — never
 * re-derive transport gross from rounded `unit_price_net`.
 *
 * **Net-anchor lines:** Line transport net uses `PriceResolution.net` from
 * `frozenPriceResolutionForInsert` when present — not `unit_price × quantity`
 * (display per-km unit can round so the product ≠ tiered total). Net is accumulated
 * into `byRate` buckets; VAT is rounded once per rate bucket. Header `tax_amount` is
 * `total − subtotal` so Netto + MwSt equals Brutto. `breakdown` merges gross-anchor
 * implied net into the same rate buckets (display; per-bucket `tax` may differ
 * slightly from the header).
 */
export function calculateInvoiceTotals(items: TotalsLineShape[]): {
  subtotal: number;
  taxAmount: number;
  total: number;
  breakdown: TaxBreakdown[];
} {
  const byRateMerged: Record<number, number> = {};
  const byRateNonTag: Record<number, number> = {};
  let nonTagSubtotal = 0;
  let grossFixed = 0;
  let priceTagNetTotal = 0;

  for (const item of items) {
    const pr = item.price_resolution;
    const rate = item.tax_rate;
    // Normalize before keying — prevents float drift producing duplicate buckets
    // e.g. 0.07000000000000001 must collapse to the same bucket as 0.07
    const normalizedRate = Math.round(item.tax_rate * 100) / 100;
    const approach = item.approach_fee_net ?? 0;

    if (item.manualGrossTotal !== null && item.manualGrossTotal !== undefined) {
      const gLine = item.manualGrossTotal;
      // why: Admin-entered brutto is the SSOT for Step 3 display; reverse-derived
      // `unit_price` / `approach_fee_net` can drift by a cent. This path matches
      // `lineItemGrossTotalForDisplay` so the footer matches the Bruttopreis column.
      grossFixed += gLine;
      const lineNet = gLine / (1 + rate);
      priceTagNetTotal += lineNet;

      if (byRateMerged[normalizedRate] === undefined) {
        byRateMerged[normalizedRate] = 0;
      }
      byRateMerged[normalizedRate] += lineNet;
      continue;
    }

    if (isGrossAnchorClientPriceTag(pr)) {
      const g = pr.gross as number;
      const qty = item.quantity;
      // Gross-anchor path (client_price_tag):
      // Sum gross × quantity directly. Do NOT re-derive from stored unit_price_net,
      // because unit_price_net is a full-precision float (gross / (1 + rate)) and
      // multiplying it back up would reintroduce the rounding error we are fixing.
      // approach_fee_net is still net-anchored so it is grossed up separately.
      grossFixed += g * qty + approach * (1 + rate);
      const lineNet = (g * qty) / (1 + rate) + approach;
      priceTagNetTotal += lineNet;

      if (byRateMerged[normalizedRate] === undefined) {
        byRateMerged[normalizedRate] = 0;
      }
      byRateMerged[normalizedRate] += lineNet;
    } else {
      // Net-anchor path (all strategies except client_price_tag):
      // Accumulate net line totals by tax rate. Tax is computed ONCE per rate bucket
      // below (round(bucketNet × rate)), not per line, to minimise rounding drift
      // across many trips at the same rate.
      const frozen = frozenPriceResolutionForInsert(item);
      const fallbackTransport =
        item.unit_price !== null ? item.unit_price * item.quantity : 0;
      const baseNet =
        frozen.net !== null && frozen.net !== undefined
          ? frozen.net
          : fallbackTransport;
      // why: Same transport net as insertLineItems / tieredNetTotal; not unit × qty.
      const lineTotal = baseNet + approach;
      nonTagSubtotal += lineTotal;

      if (byRateNonTag[normalizedRate] === undefined) {
        byRateNonTag[normalizedRate] = 0;
      }
      byRateNonTag[normalizedRate] += lineTotal;

      if (byRateMerged[normalizedRate] === undefined) {
        byRateMerged[normalizedRate] = 0;
      }
      byRateMerged[normalizedRate] += lineTotal;
    }
  }

  const taxNonTag = Object.entries(byRateNonTag).reduce(
    (sum, [rateStr, net]) => {
      return sum + Math.round(net * parseFloat(rateStr) * 100) / 100;
    },
    0
  );

  const total =
    Math.round((nonTagSubtotal + taxNonTag + grossFixed) * 100) / 100;
  const subtotal = Math.round((nonTagSubtotal + priceTagNetTotal) * 100) / 100;
  const taxAmount = Math.round((total - subtotal) * 100) / 100;

  const breakdown: TaxBreakdown[] = Object.entries(byRateMerged).map(
    ([rateStr, net]) => ({
      rate: parseFloat(rateStr),
      net: Math.round(net * 100) / 100,
      tax: Math.round(net * parseFloat(rateStr) * 100) / 100
    })
  );

  return {
    subtotal,
    taxAmount,
    total,
    breakdown
  };
}

// ─── Persist line items ───────────────────────────────────────────────────────

/**
 * Maps a BuilderLineItem to an invoice_line_items insert row.
 *
 * Exported so the draft re-open round-trip tests can assert that
 * `mapLineItemRowToBuilderLineItem` → this function reproduces the persisted
 * financial fields exactly. Behavior is unchanged.
 */
export function lineItemToInsertRow(
  invoiceId: string,
  item: BuilderLineItem
): Record<string, unknown> {
  const frozen = frozenPriceResolutionForInsert(item);
  let total_price: number;
  if (isGrossAnchorClientPriceTag(frozen)) {
    total_price =
      frozen.gross! * item.quantity +
      (item.approach_fee_net ?? 0) * (1 + item.tax_rate);
  } else {
    const transportNet =
      frozen.net !== null && frozen.net !== undefined
        ? frozen.net
        : (item.unit_price ?? 0) * item.quantity;
    total_price =
      (transportNet + (item.approach_fee_net ?? 0)) * (1 + item.tax_rate);
  }
  return {
    invoice_id: invoiceId,
    trip_id: item.trip_id,
    position: item.position,
    line_date: item.line_date,
    description: item.description,
    client_name: item.client_name,
    pickup_address: item.pickup_address,
    dropoff_address: item.dropoff_address,
    distance_km: item.distance_km,
    effective_distance_km: item.effective_distance_km ?? null,
    original_distance_km: item.original_distance_km ?? null,
    unit_price: item.unit_price ?? 0,
    quantity: item.quantity,
    total_price,
    approach_fee_net: item.approach_fee_net ?? null,
    tax_rate: item.tax_rate,
    billing_variant_code: item.billing_variant_code,
    billing_variant_name: item.billing_variant_name,
    billing_type_name: item.billing_type_name,
    pricing_strategy_used: frozen.strategy_used,
    pricing_source: frozen.source,
    kts_override: item.kts_override,
    price_resolution_snapshot: frozen as unknown as Record<string, unknown>,
    trip_meta_snapshot: item.trip_meta
      ? (item.trip_meta as unknown as Record<string, unknown>)
      : null,
    // why: billing inclusion snapshot — opted-out rows persist for audit + appendix
    billing_included: item.billingInclusion.included,
    billing_exclusion_reason: item.billingInclusion.included
      ? null
      : item.billingInclusion.reason || null,
    is_cancelled_trip: false,
    cancelled_billing_reason: null
  };
}

/**
 * Maps an opted-in BuilderCancelledTripRow to an invoice_line_items insert row.
 *
 * Exported for the draft re-open round-trip tests (inverse of
 * `mapLineItemRowToBuilderCancelledTrip`). Behavior is unchanged.
 */
export function cancelledTripToInsertRow(
  invoiceId: string,
  trip: BuilderCancelledTripRow,
  position: number
): Record<string, unknown> {
  const frozen = trip.price_resolution
    ? frozenPriceResolutionForInsert({
        price_resolution: trip.price_resolution,
        tax_rate: trip.tax_rate ?? 0,
        quantity: trip.quantity ?? 1,
        approach_fee_net: trip.approach_fee_net ?? null,
        unit_price: trip.unit_price ?? null,
        manualGrossTotal: trip.manualGrossTotal ?? null
      })
    : null;

  const pr = frozen ?? trip.price_resolution;
  const taxRate = trip.tax_rate ?? 0;
  const qty = trip.quantity ?? 1;
  let total_price = 0;
  if (pr) {
    if (isGrossAnchorClientPriceTag(pr)) {
      total_price =
        pr.gross! * qty + (trip.approach_fee_net ?? 0) * (1 + taxRate);
    } else {
      const transportNet =
        pr.net !== null && pr.net !== undefined
          ? pr.net
          : (trip.unit_price ?? 0) * qty;
      total_price =
        (transportNet + (trip.approach_fee_net ?? 0)) * (1 + taxRate);
    }
  }

  const clientName = trip.client
    ? [trip.client.first_name, trip.client.last_name].filter(Boolean).join(' ')
    : trip.client_name?.trim() || null;

  return {
    invoice_id: invoiceId,
    trip_id: trip.id,
    // why: opted-in cancelled rows append after max normal position; position column not shown in PDF for these rows
    position,
    line_date: trip.scheduled_at,
    description: `Storno-Fahrt: ${clientName ?? ''}`,
    client_name: clientName,
    pickup_address: trip.pickup_address,
    dropoff_address: trip.dropoff_address,
    distance_km: trip.driving_distance_km ?? null,
    effective_distance_km: trip.effective_distance_km ?? null,
    original_distance_km: trip.original_distance_km ?? null,
    unit_price: trip.unit_price ?? 0,
    quantity: qty,
    total_price,
    approach_fee_net: trip.approach_fee_net ?? null,
    tax_rate: taxRate,
    billing_variant_code: trip.billing_variant_code ?? null,
    billing_variant_name: trip.billing_variant_name ?? null,
    billing_type_name: trip.billing_type_name ?? null,
    pricing_strategy_used: pr?.strategy_used ?? null,
    pricing_source: pr?.source ?? null,
    kts_override: trip.kts_override ?? false,
    price_resolution_snapshot: pr
      ? (pr as unknown as Record<string, unknown>)
      : null,
    trip_meta_snapshot: null,
    billing_included: true,
    billing_exclusion_reason: null,
    is_cancelled_trip: true,
    cancelled_billing_reason: trip.billingInclusion.reason || null
  };
}

/**
 * Inserts line items for a newly created invoice into the DB.
 *
 * @param items - All normal BuilderLineItems (included + excluded — excluded rows persist for audit).
 * @param optedInCancelledTrips - Cancelled trips the admin opted in for billing.
 */
export async function insertLineItems(
  invoiceId: string,
  items: BuilderLineItem[],
  optedInCancelledTrips: BuilderCancelledTripRow[] = []
): Promise<InvoiceLineItemRow[]> {
  const supabase = createClient();

  // §14 UStG: snapshot frozen at invoice creation — never mutate after this point
  const normalRows = items.map((item) => lineItemToInsertRow(invoiceId, item));

  // why: opted-in cancelled trips append after max normal position so they don't
  // disrupt the position sort order of normal line items in the main PDF table
  const maxPosition = items.length;
  const cancelledRows = optedInCancelledTrips.map((trip, i) =>
    cancelledTripToInsertRow(invoiceId, trip, maxPosition + i + 1)
  );

  const rows = [...normalRows, ...cancelledRows];

  const { data, error } = await supabase
    .from('invoice_line_items')
    .insert(rows)
    .select();

  if (error) throw toQueryError(error);
  return (data ?? []) as unknown as InvoiceLineItemRow[];
}
