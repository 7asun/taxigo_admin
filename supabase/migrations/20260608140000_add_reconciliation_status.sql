-- Phase A: reconciliation lifecycle status (open vs completed).

ALTER TABLE public.shift_reconciliations
  ADD COLUMN IF NOT EXISTS status text
    NOT NULL DEFAULT 'completed'
    CHECK (status IN ('open', 'completed'));

COMMENT ON COLUMN public.shift_reconciliations.status IS
  'open = review started, not finished. '
  'completed = payroll-ready. '
  'DEFAULT completed: all existing rows were written by confirmShift '
  'which implied completion — do not change default to open.';
