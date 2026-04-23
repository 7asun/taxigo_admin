# Audit: Trip price population — when does the engine run?

**Scope:** Read-only code and database review (April 23, 2026).

**Purpose:** Trace where `computeTripPrice` / `loadPricingContext` / `resolveTripPrice` run, how `trips` price columns are filled, and whether **trips-as-primary** is safe without a backfill or further work.

---

## 1. When does the engine run?

### 1.1 `computeTripPrice` + `loadPricingContext` (writes `trips.net_price` / `gross_price` / `tax_rate`)

These live in `src/features/trips/lib/trip-price-engine.ts`. `computeTripPrice` calls `resolveTripPrice` and then stores **transport net + `approach_fee_net`** in `net_price` (and derives `gross_price` / `tax_rate`).

**Runs in application code, not from a DB trigger** (migrations add columns/comments only; no trigger populates these fields).

| Context | When | Notes |
|--------|------|--------|
| **Create trip (UI)** | `create-trip-form` submit | Loads `loadPricingContext` per (payer, client) pair; spreads `...computeTripPrice(...)` into `tripsService.createTrip`. |
| **Bulk upload** | `bulk-upload-dialog` (and `resolve-clients-step`) | After resolving billing/client context, merges `computeTripPrice` into insert payloads. |
| **Duplicate trips** | `duplicate-trips.ts` + `app/api/trips/duplicate/route.ts` | Recomputes with cached `PricingContext` per (company, payer, client). |
| **Recurring / cron** | `app/api/cron/generate-recurring-trips/route.ts` | Service-role Supabase; geocodes / driving metrics, then `loadPricingContext` + `computeTripPrice` on generated inserts. |
| **Edit trip** | `tripsService.updateTrip` | If `shouldRecalculatePrice(patch)` is true, loads context and merges `computeTripPrice` into the update. **Important:** `resolveTripForPricing` forces `net_price: null` in the compute input so the **stored** trip net does not feed the P3 fallback during recalculation (avoids “sticky” old snapshots). |
| **Reschedule** | `trip-reschedule/.../reschedule.actions.ts` | Same pattern as update when time/route fields change. |
| **Unassigned → assign variant** | `unassigned-trips.service.ts` | Recomputes when assigning billing. |
| **Backfill / maintenance** | `scripts/backfill-driving-distance.ts` | Re-runs `computeTripPrice` when distance or related fields are fixed. |

**Does *not* run on bare insert:** `tripsService.createTrip` and `bulkCreateTrips` only `insert` the payload. Any path that calls them **without** first merging `computeTripPrice` leaves price columns **null** (unless the insert explicitly set them).

**Example gap:** `buildReturnTripInsert` + `createLinkedReturnForOutbound` builds a return leg and calls `createTrip` with **no** `net_price` / `gross_price` / `tax_rate` — so those stay **null** until a pricing-relevant `updateTrip` (or another flow) runs.

### 1.2 `resolveTripPrice` (pure Spec C cascade)

- **Not** a separate “second engine” — it is the canonical cascade used:
  - **Inside** `computeTripPrice` (to derive stored trip fields), and
  - **Inside the invoice builder** via `buildLineItemsFromTrips` in `invoice-line-items.api.ts` (imported as `resolveTripPricePure`).

So the **same** priority rules apply to both DB snapshots and in-builder line items, but **call sites differ** (e.g. edit path nulls `net_price` in the compute input; the builder passes the **actual** `trip.net_price` from the query — see §3).

### 1.3 Supabase Edge Functions / trip sync

**No** `supabase/functions` trip-sync Edge Functions were found in this repository. **Trip materialization** for recurring rules is implemented as a **Next.js API route** cron (`generate-recurring-trips`), not an Edge Function.

### 1.4 Answer summary (Q1)

| Question | Answer |
|----------|--------|
| Is `resolveTripPrice` / pricing only when invoice builder loads? | **No.** It runs in many flows. The **builder always** runs `resolveTripPrice` when building line items, but **trip rows are also** priced at create/duplicate/cron/update (when the code path uses `computeTripPrice`). |
| Triggers / Edge / external populating `net_price` / `gross_price` / `tax_rate`? | **No DB triggers** for these fields found. **No** trip-sync Edge Function in repo. **Cron** = Next route with service role. **Post-invoice** writeback updates trips from the builder (see §3.2). |

---

## 2. Current state of trip price fields

### 2.1 Are `net_price` / `gross_price` / `tax_rate` populated for all trips?

**No — not guaranteed.**

- **Application-only** population: inserts without `computeTripPrice` leave nulls; historical rows may predate pricing columns (`20260418120000_trips-price-schema.sql` renamed `price` → `net_price` and added `gross_price` / `tax_rate` / `billing_type_id`).
- **After invoicing** (see §3.2), `updateTrip` writes `net_price` / `gross_price` / `tax_rate` (and sometimes `manual_gross_price`).

**Empirical count** (one-off query against the Supabase project configured in `.env.local` at audit time — **treat as environment-specific**, not a production guarantee without your own run):

| Metric | Value |
|--------|--------|
| Total `trips` | 1295 |
| `net_price IS NULL` | 87 |
| `net_price` populated | 1208 |

So **most** rows have a stored net price; a **non-zero** share is still null.

### 2.2 `manual_gross_price` (recent migration)

- **Schema:** `supabase/migrations/20260423100000_add_trip_manual_gross_price.sql` adds `trips.manual_gross_price` with a comment that **P0.5 in `resolveTripPrice` is deferred** (not implemented yet).
- **Code:** The only **write** found is in `use-invoice-builder.ts` when creating an invoice with a **manual gross override** (`isManualOverride && manualGrossTotal`).

**Conclusion:** Column exists; **gross-override** is persisted from the invoice path only. **`resolveTripPrice` does not read `manual_gross_price` today** (no references outside types + that write).

---

## 3. Invoice builder: `buildLineItemsFromTrips` and `resolveTripPrice` priority

### 3.1 What `buildLineItemsFromTrips` does

Defined in `src/features/invoices/api/invoice-line-items.api.ts`.

1. For each `TripForInvoice`, computes **VAT** with `resolveTaxRate(trip.driving_distance_km)`.
2. Resolves the **active billing rule** with `resolvePricingRule({ rules, payerId, billingTypeId, billingVariantId, clientId, clientPriceTags })`.
3. Calls **`resolveTripPricePure`** (same as `resolveTripPrice`) with:

   - `kts_document_applies` from the trip  
   - **`net_price: trip.net_price ?? null` **(stored column is an **input** to the cascade)  
   - `driving_distance_km`, `scheduled_at`, and embedded `client` (incl. legacy `price_tag`).

4. Maps the result into `BuilderLineItem` (unit, quantity, `price_resolution`, approach fee fields, etc.).

**Does it “read `trips.net_price` only”?** It **selects** `net_price` in `fetchTripsForBuilder` and **passes** it into `resolveTripPrice`, but it **always** runs the **full** cascade. Stored net is **not** a bypass of the engine: it is **Priority 3** — used only if higher priorities do not already determine the price. So it is *not* “engine only if null”; it is “engine every time, with P3 = stored net fallback.”

### 3.2 After invoice create (`use-invoice-builder.ts`)

On successful `createInvoice` + `insertLineItems`, the hook **fire-and-forget** `updateTrip` for each line with a `trip_id`, setting `gross_price`, `tax_rate` (and `manual_gross_price` when the user overrode gross), plus `base_net_price` and `approach_fee_net` from the line resolution, and **`net_price` = transport net + `approach_fee_net`** (aligned with `computeTripPrice` / the engine invariant). So trips that have been **invoiced through this path** get their columns aligned with the **last** created invoice line math for that run.

**Update (2026-04-24, Phase 1):** this corrects a prior skew where `net_price` on writeback was **transport only**; stored `net_price` is now the **combined** net for new writes. Historical rows may still reflect the old behaviour until backfilled.

### 3.3 `resolveTripPrice` priority order (Spec C)

Source of truth: file header and body of `src/features/invoices/lib/resolve-trip-price.ts`.

| Priority | Name | Behavior |
|----------|------|----------|
| **P0** | KTS | If `kts_document_applies === true` → **€0** (fixed resolution). |
| **P1** | Client gross | Client price tag wins: `rule._price_gross` (from `client_price_tags` / `resolvePricingRule` step 0) if valid, else **legacy** `clients.price_tag`. Gross → net via `tag / (1 + taxRate)`. **Beats** catalog rules. |
| **P2** | Billing rule strategies | If a rule is active, `executeStrategy` by `rule.strategy` may return a resolution, then **`approach_fee_net`** from rule config is attached. Sub-strategies include: `client_price_tag` (uses `trip.net_price` as fallback if tag missing), `manual_trip_price`, `no_price`, `tiered_km`, `fixed_below_threshold_then_km`, `time_based`. |
| **P3** | Stored trip net | If still unresolved and `trip.net_price != null` → **trip price fallback** (`trip_price` source), with approach fee from rule when applicable. |
| **P4** | Unresolved | `no_price` / missing line until manual handling in UI. |

**`applyGrossOverrideToResolution`** (Step 3 gross override) adjusts an existing `PriceResolution`; it is not part of the default P0–P4 chain.

---

## 4. Risk of switching the invoice builder to “trips-first” (skip engine when `net_price` is set)

### 4.1 Null `net_price` in the database

See §2.1 — in the audited environment **~6.7%** of rows had null `net_price`. Any “read-only if populated” strategy **must** define behavior for nulls (re-run full resolution vs block vs manual).

### 4.2 What breaks or degrades if the builder **skips** `resolveTripPrice` whenever `trips.net_price` is non-null?

1. **Stale data vs current catalog**  
   P1 (client / price tags) and P2 (rules, distance, time-based) can **change** after the trip was last priced. The builder currently **re-evaluates** P0–P2 every time, so a stored P3 net from last month may **differ** from what the cascade would produce today. Trips-first without invalidation would **lock in** old economics.

2. **KTS and compliance**  
   If `kts_document_applies` or catalog rules change, trusting only `net_price` could **invoice a non-zero** amount when P0 would now force €0, or the opposite. Today P0 is evaluated on each builder load.

3. **Edit-path semantics**  
   `resolveTripForPricing` **intentionally** does **not** pass stored `net_price` into `computeTripPrice` on update (forces `null`) so P3 does not **anchor** to an outdated snapshot. A builder that always trusts the row would be **inconsistent** with that design for trips that were updated after their snapshot was written.

4. **`manual_gross_price` is not in the resolver**  
   A trips-first read would need a defined rule for when **manual** gross on the row overrides engine output (comment in migration: deferred).

5. **Alignment with line-item structure**  
   The builder exposes transport vs Anfahrt **separately** on the line. **Phase 1 (2026-04-24)** also persists `base_net_price` and `approach_fee_net` on `trips` (plus combined `net_price`) for **new** `computeTripPrice` and post-invoice writeback paths. **Historically** many rows have only `net_price` (mixed semantics) or nulls. A trips-first flow that **skips** the resolver still risks stale catalog vs line math unless split columns are **backfilled** and kept current.

6. **Trips that never got `computeTripPrice` on insert** (e.g. some return legs) may still be **invoiced** if the full cascade can price them — but a naive “if `net_price` then use only” would **fail** or diverge for those with nulls.

### 4.3 If the builder **only** short-circuits when populated (hypothetical)

Even then, you need: **versioning** or **recompute** triggers when billing rules, tags, KTS, distance, or time fields change, plus agreement on P0–P2 vs stored P3. **Otherwise** trips-as-primary is a **cache** of a past engine output, not the live spec.

---

## 5. Recommendation (senior-level)

**The codebase is not ready to treat `trips.net_price` as the single source of truth for invoice line building *today* without additional design and likely a data migration pass.**

- **Behavioral gap:** The intended contract is the **Spec C cascade** (`resolveTripPrice` + current rule/tag catalog), re-run at invoice build time. `trips` columns are a **denormalized snapshot** (from `computeTripPrice` at create/update, and **overwrite** on invoice in some cases), not a guaranteed authoritative replica of “what the engine would say right now.”
- **Data gap:** A measurable fraction of rows still have **null** `net_price` in a real project DB; a trips-only read would need a **fallback** to full resolution (i.e. you still need the engine).
- **Product gap:** `manual_gross_price` is **not** consumed in `resolveTripPrice` yet; trips-first would need a clear priority vs engine output.

**Practical path if you want trips-as-primary eventually:**

1. **Backfill** (or accept nulls and branch): ensure every **invoice-eligible** trip has a well-defined stored triple *or* explicitly fall back to full `resolveTripPrice`.  
2. **Invalidation / versioning:** when pricing inputs change, either **clear** denormalized prices or **bump a version** and recompute.  
3. **Unify semantics:** document and test **transport vs Anfahrt** in stored `net_price` vs line items.  
4. **Only then** consider short-circuiting the builder (likely behind a feature flag) with **parity tests** against full resolution.

**Bottom line:** A **one-shot backfill of engine output into all trips** is a reasonable **milestone** for reporting and UX, but it **does not** by itself replace re-running the cascade at invoice time unless you also add **staleness** rules. **Trips-as-primary for the invoice builder today** would risk incorrect invoices whenever catalog or trip facts drift — **a migration step plus invalidation policy** (not just a backfill) is advised before cutover.

---

## 6. Key file map

| File | Role |
|------|------|
| `src/features/trips/lib/trip-price-engine.ts` | `loadPricingContext`, `computeTripPrice`, `shouldRecalculatePrice`, `resolveTripForPricing` |
| `src/features/invoices/lib/resolve-trip-price.ts` | `resolveTripPrice`, `applyGrossOverrideToResolution` (Spec C) |
| `src/features/trips/api/trips.service.ts` | `updateTrip` integration of engine; raw `createTrip` has no engine |
| `src/features/invoices/api/invoice-line-items.api.ts` | `fetchTripsForBuilder`, `buildLineItemsFromTrips` |
| `src/features/invoices/hooks/use-invoice-builder.ts` | Trips query → `buildLineItemsFromTrips`; post-invoice `updateTrip` writeback |
| `src/types/database.types.ts` | `trips` Row includes `net_price`, `gross_price`, `tax_rate`, `manual_gross_price` |
| `app/api/cron/generate-recurring-trips/route.ts` | Server cron pricing for generated trips |
| `supabase/migrations/20260418120000_trips-price-schema.sql` | Introduced/renamed price columns |
| `supabase/migrations/20260423100000_add_trip_manual_gross_price.sql` | `manual_gross_price` + deferred P0.5 note |

---

## Implementation status (trip price SSOT — 2026-04-23)

**Implemented (plan `trip_price_ssot_26690d29`).**

- **P0 taxameter:** `trips.manual_gross_price` is passed into `TripPriceInput` and wins first in `resolveTripPrice` (`source: 'manual_gross_price'`). No `withApproachFeeFromRule` on that path; `approach_fee_net: 0` (meter total is all-in). Priorities renumbered: KTS → P1, client tag → P2, rules → P3, stored net → P4, unresolved → P5.
- **Engine / edit:** `ComputeTripPriceInput` and `resolveTripForPricing` include `manual_gross_price` (merged from row; not nulled like `net_price` on recalc).
- **Invoice builder:** `fetchTripsForBuilder` selects `manual_gross_price`; `buildLineItemsFromTrips` passes it to `resolveTripPrice`.
- **Step 3 UI:** “Taxameter” when `source === 'manual_gross_price'` or `isManualOverride`; catalog `manual_trip_price` still “Manuell”.
- **Backfill:** `scripts/backfill-null-trip-net-prices.ts` for `net_price IS NULL AND payer_id IS NOT NULL` (run with service role; staging first).
- **Phase 1 (2026-04-24) — trip price split on `trips`:** nullable `base_net_price` and `approach_fee_net` added; `computeTripPrice` and invoice writeback keep **`net_price` = base + approach** for existing readers. Historical split: `scripts/backfill-trip-price-split.ts`. See `docs/plans/option-a-schema-split-audit.md` (Phase 1 status).

*End of audit.*

**Last updated:** 2026-04-24
