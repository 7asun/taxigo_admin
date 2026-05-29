-- =============================================================================
-- Migration: draft_invoice_editing_foundation
-- =============================================================================
--
-- WHAT THIS DOES
--   Phase A (schema + guards) for the "re-open a draft invoice and edit it"
--   feature. Two independent pieces:
--
--   1. payers.revision_invoices_enabled — per-payer feature flag gating whether
--      a draft invoice for that Kostenträger may be re-opened in the builder.
--      No TypeScript reads it yet (UI is a later phase); it exists so the gate
--      is ready and migrations stay ordered.
--
--   2. replace_draft_invoice_line_items(p_invoice_id, p_line_items) — a
--      SECURITY DEFINER RPC that ATOMICALLY swaps the line items of a *draft*
--      invoice and recomputes the header totals SERVER-SIDE.
--
--   WHY AN RPC INSTEAD OF BROADER RLS:
--   invoice_line_items has SELECT/INSERT policies only (no UPDATE/DELETE). A
--   client-side delete+reinsert would fail under RLS, and adding open
--   UPDATE/DELETE policies would let any admin mutate line items of ANY invoice
--   regardless of status. A SECURITY DEFINER function with an explicit
--   status = 'draft' guard is the surgical, lowest-risk pattern — identical in
--   spirit to create_storno_invoice (20260411120000 / 20260528062000).
--
--   WHY SERVER-SIDE TOTALS:
--   The create flow (createInvoice) currently computes subtotal/tax_amount/total
--   CLIENT-SIDE via calculateInvoiceTotals (use-invoice-builder.ts) and passes
--   them as plain insert values — the database never verifies them. This RPC
--   recomputes the header from the persisted line items so a malicious or buggy
--   client cannot desync the stored total from the stored lines. This is the
--   safer, authoritative pattern going forward.
--
-- ROLLBACK
--   Not automated — revert via a new migration if needed.
-- =============================================================================

-- ── 1. Per-payer feature flag ───────────────────────────────────────────────

ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS revision_invoices_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payers.revision_invoices_enabled IS
$$Per-payer gate for re-opening DRAFT invoices in the invoice builder.
When false (default), draft invoices for this Kostenträger are not editable and
post-issue corrections must go through Stornorechnung as before. Mirrors the
existing per-payer feature-flag pattern (manual_km_enabled, reha_schein_enabled).$$;

-- ── 2. Atomic draft line-item replacement RPC ───────────────────────────────
--
-- Contract for p_line_items: a JSONB array whose element keys match the
-- invoice_line_items columns (snake_case), exactly like the array consumed by
-- create_storno_invoice. The caller (a later phase's save path) is responsible
-- for serializing builder line items into this shape; header totals are NOT
-- accepted from the caller — they are always recomputed here.

CREATE OR REPLACE FUNCTION public.replace_draft_invoice_line_items(
  p_invoice_id  UUID,
  p_line_items  JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id       UUID;
  v_status           TEXT;
  v_gross_fixed      NUMERIC := 0;  -- Σ per-line gross of gross-anchor lines
  v_price_tag_net    NUMERIC := 0;  -- Σ implied net of gross-anchor lines
  v_non_tag_subtotal NUMERIC := 0;  -- Σ net of net-anchor lines (incl. approach)
  v_tax_non_tag      NUMERIC := 0;  -- Σ per-rate-bucket rounded VAT (net-anchor)
  v_subtotal         NUMERIC := 0;
  v_total            NUMERIC := 0;
  v_tax_amount       NUMERIC := 0;
BEGIN
  -- Same admin gate as invoice RLS / create_storno_invoice.
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- why: fetch ownership + status in one shot so the guard below cannot be
  -- bypassed by a non-existent / cross-tenant invoice id.
  SELECT i.company_id, i.status
    INTO v_company_id, v_status
  FROM public.invoices i
  WHERE i.id = p_invoice_id;

  -- Company-ownership guard (multi-tenant isolation, defence in depth on top of RLS).
  IF v_company_id IS NULL
     OR v_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- IMMUTABILITY GUARD: only drafts may be edited. sent/paid/cancelled/corrected
  -- are legal documents (§14 UStG) and must be corrected via Storno, never here.
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'invoice not found or not editable (status=%)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Atomic replace: everything below runs in the function's implicit transaction,
  -- so any failure rolls back the delete + insert + totals update together.
  DELETE FROM public.invoice_line_items WHERE invoice_id = p_invoice_id;

  -- why: column list mirrors create_storno_invoice (20260528062000) so the same
  -- serialized line-item shape works for both; CHECK constraints
  -- chk_exclusion_reason_required / chk_cancelled_billing_reason_required enforce
  -- reason integrity automatically, so no extra validation is needed here.
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
    p_invoice_id,
    NULLIF(TRIM(item->>'trip_id'), '')::UUID,
    (item->>'position')::INTEGER,
    -- why: cast the ISO string straight to DATE (not via TIMESTAMPTZ) so the
    -- stored Leistungsdatum matches the client-sent date with no timezone shift.
    NULLIF(TRIM(item->>'line_date'), '')::DATE,
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
  FROM jsonb_array_elements(COALESCE(p_line_items, '[]'::JSONB)) AS item;

  -- ── Recompute header totals — faithful port of calculateInvoiceTotals ──────
  --
  -- Only billing_included = TRUE rows count toward totals (opted-out rows are
  -- kept for the PDF appendix / audit but excluded from money, exactly like the
  -- TS hook filters with billingInclusion.included).
  --
  -- MANUAL-GROSS-OVERRIDE DECISION (see docs/plans/revision-invoice-audit.md):
  -- Only gross-anchor `client_price_tag` lines are special-cased here. The TS
  -- also treats admin gross-overrides (applyGrossOverrideToResolution) as
  -- gross-fixed, but that branch is driven by the builder-only `manualGrossTotal`
  -- flag which is NOT persisted, and the only persisted signal is a human-readable
  -- German note string (too fragile to key totals on). Routing override lines
  -- through the net-anchor path yields a BIT-IDENTICAL subtotal (the line net is
  -- gross/(1+rate) either way) and differs only in total/tax_amount by at most
  -- one cent per tax-rate bucket, and only when mixed with other lines at the
  -- same rate. The exact fix (a persisted is_manual_gross_override marker) is a
  -- documented deferred item for when the save path is wired.
  WITH cls AS (
    SELECT
      COALESCE(
        NULLIF(TRIM(li.price_resolution_snapshot->>'tax_rate'), '')::NUMERIC,
        li.tax_rate,
        0
      ) AS rate,
      li.quantity AS qty,
      COALESCE(li.approach_fee_net, 0) AS approach,
      NULLIF(TRIM(li.price_resolution_snapshot->>'gross'), '')::NUMERIC AS snap_gross,
      NULLIF(TRIM(li.price_resolution_snapshot->>'net'), '')::NUMERIC AS snap_net,
      COALESCE(
        NULLIF(li.price_resolution_snapshot->>'strategy_used', ''),
        li.pricing_strategy_used
      ) AS strategy,
      li.unit_price
    FROM public.invoice_line_items li
    WHERE li.invoice_id = p_invoice_id
      AND li.billing_included = TRUE
  ),
  per_line AS (
    SELECT
      rate,
      (strategy = 'client_price_tag' AND snap_gross IS NOT NULL) AS is_gross_anchor,
      -- Gross-anchor: full per-line gross goes to `total` untouched (no bucket rounding).
      CASE WHEN strategy = 'client_price_tag' AND snap_gross IS NOT NULL
        THEN snap_gross * qty + approach * (1 + rate)
        ELSE 0 END AS gross_fixed_part,
      -- Gross-anchor implied net (kept full precision; never re-derive gross from it).
      CASE WHEN strategy = 'client_price_tag' AND snap_gross IS NOT NULL
        THEN (snap_gross * qty) / (1 + rate) + approach
        ELSE 0 END AS price_tag_net_part,
      -- Net-anchor line net (transport net from snapshot + approach), 0 for gross-anchor.
      CASE WHEN strategy = 'client_price_tag' AND snap_gross IS NOT NULL
        THEN 0
        ELSE COALESCE(snap_net, unit_price * qty, 0) + approach END AS net_anchor_line
    FROM cls
  ),
  buckets AS (
    -- Sum net per tax rate, THEN round VAT once per bucket — sum first, round last.
    SELECT rate, SUM(net_anchor_line) AS bucket_net
    FROM per_line
    WHERE NOT is_gross_anchor
    GROUP BY rate
  ),
  agg AS (
    SELECT
      COALESCE(SUM(gross_fixed_part), 0)   AS gross_fixed,
      COALESCE(SUM(price_tag_net_part), 0) AS price_tag_net,
      COALESCE(SUM(net_anchor_line), 0)    AS non_tag_subtotal
    FROM per_line
  ),
  tax AS (
    SELECT COALESCE(SUM(ROUND(bucket_net * rate, 2)), 0) AS tax_non_tag
    FROM buckets
  )
  SELECT
    agg.gross_fixed, agg.price_tag_net, agg.non_tag_subtotal, tax.tax_non_tag
  INTO v_gross_fixed, v_price_tag_net, v_non_tag_subtotal, v_tax_non_tag
  FROM agg, tax;

  -- Final rounding points mirror calculateInvoiceTotals exactly.
  v_total      := ROUND(v_non_tag_subtotal + v_tax_non_tag + v_gross_fixed, 2);
  v_subtotal   := ROUND(v_non_tag_subtotal + v_price_tag_net, 2);
  -- why: tax_amount is derived so Netto + MwSt == Brutto regardless of bucket rounding.
  v_tax_amount := ROUND(v_total - v_subtotal, 2);

  UPDATE public.invoices
  SET subtotal   = v_subtotal,
      tax_amount = v_tax_amount,
      total      = v_total,
      updated_at = now()
  WHERE id = p_invoice_id
    AND company_id = v_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft invoice totals update failed' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_draft_invoice_line_items(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_draft_invoice_line_items(UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.replace_draft_invoice_line_items(UUID, JSONB) IS
$$Atomically replaces the line items of a DRAFT invoice and recomputes header
totals server-side (faithful port of calculateInvoiceTotals; only
billing_included = true rows count). SECURITY DEFINER; requires
current_user_is_admin() and the invoice to belong to current_user_company_id()
with status = 'draft'. Caller supplies line items as a JSONB array (same shape as
create_storno_invoice); header totals are never accepted from the caller.$$;
