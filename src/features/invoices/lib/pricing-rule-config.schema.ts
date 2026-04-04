/**
 * Zod validation for billing_pricing_rules.config JSONB + strategy pairing.
 * Validate at service boundary before any DB write.
 */
import { z } from 'zod';

import type { PricingStrategy } from '@/features/invoices/types/pricing.types';

/** One km tier — contiguous tiers validated at UI level; resolver assumes coverage. */
export const kmTierSchema = z.object({
  // from_km: inclusive start of segment
  from_km: z.number().nonnegative(),
  // to_km: exclusive upper bound; null = unlimited tail
  to_km: z.number().nonnegative().nullable(),
  price_per_km: z.number().nonnegative()
});

/** branch: tiered_km */
export const tieredKmConfigSchema = z
  .object({
    tiers: z.array(kmTierSchema).min(1)
  })
  .strict();

/** branch: fixed_below_threshold_then_km */
export const fixedBelowThresholdThenKmConfigSchema = z
  .object({
    threshold_km: z.number().nonnegative(),
    fixed_price: z.number().nonnegative(),
    km_tiers: z.array(kmTierSchema).min(1)
  })
  .strict();

const dayHoursSchema = z
  .object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/)
  })
  .strict();

/** branch: time_based */
export const timeBasedConfigSchema = z
  .object({
    fixed_fee: z.number().nonnegative(),
    working_hours: z.object({
      mon: dayHoursSchema.nullable().optional(),
      tue: dayHoursSchema.nullable().optional(),
      wed: dayHoursSchema.nullable().optional(),
      thu: dayHoursSchema.nullable().optional(),
      fri: dayHoursSchema.nullable().optional(),
      sat: dayHoursSchema.nullable().optional(),
      sun: dayHoursSchema.nullable().optional()
    }),
    holiday_rule: z.enum(['closed', 'normal']),
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  })
  .strict();

/** Empty config strategies */
export const emptyConfigSchema = z.object({}).strict();

/**
 * Discriminated union on strategy — use when validating API body { strategy, config }.
 */
export const billingPricingRuleUpsertSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('client_price_tag'),
    config: emptyConfigSchema
  }),
  z.object({
    strategy: z.literal('tiered_km'),
    config: tieredKmConfigSchema
  }),
  z.object({
    strategy: z.literal('fixed_below_threshold_then_km'),
    config: fixedBelowThresholdThenKmConfigSchema
  }),
  z.object({
    strategy: z.literal('time_based'),
    config: timeBasedConfigSchema
  }),
  z.object({
    strategy: z.literal('manual_trip_price'),
    config: emptyConfigSchema
  }),
  z.object({
    strategy: z.literal('no_price'),
    config: emptyConfigSchema
  })
]);

export type BillingPricingRuleUpsert = z.infer<
  typeof billingPricingRuleUpsertSchema
>;

/** Parse config JSON given a known strategy column value. */
export function parseConfigForStrategy(
  strategy: PricingStrategy,
  raw: unknown
): unknown {
  switch (strategy) {
    case 'client_price_tag':
    case 'manual_trip_price':
    case 'no_price':
      return emptyConfigSchema.parse(raw ?? {});
    case 'tiered_km':
      return tieredKmConfigSchema.parse(raw);
    case 'fixed_below_threshold_then_km':
      return fixedBelowThresholdThenKmConfigSchema.parse(raw);
    case 'time_based':
      return timeBasedConfigSchema.parse(raw);
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}
