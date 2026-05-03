# Plan B1–B3 — Implementation record

## Steps completed

1. **Echo `place_id`** — [`src/app/api/place-details/route.ts`](../../src/app/api/place-details/route.ts): success JSON includes `...(placeId ? { place_id: placeId } : {})` with inline comment (raw query param, not `placeResourceId`).
2. **`AddressGroupEntry.placeId`** — [`src/features/trips/types.ts`](../../src/features/trips/types.ts); [`create-trip-form.tsx`](../../src/features/trips/components/create-trip/create-trip-form.tsx): `updatePickupAddress`, `updateDropoffAddress`, and prefill-first-dropoff branch copy / retain `placeId`.
3. **Migration** — [`supabase/migrations/20260504120000_add-place-ids-to-trips.sql`](../../supabase/migrations/20260504120000_add-place-ids-to-trips.sql): `pickup_place_id`, `dropoff_place_id` nullable `TEXT`, `IF NOT EXISTS`, column comments.
4. **Types** — [`src/types/database.types.ts`](../../src/types/database.types.ts): `trips` Row / Insert / Update extended.
5. **Inserts** — All four `tripsService.createTrip` paths in `create-trip-form.tsx` set `pickup_place_id` / `dropoff_place_id` (return legs swap like lat/lng).
6. **Docs** — [`docs/driving-metrics-api.md`](../../docs/driving-metrics-api.md) section “Place ID Storage (Plan B)”; this file; one-line append on [`plan-b-place-id-pre-audit.md`](plan-b-place-id-pre-audit.md).

## Migration filename

`20260504120000_add-place-ids-to-trips.sql`

## Build gates

- After Steps 1–5: **`bun run build`** — exit 0.
- After Step 5: **`bun test`** — 88 passed, 0 failed.

## Database apply note

`supabase db push` was **not** run in the agent environment (Supabase CLI unavailable in PATH). Apply the migration against your linked project before relying on the new columns in production.

## Deferred — Plan B4

- **`route_metrics_cache`** schema and **`resolveDrivingMetricsWithCache`** / [`google-directions.ts`](../../src/lib/google-directions.ts): two-stage lookup (place ID key before coordinate key).
- UI lock indicator on trip detail distance `Badge` (per product roadmap).
