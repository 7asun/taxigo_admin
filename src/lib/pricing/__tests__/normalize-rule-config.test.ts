import { describe, expect, test } from 'bun:test';

import { normalizeRuleConfigToNet } from '../normalize-rule-config';
import { roundMoneyOnce } from '../round-money-once';

describe('normalizeRuleConfigToNet', () => {
  test('net basis — identity', () => {
    const cfg = { tiers: [{ from_km: 0, to_km: null, price_per_km: 2.5 }] };
    const out = normalizeRuleConfigToNet(cfg, 'tiered_km', 'net', 0.19);
    expect(out).toBe(cfg);
  });

  test('gross tiered_km — converts price_per_km; leaves approach_fee_net', () => {
    const cfg = {
      tiers: [{ from_km: 0, to_km: null, price_per_km: 1.07 }],
      approach_fee_net: 5
    };
    const out = normalizeRuleConfigToNet(cfg, 'tiered_km', 'gross', 0.07) as {
      tiers: { price_per_km: number }[];
      approach_fee_net: number;
    };
    expect(out.approach_fee_net).toBe(5);
    expect(out.tiers[0]!.price_per_km).toBe(roundMoneyOnce(1.07 / 1.07));
  });

  test('gross fixed_below_threshold_then_km — fixed_price and max km_tiers; approach unchanged', () => {
    const cfg = {
      threshold_km: 5,
      fixed_price: 10.7,
      km_tiers: [{ from_km: 0, to_km: null, price_per_km: 2.14 }],
      approach_fee_net: 3
    };
    const out = normalizeRuleConfigToNet(
      cfg,
      'fixed_below_threshold_then_km',
      'gross',
      0.07
    ) as typeof cfg;
    expect(out.approach_fee_net).toBe(3);
    expect(out.fixed_price).toBe(roundMoneyOnce(10.7 / 1.07));
    expect(out.km_tiers[0]!.price_per_km).toBe(roundMoneyOnce(2.14 / 1.07));
  });

  test('gross time_based — fixed_fee only', () => {
    const cfg = {
      fixed_fee: 11.9,
      working_hours: {},
      holiday_rule: 'normal' as const,
      holidays: [] as string[],
      approach_fee_net: 4
    };
    const out = normalizeRuleConfigToNet(cfg, 'time_based', 'gross', 0.19) as {
      fixed_fee: number;
      approach_fee_net: number;
    };
    expect(out.approach_fee_net).toBe(4);
    expect(out.fixed_fee).toBe(roundMoneyOnce(11.9 / 1.19));
  });

  test('manual_trip_price strategy — identity even if gross basis', () => {
    const cfg = { approach_fee_net: 2 };
    const out = normalizeRuleConfigToNet(
      cfg,
      'manual_trip_price',
      'gross',
      0.07
    );
    expect(out).toBe(cfg);
  });
});
