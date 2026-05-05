# Audit: Trips billing_type_id / billing_variant_id cleanup (obsolete family)

**Date:** 2026-05-05  
**Scope:** Schema, migrations, application read/write paths, invoices/PDF/exports, docs.  
**Proposed data fix:** Remap legacy `billing_types.id` `e49f144e-4996-47ee-aeb5-bea95482c77c` (“Notfalllabor” in sample data) to `f175a4b8-8126-4f07-827a-f4c5f5a2399d` (“Labor”) and set `billing_variant_id` to `ccc2dcb0-486c-4ed3-adb6-b581e5fbcd86` (target variant — **verify in production**; this UUID does not appear in the repo).

---

## 1. Schema: trips, billing families, variants

### 1.1 Current shape (from `src/types/database.types.ts`)

- **`trips.billing_variant_id`:** nullable `uuid`, FK → `billing_variants.id` (`trips_billing_variant_id_fkey`), `ON DELETE SET NULL`.
- **`trips.billing_type_id`:** nullable `uuid`, FK → `billing_types.id` (`trips_billing_type_id_fkey`).
- **`billing_variants`:** scalar `billing_type_id` (NOT NULL) → `billing_types.id`. **No** trip–variant junction table; the trip stores a **single** variant id.
- **`billing_types`:** family row per payer; variants are one-to-many children.

**Historical note:** `supabase/migrations/20260326120000_billing_families_and_variants.sql` temporarily had `trips.billing_type_id`, backfilled `billing_variant_id`, then **dropped** `trips.billing_type_id`. Later, `20260418120000_trips-price-schema.sql` **re-added** `trips.billing_type_id` for the price engine (“direct reference to the billing type resolved from the billing variant at creation”) with index `idx_trips_billing_type_id`.

### 1.2 Is `billing_variant_id` scalar, array, or relation table?

**Scalar column on `trips`**, optional FK. Arrays appear only in **invoice builder fetch params** (`billing_variant_ids`) and similar UI state — **not** as a `trips` column.

---

## 2. Where the old billing type ID appears (repo)

| Location | Notes |
| -------- | ----- |
| `EXAMPLE/Billing_Payer/billing_types_rows.csv` | Row for `e49f144e-4996-47ee-aeb5-bea95482c77c`, name `Notfalllabor`. |
| `EXAMPLE/Billing_Payer/billing_variants_rows.csv` | Variant row references that `billing_type_id` (`36634716-ced6-4111-bf9f-9596f4cb4390`, code `NOTFAL`). |

**Not found** in `src/`, `supabase/migrations/`, or `docs/` as a hard-coded literal. Production/staging DB may still reference it in live rows (`trips`, `billing_variants`, `billing_pricing_rules`, `invoices`, etc.).

**Target IDs in sample data (repo only):** `f175a4b8-8126-4f07-827a-f4c5f5a2399d` = family “Labor”; example “Standard” variant under Labor is `e405df7b-8732-4257-a648-ebd7ddce84d3` with code `LABOR`. The user-proposed variant `ccc2dcb0-486c-4ed3-adb6-b581e5fbcd86` is **not** in the repository — confirm it exists, belongs to the intended payer/family, and is the correct operational Unterart before any migration.

---

## 3. Migrations that introduced or changed billing-related IDs on trips

| Migration | Effect |
| --------- | ------ |
| `20260326120000_billing_families_and_variants.sql` | Adds `billing_variants`; adds `trips.billing_variant_id`; backfills from former `trips.billing_type_id`; drops legacy `trips.billing_type_id`. |
| `20260327120000_recurring_rules_billing.sql` | `recurring_rules.payer_id`, `recurring_rules.billing_variant_id` (copied to trips by cron). |
| `20260418120000_trips-price-schema.sql` | Reintroduces **`trips.billing_type_id`** FK + index + comment. |
| `20260502120002_billing_type_accepts_self_payment.sql` | `get_shift_day_summaries` joins `billing_types bt ON bt.id = t.billing_type_id` for Selbstzahler rollups. |

Other billing migrations (`billing_pricing_rules`, `invoices.billing_*`, `invoice_line_items` snapshots, `client_km_overrides.billing_variant_id`, etc.) affect **rules, invoices, or overrides** — not the trips column set directly, but they matter for **whether remapping trips changes pricing or invoice scope**.

---

## 4. How many trips use the old billing type ID?

**Cannot be answered from the repo alone.** Run against the target database (staging first):

```sql
-- Trips with denormalized family id matching the obsolete type
SELECT count(*) AS trips_by_billing_type_id
FROM public.trips
WHERE billing_type_id = 'e49f144e-4996-47ee-aeb5-bea95482c77c';

-- Trips whose Unterart belongs to the obsolete family (canonical family is on the variant)
SELECT count(*) AS trips_by_variant_family
FROM public.trips t
JOIN public.billing_variants bv ON bv.id = t.billing_variant_id
WHERE bv.billing_type_id = 'e49f144e-4996-47ee-aeb5-bea95482c77c';

-- Rows where the two disagree (high priority for manual review)
SELECT t.id, t.payer_id, t.billing_type_id, bv.billing_type_id AS variant_billing_type_id, t.billing_variant_id
FROM public.trips t
LEFT JOIN public.billing_variants bv ON bv.id = t.billing_variant_id
WHERE t.billing_type_id = 'e49f144e-4996-47ee-aeb5-bea95482c77c'
   OR bv.billing_type_id = 'e49f144e-4996-47ee-aeb5-bea95482c77c';
```

---

## 5. Other fields that matter for safe mapping

For each candidate trip row, validate at least:

| Field | Why it matters |
| ----- | -------------- |
| **`payer_id`** | `billing_types` are payer-scoped. New `billing_type_id` / `billing_variant_id` must belong to the **same** payer as the trip (or you are changing business meaning). |
| **`billing_variant_id`** | Determines CSV code, KTS cascade, variant-scoped pricing rules, `client_price_tags`, `client_km_overrides`, and embed-based UI labels. |
| **`billing_type_id` (trip)** | Used by **price recalculation** (`resolveTripForPricing` merges patch + row), **shift summaries** (`get_shift_day_summaries`, `shift-reconciliations` embed on `trips_billing_type_id_fkey`), and scripts (`backfill-driving-distance.ts` Pass C). **Can drift** from the variant’s family (see §7). |
| **Pricing / money** | After remapping, STEP 1/2/3 rule resolution may change; consider whether to re-run pricing for affected trips. |
| **`invoice_line_items` link** | Issued lines store **snapshots** (`billing_variant_*`, `billing_type_name`); they do not auto-update if `trips` changes. Uninvoiced trips will pick up new billing on next invoice build. |
| **`recurring_rules.billing_variant_id`** | Cron copies to new trips; rules still pointing at old Unterarten will keep generating “old” billing until updated separately. |

---

## 6. Foreign keys, constraints, triggers, downstream documents

### 6.1 Trip row FKs (Postgres)

- Updates must satisfy `trips_billing_type_id_fkey` and `trips_billing_variant_id_fkey` (valid UUIDs present in `billing_types` / `billing_variants`).
- **No trigger** was found in reviewed migrations that auto-syncs `billing_type_id` from `billing_variant_id`.

### 6.2 Downstream that references billing catalog (not necessarily trip FKs)

- **`billing_pricing_rules`:** scoped by `billing_type_id` and/or `billing_variant_id` / `payer_id`. Remapping trips does not delete old catalog rows; **rules attached to the old family/variants** may still exist and may need consolidation if the old family is retired.
- **`client_price_tags` / `client_km_overrides`:** variant-scoped rows may still point at old `billing_variants.id` values.
- **`invoices`:** `billing_type_id`, `billing_variant_id` on header — unrelated to trip cleanup unless you also retire catalog rows and want historical invoice filters consistent.
- **`invoice_line_items`:** textual/code snapshots; **immutable** once issued; no FK to `billing_types`.
- **RPCs:** `create_storno_invoice` / manual KM storno paths copy header `billing_type_id` / `billing_variant_id` — relevant for **invoice** rows, not trip migration.
- **`get_shift_day_summaries`:** uses **`t.billing_type_id`**, not the variant join. Incorrect or null `billing_type_id` skews Selbstzahler aggregation per day.

---

## 7. Code paths: read, write, validate, filter, display

### 7.1 Writes that set both fields consistently

- **Neue Fahrt** (`create-trip-form.tsx`): sets `billing_variant_id` and `billing_type_id` from selected variant’s `billing_type_id`.
- **Bulk CSV** (`bulk-upload-dialog.tsx`): derives `billing_type_id` from resolved variant when possible.
- **Recurring cron** (`generate-recurring-trips/route.ts`): sets both from `rule.billing_variants.billing_type_id` and rule’s `billing_variant_id`.
- **Duplicate trips** (`duplicate-trips.ts`): copies both from source.

### 7.2 Writes that may leave `billing_type_id` stale (operational risk)

These paths update or create trips with **`billing_variant_id`** but **do not** set `billing_type_id` to the new variant’s family:

- **Trip detail sheet** (`build-trip-details-patch.ts`): only patches `billing_variant_id`.
- **Paired trip sync** (`paired-trip-sync.ts`): syncs `billing_variant_id`, not `billing_type_id`.
- **Rückfahrt insert** (`build-return-trip-insert.ts`): copies `billing_variant_id` from outbound but **omits** `billing_type_id` (outbound may still carry it; if outbound ever has null `billing_type_id`, return leg can miss it).
- **Unassigned trips** (`unassigned-trips.service.ts` `assignBillingVariant`): updates only `billing_variant_id` (price recalc uses merged row — stale `billing_type_id` can affect STEP 2 rules until fixed).

**Implication for migration:** Even a perfect one-shot SQL update can be **undermined** by these code paths if users edit billing before product fixes. Invoice line building often uses **`trip.billing_variant?.billing_type_id`** (embed) for `resolvePricingRule`, which can **mask** stale `trips.billing_type_id` in some flows, while `computeTripPrice` / `resolveTripForPricing` still reads the **column** for STEP 2.

### 7.3 Reads / filters

- **Fahrten listing** (`trips-listing.tsx`, filters bar): filters by **`billing_variant_id`** (URL param), not `billing_type_id` on trips.
- **Invoice trip fetch** (`invoice-line-items.api.ts`): resolves filters via `billing_variants` → applies `.eq` / `.in` on **`trips.billing_variant_id`**.
- **Export** (`app/api/trips/export/route.ts`, preview route): embeds `billing_variant` → `billing_types` for labels.

### 7.4 Display

- **Tables, Kanban, print** (`format-billing-display-label.ts`, `print-trip-groups-list.tsx`, etc.): use **`billing_variant`** embed for family color/name, not `trips.billing_type_id`.

### 7.5 Docs drift

- **`docs/billing-families-variants.md`** states legacy `trips.billing_type_id` was removed after migration; that is **no longer accurate** after `20260418120000_trips-price-schema.sql`. **`docs/plans/billing-type-backfill-audit.md`** reflects the reintroduced column and price-engine usage.

---

## 8. Invoices, PDF, exports, reporting

| Area | Use of trip billing |
| ---- | ------------------- |
| **Builder line items** | `buildLineItemsFromTrips` uses `trip.billing_variant` embed for `billingTypeId` in `resolvePricingRule` and for `billing_type_name` / `billing_variant_*` snapshots — **embed**, not `trip.billing_type_id`. |
| **PDF** | Line items carry frozen names/codes; grouping keys use snapshot fields (`build-invoice-pdf-summary.ts`, `InvoicePdfDocument.tsx`). |
| **Storno** | Copies snapshot fields; header billing ids from **invoice**, not live trip. |
| **Trip CSV / API export** | Variant + family via PostgREST embed. |

**Issued invoices:** Changing `trips` after the fact does **not** rewrite PDFs or line items; only future runs and uninvoiced pricing are affected.

---

## 9. Is automated migration safe?

### 9.1 When mechanical UPDATE is reasonable

- Profiling queries show a **small, well-defined** set of rows.
- All affected trips share the **same payer** and the target `(billing_type_id, billing_variant_id)` pair is **verified** to belong to that payer.
- **No** conflicting `billing_pricing_rules` / price-tag expectations require staying on the old family for some rows.
- Stakeholders accept that **multiple Unterarten** under the old family (if any) all collapse to **one** target variant — otherwise mapping must be **per variant id**, not one global variant.

### 9.2 When manual review is required

- **`billing_type_id` vs `billing_variant.billing_type_id` mismatch** on the same trip.
- Trips with **`billing_variant_id` null** but `billing_type_id` still set (if any).
- Rows tied to **invoicing edge cases** (e.g. specific rules keyed to old variant ids) where remapping changes **historical pricing intent** for uninvoiced trips.
- **Recurring rules** or **client_price_tags** still referencing old variants — migrate or leave catalog consistent in the same change window.

### 9.3 Catalog / related tables

If the obsolete **`billing_types`** row is deleted or orphaned variants removed, Postgres `ON DELETE` behavior on FKs (e.g. `SET NULL` on trips, `CASCADE` on some rule tables) can have **wider** effects than a targeted `UPDATE`. Prefer **data migration first**, then **retire** duplicate families only after nothing references them.

---

## 10. Senior recommendation

**Proceed with a two-phase approach: profile + narrow automated migration, not a blind global UPDATE.**

1. **Run the SQL in §4** (counts + mismatch report) and extend with breakdowns by `payer_id`, current `billing_variant_id`, and invoicing status. If zero rows reference the old id, the problem may already be data-only in **rules/recurring**, not trips.
2. **Validate target variant `ccc2dcb0-486c-4ed3-adb6-b581e5fbcd86`** with a query that checks `billing_variants.billing_type_id = 'f175a4b8-8126-4f07-827a-f4c5f5a2399d'` and payer consistency with affected trips.
3. **Automated migration** is appropriate **only** for rows that pass those checks and where product confirms a **single** Unterart mapping. Use a **transaction**; optionally **recompute prices** for affected uninvoiced trips afterward.
4. **Broader refactor first** is **not** mandatory for a one-off id remap, but **should** be scheduled if you want long-term correctness: align all trip mutation paths to **derive `billing_type_id` from `billing_variant_id`** (or enforce with a DB trigger) so the denormalized column cannot drift after this cleanup.

**Verdict:** **Partial automated migration with a mandatory profiling/mismatch gate**, plus **catalog/rule/recurring** review in the same effort — **not** a silent full refactor, and **not** purely manual unless profiling shows heterogeneous mappings or high business risk per row.
