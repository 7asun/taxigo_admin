-- KTS PR4.1.1 v3: apply_kts_invoice_import — null-only / no-clobber patient-id backfill.
-- Replaces 20260610173000 in place (CREATE OR REPLACE). See docs/kts-architecture.md §3.7.
--
-- Changes vs v2 (body only — signature, return type, security mode, grants unchanged):
--   1. trips.kts_patient_id: COALESCE replaced with a two-branch CASE — writes only when
--      the trip field is currently empty AND the CSV provides a non-empty value. Any other
--      situation (empty CSV, already-populated trip) keeps the existing trip value.
--      btrim normalization means whitespace-only stored values are treated as empty, not
--      as a conflicting ID. v2 COALESCE could silently overwrite a non-null trip ID.
--   2. clients.kts_patient_id: new UPDATE in the same transaction — backfills the client
--      master when the trip is linked to a client and the master field is currently empty.
--      No-clobber is enforced by the WHERE clause (only empty client rows are targeted).
--      Uses explicit JOIN syntax so the join path is easy to audit.
--
-- Non-body properties preserved from v2 (verified):
--   signature, return type (uuid), LANGUAGE plpgsql, SECURITY DEFINER, SET search_path,
--   REVOKE ALL / GRANT EXECUTE TO authenticated, validation loop, INSERT, trip UPDATE WHERE.

CREATE OR REPLACE FUNCTION public.apply_kts_invoice_import(
  p_company_id      uuid,
  p_rows            jsonb,
  p_handover_id     uuid DEFAULT NULL,
  p_source_filename text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_import_id       uuid;
  v_row             record;
  v_stamped_count   int := 0;
  v_skipped_ids     uuid[] := '{}';
  v_trip            record;
BEGIN
  IF NOT public.current_user_is_admin()
     OR p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'apply_kts_invoice_import: unauthorized';
  END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'apply_kts_invoice_import: row list must not be empty';
  END IF;

  IF p_handover_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.kts_handovers h
      WHERE h.id = p_handover_id
        AND h.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION
        'apply_kts_invoice_import: handover not found or wrong company';
    END IF;
  END IF;

  -- why: validate every payload row before writing — skip already-imported, fail on bad data.
  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(p_rows) AS r(
      trip_id         uuid,
      belegnummer     text,
      invoice_amount  numeric,
      eigenanteil     numeric,
      patient_id      text
    )
  LOOP
    SELECT
      t.id,
      t.company_id,
      t.kts_document_applies,
      t.kts_belegnummer
    INTO v_trip
    FROM public.trips t
    WHERE t.id = v_row.trip_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'apply_kts_invoice_import: trip % not found', v_row.trip_id;
    END IF;

    IF v_trip.company_id IS DISTINCT FROM p_company_id THEN
      RAISE EXCEPTION
        'apply_kts_invoice_import: trip % wrong company', v_row.trip_id;
    END IF;

    IF NOT v_trip.kts_document_applies THEN
      RAISE EXCEPTION
        'apply_kts_invoice_import: trip % is not a KTS case', v_row.trip_id;
    END IF;

    IF v_trip.kts_belegnummer IS NOT NULL THEN
      v_skipped_ids := array_append(v_skipped_ids, v_row.trip_id);
    ELSE
      v_stamped_count := v_stamped_count + 1;
    END IF;
  END LOOP;

  IF cardinality(v_skipped_ids) > 0 THEN
    RAISE NOTICE
      'apply_kts_invoice_import: skipped % already-imported trip(s): %',
      cardinality(v_skipped_ids),
      v_skipped_ids;
  END IF;

  INSERT INTO public.kts_external_invoices (
    company_id,
    created_by,
    kts_handover_id,
    row_count,
    source_filename
  )
  VALUES (
    p_company_id,
    auth.uid(),
    p_handover_id,
    v_stamped_count,
    NULLIF(btrim(p_source_filename), '')
  )
  RETURNING id INTO v_import_id;

  -- why: null-only / no-clobber backfill for trips.kts_patient_id.
  -- Write only when the trip field is currently empty AND the CSV provides a non-empty value.
  -- Existing non-empty trip IDs are always kept, regardless of what the CSV sends.
  -- btrim on both sides so a whitespace-only stored value is treated as empty, not a conflict.
  UPDATE public.trips t
  SET
    kts_belegnummer         = r.belegnummer,
    kts_invoice_amount      = r.invoice_amount,
    kts_eigenanteil         = r.eigenanteil,
    kts_external_invoice_id = v_import_id,
    kts_status              = 'abgerechnet'::public.kts_status,
    kts_patient_id          = CASE
                                WHEN NULLIF(btrim(t.kts_patient_id::text), '') IS NULL
                                 AND NULLIF(btrim(r.patient_id::text), '') IS NOT NULL
                                  THEN NULLIF(btrim(r.patient_id::text), '')
                                ELSE t.kts_patient_id
                              END
  FROM jsonb_to_recordset(p_rows) AS r(
    trip_id        uuid,
    belegnummer    text,
    invoice_amount numeric,
    eigenanteil    numeric,
    patient_id     text
  )
  WHERE t.id = r.trip_id
    AND t.company_id = p_company_id
    AND t.kts_document_applies = true
    AND t.kts_belegnummer IS NULL;

  -- why: null-only backfill for clients.kts_patient_id, in the same transaction as the trip stamp.
  -- Keeps the client master consistent with the trip snapshot when a Schein-ID is confirmed for
  -- the first time via CSV import. No-clobber is enforced by the WHERE clause: this statement
  -- only targets client rows where kts_patient_id is currently empty, so the SET is always a
  -- first-time write. Explicit JOIN makes the trip → payload → client path easy to audit.
  UPDATE public.clients c
  SET kts_patient_id = NULLIF(btrim(r.patient_id::text), '')
  FROM public.trips t
  JOIN jsonb_to_recordset(p_rows) AS r(
    trip_id        uuid,
    belegnummer    text,
    invoice_amount numeric,
    eigenanteil    numeric,
    patient_id     text
  ) ON r.trip_id = t.id
  WHERE c.id = t.client_id
    AND t.company_id = p_company_id
    AND t.kts_document_applies = true
    AND t.kts_belegnummer IS NULL
    AND NULLIF(btrim(c.kts_patient_id::text), '') IS NULL
    AND NULLIF(btrim(r.patient_id::text), '') IS NOT NULL;

  RETURN v_import_id;
END;
$$;

COMMENT ON FUNCTION public.apply_kts_invoice_import(uuid, jsonb, uuid, text) IS
  'Atomic KTS accountant CSV import commit (PR4 / PR4.1.1 / v3). Expects pre-matched rows from PR4.1 '
  '(trip_id, belegnummer, invoice_amount, eigenanteil; optional patient_id). Inserts one '
  'kts_external_invoices batch and stamps eligible trips: invoice columns + kts_status = abgerechnet. '
  'Trips with kts_belegnummer already set are skipped (skip-not-fail) — entire import still succeeds; '
  'skipped trip ids are emitted via RAISE NOTICE. Does not require kts_status = uebergeben. '
  'Invoice amounts are INVOICED not PAID (Flow 3 deferred to PR4.2). '
  'patient_id per row is optional. When present and non-empty, kts_patient_id is backfilled on the '
  'trip (null-only: only when trips.kts_patient_id is currently empty) and, when trips.client_id is '
  'set and clients.kts_patient_id is empty, also on the client master — both in the same transaction. '
  'No-clobber: existing IDs are never overwritten. btrim normalization prevents whitespace-only '
  'stored values from being treated as a conflicting ID. '
  'SECURITY DEFINER — tenant guard via current_user_is_admin() and '
  'p_company_id = current_user_company_id().';

REVOKE ALL ON FUNCTION public.apply_kts_invoice_import(uuid, jsonb, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_kts_invoice_import(uuid, jsonb, uuid, text)
  TO authenticated;
