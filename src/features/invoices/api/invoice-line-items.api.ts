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
import type { BillingPricingRuleLike } from '../types/pricing.types';
import type { PriceResolution } from '../types/pricing.types';
import type {
  TripForInvoice,
  BuilderLineItem,
  InvoiceLineItemRow,
  TaxBreakdown
} from '../types/invoice.types';

// ─── Fetch trips for the invoice builder ──────────────────────────────────────

export interface FetchTripsForBuilderParams {
  payer_id: string;
  billing_type_id?: string | null; // null = all billing types
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
 * @returns       Array of TripForInvoice objects ready for line item building.
 */
export async function fetchTripsForBuilder(
  params: FetchTripsForBuilderParams
): Promise<TripForInvoice[]> {
  const supabase = createClient();

  let variantIdsForType: string[] | null = null;
  if (params.billing_type_id) {
    const { data: variants, error: vErr } = await supabase
      .from('billing_variants')
      .select('id')
      .eq('billing_type_id', params.billing_type_id);
    if (vErr) throw toQueryError(vErr);
    variantIdsForType = (variants ?? []).map((v) => v.id);
    if (variantIdsForType.length === 0) {
      return [];
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
      client:clients(id, first_name, last_name, price_tag)
    `
    )
    .eq('payer_id', params.payer_id)
    .gte('scheduled_at', params.period_from)
    .lte('scheduled_at', params.period_to + 'T23:59:59.999Z')
    .order('scheduled_at', { ascending: true });

  if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }

  if (params.client_id) {
    query = query.eq('client_id', params.client_id);
  }

  const { data, error } = await query;

  if (error) throw toQueryError(error);
  return (data ?? []) as unknown as TripForInvoice[];
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
}> {
  const trips = await fetchTripsForBuilder(params);
  let rules: BillingPricingRuleLike[];
  if (preloadedRules !== undefined) {
    rules = preloadedRules;
  } else {
    const rulesRows = await listPricingRulesForPayer(params.payer_id);
    rules = mapBillingPricingRuleRowsToLike(rulesRows);
  }
  return { trips, rules };
}

// ─── Build line items ─────────────────────────────────────────────────────────

/**
 * Converts trip rows into BuilderLineItem objects (in-memory, not yet saved).
 * Uses Spec C cascade via `resolveTripPrice` + `resolvePricingRule`.
 */
export function buildLineItemsFromTrips(
  trips: TripForInvoice[],
  rules: BillingPricingRuleLike[]
): BuilderLineItem[] {
  const rawItems = trips.map((trip, index) => {
    const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);

    const rule = resolvePricingRule({
      rules,
      payerId: trip.payer_id,
      billingTypeId: trip.billing_variant?.billing_type_id ?? null,
      billingVariantId: trip.billing_variant_id
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
      // Always snapshot the billing_type (family) name — variant name and code are intentionally
      // ignored. PDF groups by Abrechnungsfamilie only, never by variant (§14 UStG snapshot).
      billing_variant_name: trip.billing_variant?.billing_type?.name ?? null,
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
 * Includes `approach_fee_net` per line — must match `insertLineItems` total_price formula.
 */
export function calculateInvoiceTotals(items: BuilderLineItem[]): {
  subtotal: number;
  taxAmount: number;
  total: number;
  breakdown: TaxBreakdown[];
} {
  const byRate: Record<number, number> = {};

  let subtotal = 0;

  for (const item of items) {
    const baseNet =
      item.unit_price !== null ? item.unit_price * item.quantity : 0;
    const lineTotal = baseNet + (item.approach_fee_net ?? 0);

    subtotal += lineTotal;

    if (byRate[item.tax_rate] === undefined) {
      byRate[item.tax_rate] = 0;
    }
    byRate[item.tax_rate] += lineTotal;
  }

  const breakdown: TaxBreakdown[] = Object.entries(byRate).map(
    ([rate, net]) => ({
      rate: parseFloat(rate),
      net: Math.round(net * 100) / 100,
      tax: Math.round(net * parseFloat(rate) * 100) / 100
    })
  );

  const taxAmount = breakdown.reduce((sum, b) => sum + b.tax, 0);
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
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
      // total_price = (unit_price × quantity + approach_fee_net) × (1 + tax_rate)
      total_price:
        ((item.unit_price ?? 0) * item.quantity +
          (item.approach_fee_net ?? 0)) *
        (1 + item.tax_rate),
      approach_fee_net: item.approach_fee_net ?? null,
      tax_rate: item.tax_rate,
      billing_variant_code: item.billing_variant_code,
      billing_variant_name: item.billing_variant_name,
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
