/**
 * Pure resolution of the distance (km) used for VAT and pricing on an invoice line.
 * No I/O — safe to call from the builder, tests, or server code.
 */

export interface ClientKmOverrideLike {
  client_id: string;
  payer_id: string | null;
  /** When set, row applies only to this Unterart; mirrors client_price_tags scope. */
  billing_variant_id?: string | null;
  distance_km: number | string;
  is_active: boolean;
}

function isUsableKm(n: number): boolean {
  // why: zero/negative distance is not a billable route; treating it as missing avoids
  // poisoning tax tiers (50 km boundary) and per-km totals with nonsense input.
  return Number.isFinite(n) && n > 0;
}

function parseOverrideKm(raw: number | string): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return isUsableKm(n) ? n : null;
}

/**
 * Picks the winning catalog row for a trip (active rows for one client only).
 * Precedence (most specific wins), aligned with client_price_tags:
 * 1. Variant-scoped rows matching trip billing_variant_id: payer match on row, else row with payer_id null.
 * 2. Payer-wide rows (billing_variant_id null): payer_id matches trip payer.
 * 3. Global rows: payer_id and billing_variant_id both null.
 */
function pickClientKmOverrideRow(
  rows: ClientKmOverrideLike[],
  payerId: string | null | undefined,
  billingVariantId: string | null | undefined
): ClientKmOverrideLike | null {
  if (rows.length === 0) return null;
  const pid = payerId ?? null;
  const vid = billingVariantId ?? null;

  if (vid) {
    const variantRows = rows.filter(
      (r) => r.billing_variant_id != null && r.billing_variant_id === vid
    );
    const variantPayer = variantRows.find(
      (r) => r.payer_id != null && r.payer_id === pid
    );
    if (variantPayer) return variantPayer;
    const variantAnyPayer = variantRows.find((r) => r.payer_id == null);
    if (variantAnyPayer) return variantAnyPayer;
  }

  const payerWide = rows.filter(
    (r) =>
      (r.billing_variant_id == null || r.billing_variant_id === undefined) &&
      r.payer_id != null &&
      r.payer_id === pid
  );
  if (payerWide.length > 0) return payerWide[0];

  const fullyGlobal = rows.filter(
    (r) =>
      (r.billing_variant_id == null || r.billing_variant_id === undefined) &&
      r.payer_id == null
  );
  if (fullyGlobal.length > 0) return fullyGlobal[0];

  return null;
}

/**
 * Resolves the effective driving distance for a trip line item.
 *
 * Priority (most specific wins):
 *   1. trips.manual_distance_km — admin override written back from Step 3 on a
 *      previous invoice creation. Takes priority because the admin has explicitly
 *      confirmed this distance.
 *   2. client_km_overrides — variant + payer scope, then payer-wide, then global;
 *      see pickClientKmOverrideRow.
 *   3. trips.driving_distance_km — the routing provider value (Google Directions).
 *      Always the fallback; never modified by this feature.
 *
 * Returns null only when all three sources are null/undefined.
 */
export function resolveEffectiveDistanceKm(input: {
  manualDistanceKm: number | null | undefined;
  drivingDistanceKm: number | null | undefined;
  clientId: string | null | undefined;
  payerId: string | null | undefined;
  /** Trip's billing_variants.id for variant-scoped override rows. */
  billingVariantId?: string | null | undefined;
  clientKmOverrides: ClientKmOverrideLike[];
}): number | null {
  const manual = input.manualDistanceKm;
  if (manual != null && isUsableKm(manual)) {
    // why: trip-level manual KM is the strongest signal — it reflects a human decision
    // on this specific ride after seeing the invoice context, not a catalog default.
    return manual;
  }

  const cid = input.clientId;
  if (cid && input.clientKmOverrides.length > 0) {
    const rows = input.clientKmOverrides.filter(
      (r) => r.client_id === cid && r.is_active === true
    );
    const picked = pickClientKmOverrideRow(
      rows,
      input.payerId,
      input.billingVariantId
    );
    const km = picked ? parseOverrideKm(picked.distance_km) : null;
    if (km != null) return km;
  }

  const driving = input.drivingDistanceKm;
  if (driving == null) return null;
  // why: routing distance may be 0 in edge cases; still a resolved value unlike "unknown".
  return Number.isFinite(driving) ? driving : null;
}
