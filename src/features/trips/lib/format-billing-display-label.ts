/**
 * Single source of truth for **read-only** Abrechnung labels on trips.
 *
 * - **Familie** comes from the embedded parent row (`billing_types` on `billing_variant`).
 * - **Unterart** is `billing_variants.name` — never show variant `code` as the user-facing label here.
 * - If the variant display name is **Standard** (trimmed, case-insensitive), omit it so the UI shows
 *   only the family name. DB rows keep `name = 'Standard'` for migrations/CSV; presentation hides it.
 * - Use **`billingFamilyFromEmbed`** for row/card accent **color** (same embed quirks as the label).
 *
 * @see docs/billing-families-variants.md — „Abrechnung-Anzeige“
 */

export function isStandardVariantDisplayName(name: string): boolean {
  return name.trim().toLowerCase() === 'standard';
}

/**
 * Normalizes `billing_variant.billing_types` from PostgREST: usually a single object,
 * occasionally a one-element array — never assume a plain object without this helper.
 */
export function billingFamilyFromEmbed(billingTypes: unknown): {
  name?: string | null;
  color?: string | null;
} | null {
  if (billingTypes == null) return null;
  if (Array.isArray(billingTypes)) {
    const row = billingTypes[0];
    return row && typeof row === 'object' ? row : null;
  }
  if (typeof billingTypes === 'object') {
    return billingTypes as { name?: string | null; color?: string | null };
  }
  return null;
}

/**
 * Human-readable Abrechnung: `Familie · Unterart`, or only `Familie` when Unterart is Standard,
 * or only variant name if family is missing. Returns `''` when there is nothing to show.
 */
export function formatBillingDisplayLabel(
  bv: { name?: string | null; billing_types?: unknown } | null | undefined
): string {
  if (!bv) return '';
  const fam = billingFamilyFromEmbed(bv.billing_types);
  const familyName = fam?.name?.trim() || '';
  const variantName = bv.name?.trim() || '';
  const variantIsStandard =
    variantName.length > 0 && isStandardVariantDisplayName(variantName);
  const showVariant = variantName.length > 0 && !variantIsStandard;

  if (familyName && showVariant) return `${familyName} · ${variantName}`;
  if (familyName) return familyName;
  if (showVariant) return variantName;
  return '';
}
