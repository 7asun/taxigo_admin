-- Add billing_variant_id to client_km_overrides so KM overrides can be
-- scoped to a specific billing variant (Unterart), matching the scope model
-- of client_price_tags. nullable = override applies to all variants under
-- the selected payer when null.

ALTER TABLE public.client_km_overrides
  ADD COLUMN billing_variant_id uuid
    REFERENCES public.billing_variants(id)
    ON DELETE CASCADE;

-- Index for resolver lookup: client + variant scope
CREATE INDEX IF NOT EXISTS idx_client_km_overrides_variant
  ON public.client_km_overrides(client_id, billing_variant_id)
  WHERE billing_variant_id IS NOT NULL;

-- Update the existing RLS policy to cover the new column (no change needed —
-- the existing admin policy covers all columns on the table already).
