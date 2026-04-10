-- SECURITY: Layer 4 — database RLS policies.
-- This is the last line of defense. Even if layers 1-3 fail,
-- these policies ensure data never leaks to the wrong role.
-- See docs/access-control.md for the full access control architecture.
--
-- ⚠️  IMPORTANT: This migration does NOT drop old manually-created dashboard
-- policies ("Allow tenants only", "tenant select trips", etc.) that existed
-- in production before this migration set. Those were cleaned up in
-- 20260409190000_fix_trip_assignments_rls_loop.sql.
-- If you are applying this to a fresh database, the DROP POLICY IF EXISTS
-- lines are safe (they are no-ops if the policies don't exist).
-- -----------------------------------------------------------------------------
-- trips: admin full CRUD (company); driver SELECT + UPDATE own assigned rows
-- -----------------------------------------------------------------------------
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY trips_select_company_admin ON public.trips
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
CREATE POLICY trips_insert_company_admin ON public.trips
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
CREATE POLICY trips_update_company_admin ON public.trips
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
CREATE POLICY trips_delete_company_admin ON public.trips
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
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
-- -----------------------------------------------------------------------------
-- clients: admin only
-- -----------------------------------------------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_company_admin ON public.clients
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
-- -----------------------------------------------------------------------------
-- payers: admin only
-- -----------------------------------------------------------------------------
ALTER TABLE public.payers ENABLE ROW LEVEL SECURITY;
CREATE POLICY payers_company_admin ON public.payers
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
-- -----------------------------------------------------------------------------
-- company_profiles: admin only
-- -----------------------------------------------------------------------------
ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_profiles_company_admin ON public.company_profiles
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
-- -----------------------------------------------------------------------------
-- vehicles: admin only
-- -----------------------------------------------------------------------------
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_company_admin ON public.vehicles
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
-- -----------------------------------------------------------------------------
-- companies: admin only (uses id, not company_id)
-- -----------------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_company_admin ON public.companies
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND id = public.current_user_company_id()
  );
-- -----------------------------------------------------------------------------
-- Tighten catalog tables: replace company-member policies with admin-only
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS invoice_text_blocks_select_own ON public.invoice_text_blocks;
DROP POLICY IF EXISTS invoice_text_blocks_insert_own ON public.invoice_text_blocks;
DROP POLICY IF EXISTS invoice_text_blocks_update_own ON public.invoice_text_blocks;
DROP POLICY IF EXISTS invoice_text_blocks_delete_own ON public.invoice_text_blocks;
CREATE POLICY invoice_text_blocks_admin ON public.invoice_text_blocks
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
DROP POLICY IF EXISTS billing_pricing_rules_select_own ON public.billing_pricing_rules;
DROP POLICY IF EXISTS billing_pricing_rules_insert_own ON public.billing_pricing_rules;
DROP POLICY IF EXISTS billing_pricing_rules_update_own ON public.billing_pricing_rules;
DROP POLICY IF EXISTS billing_pricing_rules_delete_own ON public.billing_pricing_rules;
CREATE POLICY billing_pricing_rules_admin ON public.billing_pricing_rules
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
DROP POLICY IF EXISTS rechnungsempfaenger_select_own ON public.rechnungsempfaenger;
DROP POLICY IF EXISTS rechnungsempfaenger_insert_own ON public.rechnungsempfaenger;
DROP POLICY IF EXISTS rechnungsempfaenger_update_own ON public.rechnungsempfaenger;
DROP POLICY IF EXISTS rechnungsempfaenger_delete_own ON public.rechnungsempfaenger;
CREATE POLICY rechnungsempfaenger_admin ON public.rechnungsempfaenger
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
DROP POLICY IF EXISTS fremdfirmen_select_own ON public.fremdfirmen;
DROP POLICY IF EXISTS fremdfirmen_insert_own ON public.fremdfirmen;
DROP POLICY IF EXISTS fremdfirmen_update_own ON public.fremdfirmen;
DROP POLICY IF EXISTS fremdfirmen_delete_own ON public.fremdfirmen;
CREATE POLICY fremdfirmen_admin ON public.fremdfirmen
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
DROP POLICY IF EXISTS "pdf_vorlagen: select own company" ON public.pdf_vorlagen;
DROP POLICY IF EXISTS "pdf_vorlagen: insert own company" ON public.pdf_vorlagen;
DROP POLICY IF EXISTS "pdf_vorlagen: update own company" ON public.pdf_vorlagen;
DROP POLICY IF EXISTS "pdf_vorlagen: delete own company" ON public.pdf_vorlagen;
CREATE POLICY pdf_vorlagen_admin ON public.pdf_vorlagen
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
-- -----------------------------------------------------------------------------
-- RPC hardening: revoke update_driver from anon (API layer uses requireAdmin)
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.update_driver(
  uuid, text, text, text, text, text, text,
  uuid, text, text, text, text, double precision, double precision
) FROM anon;
