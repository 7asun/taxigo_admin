-- Driver day planning (Phase 1): admin-only schedule entries per driver per calendar day.
-- WHY admin-only RLS: drivers must not read/write plans until a driver-facing phase exists.
-- WHY UNIQUE (company_id, driver_id, plan_date): one plan row per driver per business day.
-- WHY no driver policy yet: phase 1 is dispatcher planning only; see docs/driver-planning.md.
-- Policy uses only current_user_company_id() + current_user_is_admin() — no cross-table
-- subqueries (docs/access-control.md rule 3) to avoid RLS recursion (42P17).

CREATE TABLE public.driver_day_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_date       date NOT NULL,
  status          text NOT NULL,
  planned_start   time,
  planned_end     time,
  vehicle_id      uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  notes           text,
  created_by      uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_day_plans_company_driver_date_key
    UNIQUE (company_id, driver_id, plan_date),
  CONSTRAINT driver_day_plans_status_check
    CHECK (status IN (
      'working',
      'day_off',
      'vacation',
      'sick',
      'half_day_vacation',
      'overtime',
      'training',
      'special_leave'
    ))
);

COMMENT ON TABLE public.driver_day_plans IS
  'Admin-entered driver schedule plan for one calendar day (Europe/Berlin plan_date). Separate from shifts (actuals).';

COMMENT ON COLUMN public.driver_day_plans.plan_date IS
  'Business-calendar date (DATE, not timestamptz). One row per (company, driver, plan_date).';

COMMENT ON COLUMN public.driver_day_plans.updated_at IS
  'Maintained by the application on UPDATE (same pattern as pdf_vorlagen).';

CREATE INDEX driver_day_plans_company_driver_date_idx
  ON public.driver_day_plans (company_id, driver_id, plan_date);

ALTER TABLE public.driver_day_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_own_company"
  ON public.driver_day_plans
  FOR ALL
  TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_is_admin()
  )
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_is_admin()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_day_plans TO authenticated, service_role;
