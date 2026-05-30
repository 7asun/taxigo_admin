-- =============================================================================
-- Controlling dashboard RPCs — server-side aggregations for /dashboard/controlling
-- =============================================================================
--
-- BERLIN TZ PATTERN (canonical — see docs/plans/timezone-bug-audit-v2.md Part 5 Q12):
--   All calendar-day bucketing uses:
--     (scheduled_at AT TIME ZONE 'Europe/Berlin')::date
--   Hour-of-day extraction uses:
--     EXTRACT(HOUR FROM scheduled_at AT TIME ZONE 'Europe/Berlin')
--   ISO weekday (0=Monday … 6=Sunday):
--     EXTRACT(ISODOW FROM scheduled_at AT TIME ZONE 'Europe/Berlin')::int - 1
--
-- Never use server-local CURRENT_DATE or client Date() for trip boundaries.
--
-- SECURITY DEFINER: runs as owner so aggregations can scan trips efficiently while
-- tenant scope is enforced via p_company_id + current_user_company_id() guard.
-- Admin-only: current_user_is_admin() must be true.
-- =============================================================================

-- ─── RPC 1: Daily operational KPIs ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_controlling_operational(
  p_company_id uuid,
  p_date_from  date,
  p_date_to    date
)
RETURNS TABLE (
  trip_date           date,
  total_trips         integer,
  completed_trips     integer,
  cancelled_trips     integer,
  revenue_net         numeric,
  revenue_gross       numeric,
  total_km            numeric,
  avg_price_per_trip  numeric,
  avg_km_per_trip     numeric,
  unpriced_trips      integer,
  unassigned_trips    integer,
  wheelchair_trips    integer,
  kts_trips           integer,
  fremdfirma_trips    integer,
  fremdfirma_cost     numeric
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
  date_series AS (
    SELECT gs::date AS trip_date
    FROM generate_series(p_date_from, p_date_to, '1 day'::interval) AS gs
    WHERE EXISTS (SELECT 1 FROM authorized)
  ),
  trip_agg AS (
    SELECT
      (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date AS trip_date,
      COUNT(*) FILTER (WHERE t.status <> 'cancelled')::integer AS total_trips,
      COUNT(*) FILTER (WHERE t.status = 'completed')::integer AS completed_trips,
      COUNT(*) FILTER (WHERE t.status = 'cancelled')::integer AS cancelled_trips,
      COALESCE(
        SUM(t.net_price) FILTER (WHERE t.status <> 'cancelled' AND t.net_price > 0),
        0
      ) AS revenue_net,
      COALESCE(
        SUM(t.gross_price) FILTER (WHERE t.status <> 'cancelled'),
        0
      ) AS revenue_gross,
      COALESCE(
        SUM(COALESCE(t.manual_distance_km, t.driving_distance_km))
          FILTER (WHERE t.status <> 'cancelled'),
        0
      ) AS total_km,
      AVG(t.net_price) FILTER (WHERE t.status <> 'cancelled' AND t.net_price > 0)
        AS avg_price_per_trip,
      AVG(COALESCE(t.manual_distance_km, t.driving_distance_km))
        FILTER (
          WHERE t.status <> 'cancelled'
            AND COALESCE(t.manual_distance_km, t.driving_distance_km) IS NOT NULL
        ) AS avg_km_per_trip,
      COUNT(*) FILTER (
        WHERE t.status <> 'cancelled'
          AND (t.net_price IS NULL OR t.net_price = 0)
      )::integer AS unpriced_trips,
      COUNT(*) FILTER (
        WHERE t.status <> 'cancelled' AND t.driver_id IS NULL
      )::integer AS unassigned_trips,
      COUNT(*) FILTER (
        WHERE t.status <> 'cancelled' AND t.is_wheelchair = true
      )::integer AS wheelchair_trips,
      COUNT(*) FILTER (
        WHERE t.status <> 'cancelled' AND t.kts_document_applies = true
      )::integer AS kts_trips,
      COUNT(*) FILTER (
        WHERE t.status <> 'cancelled' AND t.fremdfirma_id IS NOT NULL
      )::integer AS fremdfirma_trips,
      COALESCE(
        SUM(t.fremdfirma_cost) FILTER (WHERE t.status <> 'cancelled'),
        0
      ) AS fremdfirma_cost
    FROM public.trips t
    WHERE t.company_id = p_company_id
      AND t.scheduled_at IS NOT NULL
      AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
          BETWEEN p_date_from AND p_date_to
    GROUP BY (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
  )
  SELECT
    ds.trip_date,
    COALESCE(ta.total_trips, 0)::integer,
    COALESCE(ta.completed_trips, 0)::integer,
    COALESCE(ta.cancelled_trips, 0)::integer,
    COALESCE(ta.revenue_net, 0),
    COALESCE(ta.revenue_gross, 0),
    COALESCE(ta.total_km, 0),
    ta.avg_price_per_trip,
    ta.avg_km_per_trip,
    COALESCE(ta.unpriced_trips, 0)::integer,
    COALESCE(ta.unassigned_trips, 0)::integer,
    COALESCE(ta.wheelchair_trips, 0)::integer,
    COALESCE(ta.kts_trips, 0)::integer,
    COALESCE(ta.fremdfirma_trips, 0)::integer,
    COALESCE(ta.fremdfirma_cost, 0)
  FROM date_series ds
  LEFT JOIN trip_agg ta ON ta.trip_date = ds.trip_date
  ORDER BY ds.trip_date;
$$;

COMMENT ON FUNCTION public.get_controlling_operational IS
  'Daily operational KPI rows for the Controlling dashboard (Europe/Berlin calendar days).
   generate_series ensures zero-trip days appear for sparklines.
   SECURITY DEFINER + admin/company guard; tenant scope via p_company_id.';

GRANT EXECUTE ON FUNCTION public.get_controlling_operational(uuid, date, date)
  TO authenticated;

-- ─── RPC 2: Breakdown by payer / billing / driver ─────────────────────────────

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

COMMENT ON FUNCTION public.get_controlling_breakdown IS
  'Payer/billing/driver breakdown for Controlling tables. active_days comes from
   driver_active_days CTE (driver total working days, not per payer slice).
   SECURITY DEFINER + admin/company guard.';

GRANT EXECUTE ON FUNCTION public.get_controlling_breakdown(uuid, date, date)
  TO authenticated;

-- ─── RPC 3: Primetime heatmap (weekday × hour) ───────────────────────────────

CREATE OR REPLACE FUNCTION public.get_controlling_heatmap(
  p_company_id uuid,
  p_date_from  date,
  p_date_to    date
)
RETURNS TABLE (
  day_of_week  integer,
  hour_of_day  integer,
  trip_count   integer,
  revenue_net  numeric
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
    (EXTRACT(ISODOW FROM t.scheduled_at AT TIME ZONE 'Europe/Berlin')::int - 1)
      AS day_of_week,
    EXTRACT(HOUR FROM t.scheduled_at AT TIME ZONE 'Europe/Berlin')::integer
      AS hour_of_day,
    COUNT(*)::integer AS trip_count,
    COALESCE(SUM(t.net_price) FILTER (WHERE t.net_price > 0), 0) AS revenue_net
  FROM public.trips t
  WHERE t.company_id = p_company_id
    AND t.status <> 'cancelled'
    AND t.scheduled_at IS NOT NULL
    AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
        BETWEEN p_date_from AND p_date_to
    AND EXISTS (SELECT 1 FROM authorized)
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

COMMENT ON FUNCTION public.get_controlling_heatmap IS
'7×24 heatmap cells for Controlling. day_of_week: 0=Monday (ISODOW-1), not JS
getDay(). Only cells with ≥1 trip are returned — the frontend must initialise a
full 7×24 zero matrix and populate from RPC rows. SECURITY DEFINER + admin/company
guard.';

GRANT EXECUTE ON FUNCTION public.get_controlling_heatmap(uuid, date, date)
  TO authenticated;

-- ─── RPC 4: Invoice KPIs ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_controlling_invoice_kpis(
  p_company_id uuid,
  p_date_from  date,
  p_date_to    date
)
RETURNS TABLE (
  open_count           integer,
  open_amount          numeric,
  overdue_count        integer,
  overdue_amount       numeric,
  dso_days             numeric,
  invoicing_rate_pct   numeric,
  period_invoice_count integer
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
  -- open_invoices and overdue_invoices are intentionally NOT period-filtered.
  -- Offene Forderungen represents the current total outstanding AR balance — all
  -- invoices ever sent that remain unpaid. This is correct CFO behaviour: AR is a
  -- balance sheet position, not a period activity metric.
  -- Only fakturierungsgrad and period_invoice_count use p_date_from / p_date_to.
  open_invoices AS (
    SELECT i.id, i.total
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.status = 'sent'
      AND EXISTS (SELECT 1 FROM authorized)
  ),
  overdue_invoices AS (
    SELECT i.id, i.total
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.status = 'sent'
      AND (
        COALESCE(i.sent_at, i.created_at)
        + (COALESCE(i.payment_due_days, 0) || ' days')::interval
      ) < now()
      AND EXISTS (SELECT 1 FROM authorized)
  ),
  paid_dso AS (
    SELECT
      EXTRACT(EPOCH FROM (i.paid_at - i.sent_at)) / 86400.0 AS days_to_pay
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.status = 'paid'
      AND i.sent_at IS NOT NULL
      AND i.paid_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM authorized)
  ),
  period_trips AS (
    SELECT t.id
    FROM public.trips t
    WHERE t.company_id = p_company_id
      AND t.status <> 'cancelled'
      AND t.scheduled_at IS NOT NULL
      AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
          BETWEEN p_date_from AND p_date_to
      AND EXISTS (SELECT 1 FROM authorized)
  ),
  invoiced_trip_ids AS (
    SELECT DISTINCT ili.trip_id
    FROM public.invoice_line_items ili
    JOIN public.invoices i ON i.id = ili.invoice_id
    WHERE i.company_id = p_company_id
      AND ili.trip_id IS NOT NULL
      AND COALESCE(ili.billing_included, true) = true
      AND EXISTS (SELECT 1 FROM authorized)
  ),
  period_invoices AS (
    SELECT i.id
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.created_at IS NOT NULL
      AND (i.created_at AT TIME ZONE 'Europe/Berlin')::date
          BETWEEN p_date_from AND p_date_to
      AND EXISTS (SELECT 1 FROM authorized)
  )
  SELECT
    (SELECT COUNT(*)::integer FROM open_invoices),
    COALESCE((SELECT SUM(total) FROM open_invoices), 0),
    (SELECT COUNT(*)::integer FROM overdue_invoices),
    COALESCE((SELECT SUM(total) FROM overdue_invoices), 0),
    (SELECT ROUND(AVG(days_to_pay)) FROM paid_dso),
    CASE
      WHEN (SELECT COUNT(*) FROM period_trips) = 0 THEN 0
      ELSE ROUND(
        100.0 * (
          SELECT COUNT(*)
          FROM period_trips pt
          WHERE pt.id IN (SELECT trip_id FROM invoiced_trip_ids)
        ) / (SELECT COUNT(*) FROM period_trips)::numeric,
        1
      )
    END,
    (SELECT COUNT(*)::integer FROM period_invoices);
$$;

COMMENT ON FUNCTION public.get_controlling_invoice_kpis IS
  'Invoice receivables KPIs for Controlling. Fakturierungsgrad = period trips with
   invoice line items / total period trips (Berlin scheduled_at bounds).
   SECURITY DEFINER + admin/company guard.';

GRANT EXECUTE ON FUNCTION public.get_controlling_invoice_kpis(uuid, date, date)
  TO authenticated;

-- ─── RPC 5: Fixed 12-month revenue series ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_controlling_monthly_revenue(
  p_company_id uuid,
  p_months     integer DEFAULT 12
)
RETURNS TABLE (
  month_start  date,
  revenue_net  numeric,
  trip_count   integer
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
  month_bounds AS (
    SELECT
      (
        date_trunc(
          'month',
          (now() AT TIME ZONE 'Europe/Berlin')::timestamp
        )::date
        - ((GREATEST(p_months, 1) - 1) || ' months')::interval
      )::date AS range_start,
      date_trunc(
        'month',
        (now() AT TIME ZONE 'Europe/Berlin')::timestamp
      )::date AS range_end
  ),
  month_series AS (
    SELECT gs::date AS month_start
    FROM month_bounds mb,
      generate_series(
        mb.range_start,
        mb.range_end,
        '1 month'::interval
      ) AS gs
    WHERE EXISTS (SELECT 1 FROM authorized)
  ),
  trip_agg AS (
    SELECT
      date_trunc(
        'month',
        (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::timestamp
      )::date AS month_start,
      COALESCE(
        SUM(t.net_price) FILTER (WHERE t.net_price > 0),
        0
      ) AS revenue_net,
      COUNT(*)::integer AS trip_count
    FROM public.trips t, month_bounds mb
    WHERE t.company_id = p_company_id
      AND t.status <> 'cancelled'
      AND t.scheduled_at IS NOT NULL
      AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date >= mb.range_start
      AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date <
          (mb.range_end + interval '1 month')::date
      AND EXISTS (SELECT 1 FROM authorized)
    GROUP BY 1
  )
  SELECT
    ms.month_start,
    COALESCE(ta.revenue_net, 0),
    COALESCE(ta.trip_count, 0)::integer
  FROM month_series ms
  LEFT JOIN trip_agg ta ON ta.month_start = ms.month_start
  ORDER BY ms.month_start;
$$;

COMMENT ON FUNCTION public.get_controlling_monthly_revenue IS
  'Rolling monthly revenue for Controlling bar chart (independent of period picker).
   Months anchored to Europe/Berlin. SECURITY DEFINER + admin/company guard.';

GRANT EXECUTE ON FUNCTION public.get_controlling_monthly_revenue(uuid, integer)
  TO authenticated;
