-- Driver-portal trip cancel: set status cancelled, clear driver_id, set notes.
-- Direct UPDATE would fail RLS: trips_update_own_driver has WITH CHECK (driver_id = auth.uid()),
-- so the post-update row with driver_id = NULL is rejected. This SECURITY DEFINER RPC
-- validates the caller was the assigned driver before updating.

CREATE OR REPLACE FUNCTION public.cancel_trip_as_driver(
  p_trip_id uuid,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_status text;
BEGIN
  SELECT t.driver_id, t.status
  INTO v_driver_id, v_status
  FROM public.trips t
  WHERE t.id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_driver_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'trip cannot be cancelled' USING ERRCODE = '23514';
  END IF;

  UPDATE public.trips
  SET
    status = 'cancelled',
    driver_id = NULL,
    notes = p_notes
  WHERE id = p_trip_id
    AND driver_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_trip_as_driver(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cancel_trip_as_driver(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_trip_as_driver(uuid, text) IS
$$Driver cancels own assigned trip: sets status cancelled, notes, clears driver_id.
SECURITY DEFINER bypasses RLS only after validating driver_id = auth.uid() and status not completed/cancelled.
Drivers lose SELECT on the row after driver_id is cleared (trips_select_own_driver).$$;
