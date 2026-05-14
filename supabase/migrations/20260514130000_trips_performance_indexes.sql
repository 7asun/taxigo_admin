-- Composite indexes for trips list query performance.
-- company_id is the primary RLS/tenancy predicate on every query;
-- pairing it with the most-filtered columns avoids full table scans
-- as trip volume grows.

-- Default list view: filtered + sorted by scheduled date
CREATE INDEX IF NOT EXISTS idx_trips_company_scheduled_at
  ON public.trips (company_id, scheduled_at DESC NULLS LAST);

-- Unscheduled / requested_date branch (used when scheduled_at is null)
CREATE INDEX IF NOT EXISTS idx_trips_company_requested_date
  ON public.trips (company_id, requested_date DESC NULLS LAST);

-- Driver filter (common operational filter)
CREATE INDEX IF NOT EXISTS idx_trips_company_driver_id
  ON public.trips (company_id, driver_id);

-- Payer filter
CREATE INDEX IF NOT EXISTS idx_trips_company_payer_id
  ON public.trips (company_id, payer_id);

-- Status filter
CREATE INDEX IF NOT EXISTS idx_trips_company_status
  ON public.trips (company_id, status);
