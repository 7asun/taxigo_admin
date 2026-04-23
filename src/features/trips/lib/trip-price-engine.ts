/**
 * trip-price-engine.ts
 *
 * Phase 1: Load pricing context from Supabase and compute the three price
 * fields (net_price, gross_price, tax_rate) for a trip at creation time.
 *
 * `loadPricingContext` — async, accepts any SupabaseClient (browser, server action,
 *   or cron service-role). Uses direct queries to avoid session-bound helpers.
 *
 * `computeTripPrice`   — pure synchronous, no I/O. Delegates to existing pure
 *   resolvers in `src/features/invoices/lib/` which are never modified here.
 *
 * Phase 3 — edit path helpers:
 *
 * `shouldRecalculatePrice` — pure, synchronous. Checks whether a partial update
 *   patch touches any pricing-relevant field. Single source of truth for the
 *   trigger field list. Update paths must never hardcode these field names.
 *
 * `resolveTripForPricing`  — async. Fetches the current trip row from Supabase,
 *   merges the patch on top (patch fields win), and returns a ComputeTripPriceInput
 *   suitable for passing to computeTripPrice. net_price is always null to prevent
 *   the stored snapshot from bleeding into the P3 fallback of the recalculated price.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { mapBillingPricingRuleRowsToLike } from '@/features/invoices/api/invoice-line-items.api';
import { resolvePricingRule } from '@/features/invoices/lib/resolve-pricing-rule';
import { resolveTripPrice } from '@/features/invoices/lib/resolve-trip-price';
import { resolveTaxRate } from '@/features/invoices/lib/tax-calculator';
import type {
  BillingPricingRuleLike,
  ClientPriceTagLike
} from '@/features/invoices/types/pricing.types';
import type { Database } from '@/types/database.types';

// ─── Public types ──────────────────────────────────────────────────────────────

/** Loaded pricing context for one (companyId, payerId, clientId) triple. */
export interface PricingContext {
  /** Filtered, mapped billing pricing rules for the payer's catalog. */
  rules: BillingPricingRuleLike[];
  /** Active client price tags for this client (empty when clientId is null). */
  clientPriceTags: ClientPriceTagLike[];
  /** Legacy `clients.price_tag` (null when clientId is null or unset). */
  clientPriceTag: number | null;
}

/** The three price fields written to the `trips` row at creation time. */
export interface TripPriceFields {
  net_price: number | null;
  gross_price: number | null;
  tax_rate: number | null;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

type BillingPricingRuleRow =
  Database['public']['Tables']['billing_pricing_rules']['Row'];

/** Coerce Postgres `numeric` columns that Supabase may return as strings. */
function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return Number.NaN;
}

// ─── loadPricingContext ────────────────────────────────────────────────────────

export interface LoadPricingContextParams {
  /** Any Supabase client — browser, server action, or service-role admin. */
  supabase: SupabaseClient<Database>;
  /** Tenant company_id (required for rule scoping). */
  companyId: string;
  /** Kostenträger payer — if null, returns empty rules. */
  payerId: string | null;
  /** Client on the trip — if null, returns empty tags and null price_tag. */
  clientId: string | null;
}

/**
 * Loads all pricing data required by `computeTripPrice` for one
 * (companyId, payerId, clientId) combination.
 *
 * Callers should cache by `${companyId}:${payerId}:${clientId}` when
 * processing multiple trips in the same batch.
 *
 * Never throws — callers should wrap in try/catch and fall back to an
 * empty context so a failed load never blocks a trip save.
 */
export async function loadPricingContext({
  supabase,
  companyId,
  payerId,
  clientId
}: LoadPricingContextParams): Promise<PricingContext> {
  const empty: PricingContext = {
    rules: [],
    clientPriceTags: [],
    clientPriceTag: null
  };

  if (!payerId) return empty;

  // Run rule chain sequentially (each step depends on the previous).
  // Run client fetches in parallel with the rule chain.
  const [ruleChainResult, clientFetchResult] = await Promise.all([
    // ── Rule chain (3 queries) ─────────────────────────────────────────────
    (async () => {
      // 1a. billing_types for payer
      const { data: typeRows } = await supabase
        .from('billing_types')
        .select('id')
        .eq('payer_id', payerId);
      const typeIds = (typeRows ?? []).map((r) => r.id);

      // 1b. billing_variants for those types (skip if empty)
      let variantIds: string[] = [];
      if (typeIds.length > 0) {
        const { data: varRows } = await supabase
          .from('billing_variants')
          .select('id')
          .in('billing_type_id', typeIds);
        variantIds = (varRows ?? []).map((r) => r.id);
      }

      // 1c. All rules for company, filter in-memory to payer's catalog
      const { data: allRules } = await supabase
        .from('billing_pricing_rules')
        .select('*')
        .eq('company_id', companyId);

      const filtered = (allRules ?? ([] as BillingPricingRuleRow[])).filter(
        (r) =>
          r.payer_id === payerId ||
          (r.billing_type_id !== null && typeIds.includes(r.billing_type_id)) ||
          (r.billing_variant_id !== null &&
            variantIds.includes(r.billing_variant_id))
      );

      return mapBillingPricingRuleRowsToLike(
        filtered as BillingPricingRuleRow[]
      );
    })(),

    // ── Client fetches (run in parallel) ──────────────────────────────────
    clientId
      ? Promise.all([
          supabase
            .from('client_price_tags')
            .select('*')
            .eq('client_id', clientId)
            .eq('is_active', true),
          supabase
            .from('clients')
            .select('price_tag')
            .eq('id', clientId)
            .maybeSingle()
        ])
      : null
  ]);

  const rules = ruleChainResult;

  let clientPriceTags: ClientPriceTagLike[] = [];
  let clientPriceTag: number | null = null;

  if (clientFetchResult) {
    const [tagsResult, clientResult] = clientFetchResult;
    const tagRows = tagsResult.data ?? [];
    clientPriceTags = tagRows.map((row) => ({
      id: row.id,
      client_id: row.client_id,
      payer_id: row.payer_id,
      billing_variant_id: row.billing_variant_id,
      price_gross: toNum(row.price_gross),
      is_active: row.is_active === true
    }));
    clientPriceTag = clientResult.data?.price_tag ?? null;
  }

  return { rules, clientPriceTags, clientPriceTag };
}

// ─── computeTripPrice ──────────────────────────────────────────────────────────

export interface ComputeTripPriceInput {
  payer_id: string | null;
  billing_type_id: string | null;
  billing_variant_id: string | null;
  client_id: string | null;
  driving_distance_km: number | null;
  scheduled_at: string | null;
  kts_document_applies: boolean;
  net_price: number | null;
  /** Persisted taxameter gross on the trip — passed through to resolveTripPrice P0. */
  manual_gross_price: number | null;
}

/**
 * Pure synchronous computation of the three price fields for a trip.
 * Calls the existing pure resolvers; never performs I/O.
 *
 * Returns all-null when `payer_id` is absent (unresolved trips).
 * Returns all-null when the resolved strategy produces no price.
 * `tax_rate` is stored as `null` whenever `net_price` is `null`.
 */
export function computeTripPrice(
  trip: ComputeTripPriceInput,
  context: PricingContext
): TripPriceFields {
  const nullFields: TripPriceFields = {
    net_price: null,
    gross_price: null,
    tax_rate: null
  };

  if (!trip.payer_id) return nullFields;

  const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);

  const tripInput = {
    kts_document_applies: trip.kts_document_applies,
    net_price: trip.net_price,
    manual_gross_price: trip.manual_gross_price ?? null,
    driving_distance_km: trip.driving_distance_km,
    scheduled_at: trip.scheduled_at,
    client:
      context.clientPriceTag !== null
        ? { price_tag: context.clientPriceTag }
        : null
  };

  const rule = resolvePricingRule({
    rules: context.rules,
    payerId: trip.payer_id,
    billingTypeId: trip.billing_type_id,
    billingVariantId: trip.billing_variant_id,
    clientId: trip.client_id,
    clientPriceTags: context.clientPriceTags
  });

  const resolution = resolveTripPrice(tripInput, taxRate, rule);

  if (resolution.net === null) return nullFields;

  // approach_fee_net is intentionally excluded from resolution.net/gross:
  // the invoice builder adds it as a separate line item for per-line rendering.
  // The trip snapshot must include the full cost so reporting and the P4
  // fallback see the total, not just the base transport charge.
  // P0 taxameter (manual_gross_price) is all-in; approach_fee_net is always 0 there.
  const approachFeeNet = resolution.approach_fee_net ?? 0;
  const totalNet =
    resolution.net !== null ? resolution.net + approachFeeNet : null;
  const totalGross =
    totalNet !== null ? Math.round(totalNet * (1 + taxRate) * 100) / 100 : null;

  return {
    net_price: totalNet,
    gross_price: totalGross,
    tax_rate: totalNet !== null ? taxRate : null
  };
}

// ─── shouldRecalculatePrice ───────────────────────────────────────────────────

/**
 * Fields that, when present in a trip update patch, require fresh price
 * calculation. This is the single source of truth — update paths must never
 * hardcode these names.
 *
 * `driving_distance_km` is the primary distance signal. The coordinate fields
 * (`pickup_lat/lng`, `dropoff_lat/lng`) are a safety net for two-write address
 * updates: when an edit form writes the new addresses first (with stale distance)
 * and then writes `driving_distance_km` in a second write, both writes trigger
 * recalculation — the first at the old distance, the second at the correct one.
 * This guarantees no edit path silently skips recalculation.
 */
const PRICING_RELEVANT_FIELDS = [
  // Billing context
  'payer_id',
  'billing_type_id',
  'billing_variant_id',
  'client_id',
  'kts_document_applies',
  // Distance / route
  'driving_distance_km',
  'pickup_lat',
  'pickup_lng',
  'dropoff_lat',
  'dropoff_lng',
  // Timing
  'scheduled_at'
] as const;

export type PricingRelevantField = (typeof PRICING_RELEVANT_FIELDS)[number];

/**
 * Returns true when the patch touches at least one pricing-relevant field.
 * Pure and synchronous — safe to call in any context.
 *
 * Skipping recalculation for non-pricing updates (driver assignment, status
 * changes, notes) avoids unnecessary DB reads and context loads on high-frequency
 * operations.
 */
export function shouldRecalculatePrice(
  patch: Partial<Record<string, unknown>>
): boolean {
  return PRICING_RELEVANT_FIELDS.some((field) => field in patch);
}

// ─── resolveTripForPricing ────────────────────────────────────────────────────

/**
 * Fetches the current trip row from Supabase, overlays the patch on top
 * (patch fields win via `??`), and returns a `ComputeTripPriceInput` merged
 * with `company_id` for `loadPricingContext`.
 *
 * Always fetches from the DB — do not skip this even when the caller already
 * has the row in scope. This guarantees the merge uses the latest committed
 * state and eliminates race conditions from stale in-memory rows.
 *
 * `net_price` is always `null` in the returned input. The stored value is a
 * historical snapshot and must not bleed into the P3 fallback of the
 * recalculated price.
 *
 * Returns `null` on fetch error. Callers must proceed with the update
 * unmodified — a failed fetch must never block a trip save.
 */
export async function resolveTripForPricing(
  supabase: SupabaseClient<Database>,
  tripId: string,
  patch: Partial<Database['public']['Tables']['trips']['Update']>
): Promise<(ComputeTripPriceInput & { company_id: string }) | null> {
  const { data: current, error } = await supabase
    .from('trips')
    .select(
      'company_id, payer_id, billing_type_id, billing_variant_id, client_id, driving_distance_km, scheduled_at, kts_document_applies, net_price, manual_gross_price'
    )
    .eq('id', tripId)
    .single();

  if (error || !current) {
    console.error(
      '[trip-price-engine] resolveTripForPricing: fetch failed',
      tripId,
      error
    );
    return null;
  }

  return {
    company_id: current.company_id ?? '',
    payer_id: patch.payer_id ?? current.payer_id ?? null,
    billing_type_id: patch.billing_type_id ?? current.billing_type_id ?? null,
    billing_variant_id:
      patch.billing_variant_id ?? current.billing_variant_id ?? null,
    client_id: patch.client_id ?? current.client_id ?? null,
    driving_distance_km:
      patch.driving_distance_km ?? current.driving_distance_km ?? null,
    scheduled_at: patch.scheduled_at ?? current.scheduled_at ?? null,
    kts_document_applies:
      patch.kts_document_applies ?? current.kts_document_applies ?? false,
    // net_price is intentionally null — the stored value is a historical snapshot
    // and must not bleed into the P4 fallback of the recalculated price.
    net_price: null,
    manual_gross_price:
      patch.manual_gross_price ?? current.manual_gross_price ?? null
  };
}
