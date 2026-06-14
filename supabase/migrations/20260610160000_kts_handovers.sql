-- KTS PR3.3: batch handover to accountant — one kts_handovers row groups many trips.
-- See docs/kts-architecture.md §3.6.

CREATE TABLE public.kts_handovers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL
                          REFERENCES public.companies(id)
                          ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id)
                          ON DELETE SET NULL
);

COMMENT ON TABLE public.kts_handovers IS
  'Batch handover of verified KTS documents to the accountant (PR3.3).';

COMMENT ON COLUMN public.kts_handovers.id IS 'Primary key.';
COMMENT ON COLUMN public.kts_handovers.company_id IS
  'Tenant scope — all queries and RLS policies filter by this column.';
COMMENT ON COLUMN public.kts_handovers.created_at IS
  'When the handover batch was created.';
COMMENT ON COLUMN public.kts_handovers.created_by IS
  'Auth user who created the handover. SET NULL on user deletion; company_id is authoritative.';

CREATE INDEX idx_kts_handovers_company_id
  ON public.kts_handovers (company_id);

CREATE INDEX idx_kts_handovers_company_created_at
  ON public.kts_handovers (company_id, created_at DESC);

ALTER TABLE public.kts_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kts_handovers_select"
  ON public.kts_handovers
  FOR SELECT
  USING (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

CREATE POLICY "kts_handovers_insert"
  ON public.kts_handovers
  FOR INSERT
  WITH CHECK (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

-- No UPDATE/DELETE policies — append-only audit; rows removed via CASCADE from companies.

GRANT SELECT, INSERT ON public.kts_handovers TO authenticated, service_role;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_handover_id uuid
  REFERENCES public.kts_handovers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trips.kts_handover_id IS
  'FK to the handover batch that transitioned this trip to uebergeben (PR3.3).';

CREATE INDEX IF NOT EXISTS idx_trips_kts_handover_id
  ON public.trips (kts_handover_id)
  WHERE kts_handover_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_kts_handover(
  p_company_id uuid,
  p_trip_ids   uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_handover_id uuid;
  v_expected    int;
  v_eligible    int;
  v_updated     int;
BEGIN
  IF NOT public.current_user_is_admin()
     OR p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'create_kts_handover: unauthorized';
  END IF;

  IF cardinality(p_trip_ids) = 0 THEN
    RAISE EXCEPTION 'create_kts_handover: trip list must not be empty';
  END IF;

  v_expected := cardinality(p_trip_ids);

  SELECT COUNT(*)::int INTO v_eligible
  FROM public.trips t
  WHERE t.id = ANY(p_trip_ids)
    AND t.company_id = p_company_id
    AND t.kts_status = 'korrekt'
    AND t.kts_document_applies = true;

  IF v_eligible <> v_expected THEN
    RAISE EXCEPTION
      'create_kts_handover: % trip(s) not eligible (not korrekt or wrong company)',
      v_expected - v_eligible;
  END IF;

  INSERT INTO public.kts_handovers (company_id, created_by)
  VALUES (p_company_id, auth.uid())
  RETURNING id INTO v_handover_id;

  UPDATE public.trips
  SET
    kts_status       = 'uebergeben',
    kts_handover_id  = v_handover_id,
    kts_fehler       = false
  WHERE id = ANY(p_trip_ids)
    AND company_id = p_company_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_expected THEN
    RAISE EXCEPTION
      'create_kts_handover: updated % trip(s) but expected %',
      v_updated, v_expected;
  END IF;

  RETURN v_handover_id;
END;
$$;

COMMENT ON FUNCTION public.create_kts_handover(uuid, uuid[]) IS
  'Atomic KTS handover batch (PR3.3): inserts kts_handovers and transitions '
  'all eligible trips korrekt → uebergeben. SECURITY DEFINER — tenant guard '
  'via current_user_is_admin() and p_company_id = current_user_company_id().';

REVOKE ALL ON FUNCTION public.create_kts_handover(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_kts_handover(uuid, uuid[])
  TO authenticated;
