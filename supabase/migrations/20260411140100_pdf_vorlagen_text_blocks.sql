-- Phase 10: add optional text-block FKs to pdf_vorlagen.
-- A single Vorlage now owns both the PDF column layout (existing) and
-- the intro/outro letter text (new). These FKs are nullable so all
-- existing Vorlagen continue to work unchanged — the payer-level
-- fallback chain still applies when these are null.
ALTER TABLE pdf_vorlagen
  ADD COLUMN intro_block_id uuid
    REFERENCES invoice_text_blocks(id) ON DELETE SET NULL,
  ADD COLUMN outro_block_id uuid
    REFERENCES invoice_text_blocks(id) ON DELETE SET NULL;

COMMENT ON COLUMN pdf_vorlagen.intro_block_id IS
  'Optional FK to invoice_text_blocks (type=intro). When set, used as the
   default intro text for invoices resolved to this Vorlage in the builder.
   Does NOT retroactively affect already-issued invoices (those freeze their
   own intro_block_id snapshot at creation time per §14 UStG).';
COMMENT ON COLUMN pdf_vorlagen.outro_block_id IS
  'Optional FK to invoice_text_blocks (type=outro). Same semantics as
   intro_block_id — builder default only, never retroactive.';
