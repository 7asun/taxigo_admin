-- =============================================================================
-- Spec C: billing_pricing_rules — configurable pricing strategy per catalog level.
-- Exactly one scope FK per row (CHECK). Partial unique indexes: one active rule per scope.
-- =============================================================================

CREATE TABLE public.billing_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  payer_id uuid REFERENCES public.payers (id) ON DELETE CASCADE,
  billing_type_id uuid REFERENCES public.billing_types (id) ON DELETE CASCADE,
  billing_variant_id uuid REFERENCES public.billing_variants (id) ON DELETE CASCADE,
  strategy text NOT NULL CHECK (strategy IN (
    'client_price_tag',
    'tiered_km',
    'fixed_below_threshold_then_km',
    'time_based',
    'manual_trip_price',
    'no_price'
  )),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_pricing_rules_exactly_one_scope CHECK (
    (CASE WHEN payer_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN billing_type_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN billing_variant_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

COMMENT ON TABLE public.billing_pricing_rules IS
  'Pricing rule per Kostenträger, Abrechnungsfamilie, or billing variant. Determines which pricing strategy applies when building invoice line items.';

COMMENT ON COLUMN public.billing_pricing_rules.company_id IS
  'Tenant scope; matches payers.company_id for RLS.';

COMMENT ON COLUMN public.billing_pricing_rules.payer_id IS
  'When set (and other scope FKs null): rule applies to all trips for this payer unless overridden by a more specific rule.';

COMMENT ON COLUMN public.billing_pricing_rules.billing_type_id IS
  'When set (variant null): rule applies to all variants under this billing_types row.';

COMMENT ON COLUMN public.billing_pricing_rules.billing_variant_id IS
  'When set: rule applies only to trips with this billing_variants id (most specific scope).';

COMMENT ON COLUMN public.billing_pricing_rules.strategy IS
  'Pricing strategy enum: client_price_tag, tiered_km, fixed_below_threshold_then_km, time_based, manual_trip_price, no_price.';

COMMENT ON COLUMN public.billing_pricing_rules.config IS
  'Strategy-specific parameters as JSON. Structure validated in application code (Zod) before insert/update.';

COMMENT ON COLUMN public.billing_pricing_rules.is_active IS
  'Inactive rules are ignored at resolution time. Only one active rule per scope (enforced by partial unique indexes).';

CREATE INDEX idx_billing_pricing_rules_company ON public.billing_pricing_rules (company_id);
CREATE INDEX idx_billing_pricing_rules_payer ON public.billing_pricing_rules (payer_id)
  WHERE payer_id IS NOT NULL;
CREATE INDEX idx_billing_pricing_rules_billing_type ON public.billing_pricing_rules (billing_type_id)
  WHERE billing_type_id IS NOT NULL;
CREATE INDEX idx_billing_pricing_rules_variant ON public.billing_pricing_rules (billing_variant_id)
  WHERE billing_variant_id IS NOT NULL;

CREATE UNIQUE INDEX uq_pricing_rule_variant ON public.billing_pricing_rules (billing_variant_id)
  WHERE billing_variant_id IS NOT NULL AND is_active = true;

CREATE UNIQUE INDEX uq_pricing_rule_billing_type ON public.billing_pricing_rules (billing_type_id)
  WHERE billing_type_id IS NOT NULL
    AND billing_variant_id IS NULL
    AND is_active = true;

CREATE UNIQUE INDEX uq_pricing_rule_payer ON public.billing_pricing_rules (payer_id)
  WHERE payer_id IS NOT NULL
    AND billing_type_id IS NULL
    AND billing_variant_id IS NULL
    AND is_active = true;

ALTER TABLE public.billing_pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_pricing_rules_select_own" ON public.billing_pricing_rules;
DROP POLICY IF EXISTS "billing_pricing_rules_insert_own" ON public.billing_pricing_rules;
DROP POLICY IF EXISTS "billing_pricing_rules_update_own" ON public.billing_pricing_rules;
DROP POLICY IF EXISTS "billing_pricing_rules_delete_own" ON public.billing_pricing_rules;

CREATE POLICY "billing_pricing_rules_select_own" ON public.billing_pricing_rules
  FOR SELECT USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "billing_pricing_rules_insert_own" ON public.billing_pricing_rules
  FOR INSERT WITH CHECK (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "billing_pricing_rules_update_own" ON public.billing_pricing_rules
  FOR UPDATE USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "billing_pricing_rules_delete_own" ON public.billing_pricing_rules
  FOR DELETE USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_pricing_rules TO authenticated, service_role;
