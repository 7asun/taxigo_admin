# Audit: Duplicate Flow — First Leg Created Without Price

**Scope:** Read-only code audit (no fixes applied).  
**Date:** 2026-04-24  
**Context:** With `resolve-pricing-rule.ts` behaviour confirmed, SQL still shows the **outbound** row (first by `created_at` in a duplicate pair) unpriced and the **return** row priced. This document traces the duplicate API and `executeDuplicateTrips` only.

**Related prior note:** Payer-wide / `tiered_km` resolution and null vs `undefined` are documented in `docs/plans/arzo-rzo-pricing-audit.md`.

---

## Summary of findings per question

### 1. How many trips per operation — always a pair, or variable? Where decided?

**Variable.** `partitionIntoDuplicateUnits` (`duplicate-trips.ts` lines 189–207) builds a list of **units**: either `{ kind: 'single'; trip }` (one new row) or `{ kind: 'pair'; outbound, ret }` (two new rows, Hin+Rück). A pair exists only when `findPartnerAmongTrips` finds a partner in the same expanded batch and both legs are not yet consumed (lines 193–201).

`executeDuplicateTrips` then loops `for (const unit of units)` (line 451) and either runs the **single** branch (lines 452–500) or the **pair** branch (lines 503–612).

**`includeLinkedLeg`:** When `includeLinkedLeg !== false` (default), `fetchTripsExpandedForDuplicate` can merge in a paired leg so a lone selection can become two rows (lines 108–114, 90–117). The route sets `includeLinkedLeg` from the payload (lines 54, 420–421 in lib).

**Conclusion:** Not always a pair; when it is a pair, **outbound is inserted first, then return** (comment and flow at lines 120–124, 503–612).

---

### 2. `loadPricingContext` — once per batch or per trip? Same object or fresh?

**Once per unique `(company_id, payer_id, client_id)` for the whole duplicate request**, not per insert.

In `src/app/api/trips/duplicate/route.ts`:

- A `Map` of keys → params is built from **all** `sourceTrips` (lines 62–75).
- `Promise.all` runs `loadPricingContext({ supabase: admin, companyId, payerId, clientId })` for each key and stores the result in `contextMap` (lines 83–96).
- `getCtx(trip)` returns `contextMap.get(key) ?? emptyCtx` (lines 98–105) where `key` is `` `${company_id}:${payer_id}:${client_id}` ``.

**Same in-memory `PricingContext` object** is reused for every `computeTripPrice` that shares that key; there is no second load per leg inside `executeDuplicateTrips` (`trip-price-engine.ts` contains `loadPricingContext` at 97–189; duplicate route is the only loader for this request).

**Note:** `executeDuplicateTrips` calls `fetchTripsExpandedForDuplicate` again internally (lines 422–427), but pricing context is **not** reloaded there — only the `getContext` function from the route is used.

---

### 3. Is `computeTripPrice` called for both legs? Call sites and lines?

**Yes, for a pair, both legs get `computeTripPrice` after `enrichInsertWithMetrics` and before each insert.**

| Leg        | `enrichInsertWithMetrics`     | `computeTripPrice` + `Object.assign`                          |
|-----------|--------------------------------|----------------------------------------------------------------|
| Outbound| `duplicate-trips.ts` 558     | 563–565: `Object.assign(outInsert, computeTripPrice(toComputeInput(outInsert), getContext(unit.outbound)))` |
| Return  | 583                            | 588–590: `Object.assign(retInsert, computeTripPrice(toComputeInput(retInsert), getContext(unit.ret)))`     |

**Single** duplicate unit: same pattern at 482, 487–490 with `getContext(unit.trip)`.

Signatures for `toComputeInput` and `computeTripPrice` are in `trip-price-engine.ts` (e.g. `ComputeTripPriceInput` at 193–206, `computeTripPrice` at 216–276).

There is **no** path that calls `computeTripPrice` for only one leg of a pair.

---

### 4. Single `bulkCreateTrips` or two inserts? Price fields on both rows?

**Two separate `insert` calls, not** `tripsService.bulkCreateTrips` **from the client** — the server uses the admin Supabase client directly.

- Outbound: `supabase.from('trips').insert(outInsert).select('id').single()` (lines 568–572).
- Return: `supabase.from('trips').insert(retInsert).select('id').single()` (lines 593–597).

Each `insert` payload is the result of `buildDuplicateInsert` + `enrichInsertWithMetrics` + `Object.assign(…, computeTripPrice(…))`, so **each row’s insert object is meant to include** `gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net` (whatever `computeTripPrice` returned) **before** that row’s `insert` runs.

`trips.service.ts` is **not** used** for the duplicate path’s inserts; there is no `createTrip` / `bulkCreateTrips` wrapper here (see `trips.service.ts` 42–59 for what those do).

---

### 5. Any conditional that skips pricing by `link_type`, index, or flags?

**No.** The pair path always:

1. builds `outInsert` with `link_type: null`, `linked_trip_id: null` (lines 551–555),
2. enriches and prices outbound (558–565),
3. inserts outbound and captures `outRow.id` (568–574),
4. builds `retInsert` with `link_type: 'return'`, `linked_trip_id: outRow.id` (576–580),
5. enriches and prices return (583–590),
6. inserts return (593–597),
7. then **updates** the outbound row with `linked_trip_id` and `link_type: 'outbound'` (601–607).

`toComputeInput` (duplicate-trips.ts 315–327) does **not** read `link_type`. Nothing in the shown pair branch **skips** `computeTripPrice` for the first leg. Index in `units` only controls order of *units*, not per-leg pricing inside a unit.

---

### 6. Async gap between context load and first insert — stale or incomplete context for leg 1?

**Context load finishes before any `executeDuplicateTrips` work:** the route `await Promise.all(…loadPricingContext…)` (lines 83–96) completes before `executeDuplicateTrips` (line 107), so the map is populated (or a key is missing and `getCtx` falls back to `emptyCtx` at 104) **before** the first `computeTripPrice`.

There is **no** `await` between the route’s context preload and the duplicate run that would reload rules for leg 1 only.

**Per-leg async:** between outbound and return, the code **awaits** `enrichInsertWithMetrics` for each leg (558, 583) before `computeTripPrice` for that leg. So the **intra-leg** order is: enrich → then price → then insert. The **asymmetry** the user sees is therefore not “context not ready for first insert in time,” unless the first leg uses **emptyCtx** (failed/missing key) and the second does not — which would require **different** `(company_id, payer_id, client_id)` on `getContext(unit.outbound)` vs `getContext(unit.ret)` (see hypothesis below).

---

### 7. Senior-level hypothesis: why the first **inserted** leg is unpriced and the second priced

**The duplicate flow is not “forgetting” to price the outbound leg** — `computeTripPrice` runs for both (`duplicate-trips.ts` 563–565 and 588–590). The resolver is assumed fixed; the difference must be in **inputs** to `computeTripPrice` / `resolveTripPrice` (e.g. `driving_distance_km`, `scheduled_at`, or **which** `PricingContext` is chosen).

**Most plausible: asymmetric inputs between `unit.outbound` and `unit.ret` as source rows.**

- Route and distance fields are copied in `copyRouteAndPassengerFields` from **each** source trip separately (lines 220–311; `driving_distance_km` and `driving_duration_seconds` at 307–308). The **Hin** and **Rück** source rows in the database can have **different** `driving_distance_km` (one backfilled, one not) or one leg **without** coordinates so `enrichInsertWithMetrics` (377–402) can only fill metrics for one leg.
- `enrichInsertWithMetrics` only calls `resolveDrivingMetricsWithCache` when `driving_distance_km` is null and all four lat/lng are numbers (lines 382–401). If outbound’s insert still has `driving_distance_km == null` after that (API/cache miss, bad coords on that leg’s copy), **`tiered_km` still yields `resolution.net === null`** in `resolveTripPrice` / `executeStrategy` (see `resolve-trip-price.ts` tiered path — distance required), so `computeTripPrice` returns all-null price fields (`trip-price-engine.ts` 255).
- The **return** source row may copy **non-null** `driving_distance_km` or get a successful enrich for the reverse route, so the **second** `computeTripPrice` succeeds.

**Secondary possibility:** `getContext(unit.outbound)` and `getContext(unit.ret)` build keys from `trip.company_id`, `trip.payer_id`, `trip.client_id` (route 98–104). If those **differ** between the two source legs (data inconsistency), one leg could resolve to `emptyCtx` (missing map entry) while the other hits a full context — that would also produce one leg priced and one not without any insert-order bug.

**Not supported by the code as written:** “second insert wins a race in `loadPricingContext`” (single preload), or “link_type suppresses the first leg’s pricing” (no such branch).

**Exact references for the hypothesis:** `duplicate-trips.ts` 303–308 (per-source copy of metrics), 377–402 (`enrichInsertWithMetrics`), 558–590 (order: enrich then `computeTripPrice` per leg); `route.ts` 62–105 (context map); `trip-price-engine.ts` 244–255 (`resolvePricingRule` + `resolveTripPrice` / null net).

---

## Root cause hypothesis (single paragraph, with line references)

The duplicate **pair** path always prices **outbound** then **return** with two separate `insert` calls (`duplicate-trips.ts` 551–612) and two `computeTripPrice` invocations (563–565, 588–590). Pricing context is preloaded **once** per deduped triple in `route.ts` (83–105) and shared via `getCtx`. The consistent pattern “**first** `created_at` (outbound) unpriced, **second** (return) priced” lines up with **asymmetric** `driving_distance_km` (and possibly coordinates / `scheduled_at`) between `unit.outbound` and `unit.ret` as copied in `copyRouteAndPassengerFields` and optionally updated in `enrichInsertWithMetrics`, not with skipping the first `computeTripPrice` or a bulk-insert bug. Confirm by comparing the two **source** trip rows and the two **insert** payloads (especially `driving_distance_km`, `scheduled_at`) for a failing pair.

---

## Recommended fix approach (one paragraph)

Treat this as a **data / enrichment parity** problem for duplicate pairs: after identifying failing pairs in SQL, compare `driving_distance_km` and `scheduled_at` on the **outbound** vs **return** `InsertTrip` (or on the source `Trip` rows) used in `toComputeInput`. If the outbound leg is missing distance while the return has it, fix by (a) backfilling source trips, (b) running metrics enrichment for the outbound leg in a way that does not give up when the return leg would succeed, or (c) **after both inserts** (or before pricing), deriving missing metrics for one leg from the other when the route is the obvious reverse. Optionally assert same `(payer, client, company)` on both `unit.outbound` and `unit.ret` so `getCtx` never returns `emptyCtx` for one leg only. Re-run `scripts/backfill-null-trip-net-prices.ts` for already-created duplicate rows that stored null prices. Any code change should be **local to `duplicate-trips.ts` (or shared metrics helpers)**, not to `resolve-pricing-rule.ts` if the resolver is already correct.

---

## File reference (duplicate pricing path only)

| File | Relevance |
|------|------------|
| `src/app/api/trips/duplicate/route.ts` | `loadPricingContext` batch, `getCtx`, `executeDuplicateTrips` — lines 51–113 |
| `src/features/trips/lib/duplicate-trips.ts` | `partitionIntoDuplicateUnits`, `executeDuplicateTrips` pair/single, `enrichInsertWithMetrics`, `toComputeInput`, `computeTripPrice` call sites — lines 189–207, 413–615, 315–327, 377–403 |
| `src/features/trips/lib/trip-price-engine.ts` | `loadPricingContext`, `computeTripPrice` — lines 97–189, 216–276 |
| `src/features/trips/api/trips.service.ts` | `duplicateTrips` client wrapper only; **not** the server insert path for duplicates — lines 130–158 |
