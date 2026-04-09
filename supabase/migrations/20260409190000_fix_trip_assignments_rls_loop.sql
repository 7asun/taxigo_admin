-- Fix PostgreSQL error 42P17 (infinite recursion) on public.trips — part 2.
--
-- Root cause: trips_select_own_driver queries trip_assignments to check driver
-- assignment. trip_assignments admin policies query back into trips to check
-- company_id. PostgreSQL re-enters trips RLS → bidirectional infinite loop.
--
-- This is distinct from the accounts → accounts loop fixed in 20260409180000.
--
-- Fix: new SECURITY DEFINER helper public.trip_company_id(uuid) reads
-- trips.company_id with row_security = off — same pattern as
-- current_user_is_admin() and current_user_company_id(). All trip_assignments
-- admin policies use this helper instead of a raw EXISTS (... FROM trips ...).
--
-- trips_select_own_driver and all other trips policies are unchanged.
-- The old manual dashboard policies on trip_assignments ("Allow tenants only",
-- "tenant select trip_assignments") were already removed in an earlier manual
-- SQL session before this migration was created.

CREATE OR REPLACE FUNCTION public.trip_company_id(p_trip_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT company_id FROM public.trips WHERE id = p_trip_id;
$$;

COMMENT ON FUNCTION public.trip_company_id(uuid) IS
  'Returns trips.company_id for RLS on trip_assignments without re-evaluating trips RLS.';

GRANT EXECUTE ON FUNCTION public.trip_company_id(uuid) TO authenticated;

DROP POLICY IF EXISTS trip_assignments_select_admin ON public.trip_assignments;
DROP POLICY IF EXISTS trip_assignments_insert_admin ON public.trip_assignments;
DROP POLICY IF EXISTS trip_assignments_update_admin ON public.trip_assignments;
DROP POLICY IF EXISTS trip_assignments_delete_admin ON public.trip_assignments;

CREATE POLICY trip_assignments_select_admin ON public.trip_assignments
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND public.trip_company_id(trip_id) = public.current_user_company_id()
  );

CREATE POLICY trip_assignments_insert_admin ON public.trip_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND public.trip_company_id(trip_id) = public.current_user_company_id()
  );

CREATE POLICY trip_assignments_update_admin ON public.trip_assignments
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND public.trip_company_id(trip_id) = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND public.trip_company_id(trip_id) = public.current_user_company_id()
  );

CREATE POLICY trip_assignments_delete_admin ON public.trip_assignments
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    AND public.trip_company_id(trip_id) = public.current_user_company_id()
  );
