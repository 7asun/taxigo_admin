-- =============================================================================
-- Spec C: invoice-level recipient override + frozen snapshot (§14 UStG immutability).
-- =============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS rechnungsempfaenger_id uuid
    REFERENCES public.rechnungsempfaenger (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rechnungsempfaenger_snapshot jsonb;

COMMENT ON COLUMN public.invoices.rechnungsempfaenger_id IS
  'Optional invoice-only recipient selection; if null, resolved recipient comes from catalog cascade at build time.';

COMMENT ON COLUMN public.invoices.rechnungsempfaenger_snapshot IS
  'Frozen recipient payload at invoice creation time (§14 UStG). Do not update after issue; use for PDF and audit.';

CREATE INDEX IF NOT EXISTS idx_invoices_rechnungsempfaenger_id ON public.invoices (rechnungsempfaenger_id)
  WHERE rechnungsempfaenger_id IS NOT NULL;
