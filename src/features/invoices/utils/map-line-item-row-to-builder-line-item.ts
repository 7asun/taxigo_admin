/**
 * map-line-item-row-to-builder-line-item.ts
 *
 * Reversible mapping layer for re-opening a DRAFT invoice in the existing
 * builder. Inverts `lineItemToInsertRow` / `cancelledTripToInsertRow`
 * (see invoice-line-items.api.ts) so a persisted `invoice_line_items` row can
 * be hydrated back into builder state and, on a no-op edit, re-persisted with
 * byte-identical financial fields.
 *
 * ─── Why this is a faithful COPY, not a recomputation ──────────────────────
 * `invoice_line_items.price_resolution_snapshot` IS the frozen `PriceResolution`
 * that `lineItemToInsertRow` wrote at create time. And `lineItemToInsertRow`
 * recomputes `total_price` ONLY from that snapshot plus the numeric columns
 * (`unit_price` / `quantity` / `tax_rate` / `approach_fee_net`) — it never reads
 * builder-only flags (`manualGrossTotal`, `isManualOverride`, `isManualKmOverride`,
 * `resolved_rule`). So preserving the snapshot + numeric columns is sufficient
 * for an exact line-row round-trip; we do NOT re-derive prices on load.
 *
 * ─── Builder-only fields with no DB column ─────────────────────────────────
 * A handful of `BuilderLineItem` fields are not persisted. Their reconstruction
 * decisions are documented inline at each assignment below. The two that matter
 * for legal/financial correctness:
 *   - Manual gross override is intentionally NOT reconstructed (no note-string
 *     detection — see the inline rationale) so manual overrides flow through the
 *     same net-anchor totals path the storno/draft RPC uses (deferred item D1).
 *   - `resolved_rule` is null (cannot be reconstructed for monthly invoices),
 *     so live re-pricing of edited lines is deferred to the save-path phase.
 */

import type { TripMetaSnapshot } from '@/features/invoices/lib/trip-meta-snapshot';
import { validateLineItem } from '@/features/invoices/lib/invoice-validators';
import type {
  PriceResolution,
  PriceResolutionSource,
  PriceStrategyUsed
} from '@/features/invoices/types/pricing.types';
import type {
  BuilderCancelledTripRow,
  BuilderLineItem,
  InvoiceLineItemRow
} from '@/features/invoices/types/invoice.types';

/**
 * Non-column context needed to fully populate a `BuilderLineItem` from a row.
 * These values come from the invoice/payer hydration context, not the line row.
 */
export interface MapLineItemContext {
  /**
   * `payers.manual_km_enabled` for the invoice's payer. Drives whether Step 3
   * shows the KM input. Same payer for all rows in an edit session.
   */
  manualKmEnabled?: boolean;
}

/** Legacy subset of `PriceResolution.source` — mirrors the builder hook helper. */
function legacyPriceSourceFromResolution(
  src: string
): 'client_price_tag' | 'trip_price' | null {
  if (src === 'client_price_tag') return 'client_price_tag';
  if (src === 'trip_price') return 'trip_price';
  return null;
}

/** Round a money value to cents once (matches builder gross-up rounding). */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Reads the frozen `PriceResolution` from the row snapshot.
 *
 * why: the snapshot is the source of truth. For legacy rows persisted before
 * `price_resolution_snapshot` existed, synthesize a minimal net-anchor
 * resolution from the flat columns so the row still hydrates (documented
 * fallback — such rows cannot exist for invoices created by the current code).
 */
function priceResolutionFromRow(row: InvoiceLineItemRow): PriceResolution {
  const snapshot = row.price_resolution_snapshot;
  if (snapshot && typeof snapshot === 'object') {
    return snapshot as unknown as PriceResolution;
  }
  const netFromColumns = row.unit_price * row.quantity;
  return {
    gross: null,
    net: netFromColumns,
    tax_rate: row.tax_rate,
    strategy_used:
      (row.pricing_strategy_used as PriceStrategyUsed) ?? 'no_price',
    source: (row.pricing_source as PriceResolutionSource) ?? 'trip_price',
    unit_price_net: row.unit_price,
    quantity: row.quantity,
    approach_fee_net: row.approach_fee_net
  };
}

/**
 * Inverts `lineItemToInsertRow`: a persisted normal line item row → builder line.
 *
 * Only call for rows where `is_cancelled_trip !== true` (cancelled rows use
 * {@link mapLineItemRowToBuilderCancelledTrip}).
 */
export function mapLineItemRowToBuilderLineItem(
  row: InvoiceLineItemRow,
  ctx: MapLineItemContext = {}
): BuilderLineItem {
  const pr = priceResolutionFromRow(row);
  const approachFeeNet = row.approach_fee_net ?? pr.approach_fee_net ?? null;

  const base: Omit<BuilderLineItem, 'warnings'> = {
    trip_id: row.trip_id,
    position: row.position,
    line_date: row.line_date,
    description: row.description,
    client_name: row.client_name,
    pickup_address: row.pickup_address,
    dropoff_address: row.dropoff_address,
    distance_km: row.distance_km,
    effective_distance_km: row.effective_distance_km,
    original_distance_km: row.original_distance_km,
    manual_km_enabled: ctx.manualKmEnabled ?? false,
    // why: snapshot's unit_price_net (not the rounded `unit_price` column) so
    // frozenPriceResolutionForInsert's `Math.abs(prev - u) > 0.0001` guard stays
    // false on re-save and returns the snapshot unchanged → exact total_price.
    unit_price: pr.unit_price_net,
    approach_fee_net: approachFeeNet,
    quantity: row.quantity,
    tax_rate: row.tax_rate,
    billing_variant_code: row.billing_variant_code,
    billing_variant_name: row.billing_variant_name,
    billing_type_name: row.billing_type_name ?? null,
    // why: kts_document_applies is not persisted; the only legal signal is the
    // frozen strategy. Informational badge only — never affects pricing.
    kts_document_applies: pr.strategy_used === 'kts_override',
    // why: no_invoice_required is a trip-level advisory not snapshotted on the line.
    no_invoice_warning: false,
    price_resolution: pr,
    // why: per-line rule (with billing_variant_id/client_id) is not stored, so it
    // cannot be reliably reconstructed for monthly invoices. Null means a KM edit
    // in edit mode falls back to tax-rate-only adjustment; live reprice of edited
    // lines is deferred to the save-path phase (no silent recalculation on load).
    resolved_rule: null,
    kts_override: row.kts_override,
    trip_meta: (row.trip_meta_snapshot as TripMetaSnapshot | null) ?? null,
    price_source: legacyPriceSourceFromResolution(pr.source),
    billingInclusion: {
      included: row.billing_included ?? true,
      reason: row.billing_exclusion_reason ?? ''
    },
    approach_fee_gross:
      approachFeeNet != null
        ? roundCents(approachFeeNet * (1 + row.tax_rate))
        : null,
    // why: the pre-override original is not persisted; "reset override" in edit
    // mode therefore restores the last saved snapshot (documented assumption).
    originalPriceResolution: pr,
    // why: manual gross override is intentionally NOT reconstructed. We do not
    // reintroduce the `note.includes('Manuell überschrieben (Bruttoeingabe)')`
    // string coupling that Step 1 removed from the RPC. With manualGrossTotal
    // null, hydrated override lines flow through calculateInvoiceTotals exactly
    // as the RPC persists them (client_price_tag → gross-anchor; all else →
    // net-anchor), so the builder total matches the persisted total. The
    // ≤1-cent mixed-rate edge is the shared deferred item D1. Cosmetic trade-off:
    // the Step-3 "Manuell" badge/reset is not shown for hydrated override lines.
    manualGrossTotal: null,
    manualApproachFeeGross: null,
    isManualOverride: false,
    // why: KM "manuell" badge is UI-only (no column, no financial effect). An
    // effective distance differing from the routing original implies an override.
    manualDistanceKm:
      row.effective_distance_km != null &&
      row.original_distance_km != null &&
      row.effective_distance_km !== row.original_distance_km
        ? row.effective_distance_km
        : null,
    isManualKmOverride:
      row.effective_distance_km != null &&
      row.original_distance_km != null &&
      row.effective_distance_km !== row.original_distance_km
  };

  return { ...base, warnings: validateLineItem({ ...base, warnings: [] }) };
}

/**
 * Inverts `cancelledTripToInsertRow`: a persisted cancelled-trip line item row →
 * opted-in `BuilderCancelledTripRow`.
 *
 * Only call for rows where `is_cancelled_trip === true`.
 */
export function mapLineItemRowToBuilderCancelledTrip(
  row: InvoiceLineItemRow,
  _ctx: MapLineItemContext = {}
): BuilderCancelledTripRow {
  void _ctx;
  const pr = priceResolutionFromRow(row);
  const approachFeeNet = row.approach_fee_net ?? pr.approach_fee_net ?? null;

  return {
    id: row.trip_id ?? row.id,
    scheduled_at: row.line_date,
    pickup_address: row.pickup_address,
    dropoff_address: row.dropoff_address,
    // why: cancellation note is not snapshotted onto the line item.
    canceled_reason_notes: null,
    // why: client join is not persisted on the line; client_name carries the
    // snapshot so cancelledTripToInsertRow rebuilds the same description.
    client: null,
    client_name: row.client_name,
    driving_distance_km: row.distance_km,
    effective_distance_km: row.effective_distance_km,
    original_distance_km: row.original_distance_km,
    billingInclusion: {
      // persisted cancelled-trip rows are always opted-in billed items
      included: true,
      reason: row.cancelled_billing_reason ?? ''
    },
    price_resolution: pr,
    // see normal mapper: rule cannot be reconstructed; deferred to save path.
    resolved_rule: null,
    // snapshot unit_price_net so frozen == snapshot on re-save (exact total_price).
    unit_price: pr.unit_price_net,
    tax_rate: row.tax_rate,
    quantity: row.quantity,
    approach_fee_net: approachFeeNet,
    approach_fee_gross:
      approachFeeNet != null
        ? roundCents(approachFeeNet * (1 + row.tax_rate))
        : null,
    kts_override: row.kts_override,
    billing_variant_code: row.billing_variant_code,
    billing_variant_name: row.billing_variant_name,
    billing_type_name: row.billing_type_name ?? null,
    originalPriceResolution: pr,
    // manual gross override NOT reconstructed (same decision as normal mapper).
    manualGrossTotal: null,
    manualApproachFeeGross: null,
    isManualOverride: false,
    includeApproachFee: true
  };
}
