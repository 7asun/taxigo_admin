-- =============================================================================
-- Migration: trips.manual_tax_rate — admin tax override from invoice builder
-- =============================================================================
--
-- why: tax_rate on trips is the original billing-rule value set at trip creation.
-- The invoice builder allows the admin to override VAT per line item. Previously
-- the write-back overwrote tax_rate directly, destroying the original value with
-- no audit trail. manual_tax_rate stores the admin override separately, matching
-- the established pattern of manual_distance_km / driving_distance_km.
-- =============================================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS manual_tax_rate NUMERIC DEFAULT NULL;

COMMENT ON COLUMN public.trips.manual_tax_rate IS
$$Admin tax rate override applied during invoice creation. NULL means no override —
effective tax rate for future invoice builds uses distance-based §12 UStG tiering
unless manual_tax_rate is set. Set by executeTripWriteBack after invoice save when
isManualTaxRateOverride is true. trips.tax_rate is never written by invoice flows.$$;
