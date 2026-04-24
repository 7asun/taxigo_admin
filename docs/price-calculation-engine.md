# Price Calculation Engine

> Phase 1 — applied 2026-04-19.  
> Three price fields (`net_price`, `gross_price`, `tax_rate`) are now stamped on every new trip row at creation time.  
> Phase 2 — applied 2026-04-19.  
> Trip duplication path wired. Every duplicated trip is priced fresh; source `net_price` is never inherited.  
> Phase 3 — applied 2026-04-19.  
> Trip edit path wired. Every update that touches a pricing-relevant field triggers a fresh recalculation via `shouldRecalculatePrice` + `resolveTripForPricing` + `computeTripPrice`.  
> Phase 4 / Pass C — applied 2026-04-19.  
> `billing_type_id` backfill added to `scripts/backfill-driving-distance.ts`. Pass C derives `billing_type_id` from `billing_variants` for trips where the field was null, then selectively re-prices those trips via `runPriceForTripIds`. This corrects historical trips that fell through to the STEP 3 payer-wide fallback instead of the correct STEP 2 type-level rule. Run with `--pass-c`.

---

## Purpose

Every trip row must carry `net_price`, `gross_price`, and `tax_rate` at creation so that:

- Invoices can be generated without a live re-calculation.
- Dispatchers see pricing immediately in the trip list and detail sheet.
- VAT is locked to the correct rate based on the distance known at creation time.

---

## Architecture

```
Creation / edit paths          Engine                      Pure resolvers (unchanged)
─────────────────────          ──────────────────────────  ──────────────────────────
create-trip-form.tsx     ──►  loadPricingContext()         resolvePricingRule()
bulk-upload-dialog.tsx   ──►  computeTripPrice()      ──►  resolveTripPrice()
generate-recurring-trips ──►  shouldRecalculatePrice()     resolveTaxRate()
duplicate/route.ts       ──►  resolveTripForPricing()
tripsService.updateTrip  ──►
rescheduleTripWithOptionalPair ──►
handleCreateAndLinkClient ──►
assignBillingVariant     ──►
backfill-driving-distance ──►
```

**File**: `src/features/trips/lib/trip-price-engine.ts`

---

## `loadPricingContext`

**Signature**

```typescript
async function loadPricingContext(params: {
  supabase: SupabaseClient<Database>;
  companyId: string;
  payerId: string | null;
  clientId: string | null;
}): Promise<PricingContext>
```

**What it loads**

| Data | Source table | Condition |
|------|-------------|-----------|
| Billing pricing rules (filtered to payer's catalog) | `billing_pricing_rules` | `company_id` + payer/type/variant filter |
| Active client price tags | `client_price_tags` | `client_id` + `is_active = true` |
| Legacy client price tag | `clients.price_tag` | `client_id` |

**Early returns**

- `payerId = null` → `{ rules: [], clientPriceTags: [], clientPriceTag: null }`
- `clientId = null` → `clientPriceTags = []`, `clientPriceTag = null` (rules still loaded)

**Concurrency**

The three-query rule chain runs sequentially (each step depends on the prior). The two client queries run in parallel with the rule chain via `Promise.all`. Total round-trips: 3 (rules) + 2 (client data, in parallel) = 3 serial + 1 parallel batch.

**Why no session-bound helpers are reused**

`listPricingRulesForPayer` and `listClientPriceTagsForClientIds` call `getSessionCompanyId()` and `createClient()` internally — they are tied to a browser session. `loadPricingContext` accepts an explicit `supabase` parameter so the same function works in browser, server action, and service-role cron contexts.

**Caller contract**

- Callers must wrap in `try/catch`. A failed load must never block a trip save.
- Cache by `${companyId}:${payerId}:${clientId}` when processing multiple trips in one batch.

---

## `computeTripPrice`

**Signature**

```typescript
function computeTripPrice(
  trip: {
    payer_id: string | null;
    billing_type_id: string | null;
    billing_variant_id: string | null;
    client_id: string | null;
    driving_distance_km: number | null;
    scheduled_at: string | null;
    kts_document_applies: boolean;
    net_price: number | null;
  },
  context: PricingContext
): TripPriceFields  // { net_price, gross_price, tax_rate }
```

**Pure**: no I/O, no side effects.

**Execution sequence**

1. `payer_id === null` → return all-null immediately (trip has no payer, cannot price).
2. `resolveTaxRate(driving_distance_km)` → `taxRate` (7% for < 50 km, 19% for ≥ 50 km, 7% fallback for null).
3. Build `TripPriceInput` — maps `context.clientPriceTag` into `client: { price_tag }`.
4. `resolvePricingRule(...)` → active `BillingPricingRuleLike | null`.
5. `resolveTripPrice(tripInput, taxRate, rule)` → `PriceResolution`.
6. If `resolution.net === null` → return all-null (no price resolved).
7. Return `{ net_price: resolution.net, gross_price: resolution.gross, tax_rate: taxRate }`.

**Tax rate storage rule**

`tax_rate` is stored as `null` whenever `net_price` is `null`. A rate without a price is meaningless and would mislead invoice builders.

---

## P0–P4 Waterfall (Spec C, unchanged)

| Priority | Trigger | Source |
|----------|---------|--------|
| P0 | `kts_document_applies = true` | KTS override → `net = 0`, `gross = 0` |
| P1 | Active `client_price_tags` match (variant → payer → global) | `client_price_tag` strategy (all-in gross → net) |
| P1b | Legacy `clients.price_tag` (when no P1 tag exists) | `client_price_tag` strategy |
| P2 | Active `billing_pricing_rules` match (variant → type → payer) | Strategy: `tiered_km`, `fixed_below_threshold_then_km`, `time_based`, `manual_trip_price`, `no_price` |
| P3 | `trips.net_price` already set | `trip_price_fallback` |
| P4 | Nothing resolved | `unresolved` — all-null |

---

## VAT Rules

All MwSt logic lives exclusively in `src/features/invoices/lib/tax-calculator.ts`.

| Distance | Rate | Legal basis |
|----------|------|-------------|
| < 50 km | 7% (Ermäßigter Steuersatz) | §12 Abs. 2 Nr. 10 UStG |
| ≥ 50 km | 19% (Regelsteuersatz) | §12 Abs. 2 Nr. 10 UStG |
| null (unknown) | 7% fallback | Conservative — update if distance is later backfilled |

---

## Wired creation paths

| Path | File | Wiring pattern |
|------|------|----------------|
| Manual form (anonymous + passenger modes) | `src/features/trips/components/create-trip/create-trip-form.tsx` | Context map per unique `(payerId, clientId)` pair loaded before trip inserts; `computeTripPrice` spread into each `tripsService.createTrip` call |
| CSV bulk upload | `src/features/trips/components/bulk-upload-dialog.tsx` | Context map built from all outbound rows (Pass 0b); `computeTripPrice` applied to each outbound and return payload before `bulkCreateTrips`. **Phase 5 (2026-04-24):** `billing_type_id` is stamped from the resolved variant’s `billing_type_id` (same invariant as create-trip-form and the recurring-trips cron), not from the CSV Abrechnungsart name match alone. Upload refuses to start while `billingTypeTree` is still empty so a load race cannot null out `billing_type_id` on every row without feedback. |
| Recurring rules cron | `src/app/api/cron/generate-recurring-trips/route.ts` | `cronContextMap` declared before rule loop; context loaded inside rule loop after client fetch and payer_id guard; `computeTripPrice` spread into outbound and return payloads before `insertIfAbsent` |
| Trip duplication | `src/app/api/trips/duplicate/route.ts` + `src/features/trips/lib/duplicate-trips.ts` | Route pre-fetches source trips, builds context map, passes `getCtx` to `executeDuplicateTrips`; `computeTripPrice` called after `enrichInsertWithMetrics` at all three insert sites (single, outbound, return); source `net_price` nulled before computation to prevent P3 inheritance |

## Wired edit paths (Phase 3)

All edit paths follow this pattern: `shouldRecalculatePrice(patch)` guards the block; `resolveTripForPricing(supabase, tripId, patch)` fetches the current row and merges the patch (net_price always null); `loadPricingContext` loads rules; `computeTripPrice` produces the new price fields; `Object.assign(patch, priceFields)` writes them into the patch before the DB update. A failed `loadPricingContext` is swallowed — price is derived data and must never block a save.

| Path | File | Notes |
|------|------|-------|
| All UI edit callers (central) | `src/features/trips/api/trips.service.ts` — `updateTrip` | Single wiring point covering `TripDetailSheet`, `KanbanBoard`, `PendingAssignments`, `PendingToursWidget`, `TimelessRuleTripsWidget`, `TripFremdfirmaSection`, `createLinkedReturn` |
| Reschedule dialog (primary + partner legs) | `src/features/trips/trip-reschedule/api/reschedule.actions.ts` — `rescheduleTripWithOptionalPair` | Sits after `isRecurringTrip` / `canRescheduleTrip` guards; wired for both leg updates |
| Bulk upload client linking | `src/features/trips/components/bulk-upload/resolve-clients-step.tsx` — `handleCreateAndLinkClient` | Inline `.update({...})` extracted to named `tripPatch: UpdateTrip` variable before `Object.assign` |
| Unassigned trips — assign billing variant | `src/features/unassigned-trips/api/unassigned-trips.service.ts` — `assignBillingVariant` | Converted from single batch update to per-trip loop; price context differs per trip |
| Driving distance + price backfill script | `scripts/backfill-driving-distance.ts` — Pass A loop | Update payload extracted to named variable; price recalculation runs inside the per-trip loop via `shouldRecalculatePrice` / `resolveTripForPricing` |

---

## `shouldRecalculatePrice`

Pure synchronous function. Returns `true` when a patch object contains at least one of the following fields (checked via `field in patch`, so `null` values still trigger):

| Category | Fields |
|----------|--------|
| Billing context | `payer_id`, `billing_type_id`, `billing_variant_id`, `client_id`, `kts_document_applies` |
| Distance / route | `driving_distance_km`, `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng` |
| Timing | `scheduled_at` |

Coordinate fields are included as a safety net for two-write address edits: when a form writes new addresses (with stale distance) in the first write and `driving_distance_km` in a second write, both writes trigger recalculation. The first uses the old distance; the second uses the correct one. No edit path can silently skip recalculation.

---

## `resolveTripForPricing`

Async. Fetches the minimum required columns from the current `trips` row, overlays the patch (patch wins via `??`), and returns a `ComputeTripPriceInput` extended with `company_id`.

- Always fetches from DB even when the caller has the row in scope, to guarantee the merge uses the latest committed state.
- `net_price` is always `null` in the returned input — the stored value is a historical snapshot and must never feed the P3 fallback of the recalculated price.
- Returns `null` on error; callers proceed with the update unmodified.

---

## Implementation files

| File | Role |
|------|------|
| `src/features/trips/lib/trip-price-engine.ts` | `loadPricingContext`, `computeTripPrice`, `shouldRecalculatePrice`, `resolveTripForPricing` |
| `src/features/trips/lib/__tests__/trip-price-engine.test.ts` | 19 unit tests: `computeTripPrice` (8), `shouldRecalculatePrice` (8), edit-context `computeTripPrice` (3) |
| `src/features/trips/lib/__tests__/duplicate-trips.test.ts` | 3 unit tests for the duplication price invariant (Phase 2) |
| `docs/plans/phase3-edit-audit.md` | Audit: all update paths, Q1–Q6 answers |
| `src/features/invoices/lib/resolve-pricing-rule.ts` | Pure rule resolution (P0–P2) — unchanged |
| `src/features/invoices/lib/resolve-trip-price.ts` | Pure price calculation — unchanged |
| `src/features/invoices/lib/tax-calculator.ts` | VAT rate resolution — unchanged |
| `src/features/invoices/api/invoice-line-items.api.ts` | `mapBillingPricingRuleRowsToLike` reused |

---

## Backfill (Phase 4)

`scripts/backfill-driving-distance.ts` backfills all existing trips that are missing price fields. Run with the service-role key in `.env.local`.

| Pass | Targets | What it writes |
|------|---------|---------------|
| Pass A | `driving_distance_km IS NULL` + coordinates present | `driving_distance_km`, `driving_duration_seconds`, then price fields via `shouldRecalculatePrice` / `resolveTripForPricing` |
| Pass B (main) | `driving_distance_km IS NOT NULL` + any of `net_price`, `gross_price`, `tax_rate` is NULL | `net_price`, `gross_price`, `tax_rate` only — distance untouched |
| Pass B (fix-window) | `driving_distance_km IS NOT NULL` + `created_at` on 2026-04-19 | Same three price fields — overwrites existing values (approach_fee_net was missing on go-live day) |

**CLI flags**

```bash
bun run tsx scripts/backfill-driving-distance.ts              # Pass A + Pass B
bun run tsx scripts/backfill-driving-distance.ts --pass-a     # Pass A only
bun run tsx scripts/backfill-driving-distance.ts --pass-b     # Pass B only
bun run tsx scripts/backfill-driving-distance.ts --dry-run    # Dry run (all passes, no writes to trips table)
```

**Dry-run note for Pass B:** the SELECT intentionally excludes the three price fields (they are not read, only written). The dry-run log therefore prints the freshly computed values from `computeTripPrice` — not the stored DB values — so the output is a truthful preview of what a live run would write.

---

## Related documentation

- [docs/plans/price-calculation-audit.md](./plans/price-calculation-audit.md) — Phase 0 audit that preceded this implementation.
- [docs/driving-metrics-api.md](./driving-metrics-api.md) — How `driving_distance_km` feeds into VAT determination.
