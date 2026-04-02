-- ============================================================
-- Migration: create_invoice_text_blocks
--
-- Creates the invoice_text_blocks table for the Baukasten system.
-- Stores reusable intro/outro text blocks for invoice PDFs.
--
-- Linked to:
--   company_profiles  → company_id  (multi-tenant isolation)
--   payers            → via default_intro_block_id / default_outro_block_id
--
-- Fallback chain for PDF generation:
--   1. Payer-specific block (if set on payers table)
--   2. Company default block (is_default = true)
--   3. Hardcoded fallback text in InvoicePdfCoverBody
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_text_blocks (
  -- ── Identity ──────────────────────────────────────────────
  -- Unique identifier for the text block.
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Multi-tenant Scope ────────────────────────────────────
  -- Every text block belongs to one Taxi company.
  -- Enables per-company template libraries.
  company_id            UUID          NOT NULL
                          REFERENCES public.company_profiles(company_id)
                          ON DELETE CASCADE,

  -- ── Block Metadata ─────────────────────────────────────────
  -- Human-readable name for the template (e.g., "Standard", "Förmlich-Behörde").
  -- Displayed in dropdowns and list views.
  name                  VARCHAR(100)  NOT NULL,

  -- Type of text block: 'intro' for Einleitung, 'outro' for Schlussformel.
  -- Enforced by CHECK constraint.
  type                  VARCHAR(10)   NOT NULL
                          CHECK (type IN ('intro', 'outro')),

  -- The actual text content. Rendered as-is in PDF (with salutation prefix).
  -- Max practical length enforced by UI (2000 chars), no DB limit for flexibility.
  content               TEXT          NOT NULL,

  -- ── Default Flag ───────────────────────────────────────────
  -- If true, this block is the company-wide default for its type.
  -- Used when a payer has no specific block assigned.
  -- Only one default per type per company (enforced by partial unique index).
  is_default            BOOLEAN       DEFAULT false,

  -- ── Timestamps ───────────────────────────────────────────
  created_at            TIMESTAMPTZ   DEFAULT NOW(),
  updated_at            TIMESTAMPTZ
);

-- ── Constraints & Indexes ──────────────────────────────────
-- Prevent duplicate names for same type within a company.
CREATE UNIQUE INDEX idx_invoice_text_blocks_name 
  ON public.invoice_text_blocks(company_id, type, name);

-- Enforce only one default per type per company (partial index).
CREATE UNIQUE INDEX idx_invoice_text_blocks_default 
  ON public.invoice_text_blocks(company_id, type) 
  WHERE is_default = true;

-- Fast lookup of all blocks for a company.
CREATE INDEX idx_invoice_text_blocks_company 
  ON public.invoice_text_blocks(company_id);

-- ── Column Comments ───────────────────────────────────────────
-- Document all columns for clarity in Supabase UI and introspection.

COMMENT ON COLUMN public.invoice_text_blocks.id IS 
  'Primary key. Unique identifier for the text block.';

COMMENT ON COLUMN public.invoice_text_blocks.company_id IS 
  'FK to company_profiles. Multi-tenant scope: each block belongs to one company.';

COMMENT ON COLUMN public.invoice_text_blocks.name IS 
  'Human-readable template name (e.g., "Standard", "Förmlich-Behörde"). Shown in dropdowns.';

COMMENT ON COLUMN public.invoice_text_blocks.type IS 
  'Block type: intro (Einleitung) or outro (Schlussformel). CHECK constraint enforced.';

COMMENT ON COLUMN public.invoice_text_blocks.content IS 
  'The actual text content rendered in PDF. UI-enforced max 2000 chars.';

COMMENT ON COLUMN public.invoice_text_blocks.is_default IS 
  'If true, this is the company-wide default for its type. Used as fallback when payer has no specific block.';

COMMENT ON COLUMN public.invoice_text_blocks.created_at IS 
  'Timestamp when the block was created.';

COMMENT ON COLUMN public.invoice_text_blocks.updated_at IS 
  'Timestamp when the block was last modified. NULL if never updated.';

-- ── Modify Payers Table ────────────────────────────────────
-- Link payers to their preferred intro/outro text blocks.
-- NULL = use company default (is_default = true in invoice_text_blocks).
-- ON DELETE SET NULL: if block deleted, payer falls back to default.

ALTER TABLE public.payers
  ADD COLUMN default_intro_block_id UUID 
    REFERENCES public.invoice_text_blocks(id) 
    ON DELETE SET NULL,
  ADD COLUMN default_outro_block_id UUID 
    REFERENCES public.invoice_text_blocks(id) 
    ON DELETE SET NULL;

COMMENT ON COLUMN public.payers.default_intro_block_id IS 
  'FK to invoice_text_blocks. Preferred intro text for invoices to this payer. NULL = use company default.';

COMMENT ON COLUMN public.payers.default_outro_block_id IS 
  'FK to invoice_text_blocks. Preferred outro text for invoices to this payer. NULL = use company default.';

-- ── Enable RLS ────────────────────────────────────────────
ALTER TABLE public.invoice_text_blocks ENABLE ROW LEVEL SECURITY;

-- Companies can only see their own text blocks
CREATE POLICY "invoice_text_blocks_select_own" ON public.invoice_text_blocks
  FOR SELECT USING (company_id = (SELECT company_id FROM public.accounts WHERE id = auth.uid()));

CREATE POLICY "invoice_text_blocks_insert_own" ON public.invoice_text_blocks
  FOR INSERT WITH CHECK (company_id = (SELECT company_id FROM public.accounts WHERE id = auth.uid()));

CREATE POLICY "invoice_text_blocks_update_own" ON public.invoice_text_blocks
  FOR UPDATE USING (company_id = (SELECT company_id FROM public.accounts WHERE id = auth.uid()));

CREATE POLICY "invoice_text_blocks_delete_own" ON public.invoice_text_blocks
  FOR DELETE USING (company_id = (SELECT company_id FROM public.accounts WHERE id = auth.uid()));
