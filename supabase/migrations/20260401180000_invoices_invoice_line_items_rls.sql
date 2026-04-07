-- RLS for invoices and invoice_line_items (company-scoped admin).
-- Fixes: "new row violates row-level security policy for table invoices" when
-- RLS is enabled without INSERT policies (e.g. after enabling RLS in Dashboard).
--
-- Uses existing helpers from 20260318130000_rename_users_to_accounts.sql:
--   public.current_user_company_id()
--   public.current_user_is_admin()

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

-- invoices ------------------------------------------------------------------
DROP POLICY IF EXISTS "invoices_select_company_admin" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert_company_admin" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update_company_admin" ON public.invoices;

CREATE POLICY "invoices_select_company_admin" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "invoices_insert_company_admin" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "invoices_update_company_admin" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

-- invoice_line_items (no company_id — scope via parent invoice) ------------
DROP POLICY IF EXISTS "invoice_line_items_select_company_admin" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_line_items_insert_company_admin" ON public.invoice_line_items;

CREATE POLICY "invoice_line_items_select_company_admin" ON public.invoice_line_items
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.company_id = public.current_user_company_id()
    )
  );

CREATE POLICY "invoice_line_items_insert_company_admin" ON public.invoice_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.company_id = public.current_user_company_id()
    )
  );

-- Global MAX lookup for invoice_number (bypasses RLS). Invoice numbers are unique
-- across all companies; per-company SELECT policies would otherwise return a wrong
-- MAX and cause UNIQUE violations. Only admins may execute.
CREATE OR REPLACE FUNCTION public.invoice_numbers_max_for_prefix(p_prefix text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT i.invoice_number
    FROM public.invoices i
    WHERE i.invoice_number LIKE p_prefix || '%'
    ORDER BY i.invoice_number DESC
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoice_numbers_max_for_prefix(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_numbers_max_for_prefix(text) TO authenticated;

COMMENT ON FUNCTION public.invoice_numbers_max_for_prefix(text) IS
$$Returns the lexicographically greatest invoice_number matching p_prefix||'%' (global, all tenants). Used by the app to allocate RE-YYYY-MM-NNNN. SECURITY DEFINER; restricted to current_user_is_admin().$$;
