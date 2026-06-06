-- =============================================================================
-- Migration: invoices.replaces_invoice_id — corrective branch draft link
-- =============================================================================
--
-- why: after Storno the original invoice is status 'corrected'. A branch draft
-- is a new positive draft that replaces the storniert original for editing and
-- re-issue. One branch per original is enforced by the partial unique index.
-- =============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS replaces_invoice_id UUID
    REFERENCES public.invoices(id)
    ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_replaces_invoice_id_unique
  ON public.invoices(replaces_invoice_id)
  WHERE replaces_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.replaces_invoice_id IS
$$FK to the storniert original invoice this branch draft corrects. NULL on normal
invoices and Stornorechnungen (those use cancels_invoice_id). Set only by
create_branch_draft_from_invoice RPC. At most one branch draft per original.$$;
