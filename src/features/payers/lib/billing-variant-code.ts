/**
 * Variant `code` rules (must stay aligned with DB CHECK on billing_variants.code):
 * 2–6 characters, uppercase A–Z and digits 0–9 only — handy for CSV and invoicing.
 */

export const BILLING_VARIANT_CODE_PATTERN = /^[A-Z0-9]{2,6}$/;

export const BILLING_VARIANT_CODE_HINT =
  '2–6 Zeichen, nur Großbuchstaben A–Z und Ziffern 0–9.';

/** Uppercase and strip everything outside A–Z0–9 (before length check). */
export function normalizeBillingVariantCodeInput(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isValidBillingVariantCode(code: string): boolean {
  return BILLING_VARIANT_CODE_PATTERN.test(code);
}
