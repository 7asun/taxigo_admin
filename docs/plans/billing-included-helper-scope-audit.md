# Audit: Full Scope for `billingIncludedLineItems` Helper

**Scope:** Read-only inventory of every billing-inclusion filter, type mapping, missing filter, test gap, and intentional exclusion from the rule — to inform a shared helper design.  
**Date:** 2026-06-08  
**Prerequisite:** [`excluded-trips-totals-audit.md`](./excluded-trips-totals-audit.md) (confirmed `mainLineItems` gap in `InvoicePdfDocument.tsx`).

---

## Executive summary

The codebase uses **two representations** of the same rule:

| Layer | Field | Typical predicate |
|-------|-------|-------------------|
| Builder (runtime) | `billingInclusion.included: boolean` | `.filter(i => i.billingInclusion.included)` — **strict truthy** |
| Persisted / PDF / DB | `billing_included?: boolean` | `.filter(li => li.billing_included !== false)` or `?? true` — **loose** (null/undefined → included) |

There are **~15 production filter/branch sites** in `src/features/invoices/` plus **3 SQL sites**. The confirmed bug is not the only gap: **`mainLineItems`**, **`invoice-pdf-cover-body` flat layout**, and several **UI count displays** consume unfiltered lists.

**Critical design insight:** “Billing included” is **not one slice** for all consumers. The code needs at least **two derived lists**:

1. **Billable for money** — `billing_included !== false` (includes opted-in cancelled trips in footer totals / appendix Fahrtendetails).
2. **Main cover table (Haupttabelle)** — billing-included **and** `!is_cancelled_trip` (excludes opted-out normals **and** all cancelled rows from cover summary/flat table).

A single helper named `billingIncludedLineItems` is necessary but **not sufficient** unless paired with a second helper (e.g. `mainCoverLineItems`) or a composable predicate.

---

## 1. Every inline billing inclusion filter site

Search covered: `src/`, `supabase/migrations/` for `billing_included`, `billingInclusion.included`, `billingInclusion?.included`, and inverse filters.

### 1a. Persisted representation — `billing_included`

| File | Line | Expression | Direction | Purpose |
|------|------|------------|-----------|---------|
| `InvoicePdfDocument.tsx` | 357 | `(li) => li.billing_included !== false` | **INCLUDED** | `appendixLineItems` (Fahrtendetails appendix) |
| `InvoicePdfDocument.tsx` | 367 | `(li) => li.billing_included !== false` | **INCLUDED** | `lineItemsForCalc` → PDF footer totals |
| `InvoicePdfDocument.tsx` | 398 | `included: li.billing_included ?? true` | Map (not filter) | Rehydrate `billingInclusion` when mapping to `BuilderLineItem` shape for `calculateInvoiceTotals` |
| `map-line-item-row-to-builder-line-item.ts` | 180 | `included: row.billing_included ?? true` | Map (not filter) | Edit-mode hydration → `billingInclusion` |
| `build-draft-invoice-detail-for-pdf.ts` | 100 | `billing_included: item.billingInclusion?.included ?? true` | Serialize (not filter) | Draft row snapshot from builder |
| `build-draft-invoice-detail-for-pdf.ts` | 182 | `billing_included: true` | Constant | Opted-in cancelled draft rows (always billed when persisted) |
| `supabase/migrations/20260529080000_draft_invoice_editing_foundation.sql` | 189 | `AND li.billing_included = TRUE` | **INCLUDED** | Server-side totals recompute in `replace_draft_invoice_line_items` RPC |
| `supabase/migrations/20260530120000_controlling_rpcs.sql` | 383 | `COALESCE(ili.billing_included, true) = true` | **INCLUDED** | Controlling/revenue aggregation |
| `supabase/migrations/20260528062000_invoice_line_items_billing_inclusion.sql` | 148, 196 | `COALESCE((item->>'billing_included')::BOOLEAN, TRUE)` | Default on insert | Storno line-item copy — missing JSON key → included |

**Not a filter but writes inclusion:**

| File | Line | Expression | Purpose |
|------|------|------------|---------|
| `invoice-line-items.api.ts` | 971–974 | `billing_included: item.billingInclusion.included` + conditional exclusion reason | Persist normal rows (included **and** excluded) |
| `invoice-line-items.api.ts` | 1052 | `billing_included: true` | Persist opted-in cancelled rows |

### 1b. Builder representation — `billingInclusion.included`

| File | Line | Expression | Direction | Purpose |
|------|------|------------|-----------|---------|
| `use-invoice-builder-pdf-preview.tsx` | 298 | `lineItems.filter((li) => li.billingInclusion.included)` | **INCLUDED** | `includedLineItemsForDraft` → draft PDF |
| `use-invoice-builder.ts` | 901 | `lineItems.filter((i) => i.billingInclusion.included)` | **INCLUDED** | `includedNormal` → `calculateInvoiceTotals` |
| `use-invoice-builder.ts` | 903 | `cancelledTrips.filter((c) => c.billingInclusion.included && c.price_resolution != null)` | **INCLUDED** (+ priced) | Opted-in cancelled → totals / create / update |
| `use-invoice-builder.ts` | 918 | `lineItems.filter((i) => !i.billingInclusion.included)` | **EXCLUDED** | `excludedTripCount` |
| `use-invoice-builder.ts` | 981, 1061 | Same as L903 | **INCLUDED** (+ priced) | `createMutation` / `updateMutation` cancelled rows |
| `index.tsx` | 416 | `.filter((li) => !li.billingInclusion.included)` | **EXCLUDED** | `excludedTripsForPdf` appendix payload |
| `index.tsx` | 430 | `cancelledTrips.filter((t) => t.billingInclusion.included)` | **INCLUDED** | `billedCancelledTripsForPdf` |
| `index.tsx` | 435 | `cancelledTrips.filter((t) => !t.billingInclusion.included)` | **EXCLUDED** | `passiveCancelledTripsForPdf` |
| `trip-write-back.ts` | 62 | `item.trip_id !== null && item.billingInclusion.included` | **INCLUDED** | Trip price write-back after save |
| `invoice-validators.ts` | 110 | `!item.billingInclusion.included && reason.trim().length === 0` | **EXCLUDED** (validation) | Gate Step 3 “Weiter” when reason missing |
| `invoice-validators.ts` | 124 | `c.billingInclusion.included && reason.trim().length === 0` | **INCLUDED** (validation) | Gate when opted-in cancelled lacks billing reason |

### 1c. Branch / UI reads (not array filters)

| File | Line | Expression | Purpose |
|------|------|------------|---------|
| `step-3-line-items.tsx` | 563 | `!item.billingInclusion.included` | `isOptedOut` styling / badge |
| `step-3-line-items.tsx` | 589 | `checked={item.billingInclusion.included}` | Inclusion checkbox |
| `step-3-line-items.tsx` | 1269 | `trip.billingInclusion.included` | Cancelled-trip section opt-in state |
| `use-invoice-builder-pdf-preview.tsx` | 94, 105 | `r.billingInclusion.included ? 1 : 0` | Category B dirty hash (not filtering) |

### 1d. Default / initialization (not filters)

| File | Line | Value | Purpose |
|------|------|-------|---------|
| `invoice-line-items.api.ts` | 726 | `{ included: true, reason: '' }` | `buildLineItemsFromTrips` default for normal trips |
| `use-invoice-builder.ts` | 417 | `{ included: false, reason: '' }` | Default for fetched cancelled trips |
| `map-line-item-row-to-builder-line-item.ts` | 247–249 | `{ included: true, reason: … }` | Hydrated cancelled **line item** rows (always opted-in when persisted) |

### 1e. Sites that filter on `is_cancelled_trip` (related, not billing_included)

| File | Line | Expression | Purpose |
|------|------|------------|---------|
| `InvoicePdfDocument.tsx` | 349–350 | `!(li.is_cancelled_trip ?? false)` | **`mainLineItems`** — cover summary input (missing billing filter — **bug**) |
| `use-invoice-builder.ts` | 284–285 | `is_cancelled_trip !== true` / `=== true` | Edit hydration split normal vs cancelled arrays |

---

## 2. Type landscape

### Definitions

**`BillingInclusionState`** — `invoice.types.ts` **L41–44**

```typescript
export type BillingInclusionState = { included: boolean; reason: string };
```

**`BuilderLineItem.billingInclusion`** — **L677–683** (required on builder type).

**`InvoiceLineItemRow.billing_included`** — **L161–168** (optional on row type; DB `NOT NULL DEFAULT TRUE`).

### Which representation each site uses

| Consumer group | Representation | Notes |
|----------------|----------------|-------|
| Builder hook, Step 3, preview hook, validators, write-back | `billingInclusion.included` | Always populated on `BuilderLineItem` / `BuilderCancelledTripRow` |
| `InvoicePdfDocument`, summary builders, cover flat table | `billing_included` on `InvoiceLineItemRow` | Comes from DB or draft serializer |
| Edit hydration | DB → builder via mapper **L179–181** | `billing_included ?? true` → `billingInclusion.included` |
| Create/save | builder → DB via `lineItemToInsertRow` **L971** | Direct boolean copy |
| Draft preview | builder → draft row **L100** | `billingInclusion?.included ?? true` |

### Cross-representation mixing

**No site compares builder `billingInclusion` against row `billing_included` in one expression.** The pipeline is:

1. Builder filters use `.billingInclusion.included`.
2. Preview pre-filters builder list, then serializes to `billing_included` on draft rows.
3. `InvoicePdfDocument` only sees persisted shape.

**Risk point:** If a caller passed **unfiltered** builder items into `buildDraftInvoiceDetailForPdf`, draft rows would carry `billing_included: false` for opted-out trips while still being in `invoice.line_items`. Today the preview hook prevents this; **the serializer does not filter**.

**Cancelled-trip asymmetry:** Persisted cancelled line items hydrate with `billingInclusion.included: true` hardcoded (**map-line-item-row L247–249**), ignoring `row.billing_included` if it were ever false. DB constraint design says cancelled billed rows are always `billing_included = true`.

---

## 3. Missing filters — where the rule should apply but doesn't

Beyond **`mainLineItems`** (`InvoicePdfDocument.tsx` **L349–351**):

| Site | File:Line | Issue |
|------|-----------|-------|
| **Cover flat layout** | `invoice-pdf-cover-body.tsx` **L142–144, L246** | `coercedFlatLineItems = invoice.line_items.map(...)` — **no** `billing_included` or `is_cancelled_trip` filter. When `main_layout === 'flat'`, opted-out normals **and** opted-in cancelled rows render on the cover table. Grouped/single_row modes use `summaryItems` from `mainLineItems` (partial filter only). |
| **Step 4 position table** | `step-4-confirm.tsx` **L331** | Maps full `lineItems` prop — shows opted-out rows with net prices. |
| **Step 4 position count** | `index.tsx` **L797** → `step-4-confirm.tsx` **L293** | `lineItemCount={lineItems.length}` — counts opted-out rows. |
| **Section 3 summary chip** | `index.tsx` **L472–474** | `` `${lineItems.length} Positionen · ${totals.subtotal}` `` — count unfiltered, subtotal filtered. |
| **Step 3 header copy** | `step-3-line-items.tsx` **L461–463** | `{lineItems.length} Fahrten gefunden` — all rows. |
| **KTS / no-invoice alerts** | `step-3-line-items.tsx` **L455–456, L479–491** | Counts over full `lineItems` (may be intentional advisory). |
| **`hasMissingPrices`** | `invoice-validators.ts` **L97–98** | Scans all `lineItems` including opted-out — can block “Weiter” for excluded rows still carrying `missing_price` warning. |
| **`build-invoice-pdf-summary.ts`** | **L257** | Iterates `invoice.line_items` passed in — **no internal filter**; caller must supply correct slice. Currently receives `mainLineItems` from parent (incomplete filter). |
| **`groupLineItemsByBillingType`** | `build-invoice-pdf-summary.ts` **L557–563** | No internal filter; fed `appendixLineItems` (correctly filtered) in appendix path. |

### Sites that correctly omit filtering (by design)

| Site | Reason |
|------|--------|
| `insertLineItems` / `updateDraftInvoice` line item payload | Persists **all** normal rows for audit |
| `buildLineItemsFromTrips` | Builds all fetched trips; inclusion is Step 3 runtime state |
| Step 3 row list UI | Admin must see opted-out rows to re-include |
| `excludedTripsForPdf` / excluded appendix | **Must** use excluded slice |

### Three intended slices (product model)

```
┌─────────────────────────────────────────────────────────────────┐
│ All normal lineItems (builder) / all invoice_line_items (DB)   │
│  incl. opted-out persisted for audit                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
   EXCLUDED slice     BILLABLE slice     MAIN COVER slice
   (!included)        (billing incl.)    (billing incl.
   → appendix         → footer totals      AND !cancelled)
   Ausgeschlossene    → appendix           → grouped summary
                      Fahrtendetails       → flat cover table
                      (+ cancelled         → quantity/km on
                       billed rows)          cover for normals only
```

Today **BILLABLE** is implemented consistently (builder hook + `lineItemsForCalc`). **MAIN COVER** is incomplete (`mainLineItems` + flat cover body).

---

## 4. Helper design — type constraints

### Should there be one helper or two?

**Recommend three functions built on one predicate:**

| Function | Input type(s) | Predicate |
|----------|---------------|-----------|
| `isBillingIncludedRow(row)` | Minimal union (see below) | Loose: `billing_included !== false` OR strict builder `.included === true` via overload/type guard |
| `billingIncludedLineItems<T>(items)` | Array of T | Filter billable rows (includes opted-in cancelled) |
| `mainCoverLineItems<T>(items)` | `InvoiceLineItemRow[]` (or union) | `isBillingIncludedRow(row) && !(row.is_cancelled_trip ?? false)` |

**Why not one generic filter only?** Footer totals and Haupttabelle intentionally diverge on cancelled trips. Applying `billingIncludedLineItems` to `mainLineItems` would **still leave opted-in cancelled rows on the cover** in grouped mode unless combined with `!is_cancelled_trip`.

**Why not two completely separate helpers without shared predicate?** The `!== false` vs `.included` semantic must stay aligned; one predicate function prevents drift.

### Minimal type constraint

```typescript
/** Row is billing-included if explicitly not opted out. */
type BillingInclusionReadable =
  | { billing_included?: boolean | null }
  | { billingInclusion: BillingInclusionState };

function isBillingIncludedRow(row: BillingInclusionReadable): boolean;
```

Implementation sketch (for design doc only):

- If `'billingInclusion' in row` → `row.billingInclusion.included`
- Else → `row.billing_included !== false` (treat `null`/`undefined` as included, matching DB default and mapper)

Optional second constraint for cover:

```typescript
type CoverLineItemRow = BillingInclusionReadable & {
  is_cancelled_trip?: boolean | null;
};
```

**Builder-only sites** can keep using `billingInclusion.included` via the same predicate (strict boolean — equivalent for non-null booleans).

**Do not** force everything through `InvoiceLineItemRow` or `BuilderLineItem` — totals and write-back already use minimal shapes (`TotalsLineShape` omits inclusion entirely; filtering happens **before** totals).

---

## 5. Test coverage

### Tests that touch billing inclusion

| File | Test name | What it asserts | Filter exercised? |
|------|-----------|-----------------|-------------------|
| `map-line-item-row-to-builder-line-item.test.ts` | `'billing excluded (opted-out row keeps reason; totals unchanged by map)'` **L211–227** | Round-trip persistence of `billing_included: false` and reason | **No** — does not assert totals **exclude** opted-out row |
| Same file | `'billing excluded…'` **L262–264** (manual line test uses included only) | — | — |
| `map-line-item-row-to-builder-line-item.test.ts` | Cancelled round-trip **L320** | `billingInclusion.included` true after map | Hydration only |
| `calculate-invoice-totals.test.ts` | All tests | Fixtures use `billingInclusion: { included: true }` | **No exclusion scenario** |
| `trip-write-back.test.ts` | `buildTripWriteBackPatch` tests only | Default fixture `included: true` | **`executeTripWriteBack` filter not tested** |
| `apply-tax-rate-override.test.ts`, `line-item-net-display.test.ts` | Fixtures | `included: true` only | N/A |

### No tests found for

- `InvoicePdfDocument` / `buildInvoicePdfSummary` / `buildInvoicePdfSingleRow` with opted-out rows
- `includedLineItemsForDraft` / `includedNormal` integration
- `invoice-pdf-cover-body` flat layout with excluded rows
- Server RPC `billing_included = TRUE` filter (SQL-only)

### Recommended test gaps to close with helper work

1. **PDF summary:** opted-out row with km + price does not affect `total_km` / grouped net when excluded.
2. **Flat cover:** same scenario — excluded row not rendered in cover table.
3. **Totals invariant:** `calculateInvoiceTotals(billingIncludedLineItems(all))` matches builder hook totals with mixed included/excluded fixtures.
4. **Write-back:** `executeTripWriteBack` skips `billingInclusion.included === false` items.

---

## 6. Edge cases in current inline expressions

### Null / undefined / false

| Expression | `undefined` | `null` | `false` |
|------------|-------------|--------|---------|
| `billing_included !== false` | **Included** | **Included** | Excluded |
| `billing_included ?? true` | **Included** | **Included** | Excluded (?? only replaces nullish, not false) |
| `billingInclusion.included` (filter) | N/A (required field) | N/A | Excluded |
| SQL `billing_included = TRUE` | N/A (NOT NULL column) | N/A | Excluded |
| SQL `COALESCE(billing_included, true) = true` | **Included** | **Included** | Excluded |

**Practical equivalence:** For real data (boolean NOT NULL in DB, always-set on builder types), strict and loose predicates agree. Divergence only matters for corrupted/legacy rows with `billing_included IS NULL` — TS treats as included, SQL `= TRUE` would exclude (controlling RPC uses COALESCE to match TS).

### Missing `billingInclusion` object

- `build-draft-invoice-detail-for-pdf.ts` **L100** uses `billingInclusion?.included ?? true` — missing object → **included** (defensive).
- Builder types require `billingInclusion`; optional chaining is only on draft serializer.

### Cancelled trips vs normal opt-out

| Trip kind | Default | Persisted as line item? | `billing_included` when persisted | In footer totals? | On main cover? |
|-----------|---------|-------------------------|-------------------------------------|-------------------|----------------|
| Normal | included | Always | `true` or `false` if opted out | Only if `true` | Should be only if `true` (**bug if false**) |
| Cancelled passive | opted out | **No** — separate `cancelledTrips` array | — | No | No (appendix passive list) |
| Cancelled opted in | included | Yes (`is_cancelled_trip=true`) | Always `true` | Yes | **Should be no** (appendix billed block only); `mainLineItems` already excludes via `is_cancelled_trip`; flat cover **does not** |

### Stricter composite filters

Opted-in cancelled for totals also require `price_resolution != null` (**use-invoice-builder.ts L903**). That is **pricing readiness**, not inclusion — keep outside the inclusion helper.

---

## 7. Risk of centralising — intentional non-filter zones

**Do not apply billing-included filter to:**

| Zone | File(s) | Why |
|------|---------|-----|
| Step 3 normal trip list | `step-3-line-items.tsx` | Admin edits inclusion in place |
| Opt-out dialog | `step-3-line-items.tsx` **L1544–1624** | Targets a specific opted-out candidate |
| Persist all normal rows | `insertLineItems`, `updateDraftInvoice` | Audit trail / §14 |
| Excluded appendix source | `index.tsx` **L413–424** | Must pass **excluded** slice |
| Passive cancelled appendix | `index.tsx` **L434–437** | Opted-out cancelled trips |
| `excludedTripCount` / Step 4 Vorlage checkbox | `use-invoice-builder.ts` **L917**, `step-4-vorlage.tsx` **L551–562** | Counts/shows excluded block |
| Inclusion validators | `invoice-validators.ts` **L105–140** | Explicitly checks **excluded** or **opted-in cancelled** missing reasons |
| Edit hydration fetch split | `use-invoice-builder.ts` **L284–314** | Loads all persisted rows into builder state |
| Large-invoice threshold | `index.tsx` **L460**, preview **L223** | Performance gate on raw trip count — changing to included-only would alter manual-preview threshold semantics (document if changed) |

**Safe to centralise:**

- `appendixLineItems` filter
- `lineItemsForCalc` filter
- `mainLineItems` (+ flat cover should use same slice)
- `includedNormal` / `includedLineItemsForDraft` (builder predicate via shared function)
- `executeTripWriteBack` filter
- Optional: Step 4 display counts (product decision)

---

## Senior-level recommendation

### One helper or two?

**One predicate + two list helpers** (three exports):

1. `isBillingIncludedRow` — single truth for loose/strict representations  
2. `billingIncludedLineItems` — billable rows (totals, appendix Fahrtendetails, write-back, preview draft input)  
3. `mainCoverLineItems` — billable **normal** rows only (cover grouped summary + flat table)

Naming `billingIncludedLineItems` alone for both totals and cover would be misleading unless documented that cover needs the second helper.

### Where to put them

**Recommended:** `src/features/invoices/lib/billing-inclusion.ts`

- Co-locate with `invoice-validators.ts`, `trip-write-back.ts`, `invoice-builder-section-guards.ts`
- Import from PDF layer (`InvoicePdfDocument`, `build-draft-invoice-detail-for-pdf`) and builder hook — **avoid** placing under `components/invoice-pdf/lib/` (builder and API also need it)
- Export types from same file or re-export minimal `BillingInclusionReadable` from `invoice.types.ts` if preferred for discoverability

**Not** in `calculateInvoiceTotals` file — totals function should remain pure arithmetic; filtering stays at call sites (matches current architecture and RPC parity).

### Centralisation risks

| Risk | Mitigation |
|------|------------|
| Replacing builder `.included` with loose `!== false` | Predicate must branch on shape; for builder, keep strict `.included` |
| Applying `billingIncludedLineItems` to `mainLineItems` without `!is_cancelled_trip` | Use `mainCoverLineItems` explicitly |
| Flat cover regression | Fix `invoice-pdf-cover-body.tsx` to use `mainCoverLineItems(invoice.line_items)` — **behavior change** for flat Vorlagen showing cancelled rows on cover today |
| `hasMissingPrices` / alert counts | Decide product-wise before filtering; not part of first helper PR |
| SQL RPC stays separate | Document predicate parity in comment near `billing-inclusion.ts`; do not call TS from SQL |

### Latent issues beyond `mainLineItems`

1. **Flat vs grouped cover inconsistency** — cancelled billed rows excluded in grouped mode but visible in flat mode (`invoice-pdf-cover-body.tsx` **L142**). Same fix path as inclusion helper but separate `is_cancelled_trip` dimension.  
2. **Preview hides bugs** — pre-filtering in `use-invoice-builder-pdf-preview.tsx` **L298** means builder preview never exercises persisted full `line_items` shape; **issued invoice PDF** and **post-save detail** are the real test surface.  
3. **Step 4 / summary UX** — filtered totals + unfiltered position count confuses dispatchers; optional follow-up.  
4. **`hasMissingPrices` on opted-out rows** — can block progress incorrectly if an excluded row lacks price.  
5. **Server uses `= TRUE`, client uses `!== false`** — equivalent today (NOT NULL); document for future nullable columns.  
6. **No integration test** tying hook totals → PDF footer → cover summary for mixed included/excluded fixtures.

### Recommended implementation order

1. **Add `billing-inclusion.ts`** with predicate + two list helpers + unit tests (pure functions, table-driven edge cases for null/false/cancelled).  
2. **Fix confirmed bug:** `InvoicePdfDocument.tsx` — replace `mainLineItems` filter with `mainCoverLineItems` (or equivalent). Add PDF summary test with excluded row.  
3. **Fix flat cover:** `invoice-pdf-cover-body.tsx` — use same `mainCoverLineItems` for `coercedFlatLineItems`.  
4. **Replace duplicate persisted filters** in same file (`appendixLineItems`, `lineItemsForCalc`) with `billingIncludedLineItems` — low risk, improves consistency.  
5. **Replace builder filters** in `use-invoice-builder.ts`, `use-invoice-builder-pdf-preview.tsx`, `index.tsx`, `trip-write-back.ts` — one PR or stacked commits.  
6. **Optional UX pass:** Step 4 count/table, section 3 summary chip, `hasMissingPrices` scoped to included-only.  
7. **Do not** refactor SQL in the same PR unless explicitly desired — keep TS/SQL parity documented.

**Avoid big-bang:** implement helper + tests first, then migrate call sites in PDF path (highest user impact), then builder (already correct logically).

---

## Quick reference — all production filter expressions

```typescript
// Persisted — INCLUDED (loose)
li.billing_included !== false          // InvoicePdfDocument L357, L367

// Builder — INCLUDED (strict)
i.billingInclusion.included            // use-invoice-builder L901, preview L298
c.billingInclusion.included && c.price_resolution != null  // cancelled billed

// Builder — EXCLUDED
!i.billingInclusion.included           // excludedTripCount, excludedTripsForPdf
!t.billingInclusion.included           // passiveCancelledTripsForPdf

// Write-back — INCLUDED
item.trip_id !== null && item.billingInclusion.included  // trip-write-back L62

// Cover — partial (cancelled only, missing billing)
!(li.is_cancelled_trip ?? false)       // mainLineItems L349 — INCOMPLETE

// Flat cover — NO FILTER
invoice.line_items.map(...)            // invoice-pdf-cover-body L142 — BUG
```

---

## Related documents

- [`excluded-trips-totals-audit.md`](./excluded-trips-totals-audit.md) — symptom analysis and divergence point  
- [`docs/invoices-module.md`](../invoices-module.md) — product rules for billing inclusion  
- `.cursor/plans/billing_inclusion_control_6944ad7b.plan.md` — original spec (`billing_included === true && !is_cancelled_trip` for Haupttabelle)
