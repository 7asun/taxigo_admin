/**
 * One-line German summaries of `billing_pricing_rules.config` for catalog tables.
 */
import type { PricingStrategy } from '@/features/invoices/types/pricing.types';
import { PRICING_STRATEGIES } from '@/features/invoices/types/pricing.types';
import type { Json } from '@/types/database.types';

function eurFmt(): Intl.NumberFormat {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
}

function approachSuffix(
  cfg: Record<string, unknown>,
  fmt: Intl.NumberFormat
): string {
  const v = cfg.approach_fee_net;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return ` · Anfahrt ${fmt.format(v)} netto`;
  }
  return '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Human-readable one-liner for admin tables. Must never throw — configs may be legacy or partial.
 *
 * We intentionally avoid Zod: this is a **pure display** path with **no persistence boundary**;
 * malformed JSON must degrade to a safe fallback string, not an exception.
 */
export function formatPricingRuleConfigSummary(
  strategy: PricingStrategy,
  config: Json
): string {
  const fmt = eurFmt();
  const raw = config;
  const cfg = isRecord(raw) ? raw : {};

  try {
    switch (strategy) {
      // config: {} plus optional approach_fee_net
      case 'client_price_tag': {
        const base = 'Kunde Preis-Tag (Brutto)';
        return `${base}${approachSuffix(cfg, fmt)}`;
      }
      // config: {} plus optional approach_fee_net
      case 'manual_trip_price': {
        return `Manuell${approachSuffix(cfg, fmt)}`;
      }
      // config: {} plus optional approach_fee_net
      case 'no_price': {
        return `Kein Preis${approachSuffix(cfg, fmt)}`;
      }
      // config.tiers: { from_km, to_km | null, price_per_km }[]; optional approach_fee_net
      case 'tiered_km': {
        const tiers = cfg.tiers;
        if (!Array.isArray(tiers) || tiers.length === 0) {
          return `Staffelpreis${approachSuffix(cfg, fmt)}`;
        }
        const first = tiers[0];
        if (!isRecord(first)) {
          return `${tiers.length} Staffeln${approachSuffix(cfg, fmt)}`;
        }
        const from = typeof first.from_km === 'number' ? first.from_km : 0;
        const to = first.to_km;
        const ppk = first.price_per_km;
        const toLabel =
          to === null || to === undefined
            ? '∞'
            : typeof to === 'number'
              ? String(to)
              : '?';
        const priceLabel =
          typeof ppk === 'number' && Number.isFinite(ppk)
            ? `${fmt.format(ppk)}/km`
            : '—/km';
        const head = `ab ${from} km bis ${toLabel}: ${priceLabel}`;
        const tail = tiers.length > 1 ? ` (+${tiers.length - 1} weitere)` : '';
        return `${head}${tail}${approachSuffix(cfg, fmt)}`;
      }
      // config: threshold_km, fixed_price, km_tiers[] (same tier shape as tiered_km); optional approach_fee_net
      case 'fixed_below_threshold_then_km': {
        const th = cfg.threshold_km;
        const fp = cfg.fixed_price;
        const kmTiers = cfg.km_tiers;
        const thLabel =
          typeof th === 'number' && Number.isFinite(th) ? `${th} km` : '— km';
        const fpLabel =
          typeof fp === 'number' && Number.isFinite(fp) ? fmt.format(fp) : '—';
        const tierCount =
          Array.isArray(kmTiers) && kmTiers.length > 0
            ? `, danach ${kmTiers.length} km-Staffel(n)`
            : '';
        return `≤ ${thLabel}: Pauschal ${fpLabel}${tierCount}${approachSuffix(cfg, fmt)}`;
      }
      // config: fixed_fee, working_hours.{mon..sun}, holiday_rule, holidays[]; optional approach_fee_net
      case 'time_based': {
        const fee = cfg.fixed_fee;
        const feeLabel =
          typeof fee === 'number' && Number.isFinite(fee)
            ? fmt.format(fee)
            : '—';
        const holidays = cfg.holidays;
        const holHint =
          Array.isArray(holidays) && holidays.length > 0
            ? ` · ${holidays.length} Feiertag(e)`
            : '';
        return `Zeitbasiert · Pauschal ${feeLabel}${holHint}${approachSuffix(cfg, fmt)}`;
      }
      default:
        return '—';
    }
  } catch {
    return '—';
  }
}

export function isPricingStrategy(s: string): s is PricingStrategy {
  return (PRICING_STRATEGIES as readonly string[]).includes(s);
}
