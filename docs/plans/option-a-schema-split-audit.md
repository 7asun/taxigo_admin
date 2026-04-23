# Audit: Option A — `trips.net_price` schema split (`base_net_price` + `approach_fee_net`)

**Scope:** Read-only review of the repository as of **2026-04-23** (all searches below are against this tree). **No code changes** in this document.

**Goal:** Map every read/write of `trips.net_price`, the role of `approach_fee_net`, `computeTripPrice`’s output, invoice line items, PDF, SQL/migrations, and risks for splitting stored net into **base transport net** vs **Anfahrt net** on the `trips` table.

---

## Executive finding (semantic drift)

Today **`trips.net_price` is not a single semantic everywhere:**

- `computeTripPrice` in `trip-price-engine.ts` sets `net_price` to **`resolution.net + approachFeeNet`** (combined total net) before `gross_price` (lines 252–260).
- `use-invoice-builder.ts` overwrites the trip on invoice creation with **`net_price: item.price_resolution.net`**, and `price_resolution.net` in `resolve-trip-price` is the **base transport** amount (Anfahrt is on `price_resolution.approach_fee_net`, not in `net`).

So rows last written by the **engine** can carry a **combined** net in `trips.net_price`, while rows last touched by the **invoice writeback** can carry **base-only** net. **No code in the repo subtracts `approach_fee_net` from `net_price` to recover base** (see §1 and §2).

Option A (explicit columns) is a correct direction for SSOT, but a **data backfill** and **unified write paths** are prerequisites for correctness, not just adding columns.

---

## 1. Every read of `trips.net_price` (or `trip.net_price`)

| Location | Function / context | Use | Assumption vs combined? |
|----------|--------------------|-----|-------------------------|
| `src/features/invoices/lib/resolve-trip-price.ts` | `executeStrategy`, `resolveTripPrice` (P3 strategies use `TripPriceInput.net_price`; P4 `trip.net_price` fallback, lines 248–266, 465–467) | Input to Spec C **resolution**; P4 uses stored value as the **line net for fallback strategies** and wraps with `withApproachFeeFromRule` (may attach rule `approach_fee_net` again) | Treated as **one scalar “stored trip net”** for the cascade. It does **not** encode whether DB stored base-only or base+Anfahrt. |
| `src/features/invoices/api/invoice-line-items.api.ts` | `fetchTripsForBuilder` selects `net_price` (line 146); `buildLineItemsFromTrips` passes `net_price: trip.net_price ?? null` into `resolveTripPricePure` (line 264) | Drives the same resolution as above | **Assumes a single `trips.net_price` field** means “P4 fallback value”, not a split. |
| `src/features/invoices/lib/price-calculator.ts` | `resolveTripPrice` (adapter, lines 28–45) | Passes `trip.net_price` to pure resolver | Same as builder. |
| `src/features/trips/lib/trip-price-engine.ts` | `resolveTripForPricing` — `select` includes `net_price` (line 338); returned object sets `net_price: null` for compute (lines 364–366) | Fetches current row but **intentionally does not** pass stored `net_price` into `computeTripPrice` on recalc (avoids P4 “sticky” snapshot) | N/A for display; not used as combined vs base. |
| `src/features/trips/lib/trip-price-engine.ts` | `computeTripPrice` — passes `net_price: trip.net_price` into `TripPriceInput` for `resolveTripPrice` (line 224) | P3–P4 inside `resolveTripPrice` when **computing** new snapshot | **Input** is the value from `ComputeTripPriceInput` (often `null` on recalc). |
| `src/types/database.types.ts` | `public.trips` Row / Insert / Update (lines 1216, 1285, 1346) | Type shape for all Supabase `trips` I/O | Declares `net_price: number | null` only. |
| `src/features/trips/api/trips.service.ts` | `getTrips` — `select('*')` (line 21); `getTripById` — `select('*, ...')` (line 32); `getTripsForAnalytics` — `select('*, ...')` (line 185) | Full row; consumers receive `net_price` as part of `*` | **No local assumption**; depends on each consumer. |
| `src/features/trips/components/trips-listing.tsx` | `select(\`*, ...\`)` (lines 83–94) | Same | Column available on row objects; UI may or may not show it. |
| `src/features/dashboard/lib/stats-utils.ts` | (aggregate over trips, line 23) | `total + (trip.net_price \|\| 0)` for **revenue** | Treats as **revenue in net terms**; effectively **combined total** for engine-written rows, **base-only** for invoice-writeback rows. |
| `src/features/dashboard/lib/occupancy-utils.ts` | hourly / weekly rollups (lines 56, 110) | `revenue += trip.net_price \|\| 0` | Same as stats. |
| `src/features/unassigned-trips/api/unassigned-trips.service.ts` | `getUnassignedTrips` selects `net_price` (line 35) | Passes to **UnassignedTrip** | Display / grouping. |
| `src/features/unassigned-trips/components/trip-row.tsx` | Renders (line 95) | `formatPrice(trip.net_price)` | **Displayed as trip net price** (ambiguous semantics in DB as above). |
| `src/features/unassigned-trips/types/unassigned-trips.types.ts` | `UnassignedTrip` (line 15) | Field typing | `net_price: number | null`. |
| `src/features/trips/components/csv-export/csv-export-constants.ts` | column definition (line 101) | Export key `net_price` — **Preis (Netto)** | Exports **whatever is in the row**. |
| `src/features/invoices/types/invoice.types.ts` | `TripForInvoice.net_price` (line 236) | Comment: “manual driver price” | **Comment is misleading** for engine-priced trips (value is not always “manual”). |
| `src/features/invoices/lib/pdf-column-catalog.ts` | `key: 'net_price'` (line 272) and notes (line 29) | PDF column id `net_price` — **display** uses `valueSource: 'line_net_eur'`, not `dataField` | This is **line-item / PDF column naming**, not `trips.net_price` directly. |
| `src/features/invoices/components/pdf-vorlagen/vorlage-editor-panel.tsx` | allowed column keys include `'net_price'` (line 217) | Editor choices for **invoice** PDF layout | **Line-based** display keys, not trips table. |
| `scripts/backfill-null-trip-net-prices.ts` | fetches and updates (lines 44–46) | `select` of `net_price`, filter `.is('net_price', null)` | Maintenance; expects nullable `net_price`. |
| `scripts/backfill-driving-distance.ts` | many `.or('net_price...')` and writes (e.g. lines 84–123, 393–630) | Recompute / repair; reads and writes `net_price` | **Combined** when written via `computeTripPrice` result (same script pattern as elsewhere). |
| `src/app/api/cron/generate-recurring-trips/route.ts` | `computeTripPrice` input (lines 528, 594) | `net_price: null` in **input** to `computeTripPrice` | **Read** of column not shown here; **insert** overwrites with computed `net_price` from spread. |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | `net_price: null` in `computeTripPrice` **inputs** (lines 1358, 1421, 1507, 1590) | Insert payload; price fields come from `...computeTripPrice(...)` | Not a read of existing DB column in those lines. |
| `src/features/trips/components/bulk-upload-dialog.tsx` | `net_price: null` in input to `computeTripPrice` (lines 1256, 1335) | Insert/update payloads | Same. |
| `src/features/trips/lib/duplicate-trips.ts` | `toComputeInput` uses `net_price: null` (lines 304–327) | Duplication never inherits source `net_price` (comment lines 304–305) | **Read** of source is avoided for compute; new row gets fresh `computeTripPrice` output. |
| Tests | `src/features/invoices/lib/__tests__/resolve-trip-price.test.ts`, `src/features/trips/lib/__tests__/trip-price-engine.test.ts`, `src/features/trips/lib/__tests__/duplicate-trips.test.ts` | Exercises `net_price` on inputs/outputs | Test-only. |
| `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` | — | **No** `net_price` / `trips` references in this file (search 2026-04-23) | N/A. |

**Subtract `approach_fee_net` from `net_price`?**

- **Not found:** no expression like `net_price - approach` for trips or for recovering base net from stored `net_price` in `.ts` / `.tsx` under this repo (pattern search: `net_price` with `approach` / subtraction).

**Driver portal / some exports:** `src/features/driver-portal/api/driver-trips.service.ts` `select` lists (lines 47–48, 82–84) do **not** include `net_price`. `src/app/api/trips/export` routes had **no** `net_price` string matches in a repo search.

---

## 2. Every write of `trips.net`

### 2.1 Via `computeTripPrice` → `net_price` (typically **base + `approach_fee_net`** from resolution)

`computeTripPrice` returns `TripPriceFields` with `net_price: totalNet` where `totalNet = resolution.net + (resolution.approach_fee_net ?? 0)` (`src/features/trips/lib/trip-price-engine.ts` lines 252–260). 

That return is merged into **insert/update payloads** in:

| File | Function / flow | How written |
|------|-----------------|------------|
| `src/features/trips/api/trips.service.ts` | `updateTrip` | `Object.assign(trip, computeTripPrice(tripInput, context))` then `update(trip)` (lines 87–94) when `shouldRecalculatePrice` — writes **`net_price`, `gross_price`, `tax_rate`**. |
| `src/features/trips/trip-reschedule/api/reschedule.actions.ts` | `rescheduleTripWithOptionalPair` | `Object.assign(primaryPatch, computeTripPrice(...))` and same for partner (lines 103, 148) when `shouldRecalculatePrice(primaryPatch)` / partner — note `scheduled_at` is pricing-relevant. |
| `src/features/unassigned-trips/api/unassigned-trips.service.ts` | `assignBillingVariant` | `Object.assign(patch, computeTripPrice(...))` then `update(patch)` (lines 139–147). |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | trip insert payloads | `...computeTripPrice(..., context)` spread into create payload (e.g. lines 1349+, 1412+, etc.). |
| `src/features/trips/components/bulk-upload-dialog.tsx` | bulk insert | `...computeTripPrice(...)` merged into row (lines 1256, 1335 area). |
| `src/app/api/cron/generate-recurring-trips/route.ts` | `outboundWithPrice` / `returnWithPrice` | `...computeTripPrice(..., pricingCtx)` (lines 516–532, 583–599). |
| `src/features/trips/lib/duplicate-trips.ts` | insert after duplicate | `...computeTripPrice(toComputeInput(...), ctx)` with `toComputeInput` forcing `net_price: null` (lines 304–330 area). |
| `scripts/backfill-null-trip-net-prices.ts` | per-trip update | `net_price: priceFields.net_price` from `computeTripPrice` (line 99). |
| `scripts/backfill-driving-distance.ts` | multiple passes | `net_price: priceFields.net_price` from `computeTripPrice` when non-null (e.g. lines 123, 497, 615). |

`tripsService.createTrip` / `bulkCreateTrips` **only insert** what they receive (`trips.service.ts` lines 44–59); they do not call the engine. Callers (create form, bulk upload, duplicate API, etc.) are responsible for merging `computeTripPrice` into the insert.

### 2.2 Direct / explicit `net_price` on **update** (not the combined engine triple)

| File | What is written | Combined vs base-only? |
|------|-----------------|------------------------|
| `src/features/invoices/hooks/use-invoice-builder.ts` | After `insertLineItems`, `updateTrip` with `net_price: item.price_resolution.net` (line 277) | **`price_resolution.net` is base transport only**; Anfahrt remains separate on the line. **Not** the same as `computeTripPrice`’s `net_price` field value. **Comment (lines 271–272) says** transport net and gross “incl. Anfahrt” — aligns with `price_resolution` shape, not with engine `trips.net_price` combined storage. |

### 2.3 Inserts with `net_price: null` as **input** to `computeTripPrice` only

`create-trip-form`, `bulk-upload-dialog`, `generate-recurring-trips`, `duplicate-trips` set **`net_price: null` on the input object** to `computeTripPrice`; the **written** `net_price` to DB comes from the **return** of `computeTripPrice` (not those nulls by themselves—except when resolution fails and all price fields are null).

---

## 3. Current state of `approach_fee_net` on the `trips` table

- **Migrations:** `20260409120000_phase8_approach_fee_single_row.sql` adds **`public.invoice_line_items.approach_fee_net` only** — not `trips.approach_fee_net`.
- **`20260418120000_trips-price-schema.sql`** and **`20260423100000_add_trip_manual_gross_price.sql`:** no `approach_fee_net` on `trips`.
- **`src/types/database.types.ts` (trips Row):** fields include `net_price`, `gross_price`, `tax_rate`, `manual_gross_price` (lines 1214–1220) — **no** `approach_fee_net` on `trips`.

**Conclusion:** `trips.approach_fee_net` **does not exist** in the generated types or in the listed migrations. **Anfahrt** is modeled on **billing rule config**, **`PriceResolution`**, and **`invoice_line_items.approach_fee_net`**, not as a stored column on `trips` today.

---

## 4. `computeTripPrice` return shape today

- **Type:** `TripPriceFields` in `src/features/trips/lib/trip-price-engine.ts` (lines 49–54):  
  `{ net_price: number | null; gross_price: number | null; tax_rate: number | null }`.
- **No separate `approach_fee_net` in the return object.** Approach is read internally from `resolution.approach_fee_net` and **folded into** `net_price` and then `gross_price` (lines 252–261).
- **`Object.assign(trip, computeTripPrice(...))` at update sites** writes exactly those **three** keys to the patch/insert, unless other fields are also on the object. **No fourth column** for approach is written by the engine.

---

## 5. Invoice line items — current split

### 5.1 Does `invoice_line_items` store `approach_fee_net`?

**Yes** — `supabase/migrations/20260409120000_phase8_approach_fee_single_row.sql` adds `invoice_line_items.approach_fee_net` with a comment.  
`insertLineItems` in `invoice-line-items.api.ts` persists `approach_fee_net: item.approach_fee_net ?? null` (line 507).

### 5.2 How `buildLineItemsFromTrips` sets approach fee

In `src/features/invoices/api/invoice-line-items.api.ts` (lines 260–327):

- `priceResolution` comes from `resolveTripPricePure(..., rule)`.
- `approach_fee_net` on the builder row is set to **`priceResolution.approach_fee_net ?? null`** (lines 322–326), i.e. from the **resolution object** (which itself comes from **rule config** / Spec C, not from a `trips` column).

### 5.3 After Option A

- **If** `trips` gains `base_net_price` and `approach_fee_net` (or `trips_approach_fee_net`), the **line builder** could read approach from the trip **when** you want the row to match stored SSOT. Today it **re-derives** from rules + `resolveTripPrice` on each build.
- You would still need a **decision** whether invoice build remains **cascade-based** (current) or **snapshot-based** (read columns only) — the existing audit in `docs/plans/trip-price-source-of-truth-audit.md` discusses staleness; Option A does not by itself remove the need to run `resolveTripPrice` unless you cut over the builder intentionally.

---

## 6. PDF renderer impact

- **`InvoicePdfDocument.tsx`** (lines 84–132): `priceResolutionFromLineItem` builds a `PriceResolution` from **`invoice` line item** fields: `li.unit_price`, `li.quantity`, `li.tax_rate`, `li.price_resolution_snapshot`, **`li.approach_fee_net`**. **No** read of `trips` table in this path.
- **`build-draft-invoice-detail-for-pdf.ts` / `build-invoice-pdf-summary.ts` / `invoice-pdf-line-amounts.ts`:** work from **line items** and snapshots / `approach_fee_net` on lines.

**Conclusion for Option A (trips table split only):** **PDF output is unchanged** if you do not change how **line items** are built and persisted. Option A is **indirect** for PDF: it would matter only if you later **changed** `buildLineItemsFromTrips` to trust trip columns and that produced different line snapshots.

---

## 7. Reporting and SQL references to `trips.net_price`

**Supabase SQL migrations (full scan 2026-04-23):**

- **`20260418120000_trips-price-schema.sql`:** renames `price` → `net_price`, `COMMENT ON COLUMN public.trips.net_price`, adds `gross_price`, `tax_rate`, `billing_type_id`.
- **`20260408120001_pdf_vorlagen.sql`:** default JSON for **PDF column keys** includes the string `"net_price"` in `main_columns` / `appendix_columns` (lines 38, 43) — **invoice template UI**, not a SQL reference to `public.trips.net_price`.
- **No** view definition or RLS policy text in those migrations **references** `public.trips.net_price` (grep over `supabase/migrations` for `net_price` only hit the three files above).

**RPCs:** `supabase/migrations/20260411140000_trip_ids_matching_invoice_effective_status.sql` does **not** use `net_price` — only `trips` + `invoice_line_items` + `invoices` status.

**App-side “reporting”** using `net_price`: `stats-utils`, `occupancy-utils` (see §1).

**Edge Functions:** per `docs/plans/trip-price-source-of-truth-audit.md`, trip generation is a **Next.js route** `generate-recurring-trips` — not a Supabase Edge Function in this repo.

**If `net_price` were renamed or split:** any **TypeScript** using `trip.net_price`, **CSV** export key, and **raw SQL in scripts** (`backfill-driving-distance`, `backfill-null-trip-net-prices`) would need updates. **Migrations** that only **comment** the column would need refresh. **Default PDF JSON** in `pdf_vorlagen` would **not** break DB queries (string key `net_price` for column id).

---

## 8. Migration safety analysis

**Suggested safe sequence (conceptual, not a deployment order guarantee):**

1. Add **nullable** `base_net_price` and `approach_fee_net` (or your chosen names) on `trips` *if* you want them stored; add **comments** clarifying legacy `net_price` during transition.
2. **Backfill** from current `net_price` where semantics are known (hard if historical rows mix combined vs base-only — may require **re-running** `resolveTripPrice` + rules at backfill time, or accepting approximation error).
3. **Switch all writers** (engine, invoice writeback, scripts) to populate the new columns consistently; optionally keep **`net_price` as a generated** `base + approach` for backward compatibility or mark deprecated in types.
4. **Migrate readers** (dashboard, CSV, exports, any external BI) to use `base_net_price` + `approach` or a documented derived total.
5. **Deprecate or drop** `net_price` last, after a release with no remaining dependency.

**Constraints:**

- **No FKs** in migrations are attached to `trips.net_price` (it is a plain column; see `20260418120000_trips-price-schema.sql`).
- **No index** in migrations is defined **on** `trips.net_price` (grep: no `CREATE INDEX` including `net_price` in `supabase/migrations`).
- **RLS:** no migration text references `net_price` in `USING` / `CHECK` (grep in `supabase/migrations` for `net_price` in policies: none beyond column comments and PDF JSON defaults).
- **Views:** no definition of a view on `trips.net_price` in the grep results.

**Rename risk:** if only **one** of code paths is updated, **revenue** totals and **invoice line** math can **diverge** (especially given existing engine vs writeback **semantic** mismatch).

---

## 9. Risk surface summary

| Risk | Why it hurts |
|------|----------------|
| **Semantic mismatch already** | Engine stores **combined** net in `trips.net_price`; invoice writeback stores **base** in `net_price` via `price_resolution.net`. Splitting columns **without** fixing writeback + engine to agree will increase confusion. |
| **P4 double-counting edge** | If `trips.net_price` ever holds **base+Anfahrt** and P4 + `withApproachFeeFromRule` runs, the resolver could **treat the full amount as base** and still attach a rule `approach_fee_net`. **Not mitigated** by a subtract in the codebase (none exists). |
| **Missed write path** | Any insert/update that sets `net_price` **without** setting new columns would leave `approach_fee` wrong if you rely on the split for **reporting** or **future** builder read-through. |
| **Dashboards / CSV** | `stats-utils` / `occupancy-utils` / CSV use **`net_price` as a single number**; changing column meaning or splitting without updating them shifts **reported revenue**. |
| **Backfill** | Historical data may not be splittable without re-resolution or heuristics. |
| **Comments / docs** | `use-invoice-builder` comment (lines 271–272) describes writeback; `trip-price-engine` (lines 247–250) describes combined storage — **senior review should reconcile** in one spec. |

**Raw patches not going through `computeTripPrice`:** the **invoice writeback** in `use-invoice-builder.ts` (line 276–277) sets `net_price` (and `gross_price` / `manual_gross_price`) **directly** on `updateTrip` — that path **bypasses** `computeTripPrice` and is **intentional** (post line-item resolution).

---

## 10. Senior-level recommendation

**Is the split “safe to do now”?**

- **Schema-only (add two nullable columns):** **Low DB risk** — no special FK/RLS/index coupling found on `net_price` in migrations.
- **Behaviorally safe to rely on the split for SSOT: not without coordinated application + data work.** The codebase already has **two different meanings** for `net_price` on `trips` depending on **last write source** (engine **combined** vs invoice **base-only**). Adding `base_net_price` + `approach_fee_net` **without** unifying those writes and backfilling will **not** by itself fix totals; it can make the model **clearer** if you treat legacy `net_price` as **deprecated** and migrate carefully.

**Correct migration sequence (recommendation):**

1. **Document and align semantics in code** (single definition of what gets written to trip rows: engine, invoice, scripts).
2. **Add** nullable `base_net_price` and `approach_fee_net` on `trips` (names per your standard).
3. **Backfill** with a **deterministic** method (ideally re-run `resolveTripPrice` + `computeTripPrice` rules per row, or a verified formula — **not** only splitting ambiguous `net_price` without source-of-row metadata).
4. **Update all writers** (including `use-invoice-builder` writeback and `computeTripPrice` / `TripPriceFields`) to populate the new columns; decide whether **`net_price` becomes generated** `base + approach` or is frozen then dropped.
5. **Update readers** (dashboard, CSV, any exports) to use the split or the documented total.
6. **Deprecate/remove** `net_price` last.

**What must be done first:** **reconcile the engine vs invoice writeback semantics** for `trips.net_price` (or you risk encoding the same confusion into new columns). Option A is **worth doing** for schema clarity, but it is a **milestone in a larger consistency pass**, not a one-column rename.

---

## Reference: files explicitly requested in scope

- Read / scanned for this audit: `trip-price-engine.ts`, `trips.service.ts`, `resolve-trip-price.ts`, `invoice-line-items.api.ts`, `invoice.types.ts` (relevant sections), `database.types.ts` (trips + grep), `step-3-line-items.tsx` (no `net_price`), all `supabase/migrations` (grep + `trip_ids_matching_invoice_effective_status` read), all `scripts/` (3 files; `backfill-clients-lat-lng` has no `net_price`), `docs/plans/trip-price-source-of-truth-audit.md` (cross-check).

*End of audit.*
