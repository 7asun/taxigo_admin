-- Fix PostgreSQL error 42P17 (infinite recursion) on public.trips and related RLS.
--
-- Root cause: public.accounts policies for admins call current_user_is_admin() /
-- current_user_company_id(), which SELECT from public.accounts. RLS still applies
-- to that inner SELECT as the session role, so evaluating the accounts policy
-- re-enters the same policy → recursion.
--
-- Fix: SECURITY DEFINER helpers read only the caller's row (WHERE id = auth.uid())
-- and run that read with row_security disabled so accounts RLS is not re-evaluated.
-- SET search_path = public avoids search_path hijacking.
--
-- NOTE: This migration fixes the accounts → accounts helper loop only.
-- The trips ↔ trip_assignments bidirectional loop is a separate issue,
-- fixed in 20260409190000_fix_trip_assignments_rls_loop.sql.

CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT company_id FROM public.accounts WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT role = 'admin' FROM public.accounts WHERE id = auth.uid();
$$;

-- Idempotent: align driver trip policies with auth.uid() only (no helper calls).
DROP POLICY IF EXISTS trips_select_own_driver ON public.trips;
DROP POLICY IF EXISTS trips_update_own_driver ON public.trips;

CREATE POLICY trips_select_own_driver ON public.trips
  FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.trip_assignments ta
      WHERE ta.trip_id = trips.id AND ta.driver_id = auth.uid()
    )
  );

CREATE POLICY trips_update_own_driver ON public.trips
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());
