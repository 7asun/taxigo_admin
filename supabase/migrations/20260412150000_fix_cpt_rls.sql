-- Allow admins full CRUD on client_price_tags; allow any authenticated user in the
-- company to SELECT (client detail panel, invoice builder, etc.).
DROP POLICY IF EXISTS client_price_tags_admin ON public.client_price_tags;

CREATE POLICY client_price_tags_admin ON public.client_price_tags
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY client_price_tags_read ON public.client_price_tags
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());
