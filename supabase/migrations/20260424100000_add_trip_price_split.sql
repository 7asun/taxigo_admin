-- Phase 1: split transport net vs approach fee on trips (nullable until backfill).

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS base_net_price numeric(10, 4),
  ADD COLUMN IF NOT EXISTS approach_fee_net numeric(10, 4);

COMMENT ON COLUMN public.trips.base_net_price IS
  'Transport net only (excluding approach fee). Populated from Phase 1 onwards. Legacy rows backfilled by scripts/backfill-trip-price-split.ts.';

COMMENT ON COLUMN public.trips.approach_fee_net IS
  'Approach fee net. Zero for taxameter trips (P0). Null for rows not yet backfilled. Sourced from invoice_line_items for invoiced trips, or from resolveTripPrice replay for uninvoiced trips.';
