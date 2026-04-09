# Driving distance and duration (Google Directions)

> See [access-control.md](access-control.md) for the full role-based access control architecture.


## Purpose

The app stores **`driving_distance_km`** and **`driving_duration_seconds`** on every `trips` row whenever it can resolve a driving route between pickup and dropoff coordinates. These fields are populated across **all creation paths** — manual creation, CSV bulk upload, trip duplication, and recurring-rule materialisation.

The raw data comes from the Google **Directions API** (driving mode, metric units). The server-only module is [`src/lib/google-directions.ts`](../src/lib/google-directions.ts).

Do **not** confuse this with:

- **`GET /api/trips/metrics`** — aggregate stats (shortest/longest/average distance) from existing trip rows. It does **not** call Google.
- **`POST /api/trips/driving-metrics`** — proxies Google Directions for **one** origin/destination pair and returns `{ metrics: DrivingMetrics | null }`.

---

## DB-level cache (`resolveDrivingMetricsWithCache`)

All callers now go through `resolveDrivingMetricsWithCache` instead of calling `getDrivingMetrics` directly. The resolver implements a two-tier lookup:

```
1. Query trips WHERE pickup_lat = ? AND pickup_lng = ? AND dropoff_lat = ? AND dropoff_lng = ?
   AND driving_distance_km IS NOT NULL
   → If a match exists: return cached values immediately (no Google call)

2. Otherwise: call getDrivingMetrics (Google Directions API) and return the result
```

**Why this matters for a Taxigo context:** repeating patients (e.g. dialysis 3×/week, school transport) take the same route dozens of times per month. Without the cache every trip would cost one Google Directions call. With the cache, only the **first** occurrence ever hits Google — all subsequent trips on that route are resolved from the database in milliseconds.

The `ResolvingMetrics` type extends `DrivingMetrics` with a `source: 'cache' | 'google'` field so callers can observe the resolution path (useful for debugging quota usage).

---

## Where metrics are written

| Creation path | Where enrichment happens | Notes |
|---|---|---|
| Manual creation (Hin-/Rückfahrt) | `create-trip-form.tsx` (client) | Calls `fetchDrivingMetrics` → `/api/trips/driving-metrics` |
| Trip detail-sheet save | `build-trip-details-patch.ts` | Recalculates when pickup/dropoff coords change |
| **CSV bulk upload** | `bulk-upload-dialog.tsx` → `runBulkInsert` | Added: called immediately after geocoding resolves lat/lng, before insert |
| **Trip duplication** | `duplicate-trips.ts` → `enrichInsertWithMetrics` | Added: fills gaps left by source trips with null metrics |
| Recurring-rule cron | `generate-recurring-trips/route.ts` | Uses in-memory map as first level, then DB cache, then Google |
| **Backfill script** | `scripts/backfill-driving-distance.ts` | Idempotent; safe to re-run; uses DB cache to skip Google for already-known routes |

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

This avoids exposing a public proxy to Google's billed Directions API.

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

The script is idempotent — it only touches rows where `driving_distance_km IS NULL` and geodata is present. Re-running it is safe.

```bash
# Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_MAPS_API_KEY
bun run scripts/backfill-driving-distance.ts
```

For large databases the 500 ms sleep between rows keeps you well within Google's default rate limit of 50 QPS. The DB cache dramatically reduces actual API calls for repeated routes.

---

## Implementation references

| Piece | Path |
|-------|------|
| Core helpers (`getDrivingMetrics`, `resolveDrivingMetricsWithCache`) | [`src/lib/google-directions.ts`](../src/lib/google-directions.ts) |
| Route handler | [`src/app/api/trips/driving-metrics/route.ts`](../src/app/api/trips/driving-metrics/route.ts) |
| Browser helper | [`src/features/trips/lib/fetch-driving-metrics.ts`](../src/features/trips/lib/fetch-driving-metrics.ts) |
| Bulk-upload enrichment | [`src/features/trips/components/bulk-upload-dialog.tsx`](../src/features/trips/components/bulk-upload-dialog.tsx) |
| Duplicate-trip enrichment | [`src/features/trips/lib/duplicate-trips.ts`](../src/features/trips/lib/duplicate-trips.ts) |
| Backfill script | [`scripts/backfill-driving-distance.ts`](../scripts/backfill-driving-distance.ts) |

## Related docs

- [address-autocomplete.md](./address-autocomplete.md) — Places, Place Details, Geocoding, env table.
