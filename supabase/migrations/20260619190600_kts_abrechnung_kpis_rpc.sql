-- KTS PR4.2: Abrechnung tab KPI counts for stat cards.

CREATE OR REPLACE FUNCTION public.get_kts_abrechnung_kpis(
  p_company_id uuid
)
RETURNS TABLE (
  total_belege   bigint,
  total_invoiced numeric,
  total_bezahlt  numeric,
  total_offen    bigint
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
  ),
  base_trips AS (
    SELECT
      t.kts_belegnummer,
      t.kts_status,
      t.kts_invoice_amount
    FROM public.trips t
    WHERE EXISTS (SELECT 1 FROM authorized)
      AND t.company_id = p_company_id
      AND t.kts_document_applies = true
      AND t.kts_belegnummer IS NOT NULL
      AND t.kts_status IN ('abgerechnet', 'ruecklaufer', 'bezahlt')
  ),
  grouped AS (
    SELECT
      bt.kts_belegnummer,
      COALESCE(SUM(bt.kts_invoice_amount), 0) AS gesamtbetrag,
      CASE
        WHEN bool_or(bt.kts_status = 'ruecklaufer') THEN 'ruecklaufer'
        WHEN bool_and(bt.kts_status = 'bezahlt') THEN 'bezahlt'
        ELSE 'abgerechnet'
      END AS group_status
    FROM base_trips bt
    GROUP BY bt.kts_belegnummer
  )
  SELECT
    COUNT(*)::bigint AS total_belege,
    COALESCE(SUM(g.gesamtbetrag), 0) AS total_invoiced,
    COALESCE(SUM(
      CASE WHEN g.group_status = 'bezahlt' THEN g.gesamtbetrag ELSE 0 END
    ), 0) AS total_bezahlt,
    COUNT(*) FILTER (
      WHERE g.group_status IN ('abgerechnet', 'ruecklaufer')
    )::bigint AS total_offen
  FROM grouped g;
$$;

COMMENT ON FUNCTION public.get_kts_abrechnung_kpis(uuid) IS
  'KTS Abrechnung tab KPI counts (PR4.2). total_offen = actionable groups (abgerechnet or ruecklaufer). '
  'Amounts summed per Belegnummer group, not per trip row. '
  'SECURITY DEFINER — tenant guard via current_user_is_admin() and p_company_id = current_user_company_id().';

REVOKE ALL ON FUNCTION public.get_kts_abrechnung_kpis(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kts_abrechnung_kpis(uuid) TO authenticated;
