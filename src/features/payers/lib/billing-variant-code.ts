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

/**
 * Builds a 2–6 char code from the Unterarten-Name when it yields enough A–Z/0–9;
 * otherwise from the Abrechnungsfamilie (`billing_types.name`); last resort a short
 * deterministic token so inserts never block on empty input.
 */
export function suggestBillingVariantCode(
  variantName: string,
  familyName: string
): string {
  const fromVariant = codeFromSingleLabel(variantName);
  if (fromVariant) return fromVariant;

  const fromFamily = codeFromSingleLabel(familyName);
  if (fromFamily) return fromFamily;

  return deterministicFallbackCode(variantName, familyName);
}

/** First usable segment: ≥2 alnum from one label (truncate to 6), or one char + X. */
function codeFromSingleLabel(label: string): string | null {
  const n = normalizeBillingVariantCodeInput(label);
  if (n.length >= 6) return n.slice(0, 6);
  if (n.length >= 2) return n;
  if (n.length === 1) return `${n}X`;
  return null;
}

/** When both names strip to nothing useful — stable, collision handling is pickUnique’s job. */
function deterministicFallbackCode(
  variantName: string,
  familyName: string
): string {
  const seed = `${variantName}\0${familyName}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = 'M';
  let x = h >>> 0;
  for (let k = 0; k < 5; k++) {
    out += chars[x % 36];
    x = Math.imul(x, 31) + k + 1;
  }
  return out.slice(0, 6);
}

/**
 * Ensures a unique code within one family (`billing_variants` rows). Appends digits
 * (2…999) to a shortened prefix when the base is already taken.
 */
export function pickUniqueBillingVariantCode(
  base: string,
  existingCodes: readonly string[]
): string {
  const taken = new Set(
    existingCodes.map((c) => normalizeBillingVariantCodeInput(c).toUpperCase())
  );

  let normalized = normalizeBillingVariantCodeInput(base).slice(0, 6);
  if (normalized.length < 2) {
    normalized = deterministicFallbackCode(base, '');
  }

  const tryTake = (candidate: string): string | null => {
    const c = normalizeBillingVariantCodeInput(candidate).slice(0, 6);
    if (c.length < 2) return null;
    if (!isValidBillingVariantCode(c)) return null;
    if (taken.has(c)) return null;
    return c;
  };

  const first = tryTake(normalized);
  if (first) return first;

  for (let d = 2; d <= 999; d++) {
    const ds = String(d);
    const maxPrefix = 6 - ds.length;
    if (maxPrefix < 1) continue;
    const prefix = normalized.slice(0, maxPrefix);
    const candidate = prefix + ds;
    const ok = tryTake(candidate);
    if (ok) return ok;
  }

  for (let salt = 0; salt < 500; salt++) {
    const fb = deterministicFallbackCode(
      `${base}:${salt}`,
      String(existingCodes.length)
    );
    const ok = tryTake(fb);
    if (ok) return ok;
  }

  throw new Error(
    'Kein freier CSV-Code in dieser Familie — bitte eine bestehende Unterart anpassen.'
  );
}
