/**
 * German UI labels for pricing strategies and resolution sources (invoice builder, PDF hints, Kostenträger admin).
 */
import type {
  PriceResolutionSource,
  PriceStrategyUsed,
  PricingStrategy
} from '@/features/invoices/types/pricing.types';

export const PRICING_STRATEGY_LABELS_DE: Record<PricingStrategy, string> = {
  client_price_tag: 'Kunde Preis-Tag (Brutto)',
  tiered_km: 'Staffelpreis pro km',
  fixed_below_threshold_then_km: 'Festpreis unter Schwelle, dann km',
  time_based: 'Zeitbasiert (Außerhalb Arbeitszeit)',
  manual_trip_price: 'Manueller Fahrtenpreis',
  no_price: 'Kein Preis'
};

/** Labels for `PriceResolution.source` in tooltips and summaries. */
export const PRICE_RESOLUTION_SOURCE_LABELS_DE: Record<
  PriceResolutionSource,
  string
> = {
  kts_override: 'KTS',
  client_price_tag: 'Kunde Preis-Tag',
  variant: 'Unterart',
  billing_type: 'Abrechnungsfamilie',
  payer: 'Kostenträger',
  trip_price: 'Fahrt / manuell',
  unresolved: 'Nicht aufgelöst'
};

export function pricingStrategyUsedLabelDe(s: PriceStrategyUsed): string {
  if (s === 'kts_override') {
    return 'KTS (0 €)';
  }
  if (s === 'trip_price_fallback') {
    return 'Fahrt-Preis (System)';
  }
  const k = s as PricingStrategy;
  return PRICING_STRATEGY_LABELS_DE[k] ?? s;
}
