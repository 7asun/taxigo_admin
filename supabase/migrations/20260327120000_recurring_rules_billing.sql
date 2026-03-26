-- =============================================================================
-- recurring_rules: link each rule to payer + billing variant (same leaf as trips)
-- =============================================================================
-- Nullable for legacy rows created before this migration; the app requires both
-- on create/update. Cron skips materialization when either is NULL so we do not
-- silently create trips without billing (product rule).

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS payer_id uuid REFERENCES public.payers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_variant_id uuid REFERENCES public.billing_variants (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.recurring_rules.payer_id IS 'Kostenträger for all trips generated from this rule; copied to trips.payer_id by the recurring cron.';
COMMENT ON COLUMN public.recurring_rules.billing_variant_id IS 'Unterart (leaf); family behavior/colour come from billing_types via the variant; copied to trips.billing_variant_id by the recurring cron.';
