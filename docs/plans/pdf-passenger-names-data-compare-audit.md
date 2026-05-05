# Audit — Data compare: failing vs working appendix passenger names

**Read-only audit.** No application code changes in this document.

**Goal:** Compare real **invoice**, **line-item**, and **trip** data between a case where appendix Fahrgast names are missing vs one where they appear, and separate **Vorlage/config** effects from **snapshot/trip** effects.

**Data source:** Supabase project `etwluibddvljuhkxjkxs` (Cursor MCP `execute_sql`, read-only SELECTs). Timestamps are as returned by the database.

---

## Methodology and limitation

1. **Working example:** A **persisted** invoice with multiple trip lines and non-null `invoice_line_items.client_name` on sampled rows.
2. **Failing pattern:** This tenant’s `invoice_line_items` table has **121** trip-linked rows and **0** rows where `client_name` is null or blank (`COUNT` query below). There is **no** persisted invoice in this database that already exhibits the “— in Fahrgast” symptom on billed lines.
3. **Proxy for failing:** A **concrete trip** that is **not** on any invoice line item, with `trips.client_id IS NULL` and non-empty `trips.client_name`. From code, `buildLineItemsFromTrips` would set **`client_name: null`** for that trip; the appendix would show **—** whenever `client_name` is in `appendix_columns` (see §B.4–B.6).

Reusable SQL to find persisted failures (when they exist):

```sql
-- Invoices with at least one trip line missing passenger snapshot
SELECT i.id, i.invoice_number, i.payer_id, i.created_at
FROM invoices i
JOIN invoice_line_items ili ON ili.invoice_id = i.id
WHERE ili.trip_id IS NOT NULL
  AND (ili.client_name IS NULL OR trim(coalesce(ili.client_name, '')) = '')
GROUP BY i.id, i.invoice_number, i.payer_id, i.created_at
ORDER BY i.created_at DESC;

-- Trips that carry a display name but no Stammdaten link (predicted null snapshot today)
SELECT t.id, t.payer_id, t.client_id, t.client_name, t.billing_variant_id
FROM trips t
WHERE t.client_id IS NULL
  AND t.client_name IS NOT NULL
  AND trim(t.client_name) <> ''
  AND t.status <> 'cancelled'
ORDER BY t.scheduled_at DESC
LIMIT 20;
```

---

## Reference code (unchanged from prior audits)

**Snapshot rule — `client_name` only from embedded client, not `trips.client_name`:**

```495:521:src/features/invoices/api/invoice-line-items.api.ts
    const clientName = trip.client
      ? [trip.client.first_name, trip.client.last_name]
          .filter(Boolean)
          .join(' ')
      : null;
    ...
      client_name: clientName,
```

**Fetch does not select `trips.client_name`:**

```282:310:src/features/invoices/api/invoice-line-items.api.ts
  let query = supabase
    .from('trips')
    .select(
      `
      id,
      ...
      client:clients(id, first_name, last_name, price_tag, reference_fields)
    `
    )
```

**Appendix cell for text columns — null/blank → em dash:**

```179:183:src/features/invoices/components/invoice-pdf/pdf-column-layout.ts
function formatTextCell(raw: unknown): string {
  if (raw == null) return EM_DASH;
  const s = String(raw).trim();
  return s.length ? s : EM_DASH;
}
```

**System default appendix includes `client_name`:**

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

## Concrete examples (this tenant)

### Working — persisted invoice

| Field | Value |
|--------|--------|
| **Invoice id** | `0635e701-d1cc-4b68-a9bc-74e32d8e9036` |
| **Invoice number** | `RE-2026-05-0001` |
| **Payer id** | `0a39dde3-95ef-4bfc-b502-e3fb3afa18c0` (name **FTO**) |
| **`payers.pdf_vorlage_id`** | `null` |
| **`invoices.pdf_column_override`** | Present (`has_override: true`). Appendix keys include **`client_name`**. |
| **Effective `main_layout` (override)** | `grouped` (stored on invoice JSON) |
| **Effective `appendix_columns` (override)** | `["position","trip_date","client_name","pickup_address","dropoff_address","net_price"]` |

**Line items (sample, positions 1–5):** all rows have `client_name` = **`Oliver Staudacher`**, `billing_type_name` / `billing_variant_name` **`null`** on these rows (historical snapshot).

**Trips for those lines (same five `trip_id`s):** each has **`client_id`** = `32c84992-b9b5-444c-8891-fb08daddf62f`, **`trips.client_name`** also populated with the same string, **`clients.first_name` / `last_name`** = Oliver / Staudacher.

**Predicted appendix Fahrgast cell:** **Name visible** — `renderCellValue` reads `client_name` from the line row; value is non-null text.

---

### Failing pattern — trip-level (not on an invoice in this DB)

| Field | Value |
|--------|--------|
| **Persisted invoice** | *None in this project* with null `client_name` on trip lines (see methodology). |
| **Representative trip id** | `ccc91567-d509-4836-9554-276597208ef8` |
| **Payer id** | `cf18de74-a6b6-4f46-8d61-7862a65ea3ec` (name **RZO**) |
| **`trips.client_id`** | `null` |
| **`trips.client_name`** | `Peter Gerelts` |
| **`clients` join** | No row (`first_name` / `last_name` null) |
| **`billing_variant_id`** | `42d9b0ff-fcaa-44ca-9b47-ba2878e34373` (variant **Standard**, type **Konsil**) |

**If this trip were built into line items today:** `trip.client` is absent → **`client_name`** on the builder row would be **`null`** → persisted `invoice_line_items.client_name` would be **`null`** → for any Vorlage whose appendix lists `client_name`, **`formatTextCell`** returns **`—`**.

**Note:** This trip does **not** appear in `invoice_line_items` in the queried database; the “failing” row is **inferred from trip facts + code**, not from a stored invoice row.

---

### Payer-level trip mix (supports billing-type / payer correlation)

| Payer | Unlinked but named active trips (`client_id` null, `client_name` set) | Active trips (non-cancelled) |
|--------|------------------------------------------------------------------------|------------------------------|
| **RZO** `cf18de74-…` | **347** | 451 |
| **FTO** `0a39dde3-…` | **1** | 20 |

RZO is far more likely to appear in user reports of “names missing” when monthly scopes or Abrechnungsart filters include many of those trips — **without** any extra code path.

---

## A. Template/config comparison

### 1. Does the failing case use a different payer Vorlage or effective appendix profile than the working case?

**On this data:**

- Both **FTO** (working invoice’s payer) and **RZO** (failing-pattern trip’s payer) have **`payers.pdf_vorlage_id = null`**. Effective profile for a new invoice would fall through to **company default** or **invoice override** per `resolvePdfColumnProfile` (`src/features/invoices/lib/resolve-pdf-column-profile.ts`).
- The **working** invoice carries an **override** with explicit **`appendix_columns`** including **`client_name`**.
- For this **company** (`8df83726-cd59-4fd0-87df-0bd905915fec`), the **default Vorlage** row (`pdf_vorlagen.is_default = true`, name **ARZO**) uses **`main_layout: single_row`** and **`appendix_columns`** that **include `client_name`**.

So the **working** vs **would-be failing** contrast here is **not** “different payer Vorlage columns”: both payers lack a dedicated Vorlage id; the decisive difference for the symptom is **line-item `client_name` null vs non-null**, not a template that drops the Fahrgast column.

### 2. Is `client_name` present in `appendix_columns` for both?

**Working invoice:** Yes — override JSON lists `client_name`.

**Would-be failing PDF (same company, default Vorlage):** Yes — company default appendix includes `client_name`.

If a future invoice used a **custom** Vorlage or override that **omitted** `client_name`, the symptom would be “no Fahrgast column” / empty column set — a **different** failure mode than “— per row”.

### 3. Is template configuration enough to explain the symptom?

**Not for the “— per row” pattern** when `client_name` remains in `appendix_columns`. With the catalog key present, `renderCellValue` + `formatTextCell` explain **—** from **null/empty `client_name`** on the row (`pdf-column-layout.ts`).

---

## B. Row-data comparison

### 4. For rows where appendix shows `—`, what is stored in `invoice_line_items.client_name`?

By definition of the renderer: **null or blank** string (trimmed empty) yields **—**. There is no separate “dash” stored in the database.

This tenant had **no** such persisted line items in the global count:

```text
total line items: 121; trip lines with null/blank client_name: 0
```

### 5. For those same rows, what do `trips.client_id` and `trips.client_name` contain?

For the **proxy failing trip** `ccc91567-…`: **`client_id` null**, **`trips.client_name`** = `Peter Gerelts`.

For **working** invoice trips: **`client_id` set**, **`trips.client_name`** mirrors the linked client, **`clients.*`** present.

### 6. Are the missing-name rows exactly the ones where `client_id` is null, `trips.client_name` is populated, and joined `client` is absent?

**For the current code path: yes.** When `client_id` is null, PostgREST returns no `client` embed → `trip.client` is falsy → `clientName` in `buildLineItemsFromTrips` is **`null`**, regardless of `trips.client_name` (field not read).

The **working** rows are the opposite: **`client_id` present** and embed populated.

### 7. Counterexamples?

- **`invoice_line_items.client_name` non-null but appendix blank for Fahrgast:** Would require **`client_name` not being rendered** — e.g. column **not** in `appendix_columns`, or wrong `dataField`. With `client_name` in the profile and `dataField: 'client_name'` (`pdf-column-catalog.ts`), the renderer does not blank non-null text.
- **`trip.client` exists but snapshot missing:** Contradicts current `buildLineItemsFromTrips` for the same fetch shape unless the row was produced by a different code version, manual DB edit, or corrupted data. Not observed on the sampled working rows.

---

## C. Reproduction quality

### 8. Is the billing-type reproduction explained purely by trip population differences?

**Yes, consistent with data:** Billing filters only change **which trips** enter `buildLineItemsFromTrips`; they do not change the **formula** for `client_name`. RZO’s large share of **unlinked-but-named** trips makes filtered subsets skew toward **null** snapshots.

### 9. Does the failing payer simply have more “named but not linked” trips than the working payer?

**In this database, clearly:** **347** vs **1** for the two payers compared above.

### 10. Any evidence left of a billing-type-specific code bug after comparing real rows?

**None in this comparison.** The trip carries a normal `billing_variant_id`; the passenger gap is explained by **`client_id` null** + snapshot logic. Prior audit (`pdf-passenger-names-billing-type-scope-audit.md`) already ruled out layout/grouping coupling to `billing_type_ids`.

---

## D. Recommendation

### 11. Smallest correct fix (confirmed by trip vs working line comparison)

- **Fetch** `trips.client_name` (or equivalent) in `fetchTripsForBuilder` so it is available to `buildLineItemsFromTrips`.
- **Fallback** in `buildLineItemsFromTrips`: prefer **Stammdaten** (`trip.client` names) when present; otherwise use **trip-level** name where product/legal allows.
- **No appendix render changes** required for the “— with `client_name` column present” symptom — `InvoicePdfAppendix` / `renderCellValue` already behave correctly for non-null snapshots.

Legal/snapshot nuance (which name is authoritative) should be decided product-side before implementation; the **technical** gap is unambiguous: **`trips.client_name` is unused** while **`trip.client` is missing**.

### 12. Files to change if confirmed

- `src/features/invoices/api/invoice-line-items.api.ts` — extend `.select(...)` for trips; adjust `TripForInvoice` / builder types if needed; **`buildLineItemsFromTrips`** `clientName` derivation.
- **Tests** — builder line item when `client` embed is null but `trips.client_name` is set.

### 13. If not confirmed

If production failing rows instead showed **non-null** `invoice_line_items.client_name` but PDF still showed **—**, the next investigation would be **column profile** (missing key), **wrong `PdfColumnProfile` on the stored invoice**, or a **non–`client_name` column** mislabeled in the Vorlage — not observed on the working invoice sampled here.

---

## Senior Recommendation

This tenant’s **persisted invoices all carry non-null passenger snapshots on trip lines**, so the classic bug appears only in **trip data** that **has not** been invoiced (or in another environment). The **RZO vs FTO** payer comparison shows a **massive** difference in **unlinked-but-named** trips; that alone can explain user reports tied to **payer** and **Abrechnungsart scope** without any PDF or grouping defect. **Confirm with SQL** on production: null `invoice_line_items.client_name` vs `trips.client_name` / `trips.client_id`. The **smallest engineering fix** remains **fetch + fallback in `invoice-line-items.api.ts`**; **do not** change appendix rendering unless investigations prove a profile or key mismatch.
