-- =============================================================================
-- Migration: create_storno_invoice — atomic Stornorechnung (§14 UStG)
-- =============================================================================
--
-- WHAT THIS DOES
--   Inserts a Storno invoice header (status 'draft'), inserts mirrored line items
--   from a JSONB array, and updates the original invoice to status 'corrected'
--   with cancelled_at / updated_at — all in ONE PostgreSQL transaction.
--   If any step fails, the entire invocation rolls back (no orphan Storno header).
--
-- CALLER (TypeScript) RESPONSIBILITY
--   - generateNextInvoiceNumber() — RE-YYYY-MM-NNNN format and sequence (RPC
--     invoice_numbers_max_for_prefix) stays in TS.
--   - Negated header totals (subtotal, tax_amount, total) and negated line money
--     fields plus negatePriceResolutionSnapshot() for JSON snapshots.
--   - stornoNote text (must reference the original invoice number per §14 UStG).
--
-- THIS FUNCTION RESPONSIBILITY
--   - Authorization: same admin gate as invoice RLS / invoice_numbers_max_for_prefix.
--   - Validate original invoice belongs to p_company_id and is storno-eligible.
--   - Perform the three writes atomically inside one implicit transaction.
--
-- ROLLBACK
--   Any ERROR / RAISE aborts the function; PostgreSQL rolls back all writes.
-- =============================================================================

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
  UUID, TEXT, UUID, UUID, UUID, çTEXT, UUID, DATE, DATE,
  NUMERIC, NUMERIC, NUMERIC, TEXT, INTEGER, UUID, UUID, JSONB, JSONB, JSONB, UUID, JSONB
) TO authenticated;

COMMENT ON FUNCTION public.create_storno_invoice(
  UUID, TEXT, UUID, UUID, UUID, TEXT, UUID, DATE, DATE,
  NUMERIC, NUMERIC, NUMERIC, TEXT, INTEGER, UUID, UUID, JSONB, JSONB, JSONB, UUID, JSONB
) IS
$$Atomic Stornorechnung: insert Storno invoice (draft), line items from JSONB, mark original corrected.
SECURITY DEFINER; requires current_user_is_admin() and p_company_id = current_user_company_id().
Caller supplies negated amounts and storno note; TS owns invoice number generation.$$;
