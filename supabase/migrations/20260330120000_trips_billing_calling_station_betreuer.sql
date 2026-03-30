-- Billing metadata for Kostenträger flows (not route/passenger pickup_station / dropoff_station).
-- Populated from Neue Fahrt when behavior_profile.askCallingStationAndBetreuer is true.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS billing_calling_station text NULL,
  ADD COLUMN IF NOT EXISTS billing_betreuer text NULL;

COMMENT ON COLUMN public.trips.billing_calling_station IS
  'Optional: institution/ward that placed the order (Anrufstation). Distinct from passenger pickup_station.';

COMMENT ON COLUMN public.trips.billing_betreuer IS
  'Optional: Betreuer name/contact for billing context. Distinct from route stops.';