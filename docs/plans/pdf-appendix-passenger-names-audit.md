# Audit — PDF appendix sometimes misses passenger names

**Read-only audit.** No application code changes in this document.

**Symptom:** The PDF appendix (Anhang: Fahrtendetails) does not always show passenger names — sometimes they appear, sometimes they do not.

**Goal:** Trace data from trips → line items → appendix cells; distinguish missing snapshot data, Vorlage configuration, and layout/grouping effects.

---

## A. Source of passenger names

### 1. Where the passenger name is stored on invoice line items

The canonical field is **`client_name`** on `InvoiceLineItemRow` (mirrors `invoice_line_items.client_name`). It is documented as a snapshot of the passenger name at invoice creation:

```116:116:src/features/invoices/types/invoice.types.ts
  client_name: string | null; // snapshot of passenger name
```

The appendix does **not** use a separate `passenger` / `passenger_name` field for billed line items; it uses whatever column the Vorlage selects (typically catalog key `client_name` → `dataField: 'client_name'`).

Nested **`trip_meta_snapshot`** can carry driver/direction etc. (`pdf-column-layout.ts` / `trip-meta-snapshot.ts`) but **not** the primary Fahrgast label — that is **`client_name`** on the row.

### 2. Exact mapping in `invoice-line-items.api.ts`

**Builder → line item (in-memory):** `client_name` is built from the embedded **`trip.client`** (Stammdaten join) only:

```495:514:src/features/invoices/api/invoice-line-items.api.ts
    const clientName = trip.client
      ? [trip.client.first_name, trip.client.last_name]
          .filter(Boolean)
          .join(' ')
      : null;
    ...
    return {
      ...
      client_name: clientName,
```

**Persistence:** `insertLineItems` copies `item.client_name` straight onto the DB row:

```732:738:src/features/invoices/api/invoice-line-items.api.ts
    return {
      invoice_id: invoiceId,
      trip_id: item.trip_id,
      position: item.position,
      line_date: item.line_date,
      description: item.description,
      client_name: item.client_name,
```

So whatever `buildLineItemsFromTrips` computed at creation time is frozen for PDFs (§14 snapshot semantics).

### 3. Presence across invoice modes

| Mode | Typical `trip.client` | `client_name` on line item |
|------|------------------------|----------------------------|
| **`per_client`** | `fetchTripsForBuilder` uses `.eq('client_id', params.client_id)` — trips are scoped to that client; join `client:clients(...)` should populate `trip.client`. | Usually **non-null** if names exist on the client row. |
| **`monthly` / `single_trip`** | Many trips; some have `client_id` + join, some have **no** `client_id` (anonymous or “named only” on trip — see below). | **Null** whenever `trip.client` is missing, **even if** `trips.client_name` exists in the database (see §C). |

There is **no** separate code path that strips `client_name` in `invoices.api.ts` for appendix purposes; the issue is upstream snapshot construction and/or Vorlage columns.

---

## B. Appendix render path

### 4. Where the passenger name is rendered

**File:** `src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx`

Billed trips: each appendix **data row** calls `renderCellValue(item, col, …)` for every key in `columnProfile.appendix_columns`:

```103:122:src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx
  function renderLineItemRow(
    item: (typeof coercedLineItems)[number],
    idx: number
  ) {
    ...
        <View style={styles.tableRow}>
          {columnProfile.appendix_columns.map((key, colIdx) => {
            const col = PDF_COLUMN_MAP[key];
            if (!col) return null;
            ...
            const raw = renderCellValue(item, col, {
              fallbackDateIso: invoiceCreatedAtIso
            });
```

### 5. Field read for the Fahrgast cell

Catalog entry **`client_name`**:

```148:157:src/features/invoices/lib/pdf-column-catalog.ts
  {
    key: 'client_name',
    label: 'Fahrgast',
    uiLabel: 'Fahrgastname',
    description: 'Vor- und Nachname des Fahrgastes',
    dataField: 'client_name',
    ...
    format: 'text',
    flatOnly: true
  },
```

`renderCellValue` resolves `dataField` via `getNestedValue(item, col.dataField)` and formats text with **`formatTextCell`**, which turns null/empty into an em dash:

```179:183:src/features/invoices/components/invoice-pdf/pdf-column-layout.ts
function formatTextCell(raw: unknown): string {
  if (raw == null) return EM_DASH;
  const s = String(raw).trim();
  return s.length ? s : EM_DASH;
}
```

So “missing” names often present as **—** in the cell, not a missing column.

### 6. Raw vs grouped rows in the appendix

**Always `InvoiceLineItemRow[]`:** The appendix is explicitly a **flat** table over line items (comment at top of `invoice-pdf-appendix.tsx`). It does **not** use `InvoicePdfSummaryRow` for billed lines.

For **`main_layout === 'grouped_by_billing_type'`**, `InvoicePdfDocument` splits items with `groupLineItemsByBillingType` and passes **`group.items`** (still full line items; only **`position`** is renumbered per page):

```527:533:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
              <InvoicePdfAppendix
                ...
                lineItems={group.items.map((item, idx) => ({
                  ...item,
                  position: idx + 1
                }))}
```

**Grouping does not aggregate multiple trips into one appendix row** for billed line items — each trip remains its own row. Passenger names are **not** dropped by that grouping step.

---

## C. Why names appear only sometimes

### 7. Conditions for blank / em-dash Fahrgast cells

1. **`client_name` is null or whitespace** on the `InvoiceLineItemRow` → `formatTextCell` → **—**.
2. **Column not in Vorlage:** `client_name` is **not** in `columnProfile.appendix_columns` → no Fahrgast column at all (user sees no passenger column, not a dash in that column).
3. **Cancelled-trip block** (separate code path): uses `row.client` from `CancelledTripRow`, not `client_name` on line items — if `client` embed is missing, Fahrgast shows **—** (`invoice-pdf-appendix.tsx`, `cellValue` for `'fahrgast'`).

### 8. Root cause categories

| Hypothesis | Verdict |
|-------------|---------|
| Missing in **`line_items`** | **Yes — primary for many monthly invoices.** See §C.9. |
| Grouping collapses trips | **No** for billed appendix rows (each line item is one row). |
| Wrong **`dataField`** for Fahrgast | **No** — `client_name` is correct when the column is included. |
| Appendix row shape ≠ main table | **No** — same `InvoiceLineItemRow`; main grouped table uses summary rows, appendix does not. |
| Fallback suppresses values | **Partially** — `formatTextCell` replaces empty with **—**; it does not hide non-empty names. |

### 9. Critical code path: `TripForInvoice` fetch omits `trips.client_name`

`fetchTripsForBuilder` selects `client:clients(id, first_name, last_name, …)` but **does not** select the denormalized **`trips.client_name`** column:

```282:310:src/features/invoices/api/invoice-line-items.api.ts
    .select(
      `
      id,
      payer_id,
      ...
      client:clients(id, first_name, last_name, price_tag, reference_fields)
    `
    )
```

`TripForInvoice` in `invoice.types.ts` has **`client?: { … } | null`** but **no** top-level `client_name` on the trip:

```245:287:src/features/invoices/types/invoice.types.ts
export interface TripForInvoice {
  ...
  client?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    ...
  } | null;
```

Therefore `buildLineItemsFromTrips` sets `clientName` to **`null` whenever `trip.client` is falsy**, including trips that have **`client_id` null** but a non-empty **`trips.client_name`** in the database (documented pattern in `docs/trip-client-linking.md`: “Named but not registered”).

That yields **null `client_name` on line items** and thus **—** in the appendix Fahrgast column — **intermittent** depending on how trips were captured.

**Secondary cause:** Custom **Vorlagen** or invoice overrides that **omit `client_name`** from `appendix_columns` — then the column never appears (configuration, not data).

---

## D. Grouping and layout interaction

### 10. Does `build-invoice-pdf-summary.ts` drop passenger names for the appendix?

**No.** Summary builders (`buildInvoicePdfSummary`, `buildInvoicePdfGroupedByBillingType`, etc.) feed the **cover** main table only. The appendix uses **`invoice.line_items`** (or grouped slices of the same rows), not `InvoicePdfSummaryRow`.

`groupLineItemsByBillingType` only **partitions** line items; it does not map or strip `client_name`.

### 11. Preservation by main layout mode

| `main_layout` | Appendix line items | `client_name` on each row |
|---------------|---------------------|---------------------------|
| `grouped` / `flat` / `single_row` | Full `invoice.line_items` | Unchanged from DB snapshot |
| `grouped_by_billing_type` | Per-group `group.items` (same rows, renumbered `position`) | Unchanged |

### 12. Intended behavior when “many trips” share a billing group

Each trip is still **one appendix row**. There is **no** merge of passenger names into a single aggregate row for billed items. If names differ, they appear on **separate rows** — provided `client_name` is populated and the column is selected.

---

## E. Column catalog / visibility

### 13. Catalog key and `dataField` for Fahrgast

- **Key:** `client_name`
- **`dataField`:** `client_name`
- **`flatOnly: true`** (meaningful for **main** table layout filtering in `InvoicePdfCoverBody`, not for excluding the key from the appendix picker)

### 14. Appendix-specific flags

`APPENDIX_COLUMNS` includes all catalog entries **except `groupedOnly`**:

```435:438:src/features/invoices/lib/pdf-column-catalog.ts
export const APPENDIX_COLUMNS = PDF_COLUMN_CATALOG.filter(
  (c) => !c.groupedOnly
);
```

So **`client_name` remains available** for appendix pickers. There is **no** `appendixOnly` flag on `client_name` that would hide it from the appendix.

### 15. Can the appendix exclude Fahrgast by rule?

**Yes:** If the resolved profile’s **`appendix_columns`** array does not include `client_name` (custom Vorlage or Step 4 override), the Fahrgast column is not rendered. `resolvePdfColumnProfile` preserves stored key order and only **sanitizes unknown keys** — it does not auto-inject `client_name`.

System default **does** include Fahrgast:

```449:457:src/features/invoices/lib/pdf-column-catalog.ts
export const SYSTEM_DEFAULT_APPENDIX_COLUMNS: PdfColumnKey[] = [
  'position',
  'trip_date',
  'client_name',
  'pickup_address',
  'dropoff_address',
  'distance_km',
  'net_price'
];
```

---

## F. Preview vs persisted invoice

### 16. Both paths affected

Both **draft preview** and **issued PDF** use `InvoicePdfDocument` → `InvoicePdfAppendix` with the same cell resolution. If `client_name` is null on rows, both show **—**.

### 17. Draft preview data path

`build-draft-invoice-detail-for-pdf.ts` maps builder line items to `InvoiceLineItemRow` with the same `client_name` field:

```64:65:src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
    description: item.description,
    client_name: item.client_name,
```

`use-invoice-builder-pdf-preview.tsx` builds the draft via `buildDraftInvoiceDetailForPdf` and passes **`columnProfile`** from Section 4 — same appendix column logic as production.

### 18. Preview vs persisted shape mismatch for passenger names

**No intentional mismatch:** both use `InvoiceLineItemRow.client_name`. The preview reflects **current** builder line items (from `fetchTripsForBuilder` → `buildLineItemsFromTrips`); persisted invoices reflect **frozen** DB rows. If the same bug (omitting `trips.client_name` fallback) exists at creation time, **both** preview and issued PDF agree — both can show missing names.

---

## G. Existing project pattern

### 19–20. Precedent: snapshot field vs display-only join

**Closest precedent:** PDF **Abrechnungsfamilie** labels (`billing_type_name` on line items vs variant name). The grouped-by-billing-type summary previously labeled rows from **`billing_variant_name`** (often “Standard”) while the snapshot already carried **`billing_type_name`**. The fix was to **prefer the snapshotted family name** in grouping/labels (`invoicePdfBillingCategoryLabel` in `build-invoice-pdf-summary.ts`), not to change PDF layout.

**Related product doc:** `docs/trip-client-linking.md` explicitly describes trips with **`client_name` but `client_id` null** — invoice **per_client** filters exclude those trips; **monthly** includes them but the current line-item builder **does not** read `trips.client_name`.

### 21. Where to fix the passenger-name gap

| Approach | Fit |
|----------|-----|
| **Line-item snapshot** — include `trips.client_name` in fetch + fallback in `buildLineItemsFromTrips` when `trip.client` is null | **Strong — smallest semantic fix**; aligns with `trip-client-linking.md`; does not change PDF layout. |
| Appendix row derivation | **Not needed** — rows are already per line item. |
| Column mapping | **Only** if problem is Vorlagen without `client_name` — document/UX, not code bug. |
| Grouping semantics | **N/A** for billed appendix. |

---

## H. Recommendation

### 22. Bug classification

**Combination:**

- **Line-item snapshot bug (primary):** Builder fetch + `buildLineItemsFromTrips` ignore **`trips.client_name`** when there is no `client` embed → **`client_name` null** on line items for valid “named but not linked” trips.
- **Column visibility (secondary):** Some Vorlagen/overrides may omit **`client_name`** from `appendix_columns` — looks like “missing names” but is configuration.

Not a **summary/grouping** bug for the billed appendix. Not a **wrong `dataField`** for the default Fahrgast column.

### 23. Smallest safe fix (conceptual — not implemented in this audit)

1. **Extend `fetchTripsForBuilder`** `select` to include **`client_name`** (trips table).
2. **Extend `TripForInvoice`** with optional **`client_name: string | null`**.
3. **In `buildLineItemsFromTrips`**, set  
   `clientName = trip.client ? [first, last].join(' ') : (trip.client_name?.trim() || null)`  
   with a short `// why` (denormalized name for unlinked passengers per `trip-client-linking.md`).
4. Optionally **backfill** is out of scope for “smallest” — new invoices improve immediately; old rows stay as stored unless migrated.

No change to appendix JSX or grouping required for the primary case.

**Optional hardening:** Warn in Vorlage editor if `appendix_columns` omits `client_name` when `main_layout` is monthly (product/UX).

### 24. Files that would change for that fix

| File | Change |
|------|--------|
| `src/features/invoices/api/invoice-line-items.api.ts` | Add `client_name` to trips `select`; fallback in `buildLineItemsFromTrips`. |
| `src/features/invoices/types/invoice.types.ts` | Add `client_name?` on `TripForInvoice` if not already present. |
| Tests | Unit test: trip with `client: null`, `client_name: 'Max M.'` → line item `client_name` populated. |
| `docs/trip-client-linking.md` or `docs/invoices-module.md` | One sentence: invoice line items snapshot `trips.client_name` when no `client_id`. |

---

## Senior Recommendation

Treat the intermittent appendix Fahrgast gaps as **primarily a data completeness bug in the line-item snapshot pipeline**, not as an appendix rendering or grouping defect. The appendix already reads **`client_name`** correctly when the column is enabled; **`formatTextCell`** only masks nulls as **—**. The fetch for invoice trips never loads **`trips.client_name`**, and **`buildLineItemsFromTrips`** only derives the name from the **`clients`** embed — so any trip that is “named but not registered” (`client_id` null, `client_name` non-null) will **always** produce a blank Fahrgast cell until the fetch and mapping are extended. **Secondary:** educate or lint Vorlagen that drop **`client_name`** from **`appendix_columns`**. Implementing the **`trips.client_name`** fallback is the smallest change that preserves layout semantics and matches documented trip states.
