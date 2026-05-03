# Driving distance and duration (Google Directions)

> See [access-control.md](access-control.md) for the full role-based access control architecture.


## Purpose

The app stores **`driving_distance_km`** and **`driving_duration_seconds`** on every `trips` row whenever it can resolve a driving route between pickup and dropoff coordinates. These fields are populated across **all creation paths** — manual creation (anonymous and passenger mode), CSV bulk upload, trip duplication, and recurring-rule materialisation.

The raw data comes from the Google **Directions API** (driving mode, metric units). The server-only module is [`src/lib/google-directions.ts`](../src/lib/google-directions.ts).

Do **not** confuse this with:

- **`GET /api/trips/metrics`** — aggregate stats (shortest/longest/average distance) from existing trip rows. It does **not** call Google.
- **`POST /api/trips/driving-metrics`** — proxies Google Directions for **one** origin/destination pair and returns `{ metrics: DrivingMetrics | null }`.

---

## Cache table — `route_metrics_cache`

All callers go through `resolveDrivingMetricsWithCache` in `src/lib/google-directions.ts`. The resolver uses a dedicated `route_metrics_cache` table as its primary cache layer.

### Schema

```sql
CREATE TABLE public.route_metrics_cache (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  origin_lat       decimal(8,5) NOT NULL,
  origin_lng       decimal(8,5) NOT NULL,
  dest_lat         decimal(8,5) NOT NULL,
  dest_lng         decimal(8,5) NOT NULL,
  distance_km      float8       NOT NULL,
  duration_seconds int4         NOT NULL,
  created_at       timestamptz  DEFAULT now(),
  UNIQUE (company_id, origin_lat, origin_lng, dest_lat, dest_lng)
);

CREATE INDEX idx_route_metrics_lookup
  ON public.route_metrics_cache (company_id, origin_lat, origin_lng, dest_lat, dest_lng);
```

### Why coordinates are rounded to 5 decimal places

The Google Geocoding API can return slightly different coordinates for the same address depending on: the code path that calls it (form vs. cron vs. bulk upload), the API version, or the date of the call. A difference of as little as one ULP (unit in the last place) in a raw `float8` would cause an exact-equality cache miss, defeating the cache entirely for the routes it is most valuable for (frequently repeated patient routes).

Rounding to 5 decimal places (~1 m precision) absorbs this noise while remaining accurate enough for driving-distance purposes. The constant is `COORD_PRECISION = 5`, exported from `src/lib/google-directions.ts` and imported wherever a cache key is constructed — never hardcoded.

### Cache lookup sequence

```
1. Round all four coordinates to COORD_PRECISION decimal places.
2. Query route_metrics_cache WHERE company_id = ? AND origin_lat = ? ... (rounded values)
   → If a match exists: return { distanceKm, durationSeconds, source: 'cache' }

3. Call getDrivingMetrics with the ORIGINAL (un-rounded) coordinates for maximum precision.
   → If null (key missing, API error, no route): return null

4. Upsert result into route_metrics_cache using rounded coords.
   onConflict = 'company_id,...' + ignoreDuplicates: true
   (concurrent racing writes are silently dropped by the DB unique constraint)

5. Return { distanceKm, durationSeconds, source: 'google' }
```

### Why write-back happens before returning to the caller

A bulk CSV upload with 20 rows all going to the same dialysis clinic launches 20 concurrent `fetchDrivingMetrics` calls. All 20 miss the cache simultaneously because no trips have been inserted yet. By writing back to `route_metrics_cache` **immediately after the first Google response** (before returning from the resolver), subsequent concurrent requests from the same batch will find the result in the DB on their own lookup. The `ignoreDuplicates: true` upsert means the second write from a racing request is silently discarded — no error, no duplicate row.

### Why `companyId` is required

The cache is scoped per company so that one company's routes never populate another company's cache. Cross-company sharing is deferred.

### Previous approach (removed)

The old cache queried the `trips` table itself with exact float equality:
```sql
SELECT driving_distance_km, ...
FROM trips WHERE pickup_lat = ? AND ... AND driving_distance_km IS NOT NULL
```
This was fragile because it assumed the geocoder always returns bit-identical floats for the same address — an assumption that fails across different code paths and over time. It also never wrote back to any dedicated store, so concurrent bulk-upload requests all missed and hit Google regardless. It has been **removed entirely**.

---

## Where metrics are written

| Creation path | Where enrichment happens | Notes |
|---|---|---|
| Manual creation — anonymous mode (Hin-/Rückfahrt) | `create-trip-form.tsx` (client) | Calls `fetchDrivingMetrics` → `/api/trips/driving-metrics` |
| Manual creation — passenger mode (outbound) | `create-trip-form.tsx` (client) | Same pattern as anonymous mode — no longer deferred to backfill |
| Manual creation — passenger mode (return) | `create-trip-form.tsx` (client) | Reversed coords; awaited before insert |
| Trip detail-sheet save | `build-trip-details-patch.ts` | Recalculates when pickup/dropoff coords change — **unless** the distance freeze guard applies (see below) |
| CSV bulk upload (outbound) | `bulk-upload-dialog.tsx → runBulkInsert Pass 0` | After geocoding resolves lat/lng, before insert |
| CSV bulk upload (return) | `bulk-upload-dialog.tsx → runBulkInsert Pass 2` | Recalculated with reversed coords after `buildReturnTrip`; metrics NOT inherited from outbound |
| Trip duplication | `duplicate-trips.ts → enrichInsertWithMetrics` | Fills gaps left by source trips with null metrics; skips when source already has metrics |
| Recurring-rule cron | `generate-recurring-trips/route.ts` | In-memory Map as first level (within invocation), then `route_metrics_cache`, then Google |
| Backfill script | `scripts/backfill-driving-distance.ts` | Idempotent; safe to re-run; uses `route_metrics_cache` to skip Google for already-known routes |

---

## Distance Freeze Guard (Plan A)

**Trigger:** If **any** row exists in `invoice_line_items` with `trip_id` equal to the trip being saved (primary leg, checked before `buildTripDetailsPatch` in the trip detail sheet), **`driving_distance_km` and `driving_duration_seconds` are not recalculated** on that save path: the client skips `fetchDrivingMetrics` (no `POST /api/trips/driving-metrics` call) and omits those keys from the patch. The same idea applies to the **linked Gegenfahrt** when the user syncs both legs: before `finalizePartnerPatchWithDrivingMetrics`, the sheet queries `invoice_line_items` with `trip_id` **in** `(open trip id, partner id)` — if either leg has a line item, partner distance/duration are not recomputed.

**Rationale:** Invoice lines snapshot distance for billing; mutating the live `trips` row after a line item exists would diverge from what was billed unless product explicitly allows it.

**Fail-open:** If the `invoice_line_items` check errors (network, RLS, etc.), the code logs **`[distance-freeze]`**-prefixed **`console.error`** and treats distance as **not** locked (metrics may still be computed) so saves are not blocked.

**Observability:** Warnings for suppressed updates use **`console.warn`** with prefix **`[distance-freeze]`**. The trip detail sheet is a **client** component — these messages go to the **browser DevTools console**, not Vercel server logs, unless you add a server endpoint later. Server-side creation paths (bulk, cron, etc.) are **not** covered by this guard in Plan A.

**Plan B/C (not implemented here):** Broader policies (e.g. cache-only, status-based locks) are documented in `docs/plans/geocoding-strategy-brainstorm.md`.

---

## Place ID Storage (Plan B)

**Columns:** `trips.pickup_place_id` and `trips.dropoff_place_id` (nullable `TEXT`) store the **Google Places `place_id`** for each endpoint when the dispatcher chose an address via **Places Autocomplete + Place Details** on the **Neue Fahrt** form. They are the stable semantic identity of the stop (unlike coordinates, which can jitter slightly across days and code paths).

**Who writes them:** Only the **create-trip form** (`create-trip-form.tsx`) sets these on insert. **Bulk upload, CSV, recurring-rule cron, and other non-form paths** leave both columns **null** by design — those flows do not go through `/api/place-details`.

**API contract:** `GET /api/place-details` includes **`place_id`** in the success JSON when present: it **echoes the raw `placeId` query parameter** the client sent, not a field read from the Places API response body (the handler already knows the id from the request). This keeps the client’s stored id aligned with what it submitted.

**Plan B4 (deferred):** A follow-up change will add a **two-stage `route_metrics_cache` lookup** that prefers a **place-id-based key** before the existing rounded-coordinate key, so form-created trips sharing the same Places-selected route converge on one cache entry and one consistent `driving_distance_km`. Until B4 ships, `route_metrics_cache` and `resolveDrivingMetricsWithCache` are unchanged.

---

## Why a dedicated API route

`GOOGLE_MAPS_API_KEY` must stay on the **server**. Next.js does not expose non-`NEXT_PUBLIC_` variables to the browser, so `'use client'` components cannot import `google-directions.ts` directly. Instead they call `fetchDrivingMetrics` from [`src/features/trips/lib/fetch-driving-metrics.ts`](../src/features/trips/lib/fetch-driving-metrics.ts), which POSTs to `/api/trips/driving-metrics`.

**Server-side callers** (Route Handlers, cron, Node scripts) import `resolveDrivingMetricsWithCache` directly — no HTTP hop:

- [`src/app/api/trips/driving-metrics/route.ts`](../src/app/api/trips/driving-metrics/route.ts)
- [`src/app/api/cron/generate-recurring-trips/route.ts`](../src/app/api/cron/generate-recurring-trips/route.ts)
- [`scripts/backfill-driving-distance.ts`](../scripts/backfill-driving-distance.ts)

---

## Environment and GCP

| Requirement | Notes |
|-------------|--------|
| `GOOGLE_MAPS_API_KEY` | Set in `.env.local` / deployment env (server only). Same variable used by [`google-geocoding.ts`](../src/lib/google-geocoding.ts) for Geocoding. |
| **Directions API** | Enable for the key's GCP project (APIs & Services → Library). |
| **Geocoding API** | Often already enabled if you followed [address-autocomplete.md](./address-autocomplete.md). |

Operational hygiene: use GCP **budget alerts** and **API key restrictions** (restrict the key to Directions + Geocoding, scoped to your server's IP or referrer).

---

## Authentication

`POST /api/trips/driving-metrics` follows the same pattern as other trip mutation routes (e.g. bulk-delete, duplicate):

1. Supabase session via [`createClient`](../src/lib/supabase/server) — user must be signed in (**401** if not).
2. Row in `accounts` with **`company_id`** — (**403** if missing).

This avoids exposing a public proxy to Google's billed Directions API. The `company_id` obtained here is also passed as the `companyId` argument to `resolveDrivingMetricsWithCache` so that the cache lookup and write-back are scoped to the correct company.

---

## Request and response

**`POST /api/trips/driving-metrics`**

Body (JSON):

```json
{
  "originLat": 53.14,
  "originLng": 8.21,
  "destLat": 53.15,
  "destLng": 8.22
}
```

All four values must be finite numbers; latitude in `[-90, 90]`, longitude in `[-180, 180]`. Invalid bodies return **400** with `{ "error": "Ungültige Koordinaten." }`.

Success **200**:

```json
{ "metrics": { "distanceKm": 12.34, "durationSeconds": 890 } }
```

> **Note:** The `source` field (`'cache'` or `'google'`) is present in the server-side `ResolvingMetrics` type but is **not** forwarded to the client in the JSON response — the client only sees `distanceKm` and `durationSeconds`.

If the API key is missing, Google returns an error, or the route cannot parse distance/duration, `metrics` may be **`null`** — callers should still allow saves (trip is created without metrics and the backfill script can fill it in later).

---

## Running the backfill script

The script is idempotent — it only touches rows where `driving_distance_km IS NULL` and all four coordinate columns are non-null. Re-running it is safe.

```bash
# Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_MAPS_API_KEY
bun run scripts/backfill-driving-distance.ts

# Dry run — log what would be updated without writing to the DB
bun run scripts/backfill-driving-distance.ts --dry-run
```

The script processes trips sequentially within each batch of 50. It sleeps 200 ms after every 10 Google calls (not after every row). Cache-hit rows require no sleep because no Google call is made — the old per-row 500 ms sleep is gone.

At the end the script prints a summary:

```
── Backfill summary ──────────────────────────────
  Trips processed : 342
  Cache hits      : 298 (87.1%)
  Google calls    : 44
  Errors / skipped: 0
──────────────────────────────────────────────────
```

---

## Known Limitations

- **Cache is per-company.** Two companies that share a route (e.g. same dialysis clinic) each have their own `route_metrics_cache` row. Global sharing is deferred.
- **Write-back is decoupled from trip lifecycle.** A `route_metrics_cache` row may be written even if the associated trip insert subsequently fails. This is intentional — the cache represents the distance for a given route, not the existence of a particular trip. A phantom cache row causes no correctness problem; it only means a future trip on the same route gets a cache hit.
- **Return trips may have different metrics than outbound trips.** Routes are not always symmetric (one-way streets, motorway access). Outbound and return trip distances are calculated independently with their respective coordinate directions.
- **`driving_duration_seconds` is not exposed in the UI.** Stored in the DB; UI display is deferred.

---

## Implementation references

| Piece | Path |
|-------|------|
| Core helpers (`getDrivingMetrics`, `resolveDrivingMetricsWithCache`, `COORD_PRECISION`) | [`src/lib/google-directions.ts`](../src/lib/google-directions.ts) |
| Cache table SQL | [`supabase/migrations/20260417100000_route-metrics-cache.sql`](../supabase/migrations/20260417100000_route-metrics-cache.sql) |
| Route handler | [`src/app/api/trips/driving-metrics/route.ts`](../src/app/api/trips/driving-metrics/route.ts) |
| Browser helper | [`src/features/trips/lib/fetch-driving-metrics.ts`](../src/features/trips/lib/fetch-driving-metrics.ts) |
| Bulk-upload enrichment | [`src/features/trips/components/bulk-upload-dialog.tsx`](../src/features/trips/components/bulk-upload-dialog.tsx) |
| Duplicate-trip enrichment | [`src/features/trips/lib/duplicate-trips.ts`](../src/features/trips/lib/duplicate-trips.ts) |
| Backfill script | [`scripts/backfill-driving-distance.ts`](../scripts/backfill-driving-distance.ts) |

## Relationship to price calculation

As of Phase 1 (2026-04-19), `driving_distance_km` is consumed at creation time by `computeTripPrice` in [`src/features/trips/lib/trip-price-engine.ts`](../src/features/trips/lib/trip-price-engine.ts) to determine the applicable VAT rate (7% for < 50 km, 19% for ≥ 50 km per §12 Abs. 2 Nr. 10 UStG). `net_price`, `gross_price`, and `tax_rate` are therefore also populated at creation time across all three wired creation paths. When `driving_distance_km` is null at creation time, the VAT engine falls back to 7% (reduced rate) and `tax_rate` remains stored on the trip row.

See [price-calculation-engine.md](./price-calculation-engine.md) for the full engine documentation.

## Related docs

- [address-autocomplete.md](./address-autocomplete.md) — Places, Place Details, Geocoding, env table.
