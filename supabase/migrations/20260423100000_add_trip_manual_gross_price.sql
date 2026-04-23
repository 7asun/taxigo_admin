ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS manual_gross_price numeric(12, 4) DEFAULT NULL;

COMMENT ON COLUMN public.trips.manual_gross_price IS
  'Admin-set gross override price (taxameter amount) set during invoice creation.
   Null = use normal rule-based pricing. P0.5 priority in resolveTripPrice deferred.';
