/**
 * Pricing engine types — Spec C. Used by pure resolvers and invoice line snapshots.
 */

export const PRICING_STRATEGIES = [
  'client_price_tag',
  'tiered_km',
  'fixed_below_threshold_then_km',
  'time_based',
  'manual_trip_price',
  'no_price'
] as const;

export type PricingStrategy = (typeof PRICING_STRATEGIES)[number];

/** Stored on invoice_line_items.pricing_source and in PriceResolution.source */
export type PriceResolutionSource =
  | 'kts_override'
  | 'client_price_tag'
  | 'variant'
  | 'billing_type'
  | 'payer'
  | 'trip_price'
  | 'unresolved';

/** strategy_used in DB / snapshot — includes kts and fallbacks beyond catalog enum */
export type PriceStrategyUsed =
  | PricingStrategy
  | 'kts_override'
  | 'trip_price_fallback';

export interface KmTier {
  from_km: number;
  to_km: number | null;
  price_per_km: number;
}

/** Optional Anfahrtspreis on billing rule `config` JSON (all strategies may carry it). */
export interface ApproachFeeConfig {
  approach_fee_net?: number | null;
}

export interface TieredKmConfig extends ApproachFeeConfig {
  tiers: KmTier[];
}

export interface FixedBelowThresholdThenKmConfig extends ApproachFeeConfig {
  threshold_km: number;
  fixed_price: number;
  km_tiers: KmTier[];
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayWorkingHours {
  start: string;
  end: string;
}

export type TimeBasedWorkingHours = Partial<
  Record<WeekdayKey, DayWorkingHours | null>
>;

export interface TimeBasedConfig extends ApproachFeeConfig {
  fixed_fee: number;
  working_hours: TimeBasedWorkingHours;
  holiday_rule: 'closed' | 'normal';
  holidays: string[];
}

export type BillingPricingRuleConfig =
  | (Record<string, never> & ApproachFeeConfig)
  | TieredKmConfig
  | FixedBelowThresholdThenKmConfig
  | TimeBasedConfig;

/**
 * Row-shaped input for pure resolvers. May include `_price_gross` when synthesized
 * from `client_price_tags` in `resolvePricingRule` STEP 0 (not a DB column on billing_pricing_rules).
 */
export interface BillingPricingRuleLike {
  id: string;
  company_id: string;
  payer_id: string | null;
  billing_type_id: string | null;
  billing_variant_id: string | null;
  strategy: PricingStrategy;
  config: unknown;
  is_active: boolean;
  /** Gross € from `client_price_tags` when this object is a synthetic STEP 0 hit. */
  _price_gross?: number;
}

/** Slim row for resolver / invoice builder (loaded with trips). */
export interface ClientPriceTagLike {
  id: string;
  client_id: string;
  payer_id: string | null;
  billing_variant_id: string | null;
  price_gross: number;
  is_active: boolean;
}

/**
 * Full immutable snapshot for invoice_line_items.price_resolution_snapshot
 * and in-memory BuilderLineItem.price_resolution.
 */
export interface PriceResolution {
  gross: number | null;
  /** Base transport net only — excludes Anfahrtspreis. */
  net: number | null;
  tax_rate: number;
  strategy_used: PriceStrategyUsed;
  source: PriceResolutionSource;
  note?: string;
  /** Net unit price (invoice line semantics). */
  unit_price_net: number | null;
  /** Billing quantity (1 for flat; driving_distance_km for per-km). */
  quantity: number;
  /**
   * Flat Anfahrtspreis (net) in addition to base transport. Omitted when none applies.
   * Not included in `net` / `gross`. Line total net = `net` + `(approach_fee_net ?? 0)` at persistence.
   */
  approach_fee_net?: number | null;
}

export interface RechnungsempfaengerCatalogRow {
  id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
}

export type RechnungsempfaengerSnapshot = RechnungsempfaengerCatalogRow;

export type RechnungsempfaengerResolutionSource =
  | 'variant'
  | 'billing_type'
  | 'payer'
  | 'invoice_override'
  | 'none';
