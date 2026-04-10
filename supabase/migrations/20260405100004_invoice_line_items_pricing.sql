-- =============================================================================
-- Spec C: line item pricing provenance + full PriceResolution JSONB snapshot.
-- =============================================================================

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS pricing_strategy_used text,
  ADD COLUMN IF NOT EXISTS pricing_source text,
  ADD COLUMN IF NOT EXISTS kts_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_resolution_snapshot jsonb;

COMMENT ON COLUMN public.invoice_line_items.pricing_strategy_used IS
  'Strategy enum at invoicing time (e.g. tiered_km, client_price_tag); denormalized for reporting.';

COMMENT ON COLUMN public.invoice_line_items.pricing_source IS
  'Resolution tier: kts_override, variant, billing_type, payer, client_price_tag, trip_price, unresolved, etc.';

COMMENT ON COLUMN public.invoice_line_items.kts_override IS
  'True when KTS forced zero invoice amount for this line.';

COMMENT ON COLUMN public.invoice_line_items.price_resolution_snapshot IS
  'Full immutable PriceResolution JSON at creation (gross, net, tax_rate, notes, strategy). For audit when catalog rules change.';
