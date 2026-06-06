-- =============================================================================
-- Migration: create_branch_draft_from_invoice — atomic corrective branch draft
-- =============================================================================
--
-- Creates a positive draft invoice + line-item copy from a status='corrected'
-- original in one transaction. Caller supplies the branch invoice number (TS).
-- Does NOT modify create_storno_invoice.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_branch_draft_from_invoice(
  p_company_id            UUID,
  p_original_invoice_id   UUID,
  p_branch_invoice_number TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original   public.invoices%ROWTYPE;
  v_branch_id  UUID;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_original
  FROM public.invoices o
  WHERE o.id = p_original_invoice_id
    AND o.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'original invoice not found' USING ERRCODE = '23514';
  END IF;

  IF v_original.status IS DISTINCT FROM 'corrected' THEN
    RAISE EXCEPTION 'original invoice must be corrected (status=%)', v_original.status
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoices b
    WHERE b.replaces_invoice_id = p_original_invoice_id
  ) THEN
    RAISE EXCEPTION 'branch draft already exists for this invoice'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.invoices (
    company_id,
    invoice_number,
    payer_id,
    billing_type_id,
    billing_variant_id,
    mode,
    client_id,
    period_from,
    period_to,
    subtotal,
    tax_amount,
    total,
    payment_due_days,
    intro_block_id,
    outro_block_id,
    rechnungsempfaenger_id,
    rechnungsempfaenger_snapshot,
    client_reference_fields_snapshot,
    pdf_column_override,
    status,
    replaces_invoice_id,
    cancels_invoice_id
  ) VALUES (
    p_company_id,
    p_branch_invoice_number,
    v_original.payer_id,
    v_original.billing_type_id,
    v_original.billing_variant_id,
    v_original.mode,
    v_original.client_id,
    v_original.period_from,
    v_original.period_to,
    v_original.subtotal,
    v_original.tax_amount,
    v_original.total,
    v_original.payment_due_days,
    v_original.intro_block_id,
    v_original.outro_block_id,
    v_original.rechnungsempfaenger_id,
    v_original.rechnungsempfaenger_snapshot,
    v_original.client_reference_fields_snapshot,
    v_original.pdf_column_override,
    'draft',
    p_original_invoice_id,
    NULL
  )
  RETURNING id INTO v_branch_id;

  -- why: verbatim snapshot copy — branch draft matches storniert amounts positively.
  INSERT INTO public.invoice_line_items (
    invoice_id,
    trip_id,
    position,
    line_date,
    description,
    client_name,
    pickup_address,
    dropoff_address,
    distance_km,
    effective_distance_km,
    original_distance_km,
    unit_price,
    quantity,
    total_price,
    approach_fee_net,
    tax_rate,
    billing_variant_code,
    billing_variant_name,
    billing_type_name,
    pricing_strategy_used,
    pricing_source,
    kts_override,
    price_resolution_snapshot,
    trip_meta_snapshot,
    billing_included,
    billing_exclusion_reason,
    is_cancelled_trip,
    cancelled_billing_reason
  )
  SELECT
    v_branch_id,
    li.trip_id,
    li.position,
    li.line_date,
    li.description,
    li.client_name,
    li.pickup_address,
    li.dropoff_address,
    li.distance_km,
    li.effective_distance_km,
    li.original_distance_km,
    li.unit_price,
    li.quantity,
    li.total_price,
    li.approach_fee_net,
    li.tax_rate,
    li.billing_variant_code,
    li.billing_variant_name,
    li.billing_type_name,
    li.pricing_strategy_used,
    li.pricing_source,
    li.kts_override,
    li.price_resolution_snapshot,
    li.trip_meta_snapshot,
    li.billing_included,
    li.billing_exclusion_reason,
    li.is_cancelled_trip,
    li.cancelled_billing_reason
  FROM public.invoice_line_items li
  WHERE li.invoice_id = p_original_invoice_id
  ORDER BY li.position;

  RETURN v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_branch_draft_from_invoice(UUID, UUID, TEXT)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_branch_draft_from_invoice(UUID, UUID, TEXT)
  TO authenticated;

-- Line item snapshot columns copied verbatim by create_branch_draft_from_invoice
COMMENT ON COLUMN public.invoice_line_items.invoice_id IS
  'FK to invoices.id. Parent invoice for this position. Set to the new branch draft id on copy.';

COMMENT ON COLUMN public.invoice_line_items.trip_id IS
  'FK to trips.id. Nullable — cancelled trips may have no source trip row. Preserved in branch copy for trip linkage continuity.';

COMMENT ON COLUMN public.invoice_line_items.position IS
  'Display order on the invoice PDF (1-based). Preserved from the corrected original on branch copy.';

COMMENT ON COLUMN public.invoice_line_items.line_date IS
  'Service date/time frozen at invoice creation (from trips.scheduled_at). Copied verbatim to branch draft.';

COMMENT ON COLUMN public.invoice_line_items.description IS
  'Human-readable line title frozen at invoice creation. Copied verbatim — never recomputed on branch copy.';

COMMENT ON COLUMN public.invoice_line_items.client_name IS
  'Passenger display name snapshot at invoice creation. Copied verbatim to branch draft for PDF rendering.';

COMMENT ON COLUMN public.invoice_line_items.pickup_address IS
  'Pickup address snapshot at invoice creation. Copied verbatim to branch draft.';

COMMENT ON COLUMN public.invoice_line_items.dropoff_address IS
  'Dropoff address snapshot at invoice creation. Copied verbatim to branch draft.';

COMMENT ON COLUMN public.invoice_line_items.effective_distance_km IS
  'Admin-confirmed KM at invoice time. May differ from trips.driving_distance_km if a KM override was applied in the builder. Copied verbatim to branch draft.';

COMMENT ON COLUMN public.invoice_line_items.original_distance_km IS
  'Routing SSOT distance at invoice time, before any admin KM override. Snapshot only — never recomputed.';

COMMENT ON COLUMN public.invoice_line_items.distance_km IS
  'Raw trips.driving_distance_km at the time of invoice creation. Immutable snapshot.';

COMMENT ON COLUMN public.invoice_line_items.unit_price IS
  'Price per KM unit at invoice time, after all pricing rule resolution and overrides.';

COMMENT ON COLUMN public.invoice_line_items.quantity IS
  'Billable KM quantity used for total_price calculation.';

COMMENT ON COLUMN public.invoice_line_items.tax_rate IS
  'VAT rate applied to this line item at invoice time (e.g. 0.07 or 0.19). May differ from trips.tax_rate if admin applied a tax rate override in the builder.';

COMMENT ON COLUMN public.invoice_line_items.approach_fee_net IS
  'Anfahrtspauschale net amount. Zero if no approach fee applies for this billing variant.';

COMMENT ON COLUMN public.invoice_line_items.total_price IS
  'Gross total for this line item including VAT and approach fee.';

COMMENT ON COLUMN public.invoice_line_items.billing_variant_code IS
  'Stable billing variant code snapshot (e.g. V01) at invoice creation. Copied verbatim to branch draft.';

COMMENT ON COLUMN public.invoice_line_items.billing_variant_name IS
  'Billing variant display name (Unterart) snapshot at invoice creation. Copied verbatim to branch draft.';

COMMENT ON COLUMN public.invoice_line_items.billing_type_name IS
  'Abrechnungsfamilie name snapshot at invoice creation. Copied verbatim to branch draft.';

COMMENT ON COLUMN public.invoice_line_items.price_resolution_snapshot IS
  'Full PriceResolution JSON frozen at invoice time. Legal immutability record — never recomputed after save. Copied verbatim to branch draft.';

COMMENT ON COLUMN public.invoice_line_items.trip_meta_snapshot IS
  'Trip display metadata (address, date, client name) frozen at invoice time for PDF rendering. Independent of live trips table.';

COMMENT ON COLUMN public.invoice_line_items.billing_included IS
  'Whether this line item was included in the invoice totals. Excluded trips are still recorded for the exclusion appendix.';

COMMENT ON COLUMN public.invoice_line_items.billing_exclusion_reason IS
  'Human-readable reason why this trip was excluded from billing. NULL when billing_included is true.';

COMMENT ON COLUMN public.invoice_line_items.is_cancelled_trip IS
  'True for opted-in cancelled trips billed as a separate block. False for normal trips.';

COMMENT ON COLUMN public.invoice_line_items.cancelled_billing_reason IS
  'Reason the cancelled trip was included in billing. NULL for normal trips.';

COMMENT ON COLUMN public.invoice_line_items.pricing_strategy_used IS
  'Which pricing engine branch resolved this line item price (e.g. gross_taxameter, net_km_rule).';

COMMENT ON COLUMN public.invoice_line_items.pricing_source IS
  'Source of the resolved price (e.g. client_price_tag, trip_price, billing_rule).';

COMMENT ON COLUMN public.invoice_line_items.kts_override IS
  'True when KTS document applies and modified the price resolution for this trip.';

COMMENT ON FUNCTION public.create_branch_draft_from_invoice(UUID, UUID, TEXT) IS
$$Atomic corrective branch: insert draft header (positive totals) + copy line items
from a corrected original. SECURITY DEFINER; requires current_user_is_admin()
and p_company_id = current_user_company_id(). TS owns invoice number generation.$$;
