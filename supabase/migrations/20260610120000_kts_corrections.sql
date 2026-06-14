-- KTS correction rounds: one row per outbound correction per trip (append-only history).
-- See docs/kts-architecture.md (PR2).

CREATE TABLE public.kts_corrections (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL
                            REFERENCES public.companies(id)
                            ON DELETE CASCADE,
  trip_id       uuid        NOT NULL
                            REFERENCES public.trips(id)
                            ON DELETE CASCADE,
  sent_to       text        NOT NULL,
  sent_at       timestamptz NOT NULL,
  received_at   timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        REFERENCES auth.users(id)
                            ON DELETE SET NULL
);

COMMENT ON COLUMN public.kts_corrections.id IS 'Primary key.';
COMMENT ON COLUMN public.kts_corrections.company_id IS 'Tenant scope — all queries and RLS policies filter by this column.';
COMMENT ON COLUMN public.kts_corrections.trip_id IS 'The trip this correction round belongs to. Cascade-deleted when the trip is deleted.';
COMMENT ON COLUMN public.kts_corrections.sent_to IS 'Free-text name of the recipient (doctor, hospital, or institute) the KTS document was sent to for correction.';
COMMENT ON COLUMN public.kts_corrections.sent_at IS 'Timestamp when the KTS document was sent out for correction.';
COMMENT ON COLUMN public.kts_corrections.received_at IS 'Timestamp when the corrected document was received back. NULL means the correction round is still open.';
COMMENT ON COLUMN public.kts_corrections.notes IS 'Optional internal notes about this correction round.';
COMMENT ON COLUMN public.kts_corrections.created_at IS 'Row creation timestamp — used as the tiebreaker in DISTINCT ON for latest-round queries.';
COMMENT ON COLUMN public.kts_corrections.created_by IS 'Auth user who created this correction record. SET NULL on user deletion; company_id is the authoritative tenant key.';

CREATE INDEX ON public.kts_corrections (trip_id);
CREATE INDEX ON public.kts_corrections (company_id);
CREATE INDEX ON public.kts_corrections (trip_id, created_at DESC);

ALTER TABLE public.kts_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kts_corrections_select"
  ON public.kts_corrections
  FOR SELECT
  USING (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

CREATE POLICY "kts_corrections_insert"
  ON public.kts_corrections
  FOR INSERT
  WITH CHECK (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

CREATE POLICY "kts_corrections_update"
  ON public.kts_corrections
  FOR UPDATE
  USING (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

-- No DELETE policy — corrections are append-only audit records.
-- Rows are removed only via ON DELETE CASCADE from trips.

GRANT SELECT, INSERT, UPDATE ON public.kts_corrections TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trip_kts_correction_summaries(
  p_trip_ids uuid[]
)
RETURNS TABLE (
  trip_id            uuid,
  correction_count   bigint,
  latest_sent_to     text,
  latest_sent_at     timestamptz,
  latest_received_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (kc.trip_id)
      kc.trip_id,
      kc.sent_to     AS latest_sent_to,
      kc.sent_at     AS latest_sent_at,
      kc.received_at AS latest_received_at
    FROM public.kts_corrections kc
    WHERE kc.trip_id = ANY(p_trip_ids)
    ORDER BY kc.trip_id, kc.created_at DESC
  ),
  counts AS (
    SELECT kc.trip_id, COUNT(*) AS correction_count
    FROM public.kts_corrections kc
    WHERE kc.trip_id = ANY(p_trip_ids)
    GROUP BY kc.trip_id
  )
  SELECT
    l.trip_id,
    c.correction_count,
    l.latest_sent_to,
    l.latest_sent_at,
    l.latest_received_at
  FROM latest l
  JOIN counts c ON c.trip_id = l.trip_id;
$$;

GRANT EXECUTE ON FUNCTION public.trip_kts_correction_summaries(uuid[])
  TO authenticated;
