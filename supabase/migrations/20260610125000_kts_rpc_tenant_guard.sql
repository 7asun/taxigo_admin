-- KTS-SEC-01: Harden trip_kts_correction_summaries with in-function tenant guard.
-- See docs/plans/kts-rpc-tenant-guard-deferred.md.

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
  -- KTS-SEC-01: tenant guard added post-PR2. SECURITY DEFINER
  -- bypasses RLS on kts_corrections; we enforce isolation here
  -- by joining trips and filtering on the caller's company_id.
  -- This mirrors the pattern in controlling_rpcs.sql.
  WITH authorized AS (
    SELECT public.current_user_company_id() AS company_id
    WHERE public.current_user_company_id() IS NOT NULL
  ),
  latest AS (
    SELECT DISTINCT ON (kc.trip_id)
      kc.trip_id,
      kc.sent_to     AS latest_sent_to,
      kc.sent_at     AS latest_sent_at,
      kc.received_at AS latest_received_at
    FROM public.kts_corrections kc
    JOIN public.trips t ON t.id = kc.trip_id
    WHERE kc.trip_id = ANY(p_trip_ids)
      AND t.company_id = (SELECT company_id FROM authorized)
      AND EXISTS (SELECT 1 FROM authorized)
    ORDER BY kc.trip_id, kc.created_at DESC
  ),
  counts AS (
    SELECT kc.trip_id, COUNT(*) AS correction_count
    FROM public.kts_corrections kc
    JOIN public.trips t ON t.id = kc.trip_id
    WHERE kc.trip_id = ANY(p_trip_ids)
      AND t.company_id = (SELECT company_id FROM authorized)
      AND EXISTS (SELECT 1 FROM authorized)
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

COMMENT ON FUNCTION public.trip_kts_correction_summaries(uuid[]) IS
  'Returns aggregated KTS correction summary per trip. '
  'SECURITY DEFINER — tenant isolation enforced internally via '
  'current_user_company_id() + JOIN trips (KTS-SEC-01). '
  'Caller must supply trip UUIDs from the RLS-protected trips query.';
