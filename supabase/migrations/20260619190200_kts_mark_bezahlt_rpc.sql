-- KTS PR4.2: mark all abgerechnet trips under a Belegnummer as bezahlt.
-- why: atomic group transition — Phase 1 manual UI and future bank CSV bulk call.

CREATE OR REPLACE FUNCTION public.mark_belegnummer_bezahlt(
  p_company_id  uuid,
  p_belegnummer text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count integer;
  v_blocked_count integer;
BEGIN
  IF NOT public.current_user_is_admin()
     OR p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'mark_belegnummer_bezahlt: unauthorized';
  END IF;

  IF NULLIF(btrim(p_belegnummer), '') IS NULL THEN
    RAISE EXCEPTION 'mark_belegnummer_bezahlt: belegnummer must not be empty';
  END IF;

  -- why: any ruecklaufer in the group blocks payment until resolved (reimport or manual revert).
  SELECT COUNT(*)::int INTO v_blocked_count
  FROM public.trips
  WHERE company_id = p_company_id
    AND kts_belegnummer = btrim(p_belegnummer)
    AND kts_document_applies = true
    AND kts_status = 'ruecklaufer';

  IF v_blocked_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ruecklaufer_open',
      'blocked', v_blocked_count
    );
  END IF;

  UPDATE public.trips
  SET kts_status = 'bezahlt'::public.kts_status
  WHERE company_id = p_company_id
    AND kts_belegnummer = btrim(p_belegnummer)
    AND kts_document_applies = true
    AND kts_status = 'abgerechnet';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated_count
  );
END;
$$;

COMMENT ON FUNCTION public.mark_belegnummer_bezahlt(uuid, text) IS
  'Marks all abgerechnet trips for a Belegnummer as bezahlt (PR4.2 Flow 3 Phase 1). '
  'Fails with ruecklaufer_open when any trip in the group is ruecklaufer. '
  'Does not touch bezahlt or non-abgerechnet rows. '
  'SECURITY DEFINER — tenant guard via current_user_is_admin() and p_company_id = current_user_company_id().';

REVOKE ALL ON FUNCTION public.mark_belegnummer_bezahlt(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_belegnummer_bezahlt(uuid, text) TO authenticated;
