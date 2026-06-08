-- Phase A: three-source Schichtzettel list (trips + shifts + plan days).

-- WHY DROP instead of CREATE OR REPLACE: PostgreSQL requires DROP when
-- RETURNS TABLE columns change — CREATE OR REPLACE only works when the
-- return type is identical. DROP + CREATE in the same transaction is
-- atomic — no window where the function is missing.
DROP FUNCTION IF EXISTS public.get_shift_day_summaries(uuid, uuid);

CREATE FUNCTION public.get_shift_day_summaries(
  p_driver_id   uuid,
  p_company_id  uuid
)
RETURNS TABLE (
  date                    date,
  day_type                text,
  total_trips             bigint,
  selbstzahler_count      bigint,
  rechnung_count          bigint,
  total_revenue           numeric,
  shift_started_at        timestamptz,
  shift_ended_at          timestamptz,
  shift_break_minutes     integer,
  shift_entered_by        uuid,
  reconciliation_status   text,
  plan_status             text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH trip_days AS (
    SELECT
      (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date AS day_date,
      COUNT(*)::bigint AS total_trips,
      COUNT(*) FILTER (
        WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) = true
      )::bigint AS selbstzahler_count,
      COUNT(*) FILTER (
        WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) = false
      )::bigint AS rechnung_count,
      COALESCE(SUM(COALESCE(t.manual_gross_price, t.gross_price)), 0) AS total_revenue
    FROM public.trips t
    JOIN public.payers p ON p.id = t.payer_id
    LEFT JOIN public.billing_types bt ON bt.id = t.billing_type_id
    WHERE
      t.driver_id = p_driver_id
      AND t.company_id = p_company_id
      AND t.status = 'assigned'
    GROUP BY (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
  ),
  shift_break_totals AS (
    SELECT
      bs.shift_id,
      COALESCE(
        SUM(
          EXTRACT(EPOCH FROM (be.timestamp - bs.timestamp)) / 60.0
        ),
        0
      )::integer AS break_minutes
    FROM public.shift_events bs
    JOIN LATERAL (
      SELECT e.timestamp
      FROM public.shift_events e
      WHERE
        e.shift_id = bs.shift_id
        AND e.event_type = 'break_end'
        AND e.timestamp > bs.timestamp
      ORDER BY e.timestamp ASC
      LIMIT 1
    ) be ON true
    WHERE bs.event_type = 'break_start'
    GROUP BY bs.shift_id
  ),
  shift_days AS (
    SELECT
      (s.started_at AT TIME ZONE 'Europe/Berlin')::date AS day_date,
      s.started_at AS shift_started_at,
      s.ended_at AS shift_ended_at,
      COALESCE(sbt.break_minutes, 0) AS shift_break_minutes,
      s.entered_by AS shift_entered_by
    FROM public.shifts s
    LEFT JOIN shift_break_totals sbt ON sbt.shift_id = s.id
    WHERE
      s.driver_id = p_driver_id
      AND s.company_id = p_company_id
  ),
  plan_days AS (
    SELECT
      dp.plan_date AS day_date,
      dp.status AS plan_status
    FROM public.driver_day_plans dp
    WHERE
      dp.driver_id = p_driver_id
      AND dp.company_id = p_company_id
      AND dp.status IN ('vacation', 'sick')
  ),
  all_dates AS (
    SELECT day_date FROM trip_days
    UNION
    SELECT day_date FROM shift_days
    UNION
    SELECT day_date FROM plan_days
  )
  SELECT
    ad.day_date AS date,
    CASE
      WHEN pd.plan_status IN ('vacation', 'sick')
        AND COALESCE(td.total_trips, 0) = 0
      THEN 'plan_only'
      WHEN COALESCE(td.total_trips, 0) > 0
      THEN 'trips'
      WHEN sd.shift_started_at IS NOT NULL
      THEN 'shift_only'
      ELSE 'trips'
    END AS day_type,
    COALESCE(td.total_trips, 0)::bigint AS total_trips,
    COALESCE(td.selbstzahler_count, 0)::bigint AS selbstzahler_count,
    COALESCE(td.rechnung_count, 0)::bigint AS rechnung_count,
    COALESCE(td.total_revenue, 0) AS total_revenue,
    sd.shift_started_at,
    sd.shift_ended_at,
    CASE
      WHEN sd.shift_started_at IS NULL THEN NULL::integer
      ELSE sd.shift_break_minutes
    END AS shift_break_minutes,
    sd.shift_entered_by,
    sr.status AS reconciliation_status,
    pd.plan_status
  FROM all_dates ad
  LEFT JOIN trip_days td ON td.day_date = ad.day_date
  LEFT JOIN shift_days sd ON sd.day_date = ad.day_date
  LEFT JOIN plan_days pd ON pd.day_date = ad.day_date
  LEFT JOIN public.shift_reconciliations sr
    ON sr.driver_id = p_driver_id
    AND sr.company_id = p_company_id
    AND sr.date = ad.day_date
  ORDER BY ad.day_date DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_day_summaries(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_shift_day_summaries IS
  'Phase A Schichtzettel list: one row per calendar day (Europe/Berlin) from trips, shifts, and plan days.
   day_type: trips | shift_only | plan_only. Trip aggregates use assigned status only and
   COALESCE(billing_types.accepts_self_payment, payers.accepts_self_payment) for Selbstzahler/Rechnung split.
   shift_break_minutes sums paired break_start/break_end events per shift.
   SECURITY DEFINER; tenant scope via p_company_id and p_driver_id.';
