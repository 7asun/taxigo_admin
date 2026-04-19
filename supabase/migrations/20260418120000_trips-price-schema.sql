-- Phase 0: Trip Schema Migration for Price Calculation Engine
-- Goals: Rename price to net_price, add gross_price, tax_rate, and billing_type_id.

ALTER TABLE public.trips 
  RENAME COLUMN price TO net_price;

ALTER TABLE public.trips
  ADD COLUMN gross_price numeric,
  ADD COLUMN tax_rate numeric,
  ADD COLUMN billing_type_id uuid REFERENCES public.billing_types(id);

-- Add index on billing_type_id for performance
CREATE INDEX IF NOT EXISTS idx_trips_billing_type_id ON public.trips(billing_type_id);

-- Comment on columns for clarity
COMMENT ON COLUMN public.trips.net_price IS 'The net price of the trip (formerly price).';
COMMENT ON COLUMN public.trips.gross_price IS 'The gross price of the trip (net + tax).';
COMMENT ON COLUMN public.trips.tax_rate IS 'The tax rate applied to the trip (e.g., 0.07 or 0.19).';
COMMENT ON COLUMN public.trips.billing_type_id IS 'Direct reference to the billing type resolved from the billing variant at creation.';
