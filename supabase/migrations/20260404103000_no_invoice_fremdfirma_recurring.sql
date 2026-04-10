-- =============================================================================
-- Spec A: no_invoice_required — catalog seeds + trip + recurring_rules columns.
-- Spec B: fremdfirmen catalog + trip Fremdfirma assignment + recurring_rules mirror.
-- behavior_profile JSON extension (no_invoice_required_default) is app/Zod only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Spec A: payers + billing_variants cascade columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS no_invoice_required_default boolean DEFAULT NULL;

COMMENT ON COLUMN public.payers.no_invoice_required_default IS
  'Cascade: TRUE = default keine Rechnung für Fahrten mit diesem Kostenträger. NULL = unset (vererben).';

ALTER TABLE public.billing_variants
  ADD COLUMN IF NOT EXISTS no_invoice_required_default boolean DEFAULT NULL;

COMMENT ON COLUMN public.billing_variants.no_invoice_required_default IS
  'Unterart: überschreibt Familie und Kostenträger für no_invoice_required-Default. NULL = unset.';

-- -----------------------------------------------------------------------------
-- Spec A: trips
-- -----------------------------------------------------------------------------
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS no_invoice_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_invoice_source varchar(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS selbstzahler_collected_amount numeric(10, 2) DEFAULT NULL;

COMMENT ON COLUMN public.trips.no_invoice_required IS
  'TRUE = für diese Fahrt wird keine Rechnung an den Kostenträger erstellt.';

COMMENT ON COLUMN public.trips.no_invoice_source IS
  'variant | familie | payer | manual | system_default — Herkunft von no_invoice_required.';

COMMENT ON COLUMN public.trips.selbstzahler_collected_amount IS
  'Seed für späteres Cash-Reporting; V1 ohne UI.';

-- -----------------------------------------------------------------------------
-- Spec B: fremdfirmen
-- -----------------------------------------------------------------------------
CREATE TABLE public.fremdfirmen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  number text DEFAULT NULL,
  sort_order int NOT NULL DEFAULT 0,
  default_payment_mode text NOT NULL DEFAULT 'monthly_invoice'
    CHECK (default_payment_mode IN (
      'cash_per_trip', 'monthly_invoice', 'self_payer', 'kts_to_fremdfirma'
    )),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fremdfirmen_company_id ON public.fremdfirmen (company_id);
CREATE INDEX idx_fremdfirmen_company_active ON public.fremdfirmen (company_id, is_active);

COMMENT ON TABLE public.fremdfirmen IS
  'Externe Transportunternehmen; getrennt vom Abrechnungskatalog (Kostenträger).';

COMMENT ON COLUMN public.fremdfirmen.default_payment_mode IS
  'Standard-Abrechnungsart für neue Fahrten dieser Fremdfirma; pro Fahrt überschreibbar.';

COMMENT ON COLUMN public.fremdfirmen.number IS
  'Optionale interne Kennnummer (Berichte, CSV).';

-- -----------------------------------------------------------------------------
-- Spec B: trips Fremdfirma columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS fremdfirma_id uuid DEFAULT NULL
    REFERENCES public.fremdfirmen (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fremdfirma_payment_mode text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fremdfirma_cost numeric(10, 2) DEFAULT NULL;

DO $trips_fremd_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trips_fremdfirma_payment_mode_check'
      AND conrelid = 'public.trips'::regclass
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_fremdfirma_payment_mode_check CHECK (
        fremdfirma_payment_mode IS NULL
        OR fremdfirma_payment_mode IN (
          'cash_per_trip', 'monthly_invoice', 'self_payer', 'kts_to_fremdfirma'
        )
      );
  END IF;
END
$trips_fremd_check$;

CREATE INDEX idx_trips_fremdfirma_id ON public.trips (fremdfirma_id)
  WHERE fremdfirma_id IS NOT NULL;

COMMENT ON COLUMN public.trips.fremdfirma_id IS
  'Wenn gesetzt: Fahrt an diese Fremdfirma vergeben; driver_id sollte NULL sein.';

COMMENT ON COLUMN public.trips.fremdfirma_payment_mode IS
  'Vergütung Fremdfirma für diese Fahrt.';

COMMENT ON COLUMN public.trips.fremdfirma_cost IS
  'Vereinbarter Betrag an Fremdfirma; Seed für Margin-Reporting, kein UI-Enforcement V1.';

-- -----------------------------------------------------------------------------
-- RLS: fremdfirmen (same company scoping as invoice_text_blocks)
-- -----------------------------------------------------------------------------
ALTER TABLE public.fremdfirmen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fremdfirmen_select_own" ON public.fremdfirmen;
DROP POLICY IF EXISTS "fremdfirmen_insert_own" ON public.fremdfirmen;
DROP POLICY IF EXISTS "fremdfirmen_update_own" ON public.fremdfirmen;
DROP POLICY IF EXISTS "fremdfirmen_delete_own" ON public.fremdfirmen;

CREATE POLICY "fremdfirmen_select_own" ON public.fremdfirmen
  FOR SELECT USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "fremdfirmen_insert_own" ON public.fremdfirmen
  FOR INSERT WITH CHECK (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "fremdfirmen_update_own" ON public.fremdfirmen
  FOR UPDATE USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

CREATE POLICY "fremdfirmen_delete_own" ON public.fremdfirmen
  FOR DELETE USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fremdfirmen TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- recurring_rules: mirror columns (after fremdfirmen exists)
-- -----------------------------------------------------------------------------
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS no_invoice_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_invoice_source varchar(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fremdfirma_id uuid DEFAULT NULL
    REFERENCES public.fremdfirmen (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fremdfirma_payment_mode text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fremdfirma_cost numeric(10, 2) DEFAULT NULL;

DO $rr_fremd_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_rules_fremdfirma_payment_mode_check'
      AND conrelid = 'public.recurring_rules'::regclass
  ) THEN
    ALTER TABLE public.recurring_rules
      ADD CONSTRAINT recurring_rules_fremdfirma_payment_mode_check CHECK (
        fremdfirma_payment_mode IS NULL
        OR fremdfirma_payment_mode IN (
          'cash_per_trip', 'monthly_invoice', 'self_payer', 'kts_to_fremdfirma'
        )
      );
  END IF;
END
$rr_fremd_check$;

COMMENT ON COLUMN public.recurring_rules.no_invoice_required IS
  'Gespiegelt auf generierte Fahrten; gleiche Semantik wie trips.no_invoice_required.';

COMMENT ON COLUMN public.recurring_rules.no_invoice_source IS
  'Herkunft no_invoice_required auf der Regel; wird auf generierte Fahrten kopiert.';

COMMENT ON COLUMN public.recurring_rules.fremdfirma_id IS
  'Wenn gesetzt: generierte Fahrten werden dieser Fremdfirma zugewiesen.';

COMMENT ON COLUMN public.recurring_rules.fremdfirma_payment_mode IS
  'Abrechnungsart Fremdfirma — wird auf generierte Fahrten gespiegelt.';

COMMENT ON COLUMN public.recurring_rules.fremdfirma_cost IS
  'Vereinbarter Betrag — wird gespiegelt; kein UI-Enforcement.';
