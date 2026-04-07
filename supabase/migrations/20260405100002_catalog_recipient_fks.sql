-- =============================================================================
-- Spec C: link catalog rows to rechnungsempfaenger (nullable FK, SET NULL on delete).
-- =============================================================================

ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS rechnungsempfaenger_id uuid
    REFERENCES public.rechnungsempfaenger (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.payers.rechnungsempfaenger_id IS
  'Default invoice recipient for this payer; may be overridden on billing_types or billing_variants.';

ALTER TABLE public.billing_types
  ADD COLUMN IF NOT EXISTS rechnungsempfaenger_id uuid
    REFERENCES public.rechnungsempfaenger (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.billing_types.rechnungsempfaenger_id IS
  'Overrides payer default recipient for this billing family.';

ALTER TABLE public.billing_variants
  ADD COLUMN IF NOT EXISTS rechnungsempfaenger_id uuid
    REFERENCES public.rechnungsempfaenger (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.billing_variants.rechnungsempfaenger_id IS
  'Most specific recipient override for this variant (e.g. Arbeitsamt address).';

CREATE INDEX IF NOT EXISTS idx_payers_rechnungsempfaenger_id ON public.payers (rechnungsempfaenger_id)
  WHERE rechnungsempfaenger_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_types_rechnungsempfaenger_id ON public.billing_types (rechnungsempfaenger_id)
  WHERE rechnungsempfaenger_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_variants_rechnungsempfaenger_id ON public.billing_variants (rechnungsempfaenger_id)
  WHERE rechnungsempfaenger_id IS NOT NULL;
