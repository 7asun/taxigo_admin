/**
 * Pure trip price resolution — Spec C cascade (locked priorities).
 * Priority 0: Taxameter — `trips.manual_gross_price` (admin recorded gross; all-in, incl. Anfahrt)
 * Priority 1: KTS → €0
 * Priority 2: client gross — `rule._price_gross` (client_price_tags via resolvePricingRule STEP 0)
 *   else legacy `clients.price_tag` (gross → net)
 * Priority 3: billing_pricing_rules strategy
 * Priority 4: trips.base_net_price (transport net) fallback
 * Priority 5: null / unresolved
 *
 * Tiered km: sum raw (km × rate) then round once to cents.
 * time_based: Europe/Berlin wall clock + calendar date for holidays.
 *
 * Anfahrtspreis (`approach_fee_net` on the returned resolution):
 * - P0 taxameter: meter reading is all-in — do not add rule approach (avoids double-counting Anfahrt).
 * - client_price_tag is an all-in negotiated gross — approach fee does NOT apply.
 * - KTS lines are legally €0 — approach fee must be omitted.
 * - All other strategies: attach `approach_fee_net` from active rule config if present.
 */
import { parseISO } from 'date-fns';
import { tz } from '@date-fns/tz';

import { parseConfigForStrategy } from '@/features/invoices/lib/pricing-rule-config.schema';
import { normalizeRuleConfigToNet } from '@/lib/pricing/normalize-rule-config';
import { roundMoneyOnce } from '@/lib/pricing/round-money-once';
import type {
  ApproachFeeConfig,
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

/**
 * # Pricing engine — rounding contract
 *
 * ## Gross-anchor strategies (P2 — `client_price_tag` after P0–P1)
 *
 * The client contract specifies a **gross** price (incl. VAT). The gross value
 * is the single source of truth and must never be recomputed from a rounded net.
 *
 * Rules:
 *   - `gross` in `PriceResolution` is set directly from `client.price_tag`.
 *   - `unit_price_net` = `tag / (1 + taxRate)` — stored as full-precision float,
 *     NOT rounded with `roundMoneyOnce`. Rounding here would cause drift when
 *     multiplied across N trips (e.g. 32.60 × 13 = 423.80, not 423.84).
 *   - `net` (display field) = same full-precision value; callers that display
 *     a formatted net should round at render time, not at storage time.
 *   - `calculateInvoiceTotals` must detect pricetag lines and sum
 *     `gross × quantity` directly — never re-derive gross from the stored net.
 *
 * ## Net-anchor strategies (P3–P5 and all billing rules)
 *
 * The billing rule, trip price, or km rate defines a **net** amount. Tax is
 * applied on top and must only be rounded **once, at the total level**.
 *
 * Rules:
 *   - `unit_price_net` is rounded with `roundMoneyOnce` at resolution time
 *     (acceptable: these strategies are defined in net terms so the net is
 *     the anchor, and per-unit rounding error stays within ±0.005 per line).
 *   - For per-km strategies (`tiered_km`, `fixed_below_threshold_then_km`),
 *     `tieredNetTotal` applies ONE `roundMoneyOnce` on the total net for the
 *     trip — never per-segment — to minimise accumulated error.
 *   - `calculateInvoiceTotals` accumulates `unit_price × quantity` per line
 *     into `byRate` buckets, then applies `Math.round(net × rate × 100) / 100`
 *     once per tax-rate bucket. This is the correct sequence: sum first, round last.
 *
 * ## `approach_fee_net`
 *
 * Always net-anchored regardless of the base transport strategy. It is stored
 * as net and grossed up with `× (1 + tax_rate)` in `insertLineItems` and in
 * `calculateInvoiceTotals`. It is NEVER included in `priceResolution.gross`.
 */

const BERLIN_TZ = 'Europe/Berlin';

export interface TripPriceInput {
  kts_document_applies: boolean;
  /** @deprecated for P3/P4 — prefer `base_net_price`. */
  net_price: number | null;
  /**
   * Transport net only (excludes Anfahrt). P3 strategies and P4 use this; do not pass combined `net_price` here
   * or `withApproachFeeFromRule` can double-count approach on top of a combined stored total.
   */
  base_net_price: number | null;
  /** Taxameter gross (Admin) on the trip — absolute P0; all-in, includes Anfahrt. */
  manual_gross_price: number | null;
  driving_distance_km: number | null;
  scheduled_at: string | null;
  client?: { price_tag: number | null } | null;
}

/** Maps which catalog level produced the active rule — stored as PriceResolution.source for audit. */
function ruleScopeSource(rule: BillingPricingRuleLike): PriceResolutionSource {
  if (rule.billing_variant_id) return 'variant';
  if (rule.billing_type_id) return 'billing_type';
  return 'payer';
}

/** Optional net Anfahrtspreis from parsed rule config; undefined = omit on resolution. */
function extractApproachFeeNet(
  rule: BillingPricingRuleLike | null
): number | undefined {
  if (!rule?.is_active) return undefined;
  try {
    const cfg = parseConfigForStrategy(
      rule.strategy,
      rule.config
    ) as ApproachFeeConfig;
    const v = cfg.approach_fee_net;
    if (v === null || v === undefined) return undefined;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0) return undefined;
    return roundMoneyOnce(v);
  } catch {
    return undefined;
  }
}

function withApproachFeeFromRule(
  base: PriceResolution,
  rule: BillingPricingRuleLike | null
): PriceResolution {
  const fee = extractApproachFeeNet(rule);
  if (fee === undefined) return base;
  return { ...base, approach_fee_net: fee };
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
      // Misnamed strategy: if we got here, price_tag was absent — use stored transport net if present.
      if (trip.base_net_price != null) {
        return resolution(
          {
            net: trip.base_net_price,
            strategy_used: 'trip_price_fallback',
            source: 'trip_price',
            unit_price_net: trip.base_net_price,
            quantity: 1
          },
          taxRate
        );
      }
      return null;
    }
    case 'client_km_override': {
      // Not a billing_pricing_rules strategy in production — exhaustiveness only.
      if (trip.base_net_price != null) {
        return resolution(
          {
            net: trip.base_net_price,
            strategy_used: 'trip_price_fallback',
            source: 'trip_price',
            unit_price_net: trip.base_net_price,
            quantity: 1
          },
          taxRate
        );
      }
      return null;
    }
    case 'manual_trip_price': {
      // Explicit rule to invoice stored driver net price only.
      if (trip.base_net_price == null) return null;
      const n = trip.base_net_price;
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
      // Deliberately no automatic amount — dispatcher must enter in builder or line stays unresolved.
      return null;
    case 'tiered_km': {
      // Distance required: cannot price km tiers without driving_distance_km.
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
      // Below threshold: flat net regardless of km (quantity 1).
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
      // At/above threshold: full distance priced with km tiers (quantity = km).
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
      // Need trip instant for Berlin wall-clock and holiday calendar match.
      if (!sched) return null;
      const c = cfg as TimeBasedConfig;
      const ymd = berlinYmd(sched);
      const onHoliday = c.holidays.includes(ymd);
      let billOutsideHours = false;
      // Configured holiday + closed rule ⇒ treat like outside working hours (surcharge).
      if (onHoliday && c.holiday_rule === 'closed') {
        billOutsideHours = true;
      } else {
        const wk = weekdayKeyInBerlin(sched);
        const wh = c.working_hours[wk];
        // Day disabled in config ⇒ entire day counts as outside (surcharge).
        if (wh === null || wh === undefined) {
          billOutsideHours = true;
        } else {
          const tMin = minutesInBerlin(sched);
          const start = parseHHmmToMinutes(wh.start);
          const end = parseHHmmToMinutes(wh.end);
          // Half-open window [start, end): outside before start or from end onward.
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
  // P0: Taxameter wins over KTS, client tags, and engine — real metered fare, not a correction.
  // Gross is all-in (Anfahrt included). Do not wrap in withApproachFeeFromRule (no double Anfahrt).
  if (
    trip.manual_gross_price != null &&
    trip.manual_gross_price !== undefined
  ) {
    const gross = trip.manual_gross_price;
    const net = gross / (1 + taxRate);
    return {
      ...resolution(
        {
          net,
          gross,
          strategy_used: 'manual_trip_price',
          source: 'manual_gross_price',
          unit_price_net: net,
          quantity: 1,
          note: 'Taxameter-Preis (Admin erfasst)'
        },
        taxRate
      ),
      approach_fee_net: 0
    };
  }

  // P1 — KTS hard override (no Anfahrtspreis on resolution)
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

  // P2 — client price tag (gross → net), beats all catalog strategies (no Anfahrtspreis).
  // Prefer `_price_gross` from resolvePricingRule STEP 0 (client_price_tags); else legacy clients.price_tag.
  const syntheticGross =
    rule?.strategy === 'client_price_tag' &&
    typeof rule._price_gross === 'number' &&
    !Number.isNaN(rule._price_gross)
      ? rule._price_gross
      : null;
  const legacyTag = trip.client?.price_tag;
  const tagGross =
    syntheticGross !== null && syntheticGross > 0
      ? syntheticGross
      : legacyTag !== null && legacyTag !== undefined
        ? legacyTag
        : null;
  if (tagGross !== null && tagGross !== undefined) {
    const net = tagGross / (1 + taxRate);
    return {
      gross: tagGross,
      net,
      tax_rate: taxRate,
      strategy_used: 'client_price_tag',
      source: 'client_price_tag',
      unit_price_net: net,
      quantity: 1
    };
  }

  // P3 — catalog rule strategies (skipped when price_tag already won at P2).
  if (rule && rule.is_active) {
    // WHY: Normalization runs once here so every strategy branch stays net-anchored; we do not
    // thread gross/config into `executeStrategy` (avoids splitting VAT logic across many cases).
    // `approach_fee_net` is left unchanged inside config — see `normalizeRuleConfigToNet`.
    const configForExecution = normalizeRuleConfigToNet(
      rule.config,
      rule.strategy,
      rule.pricing_basis,
      taxRate
    );
    const strategyResult = executeStrategy(
      { ...rule, config: configForExecution },
      rule.strategy,
      trip,
      taxRate
    );
    if (strategyResult) {
      return withApproachFeeFromRule(strategyResult, {
        ...rule,
        config: configForExecution
      });
    }
  }

  // P4 — stored **transport** net when no rule produced an amount (or rule returned null).
  // `base_net_price` only: previously P4 read combined `net_price` and the rule’s approach
  // could be applied on top again (double-count). Phase 2 generated `trips.net_price` is combined only for readers.
  if (trip.base_net_price !== null && trip.base_net_price !== undefined) {
    const n = trip.base_net_price;
    return withApproachFeeFromRule(
      resolution(
        {
          net: n,
          strategy_used: 'trip_price_fallback',
          source: 'trip_price',
          unit_price_net: n,
          quantity: 1
        },
        taxRate
      ),
      rule
    );
  }

  // P5 — nothing left to price; builder shows missing_price until manual entry.
  return withApproachFeeFromRule(
    {
      gross: null,
      net: null,
      tax_rate: taxRate,
      strategy_used: 'no_price',
      source: 'unresolved',
      unit_price_net: null,
      quantity: 1
    },
    rule
  );
}

/**
 * Back-calculates unit_price_net and approach_fee_net from admin-entered gross values.
 * approach_fee_gross is INCLUDED in grossTotal (not additive).
 *
 * For per-km strategies (quantity > 1), unit_price_net is per-km so that the
 * existing insertLineItems formula (unit_price × quantity + approach_fee_net) × (1+r)
 * yields exactly grossTotal — no rounding drift.
 */
export function applyGrossOverrideToResolution(
  base: PriceResolution,
  grossTotal: number,
  approachFeeGross: number,
  taxRate: number
): PriceResolution {
  const qty = base.quantity;
  const approachFeeNet = approachFeeGross / (1 + taxRate);
  const transportNet = (grossTotal - approachFeeGross) / (1 + taxRate);
  const unitPriceNet = qty > 1 ? transportNet / qty : transportNet;
  const prevNote = base.note;
  const overrideNote = 'Manuell überschrieben (Bruttoeingabe)';
  const note =
    prevNote && !prevNote.includes(overrideNote)
      ? `${prevNote} · ${overrideNote}`
      : overrideNote;
  return {
    ...base,
    unit_price_net: unitPriceNet,
    net: transportNet,
    gross: grossTotal,
    tax_rate: taxRate,
    approach_fee_net: approachFeeNet,
    strategy_used: 'manual_trip_price',
    note
  };
}
