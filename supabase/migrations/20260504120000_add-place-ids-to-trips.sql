-- WHY: store Google Place IDs on trip rows so that Plan B4 can use
-- them as a stable, jitter-free cache key for route_metrics_cache.
-- Nullable because bulk/cron/CSV trips never go through Place Details.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS pickup_place_id  TEXT,
  ADD COLUMN IF NOT EXISTS dropoff_place_id TEXT;

COMMENT ON COLUMN public.trips.pickup_place_id IS
  'Google Places place_id for the pickup location. '
  'Populated only for form-created trips using Places Autocomplete. '
  'Used by route_metrics_cache for stable distance lookup (Plan B4).';

COMMENT ON COLUMN public.trips.dropoff_place_id IS
  'Google Places place_id for the dropoff location. '
  'Populated only for form-created trips using Places Autocomplete. '
  'Used by route_metrics_cache for stable distance lookup (Plan B4).';
