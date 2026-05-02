# Audit: Cancelled trips — move to appendix standalone table

Read-only audit (no application code changes). Focus: current cover-body cancelled rendering, appendix invocation and grouping (“Nach Abrechnungsart”), props/data flow, KTS styling pattern, column catalog overlap with `CancelledTripRow`, PDF styles, and `main_layout` detection.

---

## Q1 — Where exactly are cancelled rows rendered today?

**File:** `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx`

**Summary:** Cancelled trips are appended as **additional `View`s using the same `mainTableKeys` / column widths as the billed Haupttabelle**, **after** the billed grouped or flat rows and **before** the totals block; they use `columnProfile.show_cancelled_trips` plus `cancelledTrips.length`, not separate boolean props (`showCancelledTrips` does not exist on the props interface).

**Props received**

- **`cancelledTrips?: CancelledTripRow[]`** — default `[]` in destructuring (lines 126, 73).
- **`showCancelledTrips`** — **not a prop**. Visibility uses `columnProfile.show_cancelled_trips` (`showCancelled` at lines 153–154).

**Location in JSX tree**

- Inside the fragment returned by `InvoicePdfCoverBody`, **after** the billed table `<View>` map (lines 201–302) **and before** `<View style={styles.totalsSection}>` (lines 402+).
- **Outside** the per-row wrappers of billed data: cancelled rows are **sibling blocks** appended to the main table sequence, sharing the **same visual table column structure** (`mainTableKeys.map`) but not nested inside billed row maps.

**Full cancelled block**

```tsx
// Lines 153–156 (visibility + TODO)
const showCancelled =
  columnProfile.show_cancelled_trips && cancelledTrips.length > 0;
// ...

// Lines 304–400
      {showCancelled
        ? cancelledTrips.map((cxRow, cidx) => (
            <View
              key={`cancelled-trip-${cxRow.id}`}
              style={[
                styles.tableRow,
                styles.cancelledTripTableRow,
                cidx === 0
                  ? {
                      borderTopWidth: 1,
                      borderTopColor: PDF_COLORS.border,
                      marginTop: 6,
                      paddingTop: 8
                    }
                  : {}
              ]}
              wrap={false}
            >
              {mainTableKeys.map((key, colIdx) => {
                const col = PDF_COLUMN_MAP[key];
                if (!col) return null;
                const w = colWidths[key] ?? col.minWidthPt;
                const raw = cancelledTripMainCell(cxRow, col);
                // ... grouped_route_leistung branch + muted multiline ...
              })}
            </View>
          ))
        : null}

      <View style={[styles.totalsSection, ...]}>
```

---

## Q2 — Appendix structure: how is it invoked?

**File:** `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`

**Summary:** **`InvoicePdfAppendix` always appears on at least one appendix `Page`** (either one page for all items, or **one page per billing-variant group** when `main_layout === 'grouped_by_billing_type'`). There is **no** dedicated boolean prop naming “Nach Abrechnungsart”; that mode is **derived from `effectiveProfile.main_layout`**.

**Rendering logic (lines 490–549)**

1. **`effectiveProfile.main_layout === 'grouped_by_billing_type'`**  
   - Computes `groups = groupLineItemsByBillingType(invoice.line_items)` (lines 493–493).  
   - **Maps each `group` to its own `<Page>`** — each renders `<InvoicePdfAppendix … groupLabel={group.label} lineItems={reindexed items} />` (lines 502–527).

2. **Else** (grouped flat cover, plain grouped, single_row, flat)  
   - **Single** `<Page>` with `<InvoicePdfAppendix … lineItems={invoice.line_items} mainLayout={effectiveProfile.main_layout} />` (lines 531–545).  
   - `mainLayout` is passed through but **`void`-ed inside the appendix component** — it does **not** change appendix table shape (see appendix file).

**Props passed into `InvoicePdfAppendix`** (every instance)

- `invoiceNumber`, `invoiceCreatedAtIso`, `lineItems`, `columnProfile`, optional `groupLabel`, optional `mainLayout`.

---

## Q3 — "Nach Abrechnungsart" appendix: what does it produce?

**Files:**  
- `InvoicePdfDocument.tsx` (pagination + `InvoicePdfAppendix` per group)  
- `invoice-pdf-appendix.tsx` (table UI)  
- `build-invoice-pdf-summary.ts` — `groupLineItemsByBillingType` (lines 459–476 in current tree)

### Grouping key

- **`groupLineItemsByBillingType`** groups line items by **human-readable variant label**, not raw `billing_type_id` FK:  
  `label = item.billing_variant_name ?? item.billing_variant_code ?? 'Unbekannt'` (lines 466–467).  
- **Separate line items appear in the appendix** under the Unterart/code label bucket; **`tax_rate` is not split** into separate appendix pages (only the Unterart/code label determines the group bucket order).

Contrast: **`buildInvoicePdfGroupedByBillingType`** (cover **Haupttabelle** summaries) uses a **composite key** `label__${tax_rate}` (lines 386–392 in `build-invoice-pdf-summary.ts`).

### Visual structure per appendix page

- **No secondary “group header row” inside the table body.** The group identity appears in the **fixed header title**:  
  `Anhang: Fahrtendetails — ${groupLabel}` when `groupLabel` is set (`invoice-pdf-appendix.tsx` lines 172–176).
- Below that: **subtitle** “Zu Rechnung {invoiceNumber}” (`notesLabel`), then **`renderTableHeader()`** (same file, lines 177–179).
- **Body:** `coercedLineItems.map((item, idx) => renderLineItemRow(item, idx))` (line 182) — flat list of trips for **that group only** on that page.

### Columns used

- **`columnProfile.appendix_columns`** (ordered keys) × **`PDF_COLUMN_MAP`** — same resolver path as portrait/landscape but **never** grouped-only catalogue entries (pickers omit them via `APPENDIX_COLUMNS`; see Q6).

### Top-level JSX of the appendix

```tsx
// invoice-pdf-appendix.tsx lines 169–183
return (
  <>
    <View style={styles.appendixHeaderFixed} fixed>
      <Text style={styles.invoiceTitle}>
        {groupLabel
          ? `Anhang: Fahrtendetails — ${groupLabel}`
          : 'Anhang: Fahrtendetails'}
      </Text>
      <Text style={styles.notesLabel}>Zu Rechnung {invoiceNumber}</Text>
      {renderTableHeader()}
    </View>

    {coercedLineItems.map((item, idx) => renderLineItemRow(item, idx))}
  </>
);
```

**Summary:** “Nach Abrechnungsart” appendix = **many pages** where each page title suffix is the Unterart/code label + table of trips in that variant bucket; grouping is **`billing_variant_name`/code-derived label**, implemented in **`InvoicePdfDocument`**, not inside `invoice-pdf-appendix.tsx`.

---

## Q4 — Existing appendix props and data flow

**File:** `src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx`

**Summary:** Appendix receives **`lineItems`** from the parent (**raw `invoice.line_items` slices**), **`columnProfile`**, **`invoiceCreatedAtIso`**, **`invoiceNumber`**, optionally **`groupLabel`** / **`mainLayout`**. It does **not** receive `cancelledTrips`, `cancelledTripRows`, `show_cancelled_trips`, or booleans thereof.

```tsx
// Lines 26–35 — full props interface
export interface InvoicePdfAppendixProps {
  invoiceNumber: string;
  invoiceCreatedAtIso: string;
  lineItems: InvoiceDetail['line_items'];
  columnProfile: PdfColumnProfile;
  /** Backward compat; grouped rendering is handled at Page level in InvoicePdfDocument. */
  mainLayout?: string;
  /** When set, shown in fixed header: "Anhang: Fahrtendetails — {groupLabel}" */
  groupLabel?: string;
}
```

**Data derivation inside appendix**

- `coercedLineItems = lineItems.map(coerceLineItemJsonbSnapshots)` (line 52).  
- Cells: `renderCellValue(item, col, { fallbackDateIso: invoiceCreatedAtIso })` (lines 110–112).

---

## Q5 — KTS per-row special case

**File:** `src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx`

**Summary:** When `item.kts_override === true`, money columns use **`appendixMoneyMuted`** and an extra **`appendixKtsNote`** (“Abgerechnet über KTS”) beneath the inner `tableRow` — pattern: conditional styling + sibling note `<View>`.

```tsx
// Lines 93–166 (essential structure)
  function renderLineItemRow(
    item: (typeof coercedLineItems)[number],
    idx: number
  ) {
    const kts = item.kts_override === true;

    return (
      <View key={item.id} style={[{ width: '100%' }, idx % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
        <View style={styles.tableRow}>
          {/* column cells — isMoney && kts ? appendixMoneyMuted */}
        </View>
        {kts ? (
          <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
            <Text style={styles.appendixKtsNote}>Abgerechnet über KTS</Text>
          </View>
        ) : null}
      </View>
    );
  }
```

This is the nearest existing precedent for **“special row subtype + muted money + explanatory sub-line”**.

---

## Q6 — Appendix columns available for cancelled rows

**File:** `src/features/invoices/lib/pdf-column-catalog.ts`

**Catalog rule:** **`APPENDIX_COLUMNS = PDF_COLUMN_CATALOG.filter((c) => !c.groupedOnly)`** (lines 434–436) — appendix cannot show grouped-only aggregates (`route_leistung`, `quantity` with aggregate semantics, trip_count, totals columns, etc.).

**Eligible keys include (non‑exhaustive; all have `appendix_only`/`flat_only` combos as marked in catalog)**

| Key | Label (German, PDF header) | Role |
|-----|---------------------------|------|
| `position` | Pos. | Sequence |
| `trip_date` | Datum | Date (`line_date`-shaped source for line rows) |
| `client_name` | Fahrgast | Passenger |
| `billing_variant` | Abrechnungsart | Variant name (`flatOnly` on main) |
| `description` | Beschreibung | Free text (`flatOnly`) |
| `pickup_address` | Von | Pickup (`address_de`) |
| `dropoff_address` | Nach | Dropoff (`address_de`) |
| `distance_km` | km | Distance (`flatOnly`) |
| `driver_name` | Fahrer | Driver (`appendixOnly`) |
| `trip_direction` | H/R | Direction (`trip_direction_pdf`) |
| `unit_price_net` | EP Netto | Unit net (`currency`, `flatOnly`) |
| `net_price` | Netto | Line net (`line_net_eur` valueSource in renderer) |
| `tax_rate` | MwSt. | Percent |
| `gross_price` | Brutto | Currency from `total_price` |
| `billing_type` | Typ | Billing type code (`flatOnly`) |
| `approach_fee_line` | Anfahrt | Approach fee (`flatOnly`) |

**Summary:** Appendix supports **date, passenger, Von/Nach, distance, monetary columns, driver, Hin/Rück**, etc.; exact visible set = **`columnProfile.appendix_columns`**, not fixed to `SYSTEM_DEFAULT_APPENDIX_COLUMNS`.

---

## Q7 — `CancelledTripRow` fields vs appendix columns

**File:** `src/features/invoices/types/invoice.types.ts` (lines 287–299)

```ts
export interface CancelledTripRow {
  id: string;
  scheduled_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  client?: { id; first_name; last_name } | null;
  driver?: { name: string | null } | null;
}
```

**Today’s cell mapper:** **`cancelled-trip-main-cells.ts`** — **`cancelledTripMainCell(row, col)`** — written for Haupttabelle `PdfColumnDef`s (also comments say “appendix rows” ambiguously lines 4–6) and branches on **`grouped_route_leistung`, `summary_quantity_x`, formats, keys.** Reused as-is for appendix keys that share catalogue definitions yields:

| Appendix-oriented column key | Populate from `CancelledTripRow`? | Notes |
|-----------------------------|-----------------------------------|-------|
| `trip_date` | **Yes** (if mapper uses date format) | Use `scheduled_at` → formatted date (`cancelledTripMainCell` case `date`). |
| `client_name` | **Yes** | `client.first_name`/`last_name` via `clientLabel`. |
| `pickup_address` / `dropoff_address` | **Yes** | `pickup_address` / `dropoff_address` Trim or `—`. |
| `description` | **Partial** | Returns `"Storniert"` for description-style keys (`cancelled-trip-main-cells.ts` lines 73–79). |
| `billing_variant` | **Partial** | Same branch can yield `"Storniert"` — **no Unterart snapshot on CancelledTripRow** → informational text, not true variant label. |
| `distance_km` | **No** | No distance on row → **`—`** via default branches. |
| `driver_name` | **Partial** | `driver?.name` if `dataField` matches `*_driver_name` heuristic (lines 80–82). Trip meta snapshot absent — best-effort. |
| `trip_direction` | **No** | **—** (`format: direction`). |
| `unit_price_net`, `net_price`, `gross_price`, `approach_fee_line` | **Policy: €0** | `format: currency` → `formatInvoicePdfEur(0)` in `cancelledTripMainCell`. |
| `tax_rate` | **No** | **—** (`percent`). |
| `billing_type` | **No** | **—** (no code on row). |
| `position` | **No** | Position column returns **—** for integer keys excluding special cases (lines 51–53). |

**Summary:** Appendix-style columns align **fairly well** where they duplicate flat trip fields (date-ish, Von/Nach, Fahrgast, driver optional). **Anything requiring billing-variant identity, billing type codes, VAT rate, Hin/Rück, km, or true line numbering** gaps to **`—`**, **€0** for money columns, or a **semantic placeholder** (“Storniert”). Implementation may generalize **`cancelledTripMainCell`** or introduce **`cancelledTripAppendixCell`** keyed to appendix column mix.

---

## Q8 — Styling constants (`pdf-styles.ts`)

**File:** `src/features/invoices/components/invoice-pdf/pdf-styles.ts`

### Section / group header (bold/shaded background)

Appendix relies on **`styles.tableHeader`** for column headers (**light gray strip + bold uppercase text**):

- `tableHeader` — `backgroundColor: '#f1f5f9'`, bordered bottom (`lines 367–374`)
- **`styles.invoiceTitle`** — appendix page title (**bold Helvetica, primary color**) (`lines 320–326`)
- **`styles.notesLabel`** — secondary muted line (“Zu Rechnung …”) (`490–493`)

There is **no** separate “billing group subtitle row inside the grid” beyond **title Text** + **`tableHeader`**.

### Muted / grey data row

- **`PDF_COLORS.muted`** — `#64748b` (`lines 23–24`) — inline and KTS appendix money
- **`styles.appendixMoneyMuted`** — `{ color: PDF_COLORS.muted }` (`416–418`)
- **`styles.tableRowAlt`** — alternating row background **`PDF_COLORS.lightGray`** (`384–386`)

Cover cancelled rows additionally use **`styles.cancelledTripTableRow`** — `backgroundColor: '#f8fafc'` (`388–391`).

### Table wrapper row

Inner row flex shell: **`styles.tableRow`** for appendix data cells (`376–382`).

### Divider between sections / blocks

Invoice-level examples (not appendix-specific):

- **`styles.secondaryLegalBlock`** — `borderTopWidth` separator (`226–229`)
- **`senderOneLineRule`** — bottom border rule (`179–184`)
- Cover cancelled first row uses **inline `borderTopWidth`, `PDF_COLORS.border`** (`invoice-pdf-cover-body.tsx`)

Appendix uses `styles.tableRow`, `styles.tableHeader`, `styles.invoiceTitle`; header block spacing uses **`styles.appendixHeaderFixed`** `{ marginBottom: 8 }` (`558–560` in `pdf-styles.ts`).

**Summary:** Closest appendix pattern to reuse for standalone cancelled subsection: **`appendixMoneyMuted`**, **`PDF_COLORS.muted`**, optional **`appendixKtsNote`-style** note for “Storniert”, plus **`invoiceTitle`/`notesLabel`/`tableHeader`** for a subsection title distinct from billed trip rows — **explicit new section header may be needed because `InvoicePdfAppendix` renders one header per page.**

---

## Q9 — `main_layout` and template detection (“Nach Abrechnungsart”)

**Files:**  
- `src/features/invoices/types/pdf-vorlage.types.ts` — `MainLayout` union (`lines 17–21`) includes **`grouped_by_billing_type`**  
- `InvoicePdfDocument.tsx` — **`effectiveProfile.main_layout`** branch (`lines 328–341` for cover summaries; `491–549` for appendix pages)

**Summary:** **“Nach Abrechnungsart”** is **`main_layout === 'grouped_by_billing_type'`** on **`PdfColumnProfile`** (from Vorlage / override / resolver). It is **not** a separate boolean or a `PdfColumnKey`. **Both** cover table aggregation **and** appendix pagination key off this value in **`InvoicePdfDocument.tsx`**; **`invoice-pdf-appendix.tsx`** itself only observes **`columnProfile`** for columns + orientation and optional **`groupLabel`** from the parent.

---

## Cursor's Recommendation

**Goal recap:** Move cancelled-trip display off the Haupttabelle; add a **standalone appendix table**, visually aligned with appendix conventions and the **Nach Abrechnungsart multi-page rhythm** where applicable.

### 1. Remove cancelled rows from `invoice-pdf-cover-body.tsx`

**Minimal:** Delete the **`showCancelled` map block** (`lines ~153–157` precondition + **`304–400`**) plus **`cancelledTrips`** from props unless still needed downstream (likely removed). Drop **`cancelledTripMainCell` import**.

**Risk:** Haupttabelle is again **billing-only visuals** until appendix work lands — UX regression if appendix block is omitted in same PR.

### 2. Add standalone cancelled table inside `invoice-pdf-appendix.tsx` (“mirror Nach Abrechnungsart group style”)

**Approach:**

- Extend **`InvoicePdfAppendixProps`** with **`cancelledTrips?: CancelledTripRow[]`** and **`showCancelledTrips` from `columnProfile.show_cancelled_trips`** passed down or inferred inside appendix from **`columnProfile`** only (prefer **explicit props** passed from **`InvoicePdfDocument`** for symmetry with **`InvoicePdfCoverBody`** and testability).

- Render **conditionally** **`columnProfile.show_cancelled_trips && cancelledTrips.length > 0`**:
  - **After** billed `renderLineItemRow` list (below last non-cancelled row), OR **prepend a spacer + title**, then **`renderTableHeader()`** reused with **same appendix column widths** (`calcColumnWidths(columnProfile.appendix_columns, landscape)`).
  - Row renderer: **`cancelledTripMainCell`** is currently tuned for **`mainTableKeys`**; either **reuse** carefully for appendix keys (**must handle `line_net_eur`/appendix renderer parity**) or **`cancelledTripAppendixCell`** duplicating appendix-specific expectations.

**“Mirror grouped_by_billing_type” nuance:**

- **`grouped_by_billing_type`** appendix is **already one page per Unterart label**. Cancelled trips **lack `billing_variant_name`** on `CancelledTripRow` today — **cannot auto-bucket** into existing groups without extra fetch fields or a **dedicated final page** (“Stornierte Fahrten”) for all cancelled rows.
- **Minimal faithful behavior:** On **each** appendix `Page`, after that page’s billed rows, append **only cancelled rows that belong to that variant** if you later extend `CancelledTripRow` with variant metadata; **otherwise** a **single extra Page** (or single global block on the last appendix page) with title **`Anhang: Stornierte Fahrten`** matching **`invoiceTitle` / `notesLabel` / `tableHeader`** patterns.

### 3. Gate visibility

**Condition:** **`effectiveProfile.show_cancelled_trips && cancelledTrips.length > 0`** — same as today’s cover guard, but evaluated in **`InvoicePdfDocument`** when passing props to **`InvoicePdfAppendix`** (avoid duplicating `columnProfile` inference in deep children inconsistently).

### Prop-threading gaps

- **`InvoicePdfDocument`** currently passes **`cancelledTrips` only to `InvoicePdfCoverBody`** (`line 484`). Appendix path must **`InvoicePdfAppendix`** receive the array on **every** appendix page instance (including **each** `grouped_by_billing_type` page) — **filtering** per `groupLabel` requires **new data** on `CancelledTripRow` or **accept all cancelled on every page** (bad) or **one dedicated page** (cleaner with current type).

- **Issued invoice** still has **`cancelledTrips === []`** until detail refetch — behavior unchanged; **TODO** remains.

### Risks / edge cases

- **Landscape vs portrait:** Appendix column widths differ; cancelled rows must use **same `landscape` flag** as billed rows on that page.
- **Fixed header:** `appendixHeaderFixed` repeats on every page; a **second “Storniert” section** may need its **own fixed mini-header** or careful pagination (react-pdf `wrap`) if long.
- **Multi-page cancelled-only:** If all line items empty (edge) — not normal for issued invoices — layout still needs a valid page; out of scope unless product demands.
- **Tests:** Update any snapshot tests tied to cover-body cancelled layout; add appendix coverage for optional section.

---

## Implemented (2026-05-01)

- **`InvoicePdfCoverBody`** no longer receives or renders cancelled rows — Haupttabelle stays billing-only.
- **`CancelledTripRow.canceled_reason_notes`** matches **`trips.canceled_reason_notes`**; **`fetchCancelledTripsForBuilder`** selects it read-only for the appendix note line.
- **`invoice-pdf-appendix.tsx`**: **`renderCancelledSection()`** (length-gated inside the component; parent passes empty array on billed pages) — helper copy *Diese Fahrten wurden storniert…*, second table with **`cancelledTripAppendixCell`**, per-row **`Storniert – kein Rechnungsbetrag`**, optional **`Stornierungsgrund:`** via **`getCanceledReasonNote`**; subsection title is not `fixed`.
- **`InvoicePdfDocument`**: **`cancelledRowsForPdf`** scopes by **`show_cancelled_trips`**; all billed **`InvoicePdfAppendix`** instances get **`cancelledTrips={[]}`**; final **`Page`** when non-empty with **`lineItems={[]}`**, **`groupLabel="Stornierte Fahrten"`**, same appendix size/styles as other appendix pages.

*Audit generated from repository state; line numbers refer to files as read at audit time.*
