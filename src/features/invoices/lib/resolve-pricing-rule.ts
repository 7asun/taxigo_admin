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
  const { rules, payerId, clientId, clientPriceTags } = input;

  // Trip rows and spread objects often omit nullable FKs → `undefined` at runtime.
  // `=== null` on the rule side and `if (billingVariantId)` on the trip side then
  // disagree with SQL nulls and with each other; normalising here keeps STEP 1–3
  // aligned with how Postgres stores “no type / no variant”.
  const billingTypeId = input.billingTypeId ?? null;
  const billingVariantId = input.billingVariantId ?? null;

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
      tag = tags.find(
        (t) => (t.billing_variant_id ?? null) === billingVariantId
      );
    }
    if (!tag && payerId) {
      tag = tags.find(
        (t) => t.payer_id === payerId && (t.billing_variant_id ?? null) === null
      );
    }
    if (!tag) {
      tag = tags.find(
        (t) =>
          (t.payer_id ?? null) === null &&
          (t.billing_variant_id ?? null) === null
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

  // STEP 1 — Unterart: use a variant-level rule only when the trip has a variant.
  // If there is no rule for that variant, fall through — STEP 3 still supplies a
  // payer-wide default so an unknown variant id does not blank out pricing.
  if (billingVariantId) {
    const v = rules.find(
      (r) => (r.billing_variant_id ?? null) === billingVariantId && r.is_active
    );
    if (v) return v;
  }

  // STEP 2 — Abrechnungsfamilie: type-level catalog row (payer_id null) when the
  // trip has a billing type. No match simply means we try STEP 3 next.
  if (billingTypeId) {
    const t = rules.find(
      (r) =>
        (r.billing_type_id ?? null) === billingTypeId &&
        (r.billing_variant_id ?? null) === null &&
        (r.payer_id ?? null) === null &&
        r.is_active
    );
    if (t) return t;
  }

  // STEP 3 — Kostenträger-wide fallback. Catalogue rows may surface `undefined`
  // for nullable columns after serialisation; without `?? null`, `=== null` would
  // skip the only payer-wide rule even when the trip has no type/variant set.
  const p = rules.find(
    (r) =>
      (r.payer_id ?? null) === payerId &&
      (r.billing_type_id ?? null) === null &&
      (r.billing_variant_id ?? null) === null &&
      r.is_active
  );
  return p ?? null;
}
