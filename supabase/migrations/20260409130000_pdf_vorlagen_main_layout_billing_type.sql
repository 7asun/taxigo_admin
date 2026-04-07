-- Phase 9: extend main_layout CHECK to allow grouped_by_billing_type.
-- This layout groups invoice cover rows by billing variant label + tax rate.
-- One row per (Abrechnungsart, MwSt.-Satz) combination — no mixed-rate rows possible.

ALTER TABLE public.pdf_vorlagen
  DROP CONSTRAINT IF EXISTS pdf_vorlagen_main_layout_check;

ALTER TABLE public.pdf_vorlagen
  ADD CONSTRAINT pdf_vorlagen_main_layout_check
  CHECK (main_layout IN ('grouped', 'flat', 'single_row', 'grouped_by_billing_type'));
