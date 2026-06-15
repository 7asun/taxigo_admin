# Invoice Templates vs Totals Helpers — Audit

**Date:** 2026-06-15  
**Scope:** How each PDF `main_layout` / Vorlage computes ANZAHL, STRECKE, BRUTTO, and MwSt; which helpers are used; design for template-agnostic totals.  
**Related:** [`invoice-totals-helper-audit.md`](invoice-totals-helper-audit.md) · [`invoice-km-behaviour.md`](../invoice-km-behaviour.md) · [`invoices-module.md`](../invoices-module.md)

**Note:** `docs/invoice-km-consistency*.md` was not found. KM invariants live in [`invoice-km-behaviour.md`](../invoice-km-behaviour.md).

---

## Executive summary

All invoice PDFs share **one document composer** (`InvoicePdfDocument.tsx`) and **one cover body** (`invoice-pdf-cover-body.tsx`). “Templates” are **`pdf_vorlagen` rows** (or per-invoice `pdf_column_override`) combining:

- **`main_layout`** — how cover rows are grouped (4 modes).
- **`main_columns` / `appendix_columns`** — which catalog columns appear.
- **Display flags** — appendix sections and optional cover KM lines.

**Cover money footer** (Netto / MwSt per rate / Brutto) is **layout-independent** and already uses `calculateInvoiceTotals` on `billingIncludedLineItems`.

**Cover table columns** differ by layout: grouped modes aggregate via `build-invoice-pdf-summary.ts`; flat mode renders raw line items. KM in grouped summaries uses `computeInvoiceLineKm`; flat/appendix `distance_km` column reads `effective_distance_km` **without** the `distance_km` fallback — a minor inconsistency.

**Recommendation:** Two helpers — (1) `computeInvoiceTotalsFromSnapshots` for invoice-level trips/km/money; (2) refactor `build-invoice-pdf-summary.ts` into `buildInvoiceSummaryForLayout` that all grouped cover modes call, sharing per-line adapters from (1). Visual output unchanged; computation unified.

---

## 1. Active PDF templates and layouts

### 1.1 Layout types (`MainLayout`)

Defined in [`pdf-vorlage.types.ts`](../../src/features/invoices/types/pdf-vorlage.types.ts):

| `main_layout` | German label (Step 4) | Cover row shape |
|---------------|----------------------|-----------------|
| `grouped` | Gruppiert (nach Route) | One row per canonical route (+ tax rate on row) |
| `flat` | Pro Fahrt | One row per included normal line item |
| `single_row` | Eine Zeile (Gesamtübersicht) | **One** aggregated row for entire invoice |
| `grouped_by_billing_type` | Nach Abrechnungsart | One row per `(billing_type_name, tax_rate)` |

**Appendix** is always **flat per trip** regardless of `main_layout`. Column set comes from `appendix_columns` only.

**Resolution chain** ([`resolve-pdf-column-profile.ts`](../../src/features/invoices/lib/resolve-pdf-column-profile.ts)): invoice override → payer Vorlage → company default → system fallback (`grouped` + 5 default columns).

### 1.2 Template flags affecting totals display

Stored in `pdf_column_override` / `PdfColumnProfile` — **display only** unless noted:

| Flag | Effect on totals |
|------|------------------|
| `show_normal_billed_km_on_cover` | Optional cover line “Gesamtstrecke” (`computeInvoiceCoverKm.normalBilledKm`) |
| `show_cancelled_billed_km_on_cover` | Optional cover line “Strecke stornierte, abgerechnete Fahrten” |
| `show_cancelled_trips` | Passive €0 cancelled trips appendix (not in money/KM totals) |
| `show_excluded_trips` | Excluded trips appendix (audit; not in money/KM totals) |
| `main_columns` | Which ANZAHL/STRECKE/BRUTTO/MwSt **columns** appear on cover — not which rows are included |
| `appendix_columns` | Per-trip appendix columns; triggers landscape when > 7 columns |

No flag changes **which rows count** toward money totals — inclusion is always `billing_inclusion.ts` + `calculateInvoiceTotals`.

### 1.3 UI entry (Step 4)

[`step-4-vorlage.tsx`](../../src/features/invoices/components/invoice-builder/step-4-vorlage.tsx): Kostenträger Vorlage inheritance, layout radio, column pickers, KM toggles, `show_cancelled_trips` / `show_excluded_trips`. Live preview via `InvoicePdfDocument` + `build-draft-invoice-detail-for-pdf.ts`.

Settings admin: `/dashboard/abrechnung/vorlagen` — same `main_layout` + column arrays persisted on `pdf_vorlagen`.

### 1.4 Document levels (all layouts)

```
Cover Page (1× A4)
├── Header (recipient, Rechnungsdaten)
├── Reference bar (optional)
├── Main table (layout-specific rows)     ← ANZAHL / STRECKE / BRUTTO / MwSt.% columns
├── Optional KM block (toggles)           ← invoice-level, not per-group
├── Money footer (always)                 ← Summe Netto, zzgl. USt per rate, Bruttobetrag
└── Payment / outro

Appendix Page(s)
├── Fahrtendetails (billingIncludedLineItems, flat columns)
│   └── grouped_by_billing_type: one page per Abrechnungsfamilie
├── Stornierte Fahrten (optional, passive €0, separate page)
└── Ausgeschlossene Fahrten (optional, no amounts, separate page)
```

**Cancelled-but-billed** rows (`is_cancelled_trip = true`, `billing_included = true`) appear in **appendix Fahrtendetails** (with amber reason), **not** on the cover Haupttabelle. They **do** count toward cover **money footer** totals.

---

## 2. Per-template computation map

### 2.0 Shared cover footer (all layouts)

| Element | Source | Filter |
|---------|--------|--------|
| Summe Nettobeträge | `calculateInvoiceTotals().subtotal` | `billingIncludedLineItems` |
| zzgl. USt {rate} | `calculateInvoiceTotals().breakdown[].tax` | Per-rate bucket rounding |
| Bruttobetrag | `calculateInvoiceTotals().total` | Same |
| Gesamtstrecke (optional) | `computeInvoiceCoverKm().normalBilledKm` | Helper-internal |
| Strecke stornierte… (optional) | `computeInvoiceCoverKm().cancelledBilledKm` | Helper-internal |

**Not** read from `invoices.subtotal` / `tax_amount` / `total` on the PDF.

---

### 2.1 `grouped` (route grouping)

**Builder:** `buildInvoicePdfSummary({ ...invoice, line_items: mainLineItems })`

**Input filter:** `mainCoverLineItems(invoice.line_items)` — included, non-cancelled only.

| Column key | Label | Computation | Helper? |
|------------|-------|-------------|---------|
| `trip_count` | Anzahl | `count += 1` per line in route group → `InvoicePdfSummaryRow.quantity` | Custom in summary builder ✓ (line count) |
| `quantity` | Menge | `renderGroupedCellValue` → `"${quantity}x"` suffix | Same field, different display |
| `total_km` | Strecke | Σ `computeInvoiceLineKm(item)` per group; `null` if any line null | **computeInvoiceLineKm** ✓ |
| `total_gross` | Gesamt brutto | Σ `lineGrossEurForPdfLineItem` → `total_costs_gross` | `invoice-pdf-line-amounts.ts` |
| `total_net` / `transport_costs` / `approach_costs` | Netto split | Σ `transportNetEurForPdfLineItem` + approach | Custom anchor-aware |
| `gross_price` | Brutto | ⚠️ On grouped rows `dataField: total_price` = **aggregated net**, not gross — catalog says use `total_gross` instead | Misleading if `gross_price` picked in Vorlage |
| `tax_rate` | MwSt. | Per-group `tax_rate` (single rate per row) | Snapshot field |
| *(no MwSt € column)* | — | Tax **amount** only in cover footer breakdown | `calculateInvoiceTotals` |

**Excluded on cover?** No — `mainCoverLineItems` excludes opted-out and cancelled rows.

---

### 2.2 `grouped_by_billing_type`

**Builder:** `buildInvoicePdfGroupedByBillingType(mainLineItems)`

Same column catalog and `InvoicePdfSummaryRow` shape as `grouped`; grouping key = `(invoicePdfBillingCategoryLabel, tax_rate)`.

| Column | vs `grouped` |
|--------|--------------|
| ANZAHL (`trip_count`) | Same: line count per billing-type group |
| STRECKE (`total_km`) | Same: `computeInvoiceLineKm` sum |
| BRUTTO / Netto | Same aggregation functions |
| Route columns | `from`/`to` empty; description = Abrechnungsfamilie name |

**Appendix:** Extra grouping — `groupLineItemsByBillingType(appendixLineItems)` → one appendix **page** per family (includes opted-in cancelled rows in that family).

---

### 2.3 `single_row`

**Builder:** `buildInvoicePdfSingleRow(mainLineItems, payer·period label)`

One `InvoicePdfSummaryRow` covering **all** main cover items.

| Column | Computation |
|--------|-------------|
| ANZAHL / `trip_count` | `count` = number of included normal line items (entire invoice) |
| STRECKE | Σ `computeInvoiceLineKm` across all main lines |
| BRUTTO / Netto | Σ across all lines (same helpers as grouped) |
| Description | Payer name + period (not route-based) |

Functionally a single-group degenerate case of grouped aggregation.

---

### 2.4 `flat` (per trip on cover)

**No summary builder** — `invoice-pdf-cover-body.tsx` maps `mainCoverLineItems` → `renderCellValue` per row.

| Column key | Label | Computation | Helper? |
|------------|-------|-------------|---------|
| *(no `trip_count`)* | — | `trip_count` is `groupedOnly` — filtered out | — |
| `quantity` | Menge | Raw `invoice_line_items.quantity` (billing units, may be km) | **Not** trip count |
| `distance_km` | km | `dataField: effective_distance_km` via `getNestedValue` | **Not** `computeInvoiceLineKm` — **no `distance_km` fallback** ⚠️ |
| `gross_price` | Brutto | `total_price` (persisted line gross) | Snapshot |
| `net_price` | Netto | `total_price / (1 + tax_rate)` via `line_net_eur` | `netEuroFromLineItemGross` |
| `tax_rate` | MwSt. | Per-line `tax_rate` (percent) | Snapshot |

**Excluded on cover?** No — `mainCoverLineItems`.

---

### 2.5 Appendix (all layouts)

**Input:** `billingIncludedLineItems(invoice.line_items)` sorted by date — includes opted-in **cancelled** rows.

| Column | Per-row source |
|--------|----------------|
| `distance_km` | `effective_distance_km` (catalog `dataField`) — same flat caveat |
| `gross_price` | `total_price` |
| `net_price` | `total_price / (1 + tax_rate)` |
| `tax_rate` | MwSt % only |
| `quantity` | Not in default appendix columns |

**Special appendix sections (separate pages):**

| Section | Rows | Amounts | KM |
|---------|------|---------|-----|
| Passive Stornierte | Live `cancelledTrips` (not snapshotted line items) | €0 informational | Route text only |
| Ausgeschlossene | `excludedTrips` from builder / future DB | None | Distance in reason block optional |

---

### 2.6 Master comparison table

| Surface | ANZAHL | STRECKE | BRUTTO (table) | MwSt (table) | Money footer |
|---------|--------|---------|----------------|--------------|--------------|
| **grouped** cover | Line count / group (`trip_count`) | Σ `computeInvoiceLineKm` | `total_gross` or ⚠️ `gross_price`=net | `tax_rate` % | `calculateInvoiceTotals` |
| **grouped_by_billing_type** | Same per Abrechnungsart group | Same | Same | Same | Same |
| **single_row** | Total line count (1 row) | Σ all main lines | Same | Same | Same |
| **flat** cover | *(no trip_count column)* / `quantity`=units | `effective_distance_km` only | `total_price` | `tax_rate` % | Same |
| **Appendix** | — | `effective_distance_km` only | `total_price` | `tax_rate` % | — |
| **Cover KM toggles** | — | `computeInvoiceCoverKm` buckets | — | — | — |

---

## 3. Helpers vs custom logic

### 3.1 Already using shared helpers

| Helper | Used where |
|--------|------------|
| `computeInvoiceLineKm` | `build-invoice-pdf-summary.ts` (all grouped modes) for `total_km` |
| `computeInvoiceCoverKm` | `InvoicePdfDocument` → cover KM toggles |
| `calculateInvoiceTotals` | `InvoicePdfDocument` cover footer (all layouts) |
| `mainCoverLineItems` / `billingIncludedLineItems` | Cover table vs appendix vs money slice |
| `lineGrossEurForPdfLineItem` | Grouped gross accumulation |
| `transportNetEurForPdfLineItem` | Grouped net accumulation |

### 3.2 Custom / divergent logic

| Location | Issue |
|----------|-------|
| **Flat + appendix `distance_km`** | Reads `effective_distance_km` only — legacy rows with null effective but set `distance_km` show `—` in flat/appendix but count in grouped `total_km` | 
| **Flat `quantity` vs grouped `trip_count`** | Same word “Anzahl” in UI labels but different semantics (billing units vs trip count) |
| **`gross_price` on grouped rows** | Resolves to **net** (`InvoicePdfSummaryRow.total_price`) — catalog documents; Vorlagen using `gross_price` in grouped mode are misleading |
| **`net_price` in appendix/flat** | Back-derive from gross — not `price_resolution_snapshot.net` (differs from grouped net column which uses `transportNetEurForPdfLineItem`) |
| **Grouped summary builders** | Three parallel loops (`buildInvoicePdfSummary`, `buildInvoicePdfSingleRow`, `buildInvoicePdfGroupedByBillingType`) with duplicated accumulation |
| **PDF persisted-row adapter** | `priceResolutionFromLineItem` inline in `InvoicePdfDocument` — duplicated from mapper pattern |

### 3.3 Template-specific custom math (acceptable)

| Template-only | Shared rules untouched |
|---------------|---------------------|
| Route canonicalization + Hinfahrt/Rückfahrt labels (`grouped`) | Per-line km/money |
| Billing-type label + sort (`grouped_by_billing_type`) | Per-line km/money |
| Single-row label string | Aggregation = sum of same per-line rules |
| `mainTableKeys` column filter (flat vs grouped catalog flags) | Row inclusion filter |
| Appendix multi-page by billing type | Per-row `renderCellValue` |

---

## 4. Template-agnostic helper strategy

### 4.1 Two helpers (recommended)

#### Helper A — `computeInvoiceTotalsFromSnapshots(lineItems)`

From [`invoice-totals-helper-audit.md`](invoice-totals-helper-audit.md):

- Invoice-level: trip counts by inclusion class, km buckets, money + per-rate tax.
- **Layout-agnostic** — one result for the whole invoice.
- Powers: cover money footer, detail sidebar, integrity tests, optional cover KM toggles (via `.km`).

**Location:** `src/features/invoices/lib/compute-invoice-totals.ts`

#### Helper B — `buildInvoiceSummaryForLayout(lineItems, layout, options?)`

```typescript
type SummaryLayout =
  | 'grouped'
  | 'grouped_by_billing_type'
  | 'single_row';

function buildInvoiceSummaryForLayout(
  lineItems: InvoiceLineItemRow[], // pre-filtered: mainCoverLineItems
  layout: SummaryLayout,
  options?: { singleRowLabel?: string }
): InvoicePdfSummaryRow[];
```

**Internal contract (all layouts):**

1. **Per-line inputs** from shared adapters:
   - `lineKm = computeInvoiceLineKm(item)`
   - `lineGross = lineGrossEurForPdfLineItem(item)`
   - `lineTransportNet = transportNetEurForPdfLineItem(item)` (extract from summary file)
2. **ANZAHL per group** = `count += 1` (never `SUM(quantity)`).
3. **STRECKE per group** = Σ lineKm with null propagation.
4. **BRUTTO per group** = Σ lineGross.
5. **Grouping only** differs:
   - `grouped` → route key
   - `grouped_by_billing_type` → billing label + tax_rate
   - `single_row` → one bucket

Refactor existing three functions into thin wrappers calling B.

**Flat layout** does not use Helper B — it renders line items directly but should use:
- `computeInvoiceLineKm(item)` for distance column (fixes fallback gap)
- `lineGrossEurForPdfLineItem` / shared net helper for money columns

**Location:** keep `build-invoice-pdf-summary.ts`; add `line-item-pdf-snapshot-amounts.ts` for shared per-line adapters if needed.

### 4.2 Wiring per template

| Template | Helper A (invoice totals) | Helper B (cover rows) | Template-specific |
|----------|---------------------------|----------------------|-------------------|
| `grouped` | Footer money + optional KM | `buildInvoiceSummaryForLayout(..., 'grouped')` | Route labels |
| `grouped_by_billing_type` | Same | `buildInvoiceSummaryForLayout(..., 'grouped_by_billing_type')` | Appendix page split |
| `single_row` | Same | `buildInvoiceSummaryForLayout(..., 'single_row', { label })` | Label string |
| `flat` | Same | — (per-row render) | Column picker only |
| Appendix | — | — | `renderCellValue` + shared per-line km/amount adapters |

### 4.3 Visual parity statement

Plugging helpers in changes **implementation only**:

- Same rows included/excluded (`mainCoverLineItems` unchanged).
- Same grouping keys and labels.
- Same column keys from Vorlagen.
- Grouped ANZAHL stays line count; flat `quantity` stays billing units (label clarification optional).
- Footer Brutto/MwSt/Netto values should match current `calculateInvoiceTotals` output (Helper A wraps it).

The only **intentional fix** visible in edge cases: flat/appendix km showing `distance_km` fallback when `effective_distance_km` is null (aligns with grouped STRECKE).

---

## 5. Template-specific edge cases

### 5.1 Cancelled trips

| Type | Cover table | Cover KM | Money footer | Appendix |
|------|-------------|----------|--------------|----------|
| Opted-in cancelled (billed) | Hidden (`mainCoverLineItems`) | `cancelledBilledKm` bucket only | Included | Fahrtendetails + reason |
| Passive cancelled (€0) | Hidden | Not in buckets | Excluded | Optional `show_cancelled_trips` page |

Helper A handles money inclusion; Helper B / flat correctly omit from cover table. **No template special-case** needed beyond existing filters.

### 5.2 Excluded trips

Never on cover table or money footer. Optional appendix via `show_excluded_trips`. Helper A can expose `excludedCount` / `excludedKm` for audit UI only.

### 5.3 `single_row`

One cover row — aggregation is sum of all main lines. Helper B with single bucket; no extra business rules.

### 5.4 Column label differences

| Catalog key | uiLabel | Risk |
|-------------|---------|------|
| `trip_count` | Anzahl Fahrten | Correct semantics (line count) |
| `quantity` (grouped) | Menge | Shows `3x` trip count |
| `quantity` (flat) | Menge | Billing units |

Helper design does not merge these — **template-only fix:** tooltip / uiLabel “Menge (Abrechnungseinheiten)” on flat.

### 5.5 System default Vorlage

`SYSTEM_DEFAULT_MAIN_COLUMNS`: `position`, `route_leistung`, `quantity`, `tax_rate`, `gross_price`.

In grouped mode `gross_price` shows **net** per group (catalog caveat). Switching to `total_gross` would be a Vorlage default change, not a helper change.

---

## 6. Cross-template invariants

| ID | Invariant | Holds today? | After helper refactor |
|----|-----------|--------------|----------------------|
| X1 | Total billed km (normal bucket) identical across layouts for same invoice | **Mostly** — flat/appendix miss `distance_km` fallback | **Yes** — use `computeInvoiceLineKm` everywhere |
| X2 | Cover money footer = sum of included rows (normal + billed cancelled) | **Yes** | **Yes** (Helper A) |
| X3 | Grouped ANZAHL = line count, not Σ quantity | **Yes** | **Yes** (Helper B) |
| X4 | Excluded rows never affect cover table or money footer | **Yes** | **Yes** |
| X5 | No live `trips` reads in PDF | **Yes** (passive cancelled appendix uses builder trip list — preview only) | **Yes** |
| X6 | All layouts agree on invoice-level Brutto/Netto/MwSt | **Yes** (shared footer) | **Yes** |
| X7 | Per-group BRUTTO in grouped table = Σ line `total_price` | **Yes** (`lineGrossEurForPdfLineItem`) | **Yes** |
| X8 | Per-group STRECKE uses same km formula as invoice KM total (for main lines) | **Yes** in grouped; **partial** in flat | **Yes** after flat fix |
| X9 | MwSt **amount** only in footer (not per-row in table) | **Yes** | **Yes** |

---

## 7. Recommendations

### 7.1 How many helpers

| Helper | Responsibility |
|--------|----------------|
| **`computeInvoiceTotalsFromSnapshots`** | Invoice-level trips, km buckets, money, per-rate tax — **one answer per invoice** |
| **`buildInvoiceSummaryForLayout`** (refactor of existing summary builders) | Cover grouped row aggregation — **same per-line rules, different group keys** |
| **`computeInvoiceLineKm`** (exists) | Per-line billed km — use in flat/appendix too |
| **Per-line amount adapters** (extract from `invoice-pdf-line-amounts.ts` + `transportNetEurForPdfLineItem`) | Shared gross/net for flat, appendix, and summary builders |

### 7.2 Where they live

```
src/features/invoices/lib/
  compute-invoice-km.ts          ← exists (K1–K7)
  compute-invoice-totals.ts      ← NEW (Helper A)
  billing-inclusion.ts           ← exists (filters)
  build-invoice-pdf-summary.ts   ← refactor to Helper B + thin exports
  invoice-pdf-line-amounts.ts    ← extend / re-export per-line adapters
```

`InvoicePdfDocument.tsx` becomes orchestration only: resolve profile → Helper B or flat rows → Helper A for footer props.

### 7.3 Migration path (no visual change)

1. Add Helper A + tests (parity with `calculateInvoiceTotals` + `computeInvoiceCoverKm`).
2. Extract per-line km/amount adapters; switch flat/appendix distance to `computeInvoiceLineKm`.
3. Refactor three summary builders into Helper B (no output change — existing tests in `build-invoice-pdf-summary*.test.ts`).
4. Replace inline `priceResolutionFromLineItem` + totals mapping in `InvoicePdfDocument` with Helper A.
5. Optional: label tweaks in `pdf-column-catalog.ts` for flat `quantity` / grouped `gross_price` documentation.

### 7.4 Confirmation

**All four `main_layout` modes and all Vorlage column combinations can switch to these helpers without changing what users see**, except:

- Legacy rows with null `effective_distance_km` may gain a km value in flat/appendix (corrective alignment with grouped STRECKE).
- No change to which trips appear on cover vs appendix vs footer.

---

## Appendix — Column catalog quick reference

Relevant keys from [`pdf-column-catalog.ts`](../../src/features/invoices/lib/pdf-column-catalog.ts):

| Key | grouped | flat | appendix | Notes |
|-----|---------|------|----------|-------|
| `trip_count` | ✓ | — | — | Integer line count |
| `quantity` | ✓ (`Nx`) | ✓ (units) | — | Different semantics |
| `total_km` | ✓ | — | — | Group aggregate |
| `distance_km` | — | ✓ | ✓ | `effective_distance_km` |
| `gross_price` | ⚠️ net on summary row | ✓ gross | ✓ gross | Use `total_gross` grouped |
| `total_gross` | ✓ | — | — | Group gross |
| `net_price` | — | ✓ | ✓ | Derived from gross |
| `tax_rate` | ✓ | ✓ | ✓ | Percent only |

---

*Audit completed 2026-06-15. No code changes made.*
