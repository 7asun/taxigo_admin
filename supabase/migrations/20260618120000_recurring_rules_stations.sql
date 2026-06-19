-- Add route/passenger station columns to recurring_rules and a payer-level feature gate.
--
-- pickup_station / dropoff_station here are route/passenger station codes, the same
-- meaning as trips.pickup_station / trips.dropoff_station.
-- They are NOT the billing metadata fields trips.billing_calling_station / trips.billing_betreuer.
--
-- Deployment constraint: apply this migration before deploying app code that reads
-- or writes these columns. DB-first is safe (nullable / defaulted); UI-before-DB is not.

-- Route station fields on recurring rules (nullable, no default — null means "no station")
alter table public.recurring_rules
  add column if not exists pickup_station  text null,
  add column if not exists dropoff_station text null;

comment on column public.recurring_rules.pickup_station  is
  'Route/passenger pickup station code — copied to generated outbound trips, swapped on return trips. Not the billing calling station.';
comment on column public.recurring_rules.dropoff_station is
  'Route/passenger dropoff station code — copied to generated outbound trips, swapped on return trips. Not the billing calling station.';

-- Payer-level feature gate: when true, recurring-rule forms show and require both station fields
alter table public.payers
  add column if not exists recurring_rules_station_enabled boolean not null default false;

comment on column public.payers.recurring_rules_station_enabled is
  'When true, recurring-rule forms show pickup_station and dropoff_station as required fields. Generated trips copy/swap these station values.';
