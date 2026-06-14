-- KTS PR4.1.1: apply_kts_invoice_import v2 — optional patient_id writeback on commit.
-- Replaces 20260610172000 in place (CREATE OR REPLACE). See docs/kts-architecture.md §3.7.

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

  -- why: COALESCE(NULLIF(btrim(r.patient_id), ''), t.kts_patient_id) — never overwrite
  -- an existing Schein-ID with null when CSV row omits patient_id.
  UPDATE public.trips t
  SET
    kts_belegnummer         = r.belegnummer,
    kts_invoice_amount      = r.invoice_amount,
    kts_eigenanteil         = r.eigenanteil,
    kts_external_invoice_id = v_import_id,
    kts_status              = 'abgerechnet'::public.kts_status,
    kts_patient_id          = COALESCE(
                                NULLIF(btrim(r.patient_id::text), ''),
                                t.kts_patient_id
                              )
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

  RETURN v_import_id;
END;
$$;

COMMENT ON FUNCTION public.apply_kts_invoice_import(uuid, jsonb, uuid, text) IS
  'Atomic KTS accountant CSV import commit (PR4 / PR4.1.1). Expects pre-matched rows from PR4.1 '
  '(trip_id, belegnummer, invoice_amount, eigenanteil; optional patient_id). Inserts one '
  'kts_external_invoices batch and stamps eligible trips: invoice columns + kts_status = abgerechnet. '
  'Trips with kts_belegnummer already set are skipped (skip-not-fail) — entire import still succeeds; '
  'skipped trip ids are emitted via RAISE NOTICE. Does not require kts_status = uebergeben. '
  'Invoice amounts are INVOICED not PAID (Flow 3 deferred to PR4.2). '
  'patient_id per row is optional — when present and non-empty, kts_patient_id is written back to '
  'the trip (admin-confirmed Schein-ID from CSV). COALESCE ensures existing IDs are never overwritten '
  'with null. SECURITY DEFINER — tenant guard via current_user_is_admin() and '
  'p_company_id = current_user_company_id().';

REVOKE ALL ON FUNCTION public.apply_kts_invoice_import(uuid, jsonb, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_kts_invoice_import(uuid, jsonb, uuid, text)
  TO authenticated;
