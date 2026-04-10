---
name: Phase 6 PDF Vorlagen
overview: Add `pdf_vorlagen`, payer assignment, and optional per-invoice `pdf_column_override`; introduce `pdf-column-catalog.ts` as the sole column definition source; build admin UI, payer assignment, builder Step 5, and refactor the PDF stack to render main + appendix tables from a resolved `PdfColumnProfile` with a 4-level fallback chain.
todos:
  - id: 6a-migration-catalog-api
    content: Migration pdf_vorlagen + payer/invoices columns; RLS WITH CHECK; pdf-column-catalog.ts, resolve-pdf-column-profile.ts, pdf-vorlage.types.ts + Zod from VALID_COLUMN_KEYS, pdf-vorlagen.api.ts; extend InvoiceRow/InvoiceDetail/payer types
    status: completed
  - id: 6b-settings-ui
    content: settings/pdf-vorlagen page + nav; pdf-vorlagen-panel, vorlage-editor-panel, column-picker; React Query keys + invalidation
    status: completed
  - id: 6c-payer-assignment
    content: PayersService + payer-details-sheet PDF-Vorlage Select, preview line, pdf_vorlage_id on queries
    status: completed
  - id: 6d-builder-step5
    content: step-5-vorlage.tsx; index 5 sections + submit move; createInvoice pdf_column_override; draft preview + buildDraftInvoiceDetailForPdf columnProfile
    status: completed
  - id: 6e-pdf-render
    content: InvoicePdfDocument + CoverBody + Appendix dynamic tables; calcColumnWidths, getNestedValue, renderCellValue; getInvoiceDetail resolution; storno copy override; update all PDF call sites
    status: cancelled
isProject: false
---

# Phase 6 — Dynamic PDF column profiles (PDF-Vorlagen)

## Current vs target behavior

- Today, `[InvoicePdfCoverBody](src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx)` renders a **grouped route / Leistung** table from `buildInvoicePdfSummary` (`summaryItems`), and `[InvoicePdfAppendix](src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx)` uses **fixed** columns (including H/R).
- Phase 6 spec drives **per–line-item** columns via `main_columns` / `appendix_columns` and `dataField` on `[InvoiceLineItemRow](src/features/invoices/types/invoice.types.ts)`. Interpreting the spec literally means **replacing** the cover’s grouped summary **table** with a **dynamic line-items table** (letter block + totals unchanged). Totals continue to use existing line-item math (`[calculateInvoiceTotals](src/features/invoices/api/invoice-line-items.api.ts)` / existing amount helpers).
- **H/R (Richtung)** is not in the provided catalog snippet; preserve behavior by adding a **single** catalog entry in `[pdf-column-catalog.ts](src/features/invoices/lib/pdf-column-catalog.ts)` only (e.g. a `format` variant such as `direction` or a catalog-local `valueSource` union—still defined only in that file) so the renderer stays format-/catalog-driven, not per-key `if (key === …)`.

## Sub-phase 6a — DB + catalog + resolve + API


| Deliverable                                                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[supabase/migrations/20260406_pdf_vorlagen.sql](supabase/migrations/20260406_pdf_vorlagen.sql)`                     | `pdf_vorlagen` table, partial unique index on `(company_id) WHERE is_default`, `payers.pdf_vorlage_id`, `invoices.pdf_column_override`. **RLS:** Postgres `FOR ALL` with only `USING` is insufficient for `INSERT`; add `**WITH CHECK (company_id = (select …))`** (same predicate) or split policies so inserts succeed.                                                                   |
| `[src/features/invoices/lib/pdf-column-catalog.ts](src/features/invoices/lib/pdf-column-catalog.ts)`                 | Full doc block + `PDF_COLUMN_CATALOG`, `PdfColumnDef`, derived `PdfColumnKey`, `PDF_COLUMN_MAP`, `VALID_COLUMN_KEYS`, `MAIN_PAGE_COLUMNS`, `APPENDIX_COLUMNS`, `SYSTEM_DEFAULT_*`, `APPENDIX_LANDSCAPE_THRESHOLD`. **Align** JSON defaults in SQL with `SYSTEM_DEFAULT_*` (or default rows created by app)—avoid divergent “migration default” vs “code fallback” for the same concept.     |
| `[src/features/invoices/lib/resolve-pdf-column-profile.ts](src/features/invoices/lib/resolve-pdf-column-profile.ts)` | Pure `resolvePdfColumnProfile(override, payerVorlage, companyDefaultVorlage)` → `PdfColumnProfile` including `appendix_is_landscape` from `APPENDIX_LANDSCAPE_THRESHOLD`.                                                                                                                                                                                                                   |
| `[src/features/invoices/types/pdf-vorlage.types.ts](src/features/invoices/types/pdf-vorlage.types.ts)`               | `PdfVorlageRow`, create/update payloads, `PdfColumnProfile`; JSDoc per field (DB origin). **Zod** for `main_columns` / `appendix_columns` arrays: `z.enum(VALID_COLUMN_KEYS)` / `z.array(…)` imported from catalog—**no literal key lists** in this file.                                                                                                                                   |
| `[src/features/invoices/api/pdf-vorlagen.api.ts](src/features/invoices/api/pdf-vorlagen.api.ts)`                     | Mirror `[invoices.api.ts](src/features/invoices/api/invoices.api.ts)`: `createClient()`, `toQueryError()`, throw on error. Implement `list`, `get`, `getDefaultForCompany`, `create`, `update`, `delete` (delete: pre-check `payers.pdf_vorlage_id` references → throw), `setDefaultVorlage` (clear other defaults for `company_id`, then set one—sequential updates acceptable initially). |


**Types to extend (non-pricing):** `[InvoiceRow](src/features/invoices/types/invoice.types.ts)` + `[InvoiceDetail](src/features/invoices/types/invoice.types.ts)`: `pdf_column_override`; optional `**column_profile`** (resolved, not a DB column). Payer join type: `pdf_vorlage_id`. Regenerate or hand-update Supabase types if the project uses generated DB types.

## Sub-phase 6b — Settings: PDF-Vorlagen panel

- **Route:** `[src/app/dashboard/settings/pdf-vorlagen/page.tsx](src/app/dashboard/settings/pdf-vorlagen/page.tsx)` — same shell as [invoice-templates settings](src/app/dashboard/settings/invoice-templates/page.tsx): session check, `flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-6 md:p-8`.
- **Nav:** `[src/config/nav-config.ts](src/config/nav-config.ts)` — new child under settings.
- **Components:**
  - `[pdf-vorlagen-panel.tsx](src/features/invoices/components/pdf-vorlagen/pdf-vorlagen-panel.tsx)` — `[PanelList](src/components/panels/panel-list.tsx)` + search + “+ Neue Vorlage” (pattern from `[client-list-panel.tsx](src/features/clients/components/client-list-panel.tsx)`).
  - `[vorlage-editor-panel.tsx](src/features/invoices/components/pdf-vorlagen/vorlage-editor-panel.tsx)` — `[Panel](src/components/panels/panel.tsx)` / `PanelHeader` / `PanelBody` / `PanelFooter`; two `Collapsible` sections (Hauptrechnung / Anhang); **dnd-kit** sortable chips (reuse patterns from `[data-table.tsx](src/components/ui/table/data-table.tsx)` / kanban). File-level JSDoc per user spec (UX, catalog SSOT, `updatePdfVorlage` + query invalidation).
  - `[column-picker.tsx](src/features/invoices/components/pdf-vorlagen/column-picker.tsx)` — Popover + search; props `available: PdfColumnDef[]`, `onAdd(key)`; list built only from passed defs (caller passes `MAIN_PAGE_COLUMNS` or `APPENDIX_COLUMNS` filtered).
- **React Query:** add keys in `[src/query](src/query/README.md)` (e.g. `pdfVorlagen(companyId)`), invalidate on mutations.

## Sub-phase 6c — Kostenträger assignment

- **Extend** `[PayersService.updatePayer](src/features/payers/api/payers.service.ts)` (and hook args) with optional `pdf_vorlage_id`.
- **Ensure** list/detail queries select `pdf_vorlage_id` where needed (e.g. `[getPayers](src/features/payers/api/payers.service.ts)`, payer row used in `[payer-details-sheet.tsx](src/features/payers/components/payer-details-sheet.tsx)`).
- **UI:** In `PayerDetailsSheet`, add “PDF-Vorlage” `Select` bound to `listPdfVorlagen` + `updatePayer`. Comment block for **resolution chain**. Read-only preview: map selected Vorlage’s `main_columns` / `appendix_columns` through `PDF_COLUMN_MAP[key].uiLabel` (and landscape hint from length vs `APPENDIX_LANDSCAPE_THRESHOLD`).

## Sub-phase 6d — Builder Step 5

- **New:** `[step-5-vorlage.tsx](src/features/invoices/components/invoice-builder/step-5-vorlage.tsx)` — state machine per spec; shared `[column-picker](src/features/invoices/components/pdf-vorlagen/column-picker.tsx)` + same reorder UX as settings.
- **Modify:** `[index.tsx](src/features/invoices/components/invoice-builder/index.tsx)` — fifth `BuilderSectionCard`, dot navigation (5 dots), section locks: **§5 unlocks when section 4 is complete** (mirror `isInvoiceBuilderSection4Unlocked` pattern); **move submit** from Step 4 footer to Step 5 footer.
- **Modify:** `[step-4-confirm.tsx](src/features/invoices/components/invoice-builder/step-4-confirm.tsx)` — remove submit button if it currently lives there (already has `hideSubmitButton` in index for Step 4—verify wiring).
- **Guards:** extend `[invoice-builder-section-guards.ts](src/features/invoices/lib/invoice-builder-section-guards.ts)` with `isInvoiceBuilderSection5Unlocked(section4Complete)` (or inline in index with comment).
- **Data:** `[new/page.tsx](src/app/dashboard/invoices/new/page.tsx)` — extend payer select to include `pdf_vorlage_id`; prefetch or fetch `getDefaultVorlageForCompany` + `listPdfVorlagen` for Step 5 (server prefetch optional; client `useQuery` acceptable if consistent with invoice-templates).
- **Create invoice:** `[createInvoice](src/features/invoices/api/invoices.api.ts)` insert payload adds `pdf_column_override` when provided (null when unchecked). Extend `[CreateInvoicePayload](src/features/invoices/api/invoices.api.ts)` / caller in `[use-invoice-builder](src/features/invoices/hooks/use-invoice-builder.ts)` (or equivalent) without touching line-item pricing APIs.
- **Preview:** `[use-invoice-builder-pdf-preview.tsx](src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx)` + `[build-draft-invoice-detail-for-pdf.ts](src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts)` — pass **resolved** `columnProfile` from `resolvePdfColumnProfile` using Step 5 state (override / selected Vorlage rows / company default). `[InvoicePdfDocument](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx)` must receive `columnProfile`.

## Sub-phase 6e — Dynamic PDF renderer + detail + Storno -- Please excute until this point. We have to discuss this further. Implement 6a-6d

**Shared PDF utilities (new module under `invoice-pdf/`, e.g. `pdf-column-layout.ts`):**

- `getNestedValue(obj, dotPath)` — generic dot path for `trip_meta_snapshot.*`.
- `calcColumnWidths(keys, isLandscape)` — scale `defaultWidthPt` to portrait **515** / landscape **770**, clamp `minWidthPt`; return `Record<string, number>` or ordered widths for flex.
- `renderCellValue(item, col)` — **single** dispatch on `col.format` (and optional catalog-local `valueSource` if needed for net/gross/H&R); **forbidden:** `switch (col.key)`. For monetary lines, prefer feeding values already consistent with `[lineNetEurForPdfLineItem` / `lineGrossEurForPdfLineItem](src/features/invoices/components/invoice-pdf/lib/invoice-pdf-line-amounts.ts)` inside the format branch or via catalog-defined `valueSource` **only in `pdf-column-catalog.ts`**.
- **Refactor** `[InvoicePdfCoverBody](src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx)`: replace fixed summary table with dynamic header + rows over `line_items` + `columnProfile.main_columns`; keep intro, salutation, totals, payment block.
- **Refactor** `[InvoicePdfAppendix](src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx)`: dynamic columns; **Page** size/orientation from `columnProfile.appendix_is_landscape` (match [@react-pdf/renderer](https://react-pdf.org/) `Page` API—use explicit `width`/`height` for A4 landscape if needed).
- **Wire** `[InvoicePdfDocument](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx)`: required `columnProfile` prop; stop passing summary-driven table props where superseded; keep existing recipient / legal / snapshot behavior untouched.
- **Call sites:** `[invoice-detail](src/features/invoices/components/invoice-detail/index.tsx)`, `[invoice-pdf-preview.tsx](src/features/invoices/components/invoice-pdf/invoice-pdf-preview.tsx)`, builder preview hook — pass `columnProfile` from `InvoiceDetail.column_profile` or draft resolution.
- `**getInvoiceDetail`:** extend select to include `pdf_column_override`, `payer` with `pdf_vorlage_id`; after fetch, `Promise.all([getPdfVorlage(payerId), getDefaultVorlageForCompany(company_id)])` then `resolvePdfColumnProfile`; attach `detail.column_profile`.
- `**[storno.ts](src/features/invoices/lib/storno.ts)`:** on Storno insert, set `pdf_column_override: originalInvoice.pdf_column_override ?? null` (and ensure `InvoiceRow` typing includes the field).

**Styles:** `[pdf-styles.ts](src/features/invoices/components/invoice-pdf/pdf-styles.ts)` — migrate appendix/cover table from fixed `appendixCol`* widths to **inline widths** from `calcColumnWidths` where needed; avoid duplicating column metadata outside the catalog.

## Constraints checklist

- **Single source of truth:** all column keys, labels, widths, align, format live only in `[pdf-column-catalog.ts](src/features/invoices/lib/pdf-column-catalog.ts)`. Other files **import** `PDF_COLUMN_CATALOG`, `PDF_COLUMN_MAP`, `VALID_COLUMN_KEYS`, `MAIN_PAGE_COLUMNS`, `APPENDIX_COLUMNS`, `SYSTEM_DEFAULT_`*.
- **Do not modify** (per brief): `[invoice-line-items.api.ts](src/features/invoices/api/invoice-line-items.api.ts)`, invoice validators, pricing resolvers, `[tax-calculator.ts](src/features/invoices/lib/tax-calculator.ts)` (except existing imports if untouched), **existing** migrations.
- **Build:** `bun run build` and `bun run lint` clean.

## Risk / acceptance notes

- **Visual change:** Main PDF table switches from grouped routes to **flat line-item columns** per Vorlage; confirm with stakeholders that this matches product intent.
- **Defaults:** Existing data (no Vorlage, no override) must render via **system fallback** identical to current column *semantics* as far as possible (may still differ if old grouped layout is removed).

