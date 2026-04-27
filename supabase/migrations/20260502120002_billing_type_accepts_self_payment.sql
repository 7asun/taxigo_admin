-- billing_types.accepts_self_payment: family-level Selbstzahler override for Schichtzettel + RPC.
-- Effective self-pay per trip: COALESCE(bt.accepts_self_payment, p.accepts_self_payment).
-- unconfigured_count counts trips where that expression IS NULL (both levels unset).

ALTER TABLE public.billing_types
  ADD COLUMN IF NOT EXISTS accepts_self_payment boolean DEFAULT NULL;

COMMENT ON COLUMN public.billing_types.accepts_self_payment IS
  'NULL = inherit from parent payers.accepts_self_payment.
   TRUE = trips in this Abrechnungsfamilie are always Selbstzahler (passenger pays driver directly).
   FALSE = trips in this Abrechnungsfamilie are always invoiced.
   When set, this value wins over the payer-level setting.';

CREATE OR REPLACE FUNCTION public.get_shift_day_summaries(
  p_driver_id   uuid,
  p_company_id  uuid
)
RETURNS TABLE (
  shift_date          date,
  total_trips         bigint,
  self_pay_count      bigint,
  self_pay_total      numeric,
  invoice_count       bigint,
  unconfigured_count  bigint,
  is_reconciled       boolean,
  reconciled_by_name  text,
  reconciled_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date AS shift_date,
    COUNT(*)::bigint AS total_trips,
    COUNT(*) FILTER (
      WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) = true
    )::bigint AS self_pay_count,
    COALESCE(
      SUM(COALESCE(t.manual_gross_price, t.gross_price))
        FILTER (
          WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) = true
        ),
      0
    ) AS self_pay_total,
    COUNT(*) FILTER (
      WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) = false
    )::bigint AS invoice_count,
    COUNT(*) FILTER (
      WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) IS NULL
    )::bigint AS unconfigured_count,
    BOOL_OR(sr.id IS NOT NULL) AS is_reconciled,
    MAX(
      CASE
        WHEN a.id IS NULL THEN NULL::text
        WHEN NULLIF(btrim(a.name::text), '') IS NOT NULL THEN btrim(a.name::text)
        WHEN NULLIF(btrim(concat_ws(' ', a.first_name, a.last_name)), '') IS NOT NULL
          THEN btrim(concat_ws(' ', a.first_name, a.last_name))
        ELSE '—'
      END
    ) AS reconciled_by_name,
    MAX(sr.confirmed_at) AS reconciled_at
  FROM public.trips t
  JOIN public.payers p ON p.id = t.payer_id
  LEFT JOIN public.billing_types bt ON bt.id = t.billing_type_id
  LEFT JOIN public.shift_reconciliations sr
    ON sr.driver_id = t.driver_id
    AND sr.company_id = t.company_id
    AND sr.date = (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
  LEFT JOIN public.accounts a ON a.id = sr.confirmed_by
  WHERE
    t.driver_id = p_driver_id
    AND t.company_id = p_company_id
    AND t.status = 'assigned'
  GROUP BY (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
  ORDER BY shift_date DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_day_summaries(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_shift_day_summaries IS
  'Returns one aggregated row per calendar day (Europe/Berlin timezone) for a given driver.
   Used by the Schichtzettel list view to show shift summaries without loading full trip rows.
   Only trips with status = assigned are included (deferred: completed trips).
   self_pay_total uses manual_gross_price when set, falling back to gross_price.
   Per-trip self-pay class uses COALESCE(billing_types.accepts_self_payment, payers.accepts_self_payment);
   unconfigured is when that expression is NULL.
   SECURITY DEFINER runs as owner; tenant scope is enforced via p_company_id in the WHERE clause.';
