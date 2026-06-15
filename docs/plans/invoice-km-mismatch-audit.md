# Invoice KM mismatch across views — audit

Read-only audit (2026-06-15). No code changes.

**Scope:** Distance / kilometre (KM) data model, how each invoice UI surface computes and displays KM, interaction with opted-out trips and branch drafts, scenario reasoning for “1 trip vs 3 trips removed” in KM totals, state/caching, invariants, and fix recommendations.

**Related docs:** [`docs/invoices-module.md`](../invoices-module.md), [`docs/manual-km-overrides.md`](../manual-km-overrides.md), [`docs/plans/invoice-trip-optout-audit.md`](./invoice-trip-optout-audit.md), [`docs/plans/excluded-trips-totals-audit.md`](./excluded-trips-totals-audit.md).

---

## 0. Business context (what went wrong)

TaxiGo invoices bill trips using **frozen line-item snapshots**. Each trip contributes distance through up to three related fields on `invoice_line_items`:

- **`distance_km`** — routing snapshot (`trips.driving_distance_km` at invoice time)
- **`effective_distance_km`** — **billed** km (manual override, client catalog override, or routing)
- **`original_distance_km`** — duplicate of routing for audit

The same invoice (or a **branch draft** after Storno) can be viewed in:

| Surface | Typical KM exposure |
|---------|---------------------|
| Invoice builder (Step 3 + live PDF preview) | Per-row km; cover **Gesamtstrecke** in PDF preview |
| Dashboard invoice detail | Per-row **km** column (no invoice total) |
| Generated PDF (digital / brief) | Cover **Strecke / Gesamtstrecke** + appendix per-trip **Strecke** |
| Invoice list | **No** KM column |

Users reported that for **the same branch draft**:

- In one view/template, KM looked like **exactly one trip** had been taken out.
- In another, KM looked like **three trips** had been taken out.
- **Overall KM totals differ** between views.

**Root cause class (from code review):** There is **no single `computeInvoiceKm()` helper**. Views disagree on (1) **which snapshot field** (`distance_km` vs `effective_distance_km`), (2) **which rows count** (all line items vs billing-included only vs cover-only excluding cancelled), and (3) **whether the builder preview pre-filters** line items before PDF generation. Together with **inherited `billing_included = false` rows on branch drafts** (see opt-out audit), this produces plausible “1 vs 3 trips” KM deltas without any live `trips` re-query.

---

## 1. Data model for distances and KM snapshots

### 1.1 Trips table — distance-related columns

Authoritative shape: `Database['public']['Tables']['trips']['Row']` in `src/types/database.types.ts` (trips table predates tracked `CREATE TABLE` migrations).

| Column | Meaning | Written by | Frozen for invoices? |
|--------|---------|------------|-------------------|
| **`driving_distance_km`** | Routing provider distance (Google Directions / cache). **SSOT routing km** on the trip. | Geocoding / `POST /api/trips/driving-metrics`, backfill scripts, trip create/update | **Never** overwritten by invoice flows; snapshotted to line items as `distance_km` + `original_distance_km` |
| **`driving_duration_seconds`** | Routing duration | Same as above | Not on invoice line items |
| **`manual_distance_km`** | Admin-confirmed billed km from a **prior** invoice save (Step 3 write-back) | `executeTripWriteBack` after invoice create/draft save when `isManualKmOverride` | Becomes input to **next** invoice’s `resolveEffectiveDistanceKm`; not read when displaying a **saved** invoice |
| **`distance` / legacy** | Older `rides` table has `distance` / `distance_km`; not used in invoice builder | — | — |

**Related (not on `trips`):**

| Object | Purpose |
|--------|---------|
| **`client_km_overrides`** | Catalog fixed km per client (+ optional payer / variant scope). Migration `20260505180000_manual_km_overrides_foundation.sql` |
| **`route_metrics_cache`** | Cached route metrics between address pairs (`20260417100000_route-metrics-cache.sql`) — feeds routing, not invoice display |

**Resolution at invoice build time** (`resolve-effective-distance.ts`):  
`manual_distance_km` → `client_km_overrides` → `driving_distance_km`.

**Trip lifecycle `status`** (`src/lib/trip-status.ts`) does not store distance. Cancelled trips are excluded from the normal builder fetch but may appear via `fetchCancelledTripsForBuilder` or as persisted `is_cancelled_trip` line items.

### 1.2 `invoice_line_items` — distance columns

| Column | Meaning | Populated from | Snapshot? |
|--------|---------|----------------|-----------|
| **`distance_km`** | `NUMERIC(8,2)` — routing snapshot at insert | `trips.driving_distance_km` in `buildLineItemsFromTrips` / hydration mapper | **Yes** — immutable after insert |
| **`effective_distance_km`** | `DOUBLE PRECISION` — km used for **pricing, VAT, PDF billed distance** | `resolveEffectiveDistanceKm(...)` at build; KM override in Step 3 updates builder state then persists on save | **Yes** |
| **`original_distance_km`** | `DOUBLE PRECISION` — routing duplicate for audit / “Google km” display | `trips.driving_distance_km` at insert | **Yes** |
| **`quantity`** | Billable **units** for pricing (often = km for per-km rules, but not guaranteed) | `price_resolution.quantity` | **Yes** — not the same as “display km” in all strategies |

**Population paths:**

- **Create:** `buildLineItemsFromTrips` → `lineItemToInsertRow` (`invoice-line-items.api.ts` L693–695, L952–954)
- **Draft save:** `replace_draft_invoice_line_items` RPC — values from client JSONB
- **Storno:** `storno.ts` copies distance fields unchanged; negates money only
- **Branch draft:** `create_branch_draft_from_invoice` copies all three columns verbatim (`20260605120200_create_branch_draft_rpc.sql`)

Line items **never JOIN** live `trips` for display. `trip_id` is informational only.

### 1.3 `invoices` header — KM aggregates

**No header-level KM fields.** `invoices` stores `subtotal`, `tax_amount`, `total` only (`InvoiceRow` in `invoice.types.ts`). KM totals exist only as **derived values** in PDF summary builders (`InvoicePdfSummaryRow.total_km`) or as manual sums over UI tables.

Header money totals are recomputed on draft save (RPC) from `billing_included = true` lines only; they are **not** recomputed from live trips.

---

## 2. How each view computes and displays KM

### Summary matrix

| View | Per-row KM field | Row filter for aggregates | Invoice-level KM total? |
|------|------------------|-------------------------|------------------------|
| **A. Builder Step 3** | `effective_distance_km` (editable) + `original_distance_km` / `distance_km` (read-only reference) | None (all positions listed) | **No** |
| **A. Builder PDF preview** | Cover: `effective_distance_km` via summary builders; flat column catalog binds to `effective_distance_km` | Cover: **billing-included normal only** (`mainCoverLineItems`); preview draft built from **pre-filtered** included normals | **Yes** — PDF cover `total_km` / grouped **Strecke** |
| **B. Detail page** | **`distance_km` only** (routing snapshot) | **None** — all `invoice.line_items` rows | **No** |
| **C. Issued / detail PDF** | Cover + appendix: **`effective_distance_km`**, fallback `distance_km` | Cover: `mainCoverLineItems`; appendix rows: `billingIncludedLineItems` (includes opted-in cancelled) | **Yes** — cover `total_km` only |
| **D. Invoice list** | — | — | **No** |

---

### A. Invoice builder (edit + create)

#### A.1 Components

| UI part | File |
|---------|------|
| Per-row KM | `step-3-line-items.tsx` — collapsed row column 1 (L697–755) |
| Live PDF preview | `use-invoice-builder-pdf-preview.tsx` → `build-draft-invoice-detail-for-pdf.ts` → `InvoicePdfDocument` |
| PDF panel | `invoice-builder-pdf-panel.tsx` |

#### A.2 Data source

- **Step 3:** In-memory `BuilderLineItem[]` from `use-invoice-builder.ts`.
  - **Edit mode:** Hydrated from `invoice_line_items` via `mapLineItemRowToBuilderLineItem` — **no** live trip distance re-fetch (only `is_wheelchair` batch).
  - **Create mode:** `buildLineItemsFromTrips` from live trips + `resolveEffectiveDistanceKm`.
- **Preview:** `includedLineItemsForDraft = billingIncludedLineItems(lineItems)` (`use-invoice-builder-pdf-preview.tsx` L267–269) passed into `buildDraftInvoiceDetailForPdf` — **opted-out normals never enter draft `invoice.line_items`**.

#### A.3 Aggregation rule (preview PDF cover)

`InvoicePdfDocument` receives draft `line_items` (already missing opted-out normals) then:

```353:353:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
  const mainLineItems = mainCoverLineItems(invoice.line_items);
```

`build-invoice-pdf-summary.ts` (grouped / single_row / grouped_by_billing_type):

```296:300:src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts
    const lineKm = item.effective_distance_km ?? item.distance_km;
    if (lineKm == null) {
      group.has_null_km = true;
    } else if (!group.has_null_km) {
      group.total_km += Number(lineKm);
```

**Filters:** `billing_included !== false` **and** `is_cancelled_trip !== true` (via `mainCoverLineItems`).

**Opted-out rows:** Still visible in Step 3 with km populated; **excluded** from preview draft line list and cover `total_km`. May appear in **Ausgeschlossene Fahrten** appendix when `show_excluded_trips` is enabled (`excludedTripsForPdf` in `invoice-builder/index.tsx`).

**No Step 3 / Step 4 footer** sums km (amount totals only).

---

### B. Invoice detail page (dashboard)

#### B.1 Component

`src/features/invoices/components/invoice-detail/index.tsx` — line items table (L312–384).

#### B.2 Data source

`useInvoiceDetail` → `getInvoiceDetail` → `invoice_line_items(*)` snapshot. **No trip JOIN.**

#### B.3 Per-row display

```338:341:src/features/invoices/components/invoice-detail/index.tsx
                    <TableCell className='text-sm'>
                      {item.distance_km !== null
                        ? `${item.distance_km.toFixed(1)}`
                        : '—'}
```

Uses **`distance_km` (routing)**, **not** `effective_distance_km` (billed).

#### B.4 Aggregation

**None.** All persisted rows render, including:

- `billing_included = false` (opted-out appendix rows)
- `is_cancelled_trip = true` (opted-in cancelled billing rows)

No footer km. Users who **mentally sum** the km column count **all rows** with routing km.

---

### C. Invoice PDF / print

#### C.1 Pipeline

`InvoicePdfDocument.tsx` → `InvoicePdfCoverBody` (cover) + `InvoicePdfAppendixPages` / `invoice-pdf-appendix.tsx` (appendix).

#### C.2 Cover table KM

| Layout | KM source |
|--------|-----------|
| **grouped / single_row / grouped_by_billing_type** | `InvoicePdfSummaryRow.total_km` from `build-invoice-pdf-summary.ts` |
| **flat** | Per-row catalog column `distance_km` → **`dataField: 'effective_distance_km'`** (`pdf-column-catalog.ts` L213–218); rows from `mainCoverLineItems(invoice.line_items)` (`invoice-pdf-cover-body.tsx` L145–147) |

**Per-line km in summaries:**

```text
lineKm = effective_distance_km ?? distance_km
```

**Cover row filter:** `mainCoverLineItems` = billing-included **and** not cancelled.

#### C.3 Appendix KM

- **Fahrtendetails:** `billingIncludedLineItems(invoice.line_items)` — **includes** opted-in cancelled trips; per-row **Strecke** uses `effective_distance_km` when column enabled.
- **Ausgeschlossene Fahrten:** No km column (date, route, reason only).
- **Passive Stornierte:** No distance column in excluded appendix block.

#### C.4 Footer amounts vs cover KM (internal inconsistency)

| Slice | Filter | Includes opted-in cancelled? |
|-------|--------|------------------------------|
| Cover `total_km` | `mainCoverLineItems` | **No** |
| Footer € totals | `billingIncludedLineItems` | **Yes** |

Cancelled trips that are **billed** contribute to **invoice gross** in the PDF footer but **not** to cover **Gesamtstrecke**. Comparing “total km on cover” with “sum of appendix Strecke lines” can disagree by exactly those cancelled rows’ km.

#### C.5 Detail download vs builder preview

Detail page uses **full** `invoice.line_items` from DB. Builder preview uses **pre-filtered** included normals in the draft object. After save, cover PDF and detail PDF share the same `InvoicePdfDocument` path — **but** the detail **HTML table** still differs (field + row set).

---

### D. Invoice list / client overview

`invoice-list-table/columns.tsx`: columns are number, payer, period, mode, status, **total €** — **no KM**.

No other invoice list KM aggregate found in `src/app/dashboard/invoices/**`.

---

## 3. Interaction with opted-out trips and branch drafts

*(Extends [`invoice-trip-optout-audit.md`](./invoice-trip-optout-audit.md).)*

### 3.1 Opted-out rows (`billing_included = false`)

| Question | Answer |
|----------|--------|
| Distance fields still populated? | **Yes** — rows persist with full `distance_km` / `effective_distance_km` / `original_distance_km` snapshots (`lineItemToInsertRow` L970–974) |
| Builder Step 3 | Row remains; km visible; controls disabled when opted out |
| Builder PDF cover `total_km` | **Excluded** (draft pre-filter + `mainCoverLineItems`) |
| Detail HTML table | **Still listed**; shows **`distance_km`** |
| PDF cover `total_km` | **Excluded** via `mainCoverLineItems` |
| PDF appendix Ausgeschlossene | Listed **without** km column |
| € totals | **Excluded** (`billingIncludedLineItems` / RPC) |

### 3.2 Branch drafts

`create_branch_draft_from_invoice` copies **`distance_km`, `effective_distance_km`, `original_distance_km`, `billing_included`** verbatim from the corrected original.

- **No** live trip re-query on edit open.
- Inherited opted-out rows keep their snapshots → **cover KM excludes them**; **detail table still lists them** with routing km.

### 3.3 Cancelled trips

| Location | KM behaviour |
|----------|----------------|
| Builder “Stornierte Fahrten” block | Live fetch (create only); passive rows default opted-out; km from trip when opted in |
| Persisted `is_cancelled_trip = true` lines | Snapshotted on insert |
| PDF cover `total_km` | **Excluded** (`mainCoverLineItems`) |
| PDF appendix Fahrtendetails | **Included** when opted in; per-row Strecke |
| PDF footer € | **Included** when opted in (`billingIncludedLineItems`) |

---

## 4. Scenario reasoning: “1 trip vs 3 trips” in KM

### Scenario 1 — Inherited opt-outs on branch draft (most likely with opt-out audit)

**Setup:** Original invoice A had **2** normal trips with `billing_included = false`. Branch draft B copies them. User opts out **1 more** trip in B.

| View | Effective “trips removed” from cover KM |
|------|----------------------------------------|
| Builder PDF preview / saved PDF cover | **3** trips’ `effective_distance_km` excluded from `total_km` |
| Detail HTML table | **3** rows still visible with km; **no** total — user may count badges or compare to memory of original |
| User expectation | “I only removed **one** in this session” → perceives **1** trip delta |

**Code paths:**

- Exclusion from cover KM: `mainCoverLineItems` → `build-invoice-pdf-summary.ts` L296–300
- Inherited flags: `create_branch_draft_from_invoice` SQL copy
- Preview pre-filter: `billingIncludedLineItems` in `use-invoice-builder-pdf-preview.tsx` L267–269

**Broken invariant:** “KM delta in this edit session = trips opted out in this session.”

---

### Scenario 2 — `distance_km` (detail) vs `effective_distance_km` (PDF)

**Setup:** Several trips have **manual KM overrides** (`effective_distance_km ≠ distance_km`).

| View | Field used |
|------|------------|
| Detail table | `distance_km` |
| PDF cover / appendix Strecke | `effective_distance_km ?? distance_km` |

**Effect:** Summing detail km column ≠ PDF `total_km` even with **identical row filters**. Difference can look like “extra trips removed” if billed km is systematically lower.

**Code paths:**

- Detail: `invoice-detail/index.tsx` L338–341
- PDF: `build-invoice-pdf-summary.ts` L296; `pdf-column-catalog.ts` L218

**Broken invariant:** “All invoice views show the same billed km per line.”

---

### Scenario 3 — Builder preview (filtered) vs detail table (all rows)

**Setup:** User edits branch draft; **unsaved** preview shows cover KM after **1** new opt-out. User opens detail in another tab (saved state) or sums **all** km cells including inherited excluded rows.

| View | Line items in KM logic |
|------|------------------------|
| Builder preview draft | `billingIncludedLineItems(lineItems)` only |
| Detail table | **All** `invoice.line_items` |

**Effect:** Detail shows **more rows with km** than cover uses → manual sum or row count suggests **more** trips “missing” from billed set.

**Code paths:**

- Preview filter: `use-invoice-builder-pdf-preview.tsx` L267–279
- Detail: `invoice-detail/index.tsx` L325 — maps **all** `invoice.line_items`

**Broken invariant:** “Builder preview and detail list the same trip set for KM purposes.”

---

### Scenario 4 — Cover `total_km` vs appendix Strecke sum (cancelled billed trips)

**Setup:** Invoice includes **opted-in cancelled** trips with non-zero km.

| Aggregate | Includes cancelled billed km? |
|-----------|----------------------------|
| Cover `total_km` | **No** |
| Sum of appendix Fahrtendetails Strecke | **Yes** |

**Effect:** Appendix sum − cover `total_km` ≈ cancelled trips’ km — can resemble “N extra trips removed” on cover only.

**Code paths:**

- Cover: `mainCoverLineItems` in `InvoicePdfDocument.tsx` L353
- Appendix: `billingIncludedLineItems` L358

**Broken invariant:** “Cover Gesamtstrecke equals sum of appendix Strecke for the same invoice.”

---

## 5. State handling and caching

### 5.1 Invoice builder

| State | Storage |
|-------|---------|
| Per-line distances | `lineItems[].effective_distance_km`, `distance_km`, `original_distance_km` in React `useState` |
| KM edits | Local `kmEditing` in `step-3-line-items.tsx`; committed via `applyKmOverride` → `use-invoice-builder.ts` |
| Preview draft | `useMemo` in `use-invoice-builder-pdf-preview.tsx`; **not** React Query |
| Edit hydration | Once via `hasHydratedRef` + `invoiceKeys.full(id)` (`staleTime: Infinity`) |

**Leak risk:** `hasHydratedRef` is not reset when `invoiceId` changes (same as opt-out audit). Safe if edit route remounts per navigation.

**Preview vs Step 3:** Preview uses **filtered** `billingIncludedLineItems`; Step 3 shows **full** `lineItems` — intentional split documented in preview hook L265–266.

### 5.2 Detail page and PDF

| Path | KM computation |
|------|----------------|
| Detail HTML | Inline `item.distance_km` — **no shared helper** |
| PDF | `mainCoverLineItems` + `build-invoice-pdf-summary.ts` / `renderCellValue` with `effective_distance_km` |
| Tests | `build-invoice-pdf-summary-inclusion.test.ts` asserts opted-out rows do not affect `total_km` |

**No** `computeInvoiceKm(invoice)` selector exists. At least **three** distinct per-row field choices: `distance_km`, `effective_distance_km`, `original_distance_km` (builder reference).

---

## 6. Invariants and recommendations

### 6.1 Proposed KM invariants

| ID | Invariant |
|----|-----------|
| **K1** | For a given invoice ID, **primary billed km total** (cover Gesamtstrecke) must use the same row filter and field everywhere it is shown. |
| **K2** | Primary total = **Σ (`effective_distance_km ?? distance_km`)** for rows with `billing_included !== false` and `is_cancelled_trip !== true`. |
| **K3** | **Never** compute invoice KM from live `trips.driving_distance_km` after insert. |
| **K4** | Per-row UI labelled “km” on detail must show **billed** km (`effective_distance_km`), not routing-only `distance_km`, unless explicitly labelled “Routing km”. |
| **K5** | Opted-out rows must not affect cover `total_km` or € totals (already intended; covered by `mainCoverLineItems` / `billingIncludedLineItems`). |
| **K6** | If appendix includes km for opted-in cancelled trips, cover total must either include them too **or** UI must label cover total as “Normalfahrten” only. |
| **K7** | Branch draft KM baseline should match user mental model (see opt-out audit Option 1 vs 2). |

### 6.2 Current status

| Invariant | Holds? | Notes |
|-----------|--------|-------|
| K1 | **No** | Detail vs PDF vs builder preview use different fields/filters |
| K2 | **Partial** | PDF cover yes; detail has no total; builder preview pre-filters before `mainCoverLineItems` |
| K3 | **Yes** | Edit hydration uses line items only |
| K4 | **No** | Detail uses `distance_km` only |
| K5 | **Yes** on PDF cover (post–`mainCoverLineItems` fix); detail still **lists** opted-out rows |
| K6 | **No** | Footer € includes cancelled billed; cover km excludes |
| K7 | **No** | Branch copies excluded rows with km snapshots |

**Note:** [`excluded-trips-totals-audit.md`](./excluded-trips-totals-audit.md) (2026-06-08) described cover KM including opted-out rows via an old `mainLineItems` filter. **Current code** uses `mainCoverLineItems` (`InvoicePdfDocument.tsx` L353). Remaining gaps are **cross-view field choice** and **detail table**, not cover inclusion of opted-out rows.

### 6.3 Fix options (no implementation)

#### Option A — Single source of truth function (recommended)

Introduce e.g. `computeInvoiceKmFromSnapshot(lineItems, scope)` in `src/features/invoices/lib/` with scopes:

- `'cover'` → `mainCoverLineItems` + Σ effective
- `'appendix_billed'` → `billingIncludedLineItems` + Σ effective
- `'detail_display'` → per-row billed km for **all** rows (with badge for opted-out)

Wire **detail table**, PDF summaries, and optional builder “Gesamt km” readout to this helper.

| Pros | Cons |
|------|------|
| One filter + field definition; fixes detail/PDF/preview drift | Touch detail UI, PDF builders, possibly add cover km to detail sidebar |
| Testable pure function | Must document cancelled-trip scope (K6) explicitly |
| Aligns with §14 snapshot law | Small migration risk: detail numbers change when `effective ≠ distance_km` |

#### Option B — Document intentional differences + UI labels

Keep multiple computations; add labels: “Routing km (Google)”, “Abgerechnete km”, “Nur eingeschlossene Fahrten”.

| Pros | Cons |
|------|------|
| Minimal code churn | Users may still mis-compare; legal PDF vs internal table stays confusing |
| Can ship copy-only fixes quickly | Does not fix branch inherited opt-out surprise |
| | Technical debt remains |

---

## Appendix — Key files

| Topic | Path |
|-------|------|
| Effective distance resolver | `src/features/invoices/lib/resolve-effective-distance.ts` |
| Line item insert snapshots | `src/features/invoices/api/invoice-line-items.api.ts` |
| Inclusion filters | `src/features/invoices/lib/billing-inclusion.ts` |
| PDF summary KM | `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts` |
| PDF column binding | `src/features/invoices/lib/pdf-column-catalog.ts` |
| PDF document filters | `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` |
| Detail table | `src/features/invoices/components/invoice-detail/index.tsx` |
| Builder Step 3 km UI | `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` |
| Preview pre-filter | `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` |
| Draft PDF adapter | `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` |
| Manual KM docs | `docs/manual-km-overrides.md` |
| Migrations | `20260505180000_manual_km_overrides_foundation.sql`, `20260331130000_create_invoice_line_items.sql` |

---

## Next steps

**Recommend Option A** with this implementation order:

1. **Quick win (detail page):** Change the km column to `effective_distance_km ?? distance_km` and add a tooltip “Abgerechnete Strecke (Snapshot)”. Optionally grey out or badge opted-out rows — still list them for audit, but do not imply they count toward billed km.

2. **Add `computeInvoiceKmFromSnapshot`** with `'cover'` scope matching `mainCoverLineItems` + effective fallback; unit tests mirroring `build-invoice-pdf-summary-inclusion.test.ts`.

3. **Detail sidebar or footer:** Show one **Gesamt km (abgerechnet)** using that helper so users do not manually sum the table.

4. **Resolve K6:** Product decision — either add cancelled billed km to cover total **or** rename cover column to “Strecke Normalfahrten” and show separate line for Stornierte.

5. **Coordinate with branch draft opt-out fix** ([`invoice-trip-optout-audit.md`](./invoice-trip-optout-audit.md) Option 1 or 2) so inherited exclusions do not inflate perceived “trips removed” without labelling.

**First diagnostic for the reported incident:** For the affected branch draft ID, run:

```sql
SELECT position, trip_id, billing_included, is_cancelled_trip,
       distance_km, effective_distance_km, original_distance_km
FROM invoice_line_items
WHERE invoice_id = '<branch-draft-id>'
ORDER BY position;
```

Compare Σ `effective_distance_km` where `billing_included` vs count of excluded rows — if 3 rows have `billing_included = false` but the user only opted out 1 in-session, Scenario 1 explains the KM delta without a live-trip bug.
