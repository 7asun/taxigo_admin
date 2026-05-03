---
name: Plan B place IDs B1-B3
overview: "Implement Plan B foundation (Steps 1–6): echo `place_id` from `/api/place-details`, extend `AddressGroupEntry` and create-trip form updaters, add nullable `pickup_place_id` / `dropoff_place_id` via migration + manual `database.types.ts` updates, persist both columns on all four `tripsService.createTrip` paths, then document. No cache or `google-directions` changes."
todos:
  - id: step-1-api
    content: "Step 1: Echo place_id in place-details/route.ts + build"
    status: completed
  - id: step-2-types-form
    content: "Step 2: AddressGroupEntry.placeId + create-trip-form updaters/prefill + build"
    status: completed
  - id: step-3-migration
    content: "Step 3: New migration add-place-ids-to-trips.sql + build"
    status: completed
  - id: step-4-types-push
    content: "Step 4: database.types.ts trips Row/Insert/Update + db push + build"
    status: completed
  - id: step-5-inserts
    content: "Step 5: Four createTrip paths with pickup/dropoff_place_id + build + test"
    status: completed
  - id: step-6-docs
    content: "Step 6: driving-metrics-api.md, pre-audit append, plan-b1-b3-implementation.md"
    status: completed
isProject: false
---

# Plan B — Place ID storage (Steps 1–6)

Ground truth for paths and behavior: [docs/plans/plan-b-place-id-pre-audit.md](docs/plans/plan-b-place-id-pre-audit.md). Types file: **[src/types/database.types.ts](src/types/database.types.ts)** (there is no `src/lib/supabase/database.types.ts`). Create-trip form: **[src/features/trips/components/create-trip/create-trip-form.tsx](src/features/trips/components/create-trip/create-trip-form.tsx)**.

Execute steps **in order**; run `**bun run build`** after Steps **1, 2, 3, and 4**; run `**bun run build`** and `**bun test**` after **Step 5**. Step **6** is documentation only (optional final build if desired).

---

## Step 1 — Echo `place_id` from `/api/place-details`

**File:** [src/app/api/place-details/route.ts](src/app/api/place-details/route.ts)

- Extend the success `NextResponse.json` object (~125–132) with `**...(placeId ? { place_id: placeId } : {})`** so the key is omitted if falsy (even though the `!placeId` branch already returns 400, this matches the spec and satisfies strict “no `null`” wording).
- Keep `**lat`, `lng`, `zip_code`, `street`, `street_number`, `city**` unchanged (same keys, same semantics).
- **Inline comment:** echo the **raw** query param (what the client sent / will store), not `placeResourceId` (internal normalization for the Places URL only).
- **Do not** change error responses.

**Note:** [address-autocomplete.tsx](src/features/trips/components/trip-address-passenger/address-autocomplete.tsx) already keeps `placeId` on `AddressResult` via `...result` in `finalResult` (~248–263); it does not need to read `details.place_id` for the form pipeline to work. The echo is still valuable for API contract clarity and future clients.

**Gate:** `bun run build`

---

## Step 2 — `AddressGroupEntry.placeId` + form updaters

**File:** [src/features/trips/types.ts](src/features/trips/types.ts)

- Add `**placeId?: string`** as the **last** field on `AddressGroupEntry`.

**File:** [src/features/trips/components/create-trip/create-trip-form.tsx](src/features/trips/components/create-trip/create-trip-form.tsx)

- `**updatePickupAddress`** (~843–859): when merging a non-string `AddressResult`, set  
`**placeId: result.placeId ?? g.placeId**`  
when string input, keep `**placeId: g.placeId**` (do not wipe on free text).
- `**updateDropoffAddress**` (~909–927): same pattern with the dropoff row `g`.
- `**prefillDropoffFromPickup` block** inside `updatePickupAddress` (~868–886): for the first dropoff row, add the same `**placeId`** rule so synced pickup/dropoff share the semantic id when the product prefills dropoff from pickup.
- **Inline comments:** optional `placeId` on `AddressGroupEntry`; retain previous `placeId` when a new `AddressResult` has no `placeId` (text edit after Place selection).

**Gate:** `bun run build`

---

## Step 3 — Migration (file only)

**New file:** `supabase/migrations/YYYYMMDDHHmmss_add-place-ids-to-trips.sql`

- Use a timestamp **after** the latest existing migration (currently **[20260503140000_create_letters.sql](supabase/migrations/20260503140000_create_letters.sql)** per repo listing).
- Content per your spec: single `ALTER TABLE public.trips` with `**ADD COLUMN IF NOT EXISTS`** for `**pickup_place_id TEXT**` and `**dropoff_place_id TEXT**`, plus `COMMENT ON COLUMN` for both.
- **No** RLS changes, **no** `NOT NULL` / defaults / FKs.

**Gate:** `bun run build` (types not yet referencing columns — should still pass)

---

## Step 4 — `database.types.ts` + apply migration

**File:** [src/types/database.types.ts](src/types/database.types.ts) — `trips` table (~1231–1435)

- **Row:** add `pickup_place_id: string | null` and `dropoff_place_id: string | null` (place near other `pickup_*` / `dropoff_*` fields for readability).
- **Insert:** add optional `pickup_place_id?: string | null` and `dropoff_place_id?: string | null`.
- **Update:** add the same optional pair (Update is missing some structured address fields today; still add place columns for future patches).

**Apply migration:** run `**supabase db push`** (or your usual linked-project workflow). This repo’s [package.json](package.json) exposes `**db:types**` (`supabase gen types typescript --local`) but **no** `db:push` script — use the CLI you already use for deployments.

**Gate:** `bun run build`

---

## Step 5 — All four `createTrip` insert paths

**File:** [src/features/trips/components/create-trip/create-trip-form.tsx](src/features/trips/components/create-trip/create-trip-form.tsx)

Add to **each** `tripsService.createTrip` payload:

```ts
pickup_place_id: pickupGroup.placeId ?? null,
dropoff_place_id: dropoffGroup.placeId ?? null,
```

Use the **in-scope** group variables for that branch:


| Path               | Pickup / dropoff groups                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous outbound | `pickupGroup` / `dropoffGroup` from `resolvedPickupGroups[0]` / `resolvedDropoffGroups[0]`                                                                                                          |
| Anonymous return   | Swapped route: pickup endpoint = former dropoff → `**pickup_place_id: dropoffGroup.placeId`**, `**dropoff_place_id: pickupGroup.placeId**` (mirror `pickup_lat` / `dropoff_lat` pattern ~1438–1452) |
| Passenger outbound | `pickupGroup` / `dropoffGroup` from maps                                                                                                                                                            |
| Passenger return   | Same swap as anonymous return (~1612–1627)                                                                                                                                                          |


**Do not** add these to `baseTrip` unless every path can share it without ambiguity; **per-call-site** fields are clearer for the return-leg swap.

**Inline comments:** explicit `null` when no Places selection.

**Types:** [Trip](src/features/trips/api/trips.service.ts) / `InsertTrip` are aliases of `Row` / `Insert` — no separate service change once `database.types.ts` is updated.

**Gates:** `bun run build`, `bun test`

---

## Step 6 — Documentation (mandatory)

1. **[docs/driving-metrics-api.md](docs/driving-metrics-api.md)** — new section **“Place ID Storage (Plan B)”**: what the columns store; form-created trips vs bulk/cron/CSV nulls; `/api/place-details` echoes **raw** query `place_id`, not a Places response body field; pointer that **Plan B4** will use these for `route_metrics_cache` lookup.
2. **Append one line** to [docs/plans/plan-b-place-id-pre-audit.md](docs/plans/plan-b-place-id-pre-audit.md):
  `B1–B3 implemented [date]. B4 (cache resolver upgrade) is next as a standalone plan.`
3. **Create** [docs/plans/plan-b1-b3-implementation.md](docs/plans/plan-b1-b3-implementation.md): steps done, migration filename, build/test results, deferred B4 scope.

---

## Explicitly out of scope (hard rules)

- No changes to `**route_metrics_cache`**, **[src/lib/google-directions.ts](src/lib/google-directions.ts)**, `**resolveDrivingMetricsWithCache`**, bulk upload, cron, recurring materialization, or **[address-autocomplete.tsx](src/features/trips/components/trip-address-passenger/address-autocomplete.tsx)**.
- No trip detail sheet / patch builder changes in this plan (place IDs on **create** only).

---

## Blockers / watchouts

- **Return legs** must swap place IDs with endpoints exactly like lat/lng; a single wrong mapping will poison B4 cache keys.
- `**ensureGroupHasCoords`** spreads `group` — once `placeId` exists on `AddressGroupEntry`, it is preserved when only lat/lng are filled via geocode.
- If `**supabase db push**` is not part of your usual flow, still commit the migration and align types before merging inserts that reference new columns.



Follow every step in order. Do not skip steps. Do not combine steps.

Run the build gate after each step before proceeding to the next.

---

EXECUTION RULES

1. Implement only what the plan describes. No additional changes.

2. Step order is mandatory: 1 → 2 → 3 → 4 → 5 → 6.

3. Build gates:

   After Steps 1, 2, 3, 4: bun run build must pass.

   After Step 5: bun run build + bun test must pass.

   After Step 6: documentation only, no gate required.

4. The return leg Place ID swap in Step 5 is critical:

   pickup_place_id on a return leg = dropoffGroup.placeId

   dropoff_place_id on a return leg = pickupGroup.placeId

   Mirror exactly how lat/lng are swapped on return legs.

   Confirm from code before writing.

5. After completing all steps:

   - Mark all todos in the plan frontmatter as status: done

   - Add a completion note at the bottom of the plan file:

     "## Completed — [date]. bun run build exit 0,

      bun test [N] passed. Migration: [filename]."

   - Copy the final plan to .cursor/plans/ to keep both in sync.

6. Do not modify any file outside the plan's Files Changed table

   plus the two plan file locations.