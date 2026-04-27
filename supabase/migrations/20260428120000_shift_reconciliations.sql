-- Schichtzettel reconciliation: payer self-pay flag + admin audit table.

-- 1. Add accepts_self_payment to payers
ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS accepts_self_payment boolean DEFAULT NULL;

COMMENT ON COLUMN public.payers.accepts_self_payment IS
  'NULL = not yet configured. TRUE = passenger pays driver directly (cash or card, Selbstzahler). FALSE = payer is invoiced.';

-- 2. Create shift_reconciliations table
CREATE TABLE public.shift_reconciliations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  date            date NOT NULL,
  confirmed_by    uuid NOT NULL REFERENCES public.accounts(id),
  confirmed_at    timestamptz NOT NULL DEFAULT now(),
  notes           text,
  shift_id        uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  UNIQUE (company_id, driver_id, date)
);

COMMENT ON TABLE public.shift_reconciliations IS
  'Admin audit trail for shift journal (Schichtzettel) reconciliation. One row per driver per calendar day, written when the admin confirms the paper journal matches the system trips. shift_id links to the driver shift record when one exists for that day — nullable because a shift row is not guaranteed.';

COMMENT ON COLUMN public.shift_reconciliations.id IS
  'Primary key for the reconciliation row.';
COMMENT ON COLUMN public.shift_reconciliations.company_id IS
  'Tenant; must match the current user company (enforced by RLS).';
COMMENT ON COLUMN public.shift_reconciliations.driver_id IS
  'Driver (account) whose Schichtzettel was checked for this business day.';
COMMENT ON COLUMN public.shift_reconciliations.date IS
  'Calendar date of the shift in the business sense (same YMD as URL filter; not a timestamptz).';
COMMENT ON COLUMN public.shift_reconciliations.confirmed_by IS
  'Admin account id who confirmed the journal check.';
COMMENT ON COLUMN public.shift_reconciliations.confirmed_at IS
  'When the confirmation was recorded (server time).';
COMMENT ON COLUMN public.shift_reconciliations.notes IS
  'Optional free text: discrepancies or comments from the dispatcher.';
COMMENT ON COLUMN public.shift_reconciliations.shift_id IS
  'Optional link to public.shifts when a driver shift row exists for this driver in the business-day window; NULL if none (driver did not clock in or row missing).';

CREATE INDEX shift_reconciliations_company_id_idx ON public.shift_reconciliations (company_id);
CREATE INDEX shift_reconciliations_driver_id_date_idx ON public.shift_reconciliations (driver_id, date);

ALTER TABLE public.shift_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY shift_reconciliations_company_admin
  ON public.shift_reconciliations
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
