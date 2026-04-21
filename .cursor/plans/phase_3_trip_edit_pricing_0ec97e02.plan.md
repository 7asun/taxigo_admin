---
name: Phase 3 Trip Edit Pricing
overview: Add price recalculation to every trip update path that writes a pricing-relevant field. Two new pure/async helpers are added to trip-price-engine.ts; the central service function and four direct update paths are wired to use them.
todos:
  - id: audit-doc
    content: Read all update paths in full, answer Q1–Q6, write findings to docs/plans/phase3-edit-audit.md
    status: completed
  - id: add-helpers
    content: Add shouldRecalculatePrice and resolveTripForPricing to trip-price-engine.ts; bun run build must pass
    status: completed
  - id: wire-service
    content: Wire recalculation in tripsService.updateTrip (trips.service.ts)
    status: completed
  - id: wire-reschedule
    content: Wire recalculation in rescheduleTripWithOptionalPair (reschedule.actions.ts) — primary and partner legs
    status: completed
  - id: wire-resolve-clients
    content: Wire recalculation in handleCreateAndLinkClient (resolve-clients-step.tsx)
    status: completed
  - id: wire-assign-billing-variant
    content: Convert assignBillingVariant batch to per-trip loop with price recalculation (unassigned-trips.service.ts)
    status: completed
  - id: wire-backfill-script
    content: Wire recalculation in backfill-driving-distance.ts main loop
    status: completed
  - id: build-gate-wiring
    content: bun run build must pass after all wiring changes
    status: completed
  - id: write-tests
    content: Add shouldRecalculatePrice (8) and edit-context computeTripPrice (3) tests to trip-price-engine.test.ts; bun test must pass
    status: completed
  - id: update-docs
    content: Update price-calculation-audit.md and price-calculation-engine.md for Phase 3
    status: completed
isProject: false
---

# Phase 3 — Price Recalculation on Trip Edit

## Audit findings (Step 1 — write to `docs/plans/phase3-edit-audit.md`)

### Q1 — Update paths

Paths that write pricing-relevant fields (need wiring):

- [`src/features/trips/api/trips.service.ts`](src/features/trips/api/trips.service.ts) — `updateTrip(id, trip)` — **central service**, covers all `tripsService.updateTrip` callers
- [`src/features/trips/trip-reschedule/api/reschedule.actions.ts`](src/features/trips/trip-reschedule/api/reschedule.actions.ts) — `rescheduleTripWithOptionalPair` — direct Supabase, writes `scheduled_at`
- [`src/features/trips/components/bulk-upload/resolve-clients-step.tsx`](src/features/trips/components/bulk-upload/resolve-clients-step.tsx) — `handleCreateAndLinkClient` — direct Supabase, writes `client_id`, `pickup_lat/lng`, `dropoff_lat/lng`
- [`src/features/unassigned-trips/api/unassigned-trips.service.ts`](src/features/unassigned-trips/api/unassigned-trips.service.ts) — `assignBillingVariant` — direct Supabase batch, writes `billing_variant_id`
- [`scripts/backfill-driving-distance.ts`](scripts/backfill-driving-distance.ts) — `main` loop — direct service-role Supabase, writes `driving_distance_km`

Paths that write only non-pricing fields (no wiring needed — `shouldRecalculatePrice` would return false anyway):
- cancel/skip/series helpers in `recurring-exceptions.actions.ts` — `status`, `canceled_reason_notes`
- `driver-select-cell.tsx` — `driver_id`, `status`
- `trip-hard-delete.ts`, `duplicate-trips.ts`, `generate-recurring-trips`, `bulk-upload-dialog.tsx` link patches — `linked_trip_id`, `link_type`
- `driver-trips.service.ts` — `status`, `actual_pickup_at`, `actual_dropoff_at`

### Q2 — All paths use partial patches ✓

### Q3 — Current row in scope
- `rescheduleTripWithOptionalPair`: YES — `primary` and `paired` full rows in scope, but spec mandates always fetching from DB in `resolveTripForPricing`
- All other paths: NO — only `id` available at update site

### Q4 — Central function
`tripsService.updateTrip` is the central function. Wiring it once covers all UI callers automatically. Four direct paths bypass it.

### Q5 — Guards
`rescheduleTripWithOptionalPair` has two guards (lines 52–60):
```typescript
if (isRecurringTrip(primary)) return { ok: false, error: ... }
if (!canRescheduleTrip(primary)) return { ok: false, error: ... }
```
Price recalculation must sit after these guards, before each update call. No guard exists in `updateTrip`.

### Q6 — `company_id`
Available from the current row fetched by `resolveTripForPricing` in all paths.

---

## Step 2 — New helpers in [`src/features/trips/lib/trip-price-engine.ts`](src/features/trips/lib/trip-price-engine.ts)

Add after the existing `computeTripPrice` function. Do not modify any existing code.

**`shouldRecalculatePrice`** — pure, single source of truth for the trigger field list:
```typescript
const PRICING_RELEVANT_FIELDS = [
  'payer_id', 'billing_type_id', 'billing_variant_id', 'client_id',
  'kts_document_applies',
  // driving_distance_km is primary; coordinate fields are a safety net for
  // two-write address edits: first write (addresses) recalculates at old
  // distance, second write (driving_distance_km) recalculates at correct distance.
  'driving_distance_km',
  'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
  'scheduled_at',
] as const;

export type PricingRelevantField = typeof PRICING_RELEVANT_FIELDS[number];

export function shouldRecalculatePrice(
  patch: Partial<Record<string, unknown>>
): boolean {
  return PRICING_RELEVANT_FIELDS.some(field => field in patch);
}
```

**`resolveTripForPricing`** — async, fetches current row, merges patch, nulls `net_price`:
```typescript
export async function resolveTripForPricing(
  supabase: SupabaseClient<Database>,
  tripId: string,
  patch: Partial<Database['public']['Tables']['trips']['Update']>
): Promise<(ComputeTripPriceInput & { company_id: string }) | null>
```
- Fetches only the 9 needed columns: `company_id, payer_id, billing_type_id, billing_variant_id, client_id, driving_distance_km, scheduled_at, kts_document_applies, net_price`
- Patch fields take priority over DB values via `??`
- `net_price` is always `null` — stored value is a historical snapshot, must not feed the P3 fallback
- Returns `null` on error; caller proceeds with update unmodified

---

## Step 3 — Wiring pattern

Applied to each path below. Imports needed: `shouldRecalculatePrice`, `resolveTripForPricing`, `loadPricingContext`, `computeTripPrice` from `trip-price-engine`.

```typescript
if (shouldRecalculatePrice(patch)) {
  const tripInput = await resolveTripForPricing(supabase, tripId, patch);
  if (tripInput) {
    const context = await loadPricingContext({
      supabase,
      companyId: tripInput.company_id,
      payerId: tripInput.payer_id,
      clientId: tripInput.client_id,
    }).catch(e => {
      console.error('[trip-price-engine] loadPricingContext failed on edit', tripId, e);
      return null;
    });
    if (context) {
      Object.assign(patch, computeTripPrice(tripInput, context));
    }
  }
}
// existing update call follows unchanged
```

### Path 1 — `tripsService.updateTrip` (central)

Insert the wiring block after `const supabase = createClient();` and before the `supabase.from('trips').update(trip)` chain. The parameter name is `trip` (the patch).

### Path 2 — `rescheduleTripWithOptionalPair`

Apply the pattern twice — once for the primary leg update, once for the partner leg update. Both must sit after the existing guards and before each `supabase.from('trips').update(...)` call.

`rowFromLeg` always includes `scheduled_at` (even as `null`) so `shouldRecalculatePrice` will always be true here. The wiring can be inlined without the `if` guard, but keeping it is a no-cost safety check.

### Path 3 — `handleCreateAndLinkClient` (resolve-clients-step.tsx)

This path is inside a React client component event handler. `loadPricingContext` accepts any Supabase client, so using the browser client here is architecturally correct.

**Required before wiring:** the update payload is currently an inline object literal passed directly into `.update({...})`. `Object.assign` requires a named mutable variable as its target — mutating an inline literal has nowhere to land. Extract it first:

```typescript
// Before (current code — inline literal, cannot be mutated):
await supabase
  .from('trips')
  .update({
    client_id: client.id,
    client_name: ...,
    ...(lat !== null && lng !== null ? { pickup_lat: lat, ... } : {})
  })
  .eq('id', current.tripId);

// After (named variable — required for Object.assign):
const tripPatch: UpdateTrip = {
  client_id: client.id,
  client_name: ...,
  ...(lat !== null && lng !== null ? { pickup_lat: lat, ... } : {})
};
// wiring block (shouldRecalculatePrice, resolveTripForPricing, loadPricingContext, computeTripPrice)
// Object.assign(tripPatch, computeTripPrice(...)) is valid here
await supabase.from('trips').update(tripPatch).eq('id', current.tripId);
```

`UpdateTrip` is imported from `@/features/trips/api/trips.service` and is already the correct type for `supabase.from('trips').update(...)`. No new type import is needed if `trips.service` is already in scope; otherwise import it.

### Path 4 — `assignBillingVariant` (batch → per-trip loop)

The batch `.update({billing_variant_id}).in('id', tripIds)` must be replaced with a per-trip loop because price computation is per-trip (different payer/client contexts). The end result for `billing_variant_id` is identical; the structure changes from one batch write to N individual writes that each include the recalculated price fields.

```typescript
async assignBillingVariant(tripIds: string[], billingVariantId: string): Promise<void> {
  const supabase = createClient();
  for (const tripId of tripIds) {
    const patch: UpdateTrip = { billing_variant_id: billingVariantId };
    // wiring block (shouldRecalculatePrice, resolveTripForPricing, loadPricingContext, computeTripPrice)
    const { error } = await supabase.from('trips').update(patch).eq('id', tripId);
    if (error) { console.error(...); throw toQueryError(error); }
  }
}
```

### Path 5 — `backfill-driving-distance.ts`

Apply inside the existing per-trip loop, between the Google call and the `.update({driving_distance_km, driving_duration_seconds})`. Extract the update payload to a named variable, apply the wiring block, then write.

---

## Step 4 — Tests

Add to [`src/features/trips/lib/__tests__/trip-price-engine.test.ts`](src/features/trips/lib/__tests__/trip-price-engine.test.ts):

**`shouldRecalculatePrice` (8 tests — pure, no mocks needed):**
- Returns `true` for: `payer_id`, `driving_distance_km`, `kts_document_applies`, `pickup_lat`, `dropoff_lng`
- Returns `false` for: `{ status, notes }`, `{ driver_id }`, `{}`

**`computeTripPrice` in edit context (3 tests — simulated merged input):**
- Patch changes `payer_id`: merged input uses new payer's rule → correct price
- `net_price` from current row never used as P3: merged input has `net_price: null`, empty context → all-null
- Coordinate-only patch: `{ pickup_lat }` triggers recalculation; merged input uses `current.driving_distance_km = 5.0` → correct tiered price

---

## Step 5 — Docs

- New: [`docs/plans/phase3-edit-audit.md`](docs/plans/phase3-edit-audit.md) — Q1–Q6 answers (created in Step 1)
- [`docs/plans/price-calculation-audit.md`](docs/plans/price-calculation-audit.md) — Phase 3 applied note
- [`docs/price-calculation-engine.md`](docs/price-calculation-engine.md):
  - Move edit path from deferred to wired paths table
  - Document `shouldRecalculatePrice` and the full field list with two-write explanation
  - Document `resolveTripForPricing` merge logic and `net_price: null` invariant

---

## Build Gates

1. After `trip-price-engine.ts` changes → `bun run build` passes
2. After all update path wiring → `bun run build` passes
3. After tests → `bun test` passes (all tests green)