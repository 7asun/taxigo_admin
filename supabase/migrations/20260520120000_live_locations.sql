-- live_locations: one row per driver, upserted during active tracking (~5s)
-- WHY: history via updated_at; position snapshots / Realtime Broadcast deferred to Phase 2

-- ---------------------------------------------------------------------------
-- Table (idempotent — may already exist in remote with legacy columns)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_locations (
  driver_id    uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  speed_kmh    numeric(5, 1),
  accuracy_m   numeric(6, 1),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.live_locations
  ADD COLUMN IF NOT EXISTS speed_kmh numeric(5, 1);

ALTER TABLE public.live_locations
  ADD COLUMN IF NOT EXISTS accuracy_m numeric(6, 1);

-- Legacy deployments may have required status / nullable lat-lng — relax for Phase 1 upsert
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'live_locations' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.live_locations ALTER COLUMN status DROP NOT NULL;
  END IF;
END $$;

COMMENT ON TABLE public.live_locations IS
  'Latest GPS position per driver (upsert). Phase 1: watchPosition from driver app; admin fleet map via postgres_changes.';

COMMENT ON COLUMN public.live_locations.speed_kmh IS
  'Ground speed in km/h from Geolocation API (nullable when device does not report speed).';

COMMENT ON COLUMN public.live_locations.accuracy_m IS
  'GPS accuracy in metres (Geolocation coords.accuracy).';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.live_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver upsert own location" ON public.live_locations;
DROP POLICY IF EXISTS "live_locations_driver_all" ON public.live_locations;
DROP POLICY IF EXISTS "admin read company locations" ON public.live_locations;
DROP POLICY IF EXISTS "live_locations_admin_select" ON public.live_locations;

CREATE POLICY "live_locations_driver_all" ON public.live_locations
  FOR ALL TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (
    driver_id = auth.uid()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "live_locations_admin_select" ON public.live_locations
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes for admin fleet map)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.live_locations;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_locations TO authenticated;
