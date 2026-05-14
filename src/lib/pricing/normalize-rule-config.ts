/**
 * normalizeRuleConfigToNet
 *
 * WHY: `billing_pricing_rules.config` can store km rates and flat fees as **gross** when
 * `pricing_basis === 'gross'`. The resolver and invoice pipeline assume **net** amounts for
 * all strategy math (`tieredNetTotal`, fixed prices, time surcharges). Normalizing here keeps
 * a single execution path and avoids duplicating VAT division inside each strategy branch.
 *
 * EXCEPTION: `approach_fee_net` is **always** net by product contract — we never divide it by
 * `(1 + taxRate)` even when pricing_basis is gross (see docs/anfahrtspreis.md).
 */

import type {
  PricingBasis,
  PricingStrategy
} from '@/features/invoices/types/pricing.types';

import { roundMoneyOnce } from './round-money-once';

/** VAT is applied as `net * (1 + rate)`; gross → net uses this divisor (caller supplies rate). */
const GROSS_ANCHOR_NET_DIVISOR_OFFSET = 1;

function grossComponentToNet(gross: number, taxRate: number): number {
  const divisor = GROSS_ANCHOR_NET_DIVISOR_OFFSET + taxRate;
  if (divisor <= 0 || Number.isNaN(divisor)) {
    return roundMoneyOnce(gross);
  }
  return roundMoneyOnce(gross / divisor);
}

function mapTiers(
  tiers: Array<{ from_km: number; to_km: number | null; price_per_km: number }>,
  taxRate: number
): typeof tiers {
  return tiers.map((t) => ({
    ...t,
    price_per_km: grossComponentToNet(t.price_per_km, taxRate)
  }));
}

/**
 * Returns config safe to pass to `parseConfigForStrategy` / `executeStrategy` as **net-anchored**
 * amounts. Identity when `pricing_basis === 'net'` or strategy has no monetary config fields.
 */
export function normalizeRuleConfigToNet(
  config: unknown,
  strategy: PricingStrategy,
  pricingBasis: PricingBasis,
  taxRate: number
): unknown {
  if (pricingBasis === 'net') {
    return config;
  }

  switch (strategy) {
    case 'tiered_km': {
      const c = config as {
        tiers?: Array<{
          from_km: number;
          to_km: number | null;
          price_per_km: number;
        }>;
        approach_fee_net?: number | null;
      };
      if (!Array.isArray(c?.tiers)) return config;
      return {
        ...c,
        tiers: mapTiers(c.tiers, taxRate)
      };
    }
    case 'fixed_below_threshold_then_km': {
      const c = config as {
        threshold_km?: number;
        fixed_price?: number;
        km_tiers?: Array<{
          from_km: number;
          to_km: number | null;
          price_per_km: number;
        }>;
        approach_fee_net?: number | null;
      };
      const out: Record<string, unknown> = {
        ...(c as Record<string, unknown>)
      };
      if (typeof c.fixed_price === 'number') {
        out.fixed_price = grossComponentToNet(c.fixed_price, taxRate);
      }
      if (Array.isArray(c.km_tiers)) {
        out.km_tiers = mapTiers(c.km_tiers, taxRate);
      }
      return out;
    }
    case 'time_based': {
      const c = config as {
        fixed_fee?: number;
        approach_fee_net?: number | null;
        working_hours?: unknown;
        holiday_rule?: unknown;
        holidays?: unknown;
      };
      if (typeof c.fixed_fee !== 'number') return config;
      return {
        ...c,
        fixed_fee: grossComponentToNet(c.fixed_fee, taxRate)
      };
    }
    default:
      return config;
  }
}
