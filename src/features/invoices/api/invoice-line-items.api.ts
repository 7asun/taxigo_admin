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
import { validateLineItems } from '../lib/invoice-validators';
import { buildTripMetaFromTrip } from '../lib/trip-meta-snapshot';
import type {
  BillingPricingRuleLike,
  ClientPriceTagLike
} from '../types/pricing.types';
import { listClientPriceTagsForClientIds } from '@/features/payers/api/client-price-tags.service';
import type { PriceResolution } from '../types/pricing.types';
import type {
  TripForInvoice,
  BuilderLineItem,
  InvoiceLineItemRow,
  TaxBreakdown
} from '../types/invoice.types';

/** True when line gross must use `price_resolution.gross × qty` (not derived net × VAT). */
export function isGrossAnchorClientPriceTag(pr: PriceResolution): boolean {
  return pr.strategy_used === 'client_price_tag' && pr.gross != null;
}

// ─── Fetch trips for the invoice builder ──────────────────────────────────────

export interface FetchTripsForBuilderParams {
  payer_id: string;
  billing_type_id?: string | null; // null = all billing types
  /** Optional: scope to exactly one Unterart (billing_variants.id). */
  billing_variant_id?: string | null; // null = all variants (subject to billing_type_id filter)
  period_from: string; // ISO date string
  period_to: string; // ISO date string
  client_id?: string | null; // only for per_client mode
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
}> {
  const supabase = createClient();

  // Filter priority:
  // 1) billing_variant_id (exact Unterart) → trips.billing_variant_id = X
  // 2) billing_type_id (family) → trips.billing_variant_id IN (variants under family)
  // 3) neither → no variant filter
  const variantId =
    params.billing_variant_id && params.billing_variant_id.length > 0
      ? params.billing_variant_id
      : null;

  let variantIdsForType: string[] | null = null;
  if (!variantId && params.billing_type_id) {
    const { data: variants, error: vErr } = await supabase
      .from('billing_variants')
      .select('id')
      .eq('billing_type_id', params.billing_type_id);
    if (vErr) throw toQueryError(vErr);
    variantIdsForType = (variants ?? []).map((v) => v.id);
    if (variantIdsForType.length === 0) {
      return { trips: [], clientPriceTags: [] };
    }
  }

  let query = supabase
    .from('trips')
    .select(
      `
      id,
      payer_id,
      scheduled_at,
      price,
      driving_distance_km,
      billing_variant_id,
      pickup_address,
      dropoff_address,
      kts_document_applies,
      no_invoice_required,
      link_type,
      linked_trip_id,
      driver:accounts!trips_driver_id_fkey(name),
      payer:payers(rechnungsempfaenger_id),
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
  const clientPriceTags = await listClientPriceTagsForClientIds(clientIds);
  return { trips, clientPriceTags };
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
}> {
  const { trips, clientPriceTags } = await fetchTripsForBuilder(params);
  let rules: BillingPricingRuleLike[];
  if (preloadedRules !== undefined) {
    rules = preloadedRules;
  } else {
    const rulesRows = await listPricingRulesForPayer(params.payer_id);
    rules = mapBillingPricingRuleRowsToLike(rulesRows);
  }
  return { trips, rules, clientPriceTags };
}

// ─── Build line items ─────────────────────────────────────────────────────────

/**
 * Converts trip rows into BuilderLineItem objects (in-memory, not yet saved).
 * Uses Spec C cascade via `resolveTripPrice` + `resolvePricingRule`.
 */
export function buildLineItemsFromTrips(
  trips: TripForInvoice[],
  rules: BillingPricingRuleLike[],
  clientPriceTags: ClientPriceTagLike[] = []
): BuilderLineItem[] {
  const rawItems = trips.map((trip, index) => {
    const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);

    const rule = resolvePricingRule({
      rules,
      payerId: trip.payer_id,
      billingTypeId: trip.billing_variant?.billing_type_id ?? null,
      billingVariantId: trip.billing_variant_id,
      clientId: trip.client?.id ?? null,
      clientPriceTags
    });

    const priceResolution = resolveTripPricePure(
      {
        kts_document_applies: trip.kts_document_applies === true,
        price: trip.price ?? null,
        driving_distance_km: trip.driving_distance_km ?? null,
        scheduled_at: trip.scheduled_at,
        client: trip.client
      },
      taxRate,
      rule
    );

    const kts_override = priceResolution.strategy_used === 'kts_override';
    const unitPrice = priceResolution.unit_price_net;
    const quantity = priceResolution.quantity;

    const clientName = trip.client
      ? [trip.client.first_name, trip.client.last_name]
          .filter(Boolean)
          .join(' ')
      : null;

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
      price_resolution: priceResolution,
      kts_override,
      approach_fee_net: priceResolution.approach_fee_net ?? null,
      trip_meta: buildTripMetaFromTrip(trip),
      price_source: legacyPriceSource(priceResolution.source),
      _totalPrice:
        unitPrice !== null && unitPrice !== undefined
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
  item: BuilderLineItem
): PriceResolution {
  const u = item.unit_price;
  const pr = item.price_resolution;
  if (u === null || u === undefined) {
    return pr;
  }
  const prev = pr.unit_price_net;
  if (prev === null || prev === undefined || Math.abs(prev - u) > 0.0001) {
    return applyManualUnitNetToResolution(item, u);
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
 * **Net-anchor lines:** Net is accumulated into `byRate` buckets; VAT is rounded
 * once per rate bucket. Header `tax_amount` is `total − subtotal` so Netto + MwSt
 * equals Brutto. `breakdown` merges gross-anchor implied net into the same rate
 * buckets (display; per-bucket `tax` may differ slightly from the header).
 */
export function calculateInvoiceTotals(items: BuilderLineItem[]): {
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
    const approach = item.approach_fee_net ?? 0;

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

      if (byRateMerged[rate] === undefined) {
        byRateMerged[rate] = 0;
      }
      byRateMerged[rate] += lineNet;
    } else {
      // Net-anchor path (all strategies except client_price_tag):
      // Accumulate net line totals by tax rate. Tax is computed ONCE per rate bucket
      // below (round(bucketNet × rate)), not per line, to minimise rounding drift
      // across many trips at the same rate.
      const baseNet =
        item.unit_price !== null ? item.unit_price * item.quantity : 0;
      const lineTotal = baseNet + approach;
      nonTagSubtotal += lineTotal;

      if (byRateNonTag[rate] === undefined) {
        byRateNonTag[rate] = 0;
      }
      byRateNonTag[rate] += lineTotal;

      if (byRateMerged[rate] === undefined) {
        byRateMerged[rate] = 0;
      }
      byRateMerged[rate] += lineTotal;
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
 * Inserts line items for a newly created invoice into the DB.
 */
export async function insertLineItems(
  invoiceId: string,
  items: BuilderLineItem[]
): Promise<InvoiceLineItemRow[]> {
  const supabase = createClient();

  // §14 UStG: snapshot frozen at invoice creation — never mutate after this point
  const rows = items.map((item) => {
    const frozen = frozenPriceResolutionForInsert(item);
    // total_price persisted to invoice_line_items.
    //
    // For `client_price_tag` lines, the gross is the anchor (set in resolveTripPrice
    // P1 branch). We use price_resolution.gross × quantity so that the stored line
    // gross matches the negotiated tag exactly — no float drift from round(net) × qty.
    //
    // For all other strategies (net-anchored), gross is derived here as
    // (unit_price × quantity + approach_fee_net) × (1 + tax_rate). The one-time
    // rounding happens here at line level, not inside the resolver.
    //
    // approach_fee_net is always net-anchored and follows the net-anchor path
    // regardless of the base transport strategy.
    const total_price = isGrossAnchorClientPriceTag(frozen)
      ? frozen.gross! * item.quantity +
        (item.approach_fee_net ?? 0) * (1 + item.tax_rate)
      : ((item.unit_price ?? 0) * item.quantity +
          (item.approach_fee_net ?? 0)) *
        (1 + item.tax_rate);
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
      // §14 UStG: snapshot frozen at invoice creation — never mutate after this point
      price_resolution_snapshot: frozen as unknown as Record<string, unknown>,
      trip_meta_snapshot: item.trip_meta
        ? (item.trip_meta as unknown as Record<string, unknown>)
        : null
    };
  });

  const { data, error } = await supabase
    .from('invoice_line_items')
    .insert(rows)
    .select();

  if (error) throw toQueryError(error);
  return (data ?? []) as unknown as InvoiceLineItemRow[];
}
