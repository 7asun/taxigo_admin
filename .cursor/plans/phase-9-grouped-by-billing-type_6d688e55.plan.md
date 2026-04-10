---
name: phase-9-grouped-by-billing-type
overview: Add a fourth PDF main table layout (`grouped_by_billing_type`) that aggregates invoice cover rows by Abrechnungsart (using snapshotted `billing_variant_name` / `billing_variant_code`), without affecting non-PDF code paths.
todos:
  - id: types-mainlayout
    content: Extend `MainLayout` union + Zod enum to include `grouped_by_billing_type` in `src/features/invoices/types/pdf-vorlage.types.ts`.
    status: completed
  - id: db-check-migration
    content: Add Supabase migration to extend `pdf_vorlagen.main_layout` CHECK constraint to allow `grouped_by_billing_type`.
    status: completed
  - id: pdf-group-builder
    content: Implement `buildInvoicePdfGroupedByBillingType(lineItems)` in `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts` using `InvoicePdfSummaryRow` shape.
    status: completed
  - id: wire-invoicepdfdocument
    content: Update `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` to use the new builder when `main_layout === 'grouped_by_billing_type'`.
    status: completed
  - id: vorlage-editor-ui
    content: Add 4th layout radio option and preserve value in `handleMainLayoutChange` in `src/features/invoices/components/pdf-vorlagen/vorlage-editor-panel.tsx`.
    status: completed
  - id: docs
    content: Update `docs/invoices-module.md` to document `grouped_by_billing_type` main_layout.
    status: completed
  - id: docs-update
    content: "Update docs/invoices-module.md: add grouped_by_billing_type to main_layout table; document composite key (billing_variant + tax_rate); add future billing_type_name migration note"
    status: completed
isProject: false
---

# Phase 9 — grouped_by_billing_type main_layout

## Key constraints (as requested)

- Scope limited to **invoice PDF feature** (types, PDF builders, PDF UI, docs).
- Uses existing grouped-row type shape `InvoicePdfSummaryRow` (no new public summary row types).
- Grouping is by **snapshotted line-item fields** (no joins).
- Add DB CHECK migration for `pdf_vorlagen.main_layout` (the table has a CHECK already).

## Documentation requirement (mandatory for this phase)

Inline comments: **Every function created or modified in this phase must include JSDoc and inline comments** documenting the new behavior and the “why”, not just the “what”. Required comment targets are listed inline in the relevant steps below.

## Codebase reality check (important)

- `InvoicePdfCoverBody` does **not** choose the grouping builder; it receives `summaryItems` from `InvoicePdfDocument`.
  - Branching for layouts must therefore be wired in `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`.
- Current grouped builder `buildInvoicePdfSummary` takes the full `InvoiceDetail` (not `line_items`), because it also computes `placeHints` + direction labels.

## Design choice (matches prompt)

- Group key (composite string; label + tax rate):
  - `label = item.billing_variant_name ?? item.billing_variant_code ?? 'Unbekannt'`
  - `key = \`${label}__${item.tax_rate}`
  - This produces **one row per (Abrechnungsart, MwSt.-Satz)** combination. If the same label occurs with both 7% and 19%, it appears as **two separate rows**. This eliminates mixed-rate ambiguity without any special-case logic.
- “Billing type/family vs variant”: current snapshots only guarantee `billing_variant`_* on `InvoiceLineItemRow`; there is no `billing_type_name` on line items today, so the feature will group by **billing variant label**.

Concrete example:

Input: 80 trips “Krankenfahrt” at 7%, 4 trips “Krankenfahrt” at 19%, 32 trips “Dialyse” at 7%  
Output rows:

- Pos 1 | Krankenfahrt | 80 trips | 7%  | €4.200,00
- Pos 2 | Krankenfahrt |  4 trips | 19% |   €280,00
- Pos 3 | Dialyse      | 32 trips | 7%  |   €885,64

## Implementation outline

### 1) Types: extend `MainLayout`

- Update `MainLayout` and `mainLayoutSchema`:
  - `src/features/invoices/types/pdf-vorlage.types.ts`

### 2) DB migration: extend CHECK constraint

- Add new migration file:
  - `supabase/migrations/20260409130000_pdf_vorlagen_main_layout_billing_type.sql`
- Drop & recreate `pdf_vorlagen_main_layout_check` to allow:
  - `'grouped' | 'flat' | 'single_row' | 'grouped_by_billing_type'`

Required SQL comment block at the top of the migration:

```sql
-- Phase 9: extend main_layout CHECK to allow grouped_by_billing_type.
-- This layout groups invoice cover rows by billing variant label + tax rate.
-- One row per (Abrechnungsart, MwSt.-Satz) combination — no mixed-rate rows possible.
```

### 3) New grouped builder: `buildInvoicePdfGroupedByBillingType`

- Add new export in:
  - `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts`
- Implementation:
  - Group key:
    - `label = item.billing_variant_name ?? item.billing_variant_code ?? 'Unbekannt'`
    - `key = \`${label}__${item.tax_rate}`
    - `descriptionPrimary` stays as **label only** (e.g. “Krankenfahrt”) — the tax rate is already shown in the `tax_rate` column, so do not repeat it in the label.
  - Aggregate per group (per key):
    - `count` (trip count)
    - `total_price` (sum of `lineNetEurForPdfLineItem(item)`)
    - `approach_costs_net` (sum of `item.approach_fee_net ?? 0`)
    - `total_km` + `has_null_km` same semantics as route grouping
    - `tax_rate`: comes from the composite key (unique per group); no mixed-rate validation and no `console.warn` needed.
    - Sort order: by `firstSeen` index (preserves original line item order; same as route grouping).
  - Map to `InvoicePdfSummaryRow`:
    - `descriptionPrimary`/`description` should be the billing label
    - `from`/`to`: use a shared `EMPTY_CANONICAL_PLACE` constant (`{ key: '', primary: '', secondary: '' }`)

Required documentation comments for this step:

- `buildInvoicePdfGroupedByBillingType` — full JSDoc block must document:
  - Purpose: groups by `(billing_variant_name ?? billing_variant_code ?? 'Unbekannt') + tax_rate`
  - Why the composite key includes `tax_rate` — ensures no mixed-rate rows; each output row is always “clean”
  - Why `from`/`to` are `EMPTY_CANONICAL_PLACE` (not meaningful for billing-type groups)
  - `total_km` null semantics (null if any trip in group has null `distance_km`)
  - Future note: when `billing_type_name` is added to `invoice_line_items`, grouping key should use that field for family-level grouping (still combined with `tax_rate`)
- `EMPTY_CANONICAL_PLACE` constant — one-line comment:

```typescript
// Placeholder for grouped rows where from/to address is not meaningful (e.g. billing-type groups)
```

### 4) Wire layout in `InvoicePdfDocument`

- Update summaryItems selection in:
  - `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`
- New branch:
  - `main_layout === 'grouped_by_billing_type'` → `buildInvoicePdfGroupedByBillingType(invoice.line_items)`
  - Preserve existing:
    - `single_row` → `[buildInvoicePdfSingleRow(...)]`
    - default grouped → `buildInvoicePdfSummary(invoice).summaryItems`

Required inline comment on the new case branch:

```typescript
// grouped_by_billing_type: one summary row per Abrechnungsart + tax_rate combination
// Splitting by tax_rate ensures no mixed-rate ambiguity — each row is always clean
// Uses same InvoicePdfSummaryRow shape as grouped — no renderer changes needed
```

### 5) Settings UI: add 4th radio option

- Update:
  - `src/features/invoices/components/pdf-vorlagen/vorlage-editor-panel.tsx`
- Add radio item for `grouped_by_billing_type` with label “Nach Abrechnungsart”.
- Fix `handleMainLayoutChange` mapping:
  - currently it collapses everything except `flat`/`single_row` into `grouped`; extend to preserve `grouped_by_billing_type`.
- Column pool logic already follows:
  - `mainLayout === 'flat' ? MAIN_FLAT_COLUMNS : MAIN_GROUPED_COLUMNS`
  - so `grouped_by_billing_type` automatically uses grouped pool.

Required comment for the mapping fix:

```typescript
// Preserve grouped_by_billing_type explicitly — do not collapse into 'grouped'
// All non-flat layouts use MAIN_GROUPED_COLUMNS pool (see column pool logic below)
```

### 6) Builder Step 4 (Vorlage picker)

- Confirm logic in:
  - `src/features/invoices/components/invoice-builder/step-4-vorlage.tsx`
- It uses `inheritedMainLayout === 'flat' ? MAIN_FLAT_COLUMNS : MAIN_GROUPED_COLUMNS`, so no change needed beyond type acceptance (after Step 1).

### 7) Column catalog doc tweak (no behavioral changes)

- Optional (as per prompt): adjust column description text for grouped “description” semantics if needed, but **no flag changes** required.
  - `src/features/invoices/lib/pdf-column-catalog.ts`

### 8) Docs

- Update:
  - `docs/invoices-module.md`
- Update the `main_layout` modes table:

```
main_layout	Description
grouped	Grouped by route (Hinfahrt/Rückfahrt address pairs)
flat	One row per trip
single_row	All trips collapsed into one summary row
grouped_by_billing_type	One row per (Abrechnungsart, MwSt.-Satz) combination — if a billing type has trips at both 7% and 19%, they appear as two separate rows
```

- Add a note under the table:
  - Grouping key: `billing_variant_name ?? billing_variant_code ?? 'Unbekannt'` combined with `tax_rate`. This composite key guarantees every output row has exactly one tax rate — no approximations, no hidden mixed-rate scenarios.
  - Future path: When `billing_type_name` is added to `invoice_line_items` as a snapshotted column, the grouping key should be changed to `billing_type_name + tax_rate` to enable family-level grouping (one row per Abrechnungsfamilie per tax rate).

## Verification checklist

- UI shows 4 radio options in Vorlage editor.
- Selecting `grouped_by_billing_type`:
  - main column pool = grouped pool (no flat-only columns).
  - invoice PDF cover shows one row per distinct **(billing label, tax rate)** composite key.
  - `total_km` becomes null (rendered as `—`) if any item in that group has null `distance_km`.
  - approach + transport totals match existing Phase 8 semantics.
- `bun run build` passes.
- Migration applies cleanly (Supabase).

