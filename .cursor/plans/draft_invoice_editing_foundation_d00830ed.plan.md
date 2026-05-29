---
name: Draft invoice editing foundation
overview: Add the per-payer revision flag and a SECURITY DEFINER RPC that atomically replaces draft-invoice line items and recomputes header totals server-side (faithful port of calculateInvoiceTotals), plus a reusable ENTWURF draft watermark wired into all draft PDF render paths. No builder hydration, edit route, Bearbeiten button, or save-path integration (deferred).
todos:
  - id: migration
    content: "Create migration: add payers.revision_invoices_enabled and replace_draft_invoice_line_items SECURITY DEFINER RPC (draft-only + company guards, atomic delete+insert, server-side totals port of calculateInvoiceTotals filtered to billing_included=true). Run bun run build."
    status: completed
  - id: watermark-component
    content: Add PDF_DRAFT_WATERMARK constants + styles.draftWatermark in pdf-styles.ts; add showDraftWatermark prop (default false) and a fixed/rotated DraftWatermark rendered in every Page of InvoicePdfDocument.tsx. Run bun run build.
    status: completed
  - id: wire-watermark
    content: "Wire showDraftWatermark: invoice-pdf-preview.tsx and invoice-detail/index.tsx (status==='draft', both PDF links), use-invoice-builder-pdf-preview.tsx (unconditional true). Run bun run build."
    status: completed
  - id: docs
    content: Update docs/invoices-module.md and docs/plans/revision-invoice-audit.md; add inline why-comments to all new/changed code paths.
    status: completed
isProject: false
---

# Draft Invoice Editing Foundation (Step 1)

## Scope guard

Only: payer flag + `replace_draft_invoice_line_items` RPC + reusable `ENTWURF` watermark wired into existing draft render paths. No new status, no edit route, no Bearbeiten button, no builder hydration, no save-path call to the RPC. Non-draft PDF output stays byte-identical; watermark defaults OFF when the prop is omitted.

## Pre-coding callout (per your validation request)

- The requested approach is the lowest-risk path; no safer alternative. RPC mirrors the proven `[create_storno_invoice](supabase/migrations/20260411120000_storno_atomic_rpc.sql)` pattern instead of broadening RLS with open UPDATE/DELETE policies.
- Audit fact to document: `createInvoice` computes totals client-side (`calculateInvoiceTotals` in [use-invoice-builder.ts](src/features/invoices/hooks/use-invoice-builder.ts) L605-621) and passes them as insert values; there is no server recompute today. The RPC introduces the safer server-authoritative pattern.

## 1. Migration (new): `supabase/migrations/20260529080000_draft_invoice_editing_foundation.sql`

### 1a. Payer flag

```sql
ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS revision_invoices_enabled BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.payers.revision_invoices_enabled IS '...per-payer gate for re-opening draft invoices...';
```

### 1b. RPC `replace_draft_invoice_line_items(p_invoice_id UUID, p_line_items JSONB)` — SECURITY DEFINER

Exact signature you specified. Logic, in one transaction:

1. Auth gate: `current_user_is_admin()` else raise `42501` (same as Storno RPC).
2. Load invoice; enforce `company_id = current_user_company_id()` AND `status = 'draft'` else raise `23514` ("invoice not found or not editable"). This is the immutability guard — sent/paid/cancelled/corrected can never be edited here.
3. `DELETE FROM invoice_line_items WHERE invoice_id = p_invoice_id;`
4. `INSERT ... SELECT` from `jsonb_array_elements(p_line_items)` using the full column list from the billing-inclusion Storno insert ([20260528062000](supabase/migrations/20260528062000_invoice_line_items_billing_inclusion.sql) L160-202), including `effective_distance_km`, `original_distance_km`, `billing_included`, `is_cancelled_trip`, etc. CHECK constraints `chk_exclusion_reason_required` / `chk_cancelled_billing_reason_required` enforce reason integrity automatically.
5. Recompute header totals **server-side from the newly inserted rows** (faithful PL/pgSQL port of `calculateInvoiceTotals`, see 1c), `UPDATE invoices SET subtotal, tax_amount, total, updated_at = now()`.
6. `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated;` + `COMMENT ON FUNCTION`.

### 1c. Server-side totals (port of `calculateInvoiceTotals`) — NO fragile note matching

Recompute over inserted rows **where `billing_included = true`** (opted-out rows persist for audit but never count). Read the per-line unrounded values from `price_resolution_snapshot` JSONB (= the `frozen` resolution the TS reads), with column fallbacks for `tax_rate`/`quantity`/`approach_fee_net`.

**Manual-gross-override detection — resolved decision.** Traced every `strategy_used='manual_trip_price'` path: Taxameter P0 (`source='manual_gross_price'`), `manual_trip_price` catalog strategy (`source`=scope), manual unit-net edit (`source='trip_price'`), and the gross override (`applyGrossOverrideToResolution`, `source` inherited). All set `gross` non-null; only the override carries a distinguishing **note string** — there is **no persisted boolean/enum** for it because `lineItemToInsertRow` never persists `isManualOverride`/`manualGrossTotal`, and adding one is forbidden by the Step-1 hard rule "No changes to create flow yet". The user-proposed `gross IS NOT NULL AND strategy_used='manual_trip_price'` would over-match (catch Taxameter + unit-net + catalog cases that TS treats as net-anchor). **Therefore we do NOT special-case the manual gross override and do NOT match the note string.** Justification: classifying an override line as net-anchor yields a **bit-identical subtotal** (its net contribution is `grossTotal/(1+rate)` either way, summed unrounded before one final round) and differs from TS only in `total`/`tax_amount` by ≤1 cent per tax-rate bucket, and only when mixed with other lines at the same rate. This eliminates the fragility entirely.

Two branches:

- **Gross-anchor `client_price_tag`** (cleanly detectable: `snapshot->>'strategy_used' = 'client_price_tag' AND snapshot->>'gross' IS NOT NULL`): `grossFixed += gross*qty + approach*(1+rate)`; `priceTagNet += (gross*qty)/(1+rate) + approach`.
- **Net-anchor** (everything else, incl. manual gross overrides, Taxameter, unit-net edits, catalog rules): `baseNet = COALESCE(snapshot.net, unit_price*qty)`; accumulate `baseNet + approach` into per-`tax_rate` buckets.

Final, matching TS rounding points exactly:

- `nonTagSubtotal = Σ net-anchor (baseNet+approach)`
- `taxNonTag = Σ_bucket round(bucketNet * rate, 2)`
- `total = round(nonTagSubtotal + taxNonTag + grossFixed, 2)`
- `subtotal = round(nonTagSubtotal + priceTagNet, 2)`
- `tax_amount = round(total - subtotal, 2)`

Implement with CTEs: one pass extracting per-line classified values, then `GROUP BY tax_rate` for net-anchor buckets, then scalar aggregation. Add a why-comment documenting the override decision + ≤1-cent edge.

**Exact-parity follow-up (later phase, when save path lands):** persist an explicit `is_manual_gross_override BOOLEAN` (snapshot field or column) in the regenerated insert path and extend the RPC to route those lines through the gross-fixed branch for bit-exact `total` parity. Record in the audit doc.

**Build gate:** `bun run build`.

## 2. Watermark capability — `InvoicePdfDocument.tsx` + `pdf-styles.ts`

- In [pdf-styles.ts](src/features/invoices/components/invoice-pdf/pdf-styles.ts): add named constants `PDF_DRAFT_WATERMARK` (`fontSize`, `color` light gray, `opacity`, `rotationDeg`, `label: 'ENTWURF'`) and a `styles.draftWatermark` entry. No magic numbers.
- In [InvoicePdfDocument.tsx](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx): add `showDraftWatermark?: boolean` (default `false`) to `InvoicePdfDocumentProps`; define a local `DraftWatermark` component (absolute + `fixed` + `transform: rotate(-45deg)`, centered, non-obstructive) so it repeats on every wrapped page. Render `{showDraftWatermark && <DraftWatermark />}` as the first child inside **every** `<Page>` (cover, appendix portrait/landscape, grouped, cancelled, excluded). Default-omitted callers render identically to today.

**Build gate:** `bun run build`.

## 3. Wire watermark into draft render paths

- Preview: the route [preview/page.tsx](src/app/dashboard/invoices/[id]/preview/page.tsx) only renders `<InvoicePdfPreview/>`; the actual `InvoicePdfDocument` lives in [invoice-pdf-preview.tsx](src/features/invoices/components/invoice-pdf/invoice-pdf-preview.tsx) — wire `showDraftWatermark={invoice.status === 'draft'}` there (note the path discrepancy vs the spec table).
- Detail: [invoice-detail/index.tsx](src/features/invoices/components/invoice-detail/index.tsx) — add `showDraftWatermark={invoice.status === 'draft'}` to **both** `PDFDownloadLink` `InvoicePdfDocument` instances (Digital + Brief).
- Builder live preview: [use-invoice-builder-pdf-preview.tsx](src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx) `updatePdf(<InvoicePdfDocument .../>)` — pass `showDraftWatermark={true}` unconditionally (builder only ever previews drafts; most critical place per your note).

**Build gate:** `bun run build`.

## 4. Docs + comments (mandatory)

- [docs/invoices-module.md](docs/invoices-module.md): document `payers.revision_invoices_enabled`, the `replace_draft_invoice_line_items` RPC (draft-only guard, server-side totals, billing_included filter), and the draft watermark.
- [docs/plans/revision-invoice-audit.md](docs/plans/revision-invoice-audit.md): status update marking Phase A (schema/guards) + watermark done; record that create flow computes totals client-side while the RPC recomputes server-side; document the manual-gross-override decision (net-anchor, no note matching, subtotal exact, ≤1-cent total edge) and the exact-parity follow-up. Add a prominent **TODO: regenerate `database.types.ts` before Step 3** (Bearbeiten button reads `payers.revision_invoices_enabled`; without regen TS infers `any` and the flag check fails silently at runtime).
- Inline "why" comments on every new/changed path (RPC guards, totals branches + override decision, watermark `fixed`/rotation rationale, each wiring call site).

## Out of scope (later phases)

Line-item mapper, builder hydration from invoiceId, edit route, save-path call to the RPC, Bearbeiten button. `database.types.ts` regen for the new column is deferred this phase (no TS reads the flag yet) but is a **hard prerequisite for Step 3** — flagged as a TODO in the audit doc.



One reminder before you start: the ≤1-cent edge on total/tax_amount 

is acceptable for Step 1, but make sure the follow-up task for adding 

is_manual_gross_override as a persisted marker is written into 

docs/plans/[revision-invoice-audit.md](http://revision-invoice-audit.md) as a concrete deferred item with 

its own explanation — not just a passing comment. It must be findable 

when Step 3 is being planned.

Proceed with execution now.