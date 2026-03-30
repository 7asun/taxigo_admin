# Driving distance and duration (Google Directions)

## Purpose

The app stores **`driving_distance_km`** and **`driving_duration_seconds`** on `trips` rows when it can resolve a driving route between pickup and dropoff coordinates (e.g. Hin-/Rückfahrt flows, detail-sheet saves, recurring trip generation).

That data comes from the Google **Directions API** (driving mode, metric units). The server-only helper is [`src/lib/google-directions.ts`](../src/lib/google-directions.ts) (`getDrivingMetrics`).

Do **not** confuse this with:

- **`GET /api/trips/metrics`** — aggregate stats (shortest/longest/average distance) from existing trip rows in the database. It does **not** call Google.
- **`POST /api/trips/driving-metrics`** — calls Google Directions for **one** origin/destination pair and returns JSON `{ metrics: DrivingMetrics | null }`.

## Why a dedicated route

`GOOGLE_MAPS_API_KEY` must stay on the **server**. Next.js does not expose non-`NEXT_PUBLIC_` environment variables to the browser, so client components cannot call `getDrivingMetrics` directly. The dashboard uses [`src/features/trips/lib/fetch-driving-metrics.ts`](../src/features/trips/lib/fetch-driving-metrics.ts) (`fetchDrivingMetrics`) from `'use client'` code; it `POST`s to `/api/trips/driving-metrics`.

**Server-only callers** (no HTTP hop) keep importing `getDrivingMetrics` directly:

- [`src/app/api/cron/generate-recurring-trips/route.ts`](../src/app/api/cron/generate-recurring-trips/route.ts)
- [`scripts/backfill-driving-distance.ts`](../scripts/backfill-driving-distance.ts)

## Environment and GCP

| Requirement | Notes |
|-------------|--------|
| `GOOGLE_MAPS_API_KEY` | Set in `.env.local` / deployment env (server only). Same variable is used by [`google-geocoding.ts`](../src/lib/google-geocoding.ts) for Geocoding. |
| **Directions API** | Enable for the key’s GCP project (APIs & Services → Library). |
| **Geocoding API** | Often already enabled if you followed [address-autocomplete.md](./address-autocomplete.md). |

Operational hygiene: use GCP **budget alerts** and **API key restrictions** (restrict key to Directions + Geocoding, and to your server or HTTP referrers as appropriate).

## Authentication

`POST /api/trips/driving-metrics` follows the same pattern as other trip mutation routes (e.g. bulk delete, duplicate):

1. Supabase session via [`createClient`](../src/lib/supabase/server) — user must be signed in (**401** if not).
2. Row in `accounts` with **`company_id`** — (**403** if missing).

This avoids exposing a public proxy to Google’s billed Directions API.

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

If the API key is missing, Google returns an error, or the route cannot parse distance/duration, `metrics` may be **`null`** — callers should still allow saves (same behaviour as before).

## Implementation references

| Piece | Path |
|-------|------|
| Route handler | [`src/app/api/trips/driving-metrics/route.ts`](../src/app/api/trips/driving-metrics/route.ts) |
| Browser helper | [`src/features/trips/lib/fetch-driving-metrics.ts`](../src/features/trips/lib/fetch-driving-metrics.ts) |
| Directions call | [`src/lib/google-directions.ts`](../src/lib/google-directions.ts) |

## Related docs

- [address-autocomplete.md](./address-autocomplete.md) — Places, Place Details, Geocoding, env table.
