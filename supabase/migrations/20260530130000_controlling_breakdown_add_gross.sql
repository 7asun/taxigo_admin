-- Add revenue_gross to get_controlling_breakdown
-- Previously only revenue_net was returned. Gross is needed in PayerBreakdown
-- so the CFO can see both net and gross totals per payer without a separate query.
--
-- Must drop first because RETURNS TABLE signature changed (added revenue_gross).
-- Postgres does not allow CREATE OR REPLACE when the return type differs.
DROP FUNCTION IF EXISTS public.get_controlling_breakdown(uuid, date, date);

CREATE OR REPLACE FUNCTION public.get_controlling_breakdown(
  p_company_id uuid,
  p_date_from  date,
  p_date_to    date
)
RETURNS TABLE (
  payer_id              uuid,
  payer_name            text,
  billing_type_id       uuid,
  billing_type_name     text,
  billing_variant_id    uuid,
  billing_variant_name  text,
  driver_id             uuid,
  driver_name           text,
  trip_count            integer,
  revenue_net           numeric,
  revenue_gross         numeric,
  total_km              numeric,
  avg_price_per_trip    numeric,
  active_days           integer,
  wheelchair_trips      integer
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
  -- active_days is driver-level (all payers combined), not per breakdown slice.
  driver_active_days AS (
    SELECT
      t.driver_id,
      COUNT(DISTINCT (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date)::integer
        AS active_days
    FROM public.trips t
    WHERE t.company_id = p_company_id
      AND t.status <> 'cancelled'
      AND t.scheduled_at IS NOT NULL
      AND t.driver_id IS NOT NULL
      AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
          BETWEEN p_date_from AND p_date_to
      AND EXISTS (SELECT 1 FROM authorized)
    GROUP BY t.driver_id
  )
  SELECT
    t.payer_id,
    p.name AS payer_name,
    t.billing_type_id,
    bt.name AS billing_type_name,
    t.billing_variant_id,
    bv.name AS billing_variant_name,
    t.driver_id,
    CASE
      WHEN a.id IS NULL THEN NULL::text
      WHEN NULLIF(btrim(a.name::text), '') IS NOT NULL THEN btrim(a.name::text)
      WHEN NULLIF(btrim(concat_ws(' ', a.first_name, a.last_name)), '') IS NOT NULL
        THEN btrim(concat_ws(' ', a.first_name, a.last_name))
      ELSE '—'
    END AS driver_name,
    COUNT(*) FILTER (WHERE t.status <> 'cancelled')::integer AS trip_count,
    COALESCE(
      SUM(t.net_price) FILTER (WHERE t.status <> 'cancelled' AND t.net_price > 0),
      0
    ) AS revenue_net,
    COALESCE(SUM(t.gross_price) FILTER (WHERE t.status <> 'cancelled'), 0) AS revenue_gross,
    COALESCE(
      SUM(COALESCE(t.manual_distance_km, t.driving_distance_km))
        FILTER (WHERE t.status <> 'cancelled'),
      0
    ) AS total_km,
    AVG(t.net_price) FILTER (WHERE t.status <> 'cancelled' AND t.net_price > 0)
      AS avg_price_per_trip,
    dad.active_days,
    COUNT(*) FILTER (
      WHERE t.status <> 'cancelled' AND t.is_wheelchair = true
    )::integer AS wheelchair_trips
  FROM public.trips t
  LEFT JOIN public.payers p ON p.id = t.payer_id
  LEFT JOIN public.billing_types bt ON bt.id = t.billing_type_id
  LEFT JOIN public.billing_variants bv ON bv.id = t.billing_variant_id
  LEFT JOIN public.accounts a
    ON a.id = t.driver_id AND a.role = 'driver'
  LEFT JOIN driver_active_days dad ON dad.driver_id = t.driver_id
  WHERE t.company_id = p_company_id
    AND t.scheduled_at IS NOT NULL
    AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
        BETWEEN p_date_from AND p_date_to
    AND EXISTS (SELECT 1 FROM authorized)
  GROUP BY
    t.payer_id,
    p.name,
    t.billing_type_id,
    bt.name,
    t.billing_variant_id,
    bv.name,
    t.driver_id,
    a.id,
    a.name,
    a.first_name,
    a.last_name,
    dad.active_days
  HAVING COUNT(*) FILTER (WHERE t.status <> 'cancelled') > 0
  ORDER BY revenue_net DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_controlling_breakdown(uuid, date, date)
  TO authenticated;
