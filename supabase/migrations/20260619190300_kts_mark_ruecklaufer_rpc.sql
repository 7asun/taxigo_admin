-- KTS PR4.2: mark abgerechnet trips under a Belegnummer as ruecklaufer.
-- Resolution: accountant reimports via apply_kts_invoice_import v4 (accepts ruecklaufer rows).

CREATE OR REPLACE FUNCTION public.mark_belegnummer_ruecklaufer(
  p_company_id  uuid,
  p_belegnummer text,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count integer;
BEGIN
  IF NOT public.current_user_is_admin()
     OR p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'mark_belegnummer_ruecklaufer: unauthorized';
  END IF;

  IF NULLIF(btrim(p_belegnummer), '') IS NULL THEN
    RAISE EXCEPTION 'mark_belegnummer_ruecklaufer: belegnummer must not be empty';
  END IF;

  UPDATE public.trips
  SET
    kts_status             = 'ruecklaufer'::public.kts_status,
    kts_ruecklaufer_reason = NULLIF(btrim(p_reason), '')
  WHERE company_id = p_company_id
    AND kts_belegnummer = btrim(p_belegnummer)
    AND kts_document_applies = true
    AND kts_status = 'abgerechnet';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated_count,
    'reason', NULLIF(btrim(p_reason), '')
  );
END;
$$;

COMMENT ON FUNCTION public.mark_belegnummer_ruecklaufer(uuid, text, text) IS
  'Marks all abgerechnet trips for a Belegnummer as ruecklaufer (PR4.2). '
  'Optional p_reason is persisted on trips.kts_ruecklaufer_reason for all stamped rows in the group. '
  'Resolution path: apply_kts_invoice_import v4 re-stamps ruecklaufer rows to abgerechnet. '
  'SECURITY DEFINER — tenant guard via current_user_is_admin() and p_company_id = current_user_company_id().';

REVOKE ALL ON FUNCTION public.mark_belegnummer_ruecklaufer(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_belegnummer_ruecklaufer(uuid, text, text) TO authenticated;
