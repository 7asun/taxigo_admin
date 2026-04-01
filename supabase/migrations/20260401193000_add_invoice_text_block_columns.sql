-- ============================================================
-- Migration: add_invoice_text_block_columns_to_invoices
--
-- Adds intro_block_id and outro_block_id columns to the invoices table
-- to store selected Rechnungsvorlagen for each invoice.
--
-- Linked to:
--   invoice_text_blocks → intro_block_id / outro_block_id
--
-- ============================================================

-- ── Add columns to invoices table ─────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS intro_block_id UUID 
    REFERENCES public.invoice_text_blocks(id) 
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outro_block_id UUID 
    REFERENCES public.invoice_text_blocks(id) 
    ON DELETE SET NULL;

-- ── Column Comments ─────────────────────────────────────────────────────────

COMMENT ON COLUMN public.invoices.intro_block_id IS 
  'FK to invoice_text_blocks. Selected intro text block for this invoice. NULL = use fallback chain.';

COMMENT ON COLUMN public.invoices.outro_block_id IS 
  'FK to invoice_text_blocks. Selected outro text block for this invoice. NULL = use fallback chain.';

-- ── Indexes for faster lookups ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_intro_block_id 
  ON public.invoices(intro_block_id) 
  WHERE intro_block_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_outro_block_id 
  ON public.invoices(outro_block_id) 
  WHERE outro_block_id IS NOT NULL;
