-- =============================================================================
-- Add billing_variant_id to invoices (Unterart scoping)
--
-- Purpose:
-- - Persist Unterart-level invoice scope on the header row for future filtering
--   and analytics.
-- - NULL means the invoice covers multiple Unterarten (e.g. monthly run or any
--   invoice not explicitly scoped to one billing_variants.id).
--
-- Context (invoice hierarchy fix):
-- - per_client mode now carries billing_variant_id end-to-end.
-- - invoices.billing_type_id remains the optional family (billing_types.id) filter.
-- =============================================================================

-- Add billing_variant_id to invoices for Unterart-level scoping and future filtering.
-- NULL means the invoice covers multiple Unterarten (e.g. monthly, all variants under a family).
-- Set when invoice is scoped to exactly one Unterart (e.g. per_client mode with a specific variant).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS billing_variant_id uuid
  REFERENCES public.billing_variants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoices.billing_variant_id IS
  'Unterart (billing_variants.id) this invoice is scoped to. NULL = all variants under billing_type_id.';

