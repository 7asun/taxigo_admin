/**
 * Picks the active pricing source for a trip: client price tags (STEP 0), then billing rules
 * (variant → billing_type → payer). Pure: no I/O.
 */
import type {
  BillingPricingRuleLike,
  ClientPriceTagLike
} from '@/features/invoices/types/pricing.types';

export interface ResolvePricingRuleInput {
  /** All candidate rules for this company (caller filters is_active + payer). */
  rules: BillingPricingRuleLike[];
  payerId: string;
  billingTypeId: string | null;
  billingVariantId: string | null;
  clientId?: string | null;
  /** Active tags for clients on the current trip batch; filtered by clientId in STEP 0. */
  clientPriceTags?: ClientPriceTagLike[];
}

export function resolvePricingRule(
  input: ResolvePricingRuleInput
): BillingPricingRuleLike | null {
  const {
    rules,
    payerId,
    billingTypeId,
    billingVariantId,
    clientId,
    clientPriceTags
  } = input;

  const companyId = rules[0]?.company_id ?? '';

  // STEP 0 resolves client+payer price tags before catalog rules.
  // Priority within tags: variant-scoped > payer-scoped > global fallback.
  // See docs/pricing-engine.md and docs/preisregeln.md.
  if (clientId && clientPriceTags?.length) {
    const tags = clientPriceTags.filter(
      (t) => t.client_id === clientId && t.is_active
    );
    let tag: ClientPriceTagLike | undefined;

    if (billingVariantId) {
      tag = tags.find((t) => t.billing_variant_id === billingVariantId);
    }
    if (!tag && payerId) {
      tag = tags.find(
        (t) =>
          t.payer_id === payerId &&
          (t.billing_variant_id === null || t.billing_variant_id === undefined)
      );
    }
    if (!tag) {
      tag = tags.find(
        (t) =>
          (t.payer_id === null || t.payer_id === undefined) &&
          (t.billing_variant_id === null || t.billing_variant_id === undefined)
      );
    }

    if (tag) {
      const g = Number(tag.price_gross);
      if (!Number.isNaN(g) && g > 0) {
        return {
          id: tag.id,
          company_id: companyId,
          payer_id: tag.payer_id,
          billing_type_id: null,
          billing_variant_id: tag.billing_variant_id,
          strategy: 'client_price_tag',
          config: {},
          is_active: true,
          _price_gross: g
        };
      }
    }
  }

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
