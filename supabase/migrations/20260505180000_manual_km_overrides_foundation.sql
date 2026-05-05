-- =============================================================================
-- Migration: manual_km_overrides_foundation — manual KM resolution (Phase 1)
-- =============================================================================
--
-- WHAT THIS DOES
--   Adds payer/trip/line-item columns and client_km_overrides for resolving an
--   effective distance (manual → client override → Google routing) without ever
--   mutating trips.driving_distance_km. Extends create_storno_invoice so Storno
--   line items preserve effective_distance_km / original_distance_km snapshots.
--
-- ROLLBACK
--   Not automated — revert via new migration if needed.
-- =============================================================================

-- ── 1a. payers.manual_km_enabled ────────────────────────────────────────────

ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS manual_km_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payers.manual_km_enabled IS
  'When true, the invoice builder Step 3 renders an editable manual KM input next to the Google distance for every trip row under this payer. False by default — the KM input is hidden and driving_distance_km is used as-is.';

-- ── 1b. trips.manual_distance_km ───────────────────────────────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS manual_distance_km DOUBLE PRECISION;

COMMENT ON COLUMN public.trips.manual_distance_km IS
  'Admin-entered distance override in kilometres. Set via a fire-and-forget writeback when the admin commits a manual KM edit in invoice builder Step 3. NULL means no override has been set. Never overrides driving_distance_km — that column always holds the routing provider value.';

-- ── 1c. invoice_line_items distance snapshots ───────────────────────────────

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS effective_distance_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS original_distance_km DOUBLE PRECISION;

COMMENT ON COLUMN public.invoice_line_items.effective_distance_km IS
  'The distance in km actually used for pricing, VAT resolution, and PDF output for this line item. Equals manual_distance_km if an override was active at invoice creation time, otherwise equals trips.driving_distance_km. Snapshotted at invoice creation — never recomputed afterwards.';

COMMENT ON COLUMN public.invoice_line_items.original_distance_km IS
  'Snapshot of trips.driving_distance_km at invoice creation time. Always the routing-provider value, never the manual override. Preserved for audit and display alongside effective_distance_km.';

-- ── 1d. client_km_overrides ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_km_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  payer_id uuid NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  distance_km numeric(8, 3) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_km_overrides IS
  'Per-client manual distance overrides, optionally scoped to a payer. When a matching active row exists, its distance_km is used as the effective KM for invoice line items instead of the routing-provider value. Mirrors the client_price_tags pattern.';

COMMENT ON COLUMN public.client_km_overrides.id IS
  'Primary key.';

COMMENT ON COLUMN public.client_km_overrides.company_id IS
  'Tenant scope — all queries must filter by company_id.';

COMMENT ON COLUMN public.client_km_overrides.client_id IS
  'The Fahrgast (client) this override applies to.';

COMMENT ON COLUMN public.client_km_overrides.payer_id IS
  'When set, this override only applies when the trip is invoiced under this specific Kostenträger. NULL means it applies across all payers for this client. Resolution priority: payer-scoped row wins over global (payer_id NULL) row.';

COMMENT ON COLUMN public.client_km_overrides.distance_km IS
  'The override distance in kilometres to use instead of the routing-provider value.';

COMMENT ON COLUMN public.client_km_overrides.is_active IS
  'Soft-delete flag. Only rows with is_active = true are considered during resolution.';

COMMENT ON COLUMN public.client_km_overrides.created_at IS
  'Row creation timestamp (UTC).';

COMMENT ON COLUMN public.client_km_overrides.updated_at IS
  'Last update timestamp (UTC). Application must set this on every UPDATE.';

CREATE INDEX IF NOT EXISTS client_km_overrides_client_payer_idx
  ON public.client_km_overrides (company_id, client_id, payer_id)
  WHERE is_active = true;

ALTER TABLE public.client_km_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_km_overrides_admin ON public.client_km_overrides
  FOR ALL TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_km_overrides TO authenticated, service_role;

-- ── create_storno_invoice — include distance snapshot columns ───────────────

CREATE OR REPLACE FUNCTION public.create_storno_invoice(
  p_company_id                        UUID,
  p_invoice_number                    TEXT,
  p_payer_id                          UUID,
  p_billing_type_id                   UUID,
  p_billing_variant_id                UUID,
  p_mode                              TEXT,
  p_client_id                         UUID,
  p_period_from                       DATE,
  p_period_to                         DATE,
  p_subtotal                          NUMERIC,
  p_tax_amount                        NUMERIC,
  p_total                             NUMERIC,
  p_notes                             TEXT,
  p_payment_due_days                  INTEGER,
  p_cancels_invoice_id                UUID,
  p_rechnungsempfaenger_id            UUID,
  p_rechnungsempfaenger_snapshot      JSONB,
  p_client_reference_fields_snapshot  JSONB,
  p_pdf_column_override               JSONB,
  p_original_invoice_id               UUID,
  p_line_items                        JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_storno_id UUID;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_cancels_invoice_id IS DISTINCT FROM p_original_invoice_id THEN
    RAISE EXCEPTION 'invalid storno parameters' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.invoices o
    WHERE o.id = p_original_invoice_id
      AND o.company_id = p_company_id
      AND o.status IN ('draft', 'sent')
  ) THEN
    RAISE EXCEPTION 'original invoice not found or not storno-eligible'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.invoices (
    company_id, invoice_number, payer_id, billing_type_id, billing_variant_id,
    mode, client_id, period_from, period_to,
    subtotal, tax_amount, total,
    notes, payment_due_days, status,
    cancels_invoice_id,
    rechnungsempfaenger_id, rechnungsempfaenger_snapshot,
    client_reference_fields_snapshot, pdf_column_override
  ) VALUES (
    p_company_id, p_invoice_number, p_payer_id, p_billing_type_id, p_billing_variant_id,
    p_mode, p_client_id, p_period_from, p_period_to,
    p_subtotal, p_tax_amount, p_total,
    p_notes, p_payment_due_days, 'draft',
    p_cancels_invoice_id,
    p_rechnungsempfaenger_id, p_rechnungsempfaenger_snapshot,
    p_client_reference_fields_snapshot, p_pdf_column_override
  )
  RETURNING id INTO v_storno_id;

  INSERT INTO public.invoice_line_items (
    invoice_id, trip_id, position, line_date, description,
    client_name, pickup_address, dropoff_address, distance_km,
    effective_distance_km, original_distance_km,
    unit_price, quantity, total_price, approach_fee_net, tax_rate,
    billing_variant_code, billing_variant_name, billing_type_name,
    pricing_strategy_used, pricing_source, kts_override,
    price_resolution_snapshot, trip_meta_snapshot
  )
  SELECT
    v_storno_id,
    NULLIF(TRIM(item->>'trip_id'), '')::UUID,
    (item->>'position')::INTEGER,
    NULLIF(TRIM(item->>'line_date'), '')::TIMESTAMPTZ,
    item->>'description',
    NULLIF(item->>'client_name', ''),
    NULLIF(item->>'pickup_address', ''),
    NULLIF(item->>'dropoff_address', ''),
    NULLIF(TRIM(item->>'distance_km'), '')::NUMERIC,
    NULLIF(TRIM(item->>'effective_distance_km'), '')::DOUBLE PRECISION,
    NULLIF(TRIM(item->>'original_distance_km'), '')::DOUBLE PRECISION,
    (item->>'unit_price')::NUMERIC,
    (item->>'quantity')::NUMERIC,
    (item->>'total_price')::NUMERIC,
    NULLIF(TRIM(item->>'approach_fee_net'), '')::NUMERIC,
    (item->>'tax_rate')::NUMERIC,
    NULLIF(item->>'billing_variant_code', ''),
    NULLIF(item->>'billing_variant_name', ''),
    NULLIF(item->>'billing_type_name', ''),
    NULLIF(item->>'pricing_strategy_used', ''),
    NULLIF(item->>'pricing_source', ''),
    COALESCE((item->>'kts_override')::BOOLEAN, FALSE),
    item->'price_resolution_snapshot',
    item->'trip_meta_snapshot'
  FROM jsonb_array_elements(
    COALESCE(p_line_items, '[]'::JSONB)
  ) AS item;

  UPDATE public.invoices
  SET
    status       = 'corrected',
    cancelled_at = now(),
    updated_at   = now()
  WHERE id = p_original_invoice_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'original invoice update failed' USING ERRCODE = '23514';
  END IF;

  RETURN v_storno_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_storno_invoice(
  UUID, TEXT, UUID, UUID, UUID, TEXT, UUID, DATE, DATE,
  NUMERIC, NUMERIC, NUMERIC, TEXT, INTEGER, UUID, UUID, JSONB, JSONB, JSONB, UUID, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_storno_invoice(
  UUID, TEXT, UUID, UUID, UUID, TEXT, UUID, DATE, DATE,
  NUMERIC, NUMERIC, NUMERIC, TEXT, INTEGER, UUID, UUID, JSONB, JSONB, JSONB, UUID, JSONB
) TO authenticated;

COMMENT ON FUNCTION public.create_storno_invoice(
  UUID, TEXT, UUID, UUID, UUID, TEXT, UUID, DATE, DATE,
  NUMERIC, NUMERIC, NUMERIC, TEXT, INTEGER, UUID, UUID, JSONB, JSONB, JSONB, UUID, JSONB
) IS
$$Atomic Stornorechnung: insert Storno invoice (draft), line items from JSONB, mark original corrected.
SECURITY DEFINER; requires current_user_is_admin() and p_company_id = current_user_company_id().
Caller supplies negated amounts and storno note; TS owns invoice number generation.$$;
