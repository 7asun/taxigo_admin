/**
 * Picks the most specific active billing_pricing_rules row for a trip's catalog.
 * Cascade: variant → billing_type → payer (same idea as resolve-kts-default).
 * Pure: no I/O.
 */
import type { BillingPricingRuleLike } from '@/features/invoices/types/pricing.types';

export interface ResolvePricingRuleInput {
  /** All candidate rules for this company (caller filters is_active + payer). */
  rules: BillingPricingRuleLike[];
  payerId: string;
  billingTypeId: string | null;
  billingVariantId: string | null;
}

export function resolvePricingRule(
  input: ResolvePricingRuleInput
): BillingPricingRuleLike | null {
  const { rules, payerId, billingTypeId, billingVariantId } = input;

  // STEP 1 — Unterart wins: most specific catalog level for mixed families on one payer.
  if (billingVariantId) {
    const v = rules.find(
      (r) => r.billing_variant_id === billingVariantId && r.is_active
    );
    if (v) return v;
  }

  // STEP 2 — Abrechnungsfamilie when no variant rule applies (shared default for all variants of that type).
  if (billingTypeId) {
    const t = rules.find(
      (r) =>
        r.billing_type_id === billingTypeId &&
        r.billing_variant_id === null &&
        r.payer_id === null &&
        r.is_active
    );
    if (t) return t;
  }

  // STEP 3 — Kostenträger-wide fallback when neither variant nor type set a rule.
  const p = rules.find(
    (r) =>
      r.payer_id === payerId &&
      r.billing_type_id === null &&
      r.billing_variant_id === null &&
      r.is_active
  );
  return p ?? null;
}
