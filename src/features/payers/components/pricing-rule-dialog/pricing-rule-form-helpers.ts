/**
 * Pure helpers for PricingRuleDialog form state.
 * No React, no hooks, no side-effects — safe to import in tests.
 */

import type { TimeBasedConfig } from '@/features/invoices/types/pricing.types';
import type { PricingStrategy } from '@/features/invoices/types/pricing.types';
import {
  WEEKDAY_ORDER,
  type DaysForm,
  type KmTierFormValue,
  type PricingRuleFormValues
} from './pricing-rule-dialog.types';

export function defaultTier(): KmTierFormValue {
  return { from_km: 0, to_km: null, price_per_km: 2.5 };
}

export function defaultDaysForNewRule(): DaysForm {
  const o = {} as DaysForm;
  for (const k of WEEKDAY_ORDER) {
    o[k] =
      k === 'sat' || k === 'sun'
        ? { enabled: false, start: '07:00', end: '18:00' }
        : { enabled: true, start: '07:00', end: '18:00' };
  }
  return o;
}

export function daysFromTimeConfig(cfg: TimeBasedConfig | undefined): DaysForm {
  const wh = cfg?.working_hours;
  const out = defaultDaysForNewRule();
  if (!wh) return out;
  for (const k of WEEKDAY_ORDER) {
    const slot = wh[k];
    if (
      slot &&
      typeof slot.start === 'string' &&
      typeof slot.end === 'string'
    ) {
      out[k] = { enabled: true, start: slot.start, end: slot.end };
    } else {
      out[k] = { enabled: false, start: '07:00', end: '18:00' };
    }
  }
  return out;
}

export function buildWorkingHoursFromDays(
  days: DaysForm
): TimeBasedConfig['working_hours'] {
  const wh: TimeBasedConfig['working_hours'] = {};
  for (const k of WEEKDAY_ORDER) {
    const d = days[k];
    wh[k] = d.enabled ? { start: d.start, end: d.end } : null;
  }
  return wh;
}

export function defaultFormValues(): PricingRuleFormValues {
  return {
    strategy: 'tiered_km',
    approach_fee_net: null,
    tiers: [defaultTier()],
    threshold_km: 4,
    fixed_price: 15,
    km_tiers: [defaultTier()],
    fixed_fee: 45,
    holiday_rule: 'normal',
    holidays: [],
    days: defaultDaysForNewRule()
  };
}

/**
 * Maps validated form values to the `{ strategy, config }` shape expected by
 * createPricingRule / updatePricingRule.
 *
 * approach_fee_net is merged into every config object when present and valid.
 * The caller is responsible for Zod-validating the result before sending to the API.
 *
 * NOTE: client_price_tag, manual_trip_price, and no_price produce an empty config {}.
 * The actual client price is stored on clients.price_tag, not here.
 */
export function buildApiPayload(v: PricingRuleFormValues): {
  strategy: PricingStrategy;
  config: Record<string, unknown>;
} {
  const withApproach = (
    config: Record<string, unknown>
  ): Record<string, unknown> => {
    if (
      v.approach_fee_net != null &&
      Number.isFinite(v.approach_fee_net) &&
      v.approach_fee_net >= 0
    ) {
      return { ...config, approach_fee_net: v.approach_fee_net };
    }
    return config;
  };

  switch (v.strategy) {
    case 'client_price_tag':
    case 'manual_trip_price':
    case 'no_price':
      return {
        strategy: v.strategy,
        config: withApproach({})
      };
    case 'tiered_km':
      return {
        strategy: v.strategy,
        config: withApproach({ tiers: v.tiers })
      };
    case 'fixed_below_threshold_then_km':
      return {
        strategy: v.strategy,
        config: withApproach({
          threshold_km: v.threshold_km,
          fixed_price: v.fixed_price,
          km_tiers: v.km_tiers
        })
      };
    case 'time_based':
      return {
        strategy: v.strategy,
        config: withApproach({
          fixed_fee: v.fixed_fee,
          working_hours: buildWorkingHoursFromDays(v.days),
          holiday_rule: v.holiday_rule,
          holidays: v.holidays
        })
      };
    default: {
      const _e: never = v.strategy;
      return _e;
    }
  }
}
