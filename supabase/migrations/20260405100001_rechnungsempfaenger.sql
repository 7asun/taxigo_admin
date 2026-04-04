-- =============================================================================
-- Spec C: rechnungsempfaenger — invoice recipient catalog (independent of payers).
-- =============================================================================

CREATE TABLE public.rechnungsempfaenger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,
  country text DEFAULT 'DE',
  email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rechnungsempfaenger_company ON public.rechnungsempfaenger (company_id);
CREATE INDEX idx_rechnungsempfaenger_company_active ON public.rechnungsempfaenger (company_id, is_active);

COMMENT ON TABLE public.rechnungsempfaenger IS
  'Invoice recipient catalog. Independent of payers; one recipient can be linked from multiple catalog levels.';

COMMENT ON COLUMN public.rechnungsempfaenger.name IS
  'Legal or display name on the invoice address block.';

COMMENT ON COLUMN public.rechnungsempfaenger.address_line1 IS
  'First address line (street and number or organisation line).';

COMMENT ON COLUMN public.rechnungsempfaenger.address_line2 IS
  'Optional second address line.';

COMMENT ON COLUMN public.rechnungsempfaenger.postal_code IS
  'Postal code (PLZ).';

COMMENT ON COLUMN public.rechnungsempfaenger.country IS
  'ISO country; default DE.';

COMMENT ON COLUMN public.rechnungsempfaenger.email IS
  'Optional contact email; not printed on PDF unless product requires it.';

COMMENT ON COLUMN public.rechnungsempfaenger.is_active IS
  'Inactive recipients hidden from default pickers; historical invoice snapshots unchanged.';

ALTER TABLE public.rechnungsempfaenger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rechnungsempfaenger_select_own" ON public.rechnungsempfaenger;
DROP POLICY IF EXISTS "rechnungsempfaenger_insert_own" ON public.rechnungsempfaenger;
DROP POLICY IF EXISTS "rechnungsempfaenger_update_own" ON public.rechnungsempfaenger;
DROP POLICY IF EXISTS "rechnungsempfaenger_delete_own" ON public.rechnungsempfaenger;

CREATE POLICY "rechnungsempfaenger_select_own" ON public.rechnungsempfaenger
  FOR SELECT USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "rechnungsempfaenger_insert_own" ON public.rechnungsempfaenger
  FOR INSERT WITH CHECK (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "rechnungsempfaenger_update_own" ON public.rechnungsempfaenger
  FOR UPDATE USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "rechnungsempfaenger_delete_own" ON public.rechnungsempfaenger
  FOR DELETE USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rechnungsempfaenger TO authenticated, service_role;
