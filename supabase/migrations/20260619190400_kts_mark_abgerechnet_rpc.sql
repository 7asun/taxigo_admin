-- KTS PR4.2: manual escape hatch — ruecklaufer → abgerechnet without CSV reimport.
-- why: admin may confirm correction out-of-band; must NOT mark trips bezahlt.

CREATE OR REPLACE FUNCTION public.mark_belegnummer_abgerechnet(
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
BEGIN
  IF NOT public.current_user_is_admin()
     OR p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'mark_belegnummer_abgerechnet: unauthorized';
  END IF;

  IF NULLIF(btrim(p_belegnummer), '') IS NULL THEN
    RAISE EXCEPTION 'mark_belegnummer_abgerechnet: belegnummer must not be empty';
  END IF;

  UPDATE public.trips
  SET
    kts_status             = 'abgerechnet'::public.kts_status,
    kts_ruecklaufer_reason = NULL
  WHERE company_id = p_company_id
    AND kts_belegnummer = btrim(p_belegnummer)
    AND kts_document_applies = true
    AND kts_status = 'ruecklaufer';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated_count
  );
END;
$$;

COMMENT ON FUNCTION public.mark_belegnummer_abgerechnet(uuid, text) IS
  'Manual escape hatch: ruecklaufer → abgerechnet for all trips under a Belegnummer (PR4.2). '
  'Only touches ruecklaufer rows — never bezahlt or abgerechnet. Clears kts_ruecklaufer_reason. '
  'SECURITY DEFINER — tenant guard via current_user_is_admin() and p_company_id = current_user_company_id().';

REVOKE ALL ON FUNCTION public.mark_belegnummer_abgerechnet(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_belegnummer_abgerechnet(uuid, text) TO authenticated;
