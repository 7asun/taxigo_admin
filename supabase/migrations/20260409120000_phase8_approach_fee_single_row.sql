-- Phase 8: Anfahrtspreis (approach fee) on line items + single_row PDF main_layout.

-- ── invoice_line_items.approach_fee_net ─────────────────────────────────────
ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS approach_fee_net numeric(10, 2) DEFAULT NULL;

COMMENT ON COLUMN public.invoice_line_items.approach_fee_net IS
  'Optional flat Anfahrtspreis (net) added on top of the base transport price. '
  'Null on rows created before this migration — treat as 0. '
  'Grossed with tax_rate when computing total_price.';

-- ── pdf_vorlagen.main_layout: allow single_row ───────────────────────────────
ALTER TABLE public.pdf_vorlagen
  DROP CONSTRAINT IF EXISTS pdf_vorlagen_main_layout_check;

ALTER TABLE public.pdf_vorlagen
  ADD CONSTRAINT pdf_vorlagen_main_layout_check
  CHECK (main_layout IN ('grouped', 'flat', 'single_row'));
