-- Named “Ansichten”: saved trips list URL filters + table column visibility, scoped by company.

CREATE TABLE IF NOT EXISTS public.trip_presets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  params        jsonb NOT NULL DEFAULT '{}',
  column_visibility jsonb NOT NULL DEFAULT '{}',
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_presets_company_id
  ON public.trip_presets (company_id, sort_order);

COMMENT ON TABLE public.trip_presets IS
  'Company-scoped saved views for the trips list (Filter-URL + Spaltensichtbarkeit). Shared by all admins of the company; not per-user.';

COMMENT ON COLUMN public.trip_presets.id IS
  'Primary key for the preset row.';

COMMENT ON COLUMN public.trip_presets.company_id IS
  'Tenant: must match RLS current_user_company_id() on write.';

COMMENT ON COLUMN public.trip_presets.name IS
  'User-visible label in the Ansichten dropdown (1–60 characters, enforced by CHECK).';

COMMENT ON COLUMN public.trip_presets.params IS
  'JSON object of whitelisted URL search params (filters, view, sort). Excludes page/perPage in the app contract; values are strings as in the query string.';

COMMENT ON COLUMN public.trip_presets.column_visibility IS
  'JSON object: TanStack Table VisibilityState (column id -> false to hide); missing keys mean visible by default.';

COMMENT ON COLUMN public.trip_presets.sort_order IS
  'Display order in UI (lower values first). Reordered via the management sheet.';

COMMENT ON COLUMN public.trip_presets.created_at IS
  'Row creation time (server default now()).';

COMMENT ON COLUMN public.trip_presets.updated_at IS
  'Last application update time; app sets on changes (no DB trigger).';

ALTER TABLE public.trip_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_presets_select ON public.trip_presets
  FOR SELECT TO authenticated
  USING (public.current_user_is_admin() AND company_id = public.current_user_company_id());

CREATE POLICY trip_presets_insert ON public.trip_presets
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_admin() AND company_id = public.current_user_company_id());

CREATE POLICY trip_presets_update ON public.trip_presets
  FOR UPDATE TO authenticated
  USING (public.current_user_is_admin() AND company_id = public.current_user_company_id());

CREATE POLICY trip_presets_delete ON public.trip_presets
  FOR DELETE TO authenticated
  USING (public.current_user_is_admin() AND company_id = public.current_user_company_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_presets TO authenticated, service_role;
