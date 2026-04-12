-- =============================================================================
-- client_price_tags — scoped gross price tags per client (global / payer / variant).
-- Legacy clients.price_tag remains until a follow-up migration drops it.
-- =============================================================================

CREATE TABLE public.client_price_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  payer_id uuid NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  billing_variant_id uuid NULL REFERENCES public.billing_variants (id) ON DELETE CASCADE,
  price_gross numeric(10, 2) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_price_tags IS
  'Gross (brutto) negotiated prices per client, optionally scoped to payer or billing variant; resolution before billing_pricing_rules.';

CREATE UNIQUE INDEX uq_cpt_variant ON public.client_price_tags (client_id, billing_variant_id)
  WHERE billing_variant_id IS NOT NULL AND is_active = true;

CREATE UNIQUE INDEX uq_cpt_payer ON public.client_price_tags (client_id, payer_id)
  WHERE payer_id IS NOT NULL AND billing_variant_id IS NULL AND is_active = true;

CREATE UNIQUE INDEX uq_cpt_global ON public.client_price_tags (client_id)
  WHERE payer_id IS NULL AND billing_variant_id IS NULL AND is_active = true;

CREATE INDEX idx_client_price_tags_company ON public.client_price_tags (company_id);
CREATE INDEX idx_client_price_tags_client ON public.client_price_tags (client_id)
  WHERE is_active = true;

ALTER TABLE public.client_price_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_price_tags_admin ON public.client_price_tags
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_price_tags TO authenticated, service_role;

-- Backfill: one global row per client that had price_tag (avoid duplicate globals).
INSERT INTO public.client_price_tags (company_id, client_id, price_gross)
SELECT c.company_id, c.id, c.price_tag::numeric(10, 2)
FROM public.clients c
WHERE c.price_tag IS NOT NULL
  AND c.price_tag > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.client_price_tags t
    WHERE t.client_id = c.id
      AND t.payer_id IS NULL
      AND t.billing_variant_id IS NULL
      AND t.is_active = true
  );
