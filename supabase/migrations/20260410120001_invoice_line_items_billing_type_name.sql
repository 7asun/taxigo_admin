-- =============================================================================
-- Add billing_type_name to invoice_line_items (Abrechnungsfamilie snapshot)
--
-- Purpose (invoice hierarchy fix):
-- - Preserve both labels immutably on each line item:
--   - billing_variant_name = Unterart name (billing_variants.name)
--   - billing_type_name    = Abrechnungsfamilie name (billing_types.name)
-- - This enables correct PDF display (Unterart) while still retaining the family
--   label for grouping/reporting and audit (§14 UStG immutability).
-- =============================================================================

-- Add billing_type_name snapshot to preserve the Abrechnungsfamilie label at invoice creation time.
-- billing_variant_name already exists but was previously (incorrectly) storing the family name.
-- After this migration, billing_variant_name = Unterart name, billing_type_name = family name.
ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS billing_type_name text;

COMMENT ON COLUMN public.invoice_line_items.billing_type_name IS
  'Snapshot of billing_types.name (Abrechnungsfamilie) at invoice creation. Immutable per §14 UStG.';

