-- WHY: store geocoded coordinates on the rule so the cron can use
-- stable lat/lng across runs instead of re-geocoding the address
-- string each time (which is non-deterministic). Nullable so existing
-- rules are not broken — the cron falls back to geocoding when null.
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS pickup_lat   FLOAT8,
  ADD COLUMN IF NOT EXISTS pickup_lng   FLOAT8,
  ADD COLUMN IF NOT EXISTS dropoff_lat  FLOAT8,
  ADD COLUMN IF NOT EXISTS dropoff_lng  FLOAT8;

COMMENT ON COLUMN public.recurring_rules.pickup_lat IS
  'Geocoded latitude for pickup_address. Resolved once at rule '
  'creation/update. Null for legacy rules — cron falls back to '
  'live geocoding when null.';

COMMENT ON COLUMN public.recurring_rules.pickup_lng IS
  'Geocoded longitude for pickup_address. See pickup_lat.';

COMMENT ON COLUMN public.recurring_rules.dropoff_lat IS
  'Geocoded latitude for dropoff_address. See pickup_lat.';

COMMENT ON COLUMN public.recurring_rules.dropoff_lng IS
  'Geocoded longitude for dropoff_address. See pickup_lat.';
