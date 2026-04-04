/**
 * Pure trip price resolution — Spec C cascade (locked priorities).
 * Priority 0: KTS → €0
 * Priority 1: clients.price_tag (gross → net)
 * Priority 2: billing_pricing_rules strategy
 * Priority 3: trips.price (net)
 * Priority 4: null / unresolved
 *
 * Tiered km: sum raw (km × rate) then round once to cents.
 * time_based: Europe/Berlin wall clock + calendar date for holidays.
 */
import { parseISO } from 'date-fns';
import { tz } from '@date-fns/tz';

import { parseConfigForStrategy } from '@/features/invoices/lib/pricing-rule-config.schema';
import type {
  BillingPricingRuleLike,
  FixedBelowThresholdThenKmConfig,
  KmTier,
  PriceResolution,
  PriceResolutionSource,
  PricingStrategy,
  TimeBasedConfig,
  TieredKmConfig,
  WeekdayKey
} from '@/features/invoices/types/pricing.types';

import { getTripsBusinessTimeZone } from '@/features/trips/lib/trip-business-date';

const BERLIN_TZ = 'Europe/Berlin';

export interface TripPriceInput {
  kts_document_applies: boolean;
  price: number | null;
  driving_distance_km: number | null;
  scheduled_at: string | null;
  client?: { price_tag: number | null } | null;
}

function roundMoneyOnce(raw: number): number {
  return Math.round(raw * 100) / 100;
}

function ruleScopeSource(rule: BillingPricingRuleLike): PriceResolutionSource {
  if (rule.billing_variant_id) return 'variant';
  if (rule.billing_type_id) return 'billing_type';
  return 'payer';
}

const JS_DAY_TO_KEY: Record<number, WeekdayKey> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat'
};

function parseHHmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

/** Berlin local YYYY-MM-DD for holiday string compare */
function berlinYmd(scheduledAt: string): string {
  const zone = tz(getTripsBusinessTimeZone() || BERLIN_TZ);
  const d = zone(parseISO(scheduledAt)) as Date;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function minutesInBerlin(scheduledAt: string): number {
  const zone = tz(getTripsBusinessTimeZone() || BERLIN_TZ);
  const d = zone(parseISO(scheduledAt)) as Date;
  return d.getHours() * 60 + d.getMinutes();
}

function weekdayKeyInBerlin(scheduledAt: string): WeekdayKey {
  const zone = tz(getTripsBusinessTimeZone() || BERLIN_TZ);
  const d = zone(parseISO(scheduledAt)) as Date;
  return JS_DAY_TO_KEY[d.getDay()] ?? 'mon';
}

/**
 * Accumulate km × price_per_km across tiers from 0 to distanceKm; round once at end.
 */
export function tieredNetTotal(distanceKm: number, tiers: KmTier[]): number {
  if (distanceKm <= 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.from_km - b.from_km);
  let pos = 0;
  let raw = 0;
  let guard = 0;
  while (pos < distanceKm - 1e-9 && guard < 1000) {
    guard += 1;
    const tier = sorted.find(
      (t) => pos + 1e-9 >= t.from_km && (t.to_km === null || pos < t.to_km)
    );
    if (!tier) break;
    const cap =
      tier.to_km === null ? distanceKm : Math.min(tier.to_km, distanceKm);
    if (cap <= pos) break;
    const km = cap - pos;
    raw += km * tier.price_per_km;
    pos = cap;
  }
  return roundMoneyOnce(raw);
}

function grossFromNet(net: number, taxRate: number): number {
  return roundMoneyOnce(net * (1 + taxRate));
}

function resolution(
  partial: {
    net: number | null;
    gross?: number | null;
    strategy_used: PriceResolution['strategy_used'];
    source: PriceResolutionSource;
    note?: string;
    unit_price_net: number | null;
    quantity: number;
    tax_rate?: number;
  },
  taxRate: number
): PriceResolution {
  const net = partial.net;
  const gross =
    partial.gross !== undefined && partial.gross !== null
      ? partial.gross
      : net !== null && net !== undefined
        ? grossFromNet(net, taxRate)
        : null;
  return {
    gross,
    net: net ?? null,
    tax_rate: partial.tax_rate ?? taxRate,
    strategy_used: partial.strategy_used,
    source: partial.source,
    note: partial.note,
    unit_price_net: partial.unit_price_net ?? null,
    quantity: partial.quantity
  };
}

function executeStrategy(
  rule: BillingPricingRuleLike,
  strategy: PricingStrategy,
  trip: TripPriceInput,
  taxRate: number
): PriceResolution | null {
  const scope = ruleScopeSource(rule);
  let cfg: unknown;
  try {
    cfg = parseConfigForStrategy(strategy, rule.config);
  } catch {
    return null;
  }

  const dist = trip.driving_distance_km;
  const sched = trip.scheduled_at;

  switch (strategy) {
    case 'client_price_tag': {
      // P1 already consumed price_tag; here only trip.price fallback applies
      if (trip.price != null) {
        return resolution(
          {
            net: trip.price,
            strategy_used: 'trip_price_fallback',
            source: 'trip_price',
            unit_price_net: trip.price,
            quantity: 1
          },
          taxRate
        );
      }
      return null;
    }
    case 'manual_trip_price': {
      if (trip.price == null) return null;
      const n = trip.price;
      return resolution(
        {
          net: n,
          strategy_used: 'manual_trip_price',
          source: scope,
          unit_price_net: n,
          quantity: 1
        },
        taxRate
      );
    }
    case 'no_price':
      return null;
    case 'tiered_km': {
      if (dist === null || dist === undefined) return null;
      const c = cfg as TieredKmConfig;
      const totalNet = tieredNetTotal(dist, c.tiers);
      const unit = roundMoneyOnce(totalNet / dist);
      return resolution(
        {
          net: totalNet,
          strategy_used: 'tiered_km',
          source: scope,
          unit_price_net: unit,
          quantity: dist
        },
        taxRate
      );
    }
    case 'fixed_below_threshold_then_km': {
      if (dist === null || dist === undefined) return null;
      const c = cfg as FixedBelowThresholdThenKmConfig;
      if (dist < c.threshold_km) {
        const n = roundMoneyOnce(c.fixed_price);
        return resolution(
          {
            net: n,
            strategy_used: 'fixed_below_threshold_then_km',
            source: scope,
            unit_price_net: n,
            quantity: 1
          },
          taxRate
        );
      }
      const totalNet = tieredNetTotal(dist, c.km_tiers);
      const unit = roundMoneyOnce(totalNet / dist);
      return resolution(
        {
          net: totalNet,
          strategy_used: 'fixed_below_threshold_then_km',
          source: scope,
          unit_price_net: unit,
          quantity: dist
        },
        taxRate
      );
    }
    case 'time_based': {
      if (!sched) return null;
      const c = cfg as TimeBasedConfig;
      const ymd = berlinYmd(sched);
      const onHoliday = c.holidays.includes(ymd);
      let billOutsideHours = false;
      if (onHoliday && c.holiday_rule === 'closed') {
        billOutsideHours = true;
      } else {
        const wk = weekdayKeyInBerlin(sched);
        const wh = c.working_hours[wk];
        if (wh === null || wh === undefined) {
          billOutsideHours = true;
        } else {
          const tMin = minutesInBerlin(sched);
          const start = parseHHmmToMinutes(wh.start);
          const end = parseHHmmToMinutes(wh.end);
          if (tMin < start || tMin >= end) {
            billOutsideHours = true;
          }
        }
      }
      const fee = roundMoneyOnce(c.fixed_fee);
      if (!billOutsideHours) {
        return resolution(
          {
            net: 0,
            gross: 0,
            strategy_used: 'time_based',
            source: scope,
            unit_price_net: 0,
            quantity: 1,
            note: 'Innerhalb Arbeitszeit'
          },
          taxRate
        );
      }
      return resolution(
        {
          net: fee,
          strategy_used: 'time_based',
          source: scope,
          unit_price_net: fee,
          quantity: 1,
          note: 'Außerhalb Arbeitszeit / Feiertag'
        },
        taxRate
      );
    }
    default: {
      const _e: never = strategy;
      return _e;
    }
  }
}

export function resolveTripPrice(
  trip: TripPriceInput,
  taxRate: number,
  rule: BillingPricingRuleLike | null
): PriceResolution {
  // Priority 0 — KTS hard override
  if (trip.kts_document_applies === true) {
    return {
      gross: 0,
      net: 0,
      tax_rate: taxRate,
      strategy_used: 'kts_override',
      source: 'kts_override',
      note: 'Abgerechnet über KTS — kein Rechnungsbetrag',
      unit_price_net: 0,
      quantity: 1
    };
  }

  // Priority 1 — client price_tag (gross → net), beats all catalog strategies
  const tag = trip.client?.price_tag;
  if (tag !== null && tag !== undefined) {
    const net = roundMoneyOnce(tag / (1 + taxRate));
    return {
      gross: tag,
      net,
      tax_rate: taxRate,
      strategy_used: 'client_price_tag',
      source: 'client_price_tag',
      unit_price_net: net,
      quantity: 1
    };
  }

  // Priority 2 — billing rule
  if (rule && rule.is_active) {
    const r = executeStrategy(rule, rule.strategy, trip, taxRate);
    if (r) return r;
  }

  // Priority 3 — trip.price net fallback
  if (trip.price !== null && trip.price !== undefined) {
    const n = trip.price;
    return resolution(
      {
        net: n,
        strategy_used: 'trip_price_fallback',
        source: 'trip_price',
        unit_price_net: n,
        quantity: 1
      },
      taxRate
    );
  }

  // Priority 4 — unresolved
  return {
    gross: null,
    net: null,
    tax_rate: taxRate,
    strategy_used: 'no_price',
    source: 'unresolved',
    unit_price_net: null,
    quantity: 1
  };
}
