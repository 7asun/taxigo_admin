-- KTS PR4.2: Abrechnung tab — grouped listing by kts_belegnummer.
-- why: group_status is computed after GROUP BY; filtering it in WHERE would be invalid SQL.

CREATE OR REPLACE FUNCTION public.get_kts_abrechnung_groups(
  p_company_id       uuid,
  p_status_filter    text[]   DEFAULT NULL,
  p_search           text     DEFAULT NULL,
  p_imported_from    date     DEFAULT NULL,
  p_imported_to      date     DEFAULT NULL,
  p_limit            integer  DEFAULT 50,
  p_offset           integer  DEFAULT 0
)
RETURNS TABLE (
  kts_belegnummer      text,
  trip_count           bigint,
  gesamtbetrag         numeric,
  eigenanteil_gesamt   numeric,
  earliest_trip        date,
  latest_trip          date,
  import_id            uuid,
  source_filename      text,
  imported_at          timestamptz,
  import_count         bigint,
  has_multiple_imports boolean,
  group_status         text
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
      t.kts_invoice_amount,
      t.kts_eigenanteil,
      t.scheduled_at,
      t.kts_external_invoice_id,
      ei.created_at  AS import_created_at,
      ei.source_filename AS import_source_filename
    FROM public.trips t
    LEFT JOIN public.kts_external_invoices ei
      ON ei.id = t.kts_external_invoice_id
    WHERE EXISTS (SELECT 1 FROM authorized)
      AND t.company_id = p_company_id
      AND t.kts_document_applies = true
      AND t.kts_belegnummer IS NOT NULL
      AND t.kts_status IN ('abgerechnet', 'ruecklaufer', 'bezahlt')
      AND (
        p_search IS NULL
        OR NULLIF(btrim(p_search), '') IS NULL
        OR t.kts_belegnummer ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  grouped AS (
    SELECT
      bt.kts_belegnummer,
      COUNT(*)::bigint AS trip_count,
      COALESCE(SUM(bt.kts_invoice_amount), 0) AS gesamtbetrag,
      COALESCE(SUM(bt.kts_eigenanteil), 0) AS eigenanteil_gesamt,
      MIN(bt.scheduled_at::date) AS earliest_trip,
      MAX(bt.scheduled_at::date) AS latest_trip,
      (ARRAY_AGG(bt.kts_external_invoice_id ORDER BY bt.import_created_at DESC NULLS LAST))[1] AS import_id,
      (ARRAY_AGG(bt.import_source_filename ORDER BY bt.import_created_at DESC NULLS LAST))[1] AS source_filename,
      MAX(bt.import_created_at) AS imported_at,
      COUNT(DISTINCT bt.kts_external_invoice_id)::bigint AS import_count,
      COUNT(DISTINCT bt.kts_external_invoice_id) > 1 AS has_multiple_imports,
      CASE
        WHEN bool_or(bt.kts_status = 'ruecklaufer') THEN 'ruecklaufer'
        WHEN bool_and(bt.kts_status = 'bezahlt') THEN 'bezahlt'
        ELSE 'abgerechnet'
      END AS group_status
    FROM base_trips bt
    GROUP BY bt.kts_belegnummer
  )
  SELECT
    g.kts_belegnummer,
    g.trip_count,
    g.gesamtbetrag,
    g.eigenanteil_gesamt,
    g.earliest_trip,
    g.latest_trip,
    g.import_id,
    g.source_filename,
    g.imported_at,
    g.import_count,
    g.has_multiple_imports,
    g.group_status
  FROM grouped g
  WHERE (
    p_status_filter IS NULL
    OR cardinality(p_status_filter) = 0
    OR g.group_status = ANY(p_status_filter)
  )
  -- why: groups with no import batch (imported_at IS NULL) are excluded when a date filter
  -- is active — intentional; they have no import date to match against.
  AND (
    p_imported_from IS NULL
    OR g.imported_at IS NOT NULL AND g.imported_at::date >= p_imported_from
  )
  AND (
    p_imported_to IS NULL
    OR g.imported_at IS NOT NULL AND g.imported_at::date <= p_imported_to
  )
  ORDER BY g.imported_at DESC NULLS LAST, g.kts_belegnummer ASC
  LIMIT p_limit
  OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION public.get_kts_abrechnung_groups_count(
  p_company_id       uuid,
  p_status_filter    text[]  DEFAULT NULL,
  p_search           text    DEFAULT NULL,
  p_imported_from    date    DEFAULT NULL,
  p_imported_to      date    DEFAULT NULL
)
RETURNS bigint
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
      t.kts_external_invoice_id,
      ei.created_at AS import_created_at
    FROM public.trips t
    LEFT JOIN public.kts_external_invoices ei
      ON ei.id = t.kts_external_invoice_id
    WHERE EXISTS (SELECT 1 FROM authorized)
      AND t.company_id = p_company_id
      AND t.kts_document_applies = true
      AND t.kts_belegnummer IS NOT NULL
      AND t.kts_status IN ('abgerechnet', 'ruecklaufer', 'bezahlt')
      AND (
        p_search IS NULL
        OR NULLIF(btrim(p_search), '') IS NULL
        OR t.kts_belegnummer ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  grouped AS (
    SELECT
      bt.kts_belegnummer,
      MAX(bt.import_created_at) AS imported_at,
      CASE
        WHEN bool_or(bt.kts_status = 'ruecklaufer') THEN 'ruecklaufer'
        WHEN bool_and(bt.kts_status = 'bezahlt') THEN 'bezahlt'
        ELSE 'abgerechnet'
      END AS group_status
    FROM base_trips bt
    GROUP BY bt.kts_belegnummer
  )
  SELECT COUNT(*)::bigint
  FROM grouped g
  WHERE (
    p_status_filter IS NULL
    OR cardinality(p_status_filter) = 0
    OR g.group_status = ANY(p_status_filter)
  )
  -- why: same as list RPC — no-import groups excluded under active date filters (by design).
  AND (
    p_imported_from IS NULL
    OR g.imported_at IS NOT NULL AND g.imported_at::date >= p_imported_from
  )
  AND (
    p_imported_to IS NULL
    OR g.imported_at IS NOT NULL AND g.imported_at::date <= p_imported_to
  );
$$;

COMMENT ON FUNCTION public.get_kts_abrechnung_groups(uuid, text[], text, date, date, integer, integer) IS
  'KTS Abrechnung tab grouped rows by kts_belegnummer (PR4.2). '
  'group_status: ruecklaufer wins over abgerechnet; all bezahlt → bezahlt. '
  'import_count / has_multiple_imports surface cross-import ambiguity (no DB uniqueness on Belegnummer). '
  'SECURITY DEFINER — tenant guard via current_user_is_admin() and p_company_id = current_user_company_id().';

COMMENT ON FUNCTION public.get_kts_abrechnung_groups_count(uuid, text[], text, date, date) IS
  'Pagination count for get_kts_abrechnung_groups — mirrors the same filters on grouped rows. '
  'SECURITY DEFINER — tenant guard via current_user_is_admin() and p_company_id = current_user_company_id().';

REVOKE ALL ON FUNCTION public.get_kts_abrechnung_groups(uuid, text[], text, date, date, integer, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kts_abrechnung_groups(uuid, text[], text, date, date, integer, integer)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_kts_abrechnung_groups_count(uuid, text[], text, date, date)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kts_abrechnung_groups_count(uuid, text[], text, date, date)
  TO authenticated;
