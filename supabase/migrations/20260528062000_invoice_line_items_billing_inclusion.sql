-- =============================================================================
-- Migration: invoice_line_items_billing_inclusion
-- =============================================================================
--
-- WHAT THIS DOES
--   Adds four columns to invoice_line_items to track per-line billing inclusion
--   state (opt-out normal trips, opt-in cancelled trips) with mandatory reason
--   fields enforced via CHECK constraints.
--
--   Also updates create_storno_invoice so Storno line items carry the new
--   billing_included / is_cancelled_trip columns from the JSONB payload
--   (Storno rows always mirror the original invoice — inclusion flags copy as-is).
--
-- ROLLBACK
--   Not automated — revert via a new migration if needed.
-- =============================================================================

-- ── 1. New columns ──────────────────────────────────────────────────────────

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS billing_included BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS billing_exclusion_reason TEXT,
  ADD COLUMN IF NOT EXISTS is_cancelled_trip BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancelled_billing_reason TEXT;

COMMENT ON COLUMN public.invoice_line_items.billing_included IS
'When false, this line item is excluded from invoice totals (subtotal/tax/total).
It is still persisted for audit trail and PDF appendix rendering.
Only normal trips may have billing_included = false; opted-in cancelled trips
always have billing_included = true with is_cancelled_trip = true.';

COMMENT ON COLUMN public.invoice_line_items.billing_exclusion_reason IS
'Mandatory reason text when billing_included = false (admin opted out this trip).
NULL for all billing_included = true rows. Shown in the Ausgeschlossene Fahrten
PDF appendix section.';

COMMENT ON COLUMN public.invoice_line_items.is_cancelled_trip IS
'True when this line item was sourced from a cancelled trip that the admin
explicitly opted in to billing. These rows carry full pricing snapshots and
a billing reason but do not appear in the Haupttabelle — only in the
Stornierte Fahrten PDF appendix billed block.';

COMMENT ON COLUMN public.invoice_line_items.cancelled_billing_reason IS
'Mandatory billing reason when is_cancelled_trip = true and billing_included = true.
Shown in amber in the Stornierte Fahrten billed block of the PDF appendix.';

-- ── 2. CHECK constraints ────────────────────────────────────────────────────

-- why: this constraint enforces that a normal trip opted out of billing
-- always carries an exclusion reason. Three branches:
--   1. billing_included = TRUE  → included trips never need a reason (passes)
--   2. is_cancelled_trip = TRUE → cancelled trips use cancelled_billing_reason
--                                 (enforced by the second constraint below),
--                                 not billing_exclusion_reason — so this
--                                 branch correctly exempts them here
--   3. billing_exclusion_reason IS NOT NULL → opted-out normal trips must
--                                             have a reason (this is the
--                                             enforced case)
ALTER TABLE public.invoice_line_items
  ADD CONSTRAINT chk_exclusion_reason_required
  CHECK (
    billing_included = TRUE
    OR is_cancelled_trip = TRUE
    OR billing_exclusion_reason IS NOT NULL
  );

-- why: billing reason required when a cancelled trip is opted in for billing
ALTER TABLE public.invoice_line_items
  ADD CONSTRAINT chk_cancelled_billing_reason_required
  CHECK (
    is_cancelled_trip = FALSE
    OR billing_included = FALSE
    OR cancelled_billing_reason IS NOT NULL
  );

-- ── 3. Update create_storno_invoice RPC ─────────────────────────────────────
--
-- The Storno RPC inserts line items from a JSONB array using an explicit column
-- list. The new columns must be included so Storno rows carry the same inclusion
-- flags as the original invoice rows they mirror.
-- Storno rows always have billing_included = true (they are always billed at
-- negative amounts); is_cancelled_trip is copied from the original row.

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

  -- why: new billing_included / is_cancelled_trip columns must be carried from
  -- the JSONB payload; defaults (TRUE / FALSE) apply when the key is absent so
  -- older callers that have not yet been updated still work correctly.
  INSERT INTO public.invoice_line_items (
    invoice_id, trip_id, position, line_date, description,
    client_name, pickup_address, dropoff_address, distance_km,
    effective_distance_km, original_distance_km,
    unit_price, quantity, total_price, approach_fee_net, tax_rate,
    billing_variant_code, billing_variant_name, billing_type_name,
    pricing_strategy_used, pricing_source, kts_override,
    price_resolution_snapshot, trip_meta_snapshot,
    billing_included, billing_exclusion_reason,
    is_cancelled_trip, cancelled_billing_reason
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
    item->'trip_meta_snapshot',
    COALESCE((item->>'billing_included')::BOOLEAN, TRUE),
    NULLIF(item->>'billing_exclusion_reason', ''),
    COALESCE((item->>'is_cancelled_trip')::BOOLEAN, FALSE),
    NULLIF(item->>'cancelled_billing_reason', '')
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
Caller supplies negated amounts and storno note; TS owns invoice number generation.
Updated in 20260528060000 to carry billing_included / is_cancelled_trip columns.$$;
