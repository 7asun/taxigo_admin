-- KTS PR3.2: queue KPI counts for /dashboard/kts stat cards.
-- Overdue threshold: 10 days (KTS_OVERDUE_DAYS in src/features/kts/kts.service.ts).

CREATE OR REPLACE FUNCTION public.get_kts_queue_kpis(
  p_company_id uuid
)
RETURNS TABLE (
  gesamt        bigint,
  ungeprueft    bigint,
  fehler_aktiv  bigint,
  ueberfaellig  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authorized AS (
    SELECT 1
    WHERE public.current_user_is_admin()
      AND p_company_id = public.current_user_company_id()
  )
  SELECT
    (COUNT(*) FILTER (WHERE true))::bigint AS gesamt,
    (COUNT(*) FILTER (WHERE t.kts_status = 'ungeprueft'))::bigint AS ungeprueft,
    (COUNT(*) FILTER (
      WHERE t.kts_status IN ('fehlerhaft', 'in_korrektur')
    ))::bigint AS fehler_aktiv,
    (
      SELECT COUNT(DISTINCT kc.trip_id)::bigint
      FROM public.kts_corrections kc
      WHERE EXISTS (SELECT 1 FROM authorized)
        AND kc.company_id = p_company_id
        AND kc.received_at IS NULL
        AND kc.sent_at < now() - interval '10 days'
    ) AS ueberfaellig
  FROM public.trips t
  WHERE t.company_id = p_company_id
    AND t.kts_document_applies = true
    AND EXISTS (SELECT 1 FROM authorized);
$$;

COMMENT ON FUNCTION public.get_kts_queue_kpis(uuid) IS
  'KTS queue KPI counts for stat cards (PR3.2). '
  'SECURITY DEFINER — tenant isolation via p_company_id = current_user_company_id() '
  'and current_user_is_admin(). Overdue uses KTS_OVERDUE_DAYS = 10.';

GRANT EXECUTE ON FUNCTION public.get_kts_queue_kpis(uuid)
  TO authenticated;
