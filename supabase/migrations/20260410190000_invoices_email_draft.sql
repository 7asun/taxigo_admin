-- Adds editable email draft fields to invoices.
-- Both are nullable: NULL means the draft has never been generated yet.
-- Once generated, the dispatcher can edit and save the text freely.
-- These fields are NOT immutable (unlike snapshots) — they follow the
-- same mutable pattern as `notes` and `payment_due_days`.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_body    TEXT;
