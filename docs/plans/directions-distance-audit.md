# Directions Distance Audit

## Summary

`trips.driving_distance_km` is written only when application code persists a trip or patch (and by maintenance scripts); it is **not** recomputed on every UI render or list fetch. Distance comes from the Google **Directions** HTTP API (`mode=driving`, `units=metric`) via **`resolveDrivingMetricsWithCache`**, which layers a **per-company `route_metrics_cache`** keyed by coordinates rounded to five decimal places. The most plausible explanation for “same route / same passenger / different days but different kilometres” is **combinations of (a)** slightly **different stored pickup/dropoff coordinates** for the same human-readable addresses (geocoding variance across paths or dates), **(b)** **cache misses** across those coordinate buckets leading to **fresh Directions calls** whose returned polyline length can differ when endpoints move even by tens of metres, and **(c)** **multiple independent write paths** (create form, bulk upload + geocode, recurring cron, duplication with verbatim metrics vs enrichment, detail-sheet route edits, backfill) that do not all guarantee one canonical distance for a given address pair.

## Findings

### 1. Write path(s) for driving_distance_km

**Persisted at save time (not on read/render).** The column is set on `INSERT`/`UPDATE` payloads built by trip flows or scripts. Listing or opening a trip loads the stored value from Supabase; there is no evidence of a hook that recalculates distance on every trip fetch.

**Multiple code paths write the field:**

| Path | Mechanism | Key references |
|------|-----------|----------------|
| Manual create (anonymous + passenger modes) | After resolving lat/lng for pickup/dropoff, `fetchDrivingMetrics` → `POST /api/trips/driving-metrics` → `resolveDrivingMetricsWithCache`; values attached to `createTrip` payload | `create-trip-form.tsx` (e.g. outbound ~1334–1388, return ~1398–1460, passenger loops ~1485–1634) |
| Trip detail sheet “Trip aktualisieren” | When the built PATCH includes new `pickup_lat` and/or `dropoff_lat`, `buildTripDetailsPatch` calls `fetchDrivingMetrics` and sets `driving_distance_km` / `driving_duration_seconds` on the patch | `build-trip-details-patch.ts` ~231–259 |
| Paired Gegenfahrt sync | `finalizePartnerPatchWithDrivingMetrics` recomputes metrics for the swapped route when four coords exist | `paired-trip-sync.ts` ~267–289 |
| CSV bulk upload | Pass 0: geocode via `/api/geocode-address`, then `fetchDrivingMetrics`; return legs recalc reversed route | `bulk-upload-dialog.tsx` ~1110–1236, ~1327–1364 |
| Trip duplication | **`copyRouteAndPassengerFields` copies `driving_distance_km` verbatim** from source; **`enrichInsertWithMetrics`** only runs when the copied value is still null but coords exist | `duplicate-trips.ts` ~214–311, ~377–402, ~482–583 |
| Recurring cron | Geocodes rule addresses, then `resolveDrivingMetricsWithCache` (plus in-memory dedupe map per cron run) | `generate-recurring-trips/route.ts` ~220–257 |
| Linked return creation | Reversed coords → `fetchDrivingMetrics` | `create-linked-return.ts` ~34–44 |
| Backfill / maintenance | `scripts/backfill-driving-distance.ts` updates rows with null distance when coords exist | e.g. ~279–318 |

**No Supabase Edge Functions** under `supabase/functions/` were present in this repository (empty tree); nothing serverless in that folder writes `driving_distance_km`.

**Service invoked:** Google Maps **Directions** JSON endpoint, wrapped in `getDrivingMetrics` (`src/lib/google-directions.ts` ~83–144).

---

### 2. Input to directions API

**Lat/lng pairs only — not raw address strings.** The Directions request builds `origin` and `destination` as comma-separated latitude/longitude strings:

```96:104:src/lib/google-directions.ts
  const origin = `${originLat},${originLng}`;
  const destination = `${destLat},${destLng}`;

  const url = new URL(DIRECTIONS_ENDPOINT);
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('units', 'metric');
```

Addresses are **geocoded elsewhere** (form autocomplete / `/api/geocode-address` in bulk upload / cron `geocodeAddressLineToStructured`) to populate `trips.pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`. Those stored coordinates are what downstream code passes into `fetchDrivingMetrics` / `resolveDrivingMetricsWithCache`.

**Coordinate provenance at call time:** Callers use whatever lat/lng are on the insert/patch object or geocoding result **at that moment** — e.g. merged pickup/drop from patch vs existing trip in `buildTripDetailsPatch` (~231–242). Cron uses freshly geocoded `pickupGeo` / `dropoffGeo` (~220–221).

---

### 3. Caching behaviour

**Three layers appear in code:**

1. **`route_metrics_cache` (Postgres)** — Primary cache inside `resolveDrivingMetricsWithCache`: lookup by `company_id` + four coordinates **after rounding to `COORD_PRECISION` (5 dp)**; on miss, Google is called and an upsert writes the result (`google-directions.ts` ~190–266).

2. **In-memory map (recurring cron only)** — `drivingMetricsCache` keyed by rounded coord strings to avoid duplicate resolver calls within one cron invocation (`generate-recurring-trips/route.ts` ~146, ~227–252).

3. **No React Query / localStorage cache** for distance itself — `fetch-driving-metrics.ts` is a plain `fetch` to the API route; trip lists use normal trip queries and show stored DB values.

**Fresh API behaviour:** A new Google Directions call happens when the rounded-key lookup misses **or** when code calls `getDrivingMetrics` directly (bypassing cache — documented as low-level only; normal path is the resolver).

**Race / stale behaviour:** Docs and code use `upsert` with `onConflict` + `ignoreDuplicates: true` so concurrent writers do not error; **the first successful insert defines the cached distance** for that key; later races read that row (`docs/driving-metrics-api.md` ~66–68). A trip insert can fail after a cache row was written (“phantom cache” is acknowledged in the same doc ~194–196) — that does not corrupt trips but means cache can exist without a trip.

**Important nuance:** Cache lookup uses **rounded** coordinates, but `getDrivingMetrics` is invoked with **original unrounded** lat/lng (`google-directions.ts` ~223–229). Two trips whose coords differ slightly before rounding may still **share one cache bucket** after rounding and thus **share one stored distance**; conversely, if rounding splits them into different buckets, they may get **independent** Google results.

---

### 4. Rounding / unit handling

**API → km:** Google returns leg distance in metres (`distance.value`); code computes `distanceKm = distanceMeters / 1000` with **no additional rounding** before return (`google-directions.ts` ~124–138).

**Storage:** Column type is `DOUBLE PRECISION` (`20260316090000_add_driving_distance_and_duration_to_trips.sql`); values are stored as IEEE floats — small representation noise is possible when comparing trips.

**Coordinate rounding:** Only used for **cache keys** (`roundCoord` / `toFixed(COORD_PRECISION)`), not for rounding the final kilometre value written to `trips.driving_distance_km`.

**Frontend vs backend:** The browser does not compute route length; it receives `distanceKm` from the API JSON. No second rounding layer was found in the client helper beyond using the number as returned.

---

### 5. Directions API configuration

From `getDrivingMetrics` URL construction:

| Parameter | Value |
|-----------|--------|
| `mode` | `driving` |
| `units` | `metric` |

**Not observed in this codebase’s Directions request:** `departure_time`, `traffic_model`, `avoid`, `alternatives`, or waypoints — only `origin`, `destination`, `mode`, `units`, `key` (`google-directions.ts` ~99–104).

**Route selection:** Response uses **`data.routes?.[0]`** and the first leg only (`google-directions.ts` ~122–125). There is no client-side selection among alternatives because `alternatives` is not requested.

**Traffic / time-dependent routing:** Standard Directions without departure_time typically returns a **non-traffic-aware** baseline for driving distance in many cases; the implementation does **not** pass traffic parameters. Remaining variance then comes mainly from **different origin/destination coordinates**, **Google-side routing data updates**, or **first-route ordering** if Google ever returns multiple routes without `alternatives=true` (current code always takes index 0).

---

### 6. Invoice read behaviour

**Invoices read `driving_distance_km` from the database**, not from a live Directions recalculation at PDF time.

- `fetchTripsForBuilder` selects `driving_distance_km` (and addresses, pricing fields, client, etc.) from `trips` (`invoice-line-items.api.ts` ~161–188).
- `buildLineItemsFromTrips` sets `distance_km: trip.driving_distance_km` and passes `trip.driving_distance_km` into `resolveTaxRate` and `resolveTripPricePure` (`invoice-line-items.api.ts` ~325–385).

So **line-item distance shown in the builder** is the **stored trip value** at fetch time.

**Caveat:** `resolveTripPricePure` and `resolvePricingRule` **re-run the pricing cascade** using **current** billing rules + **stored** trip inputs (`driving_distance_km` among them). That means **monetary totals** can change if rules change, even though **distance** on the line still originates from the trip row unless someone edits the trip or backfills distance.

---

### 7. Data quality signals

**Conceptual SQL** — trips with the same textual endpoints but materially different stored distances (adjust threshold as needed):

```sql
-- Conceptual only — not executed as part of this audit.
-- Finds address pairs (string match) where stored distances differ by > 0.5 km.
SELECT
  pickup_address,
  dropoff_address,
  COUNT(*) AS trip_count,
  MIN(driving_distance_km) AS min_km,
  MAX(driving_distance_km) AS max_km,
  (MAX(driving_distance_km) - MIN(driving_distance_km)) AS spread_km
FROM trips
WHERE pickup_address IS NOT NULL
  AND dropoff_address IS NOT NULL
  AND driving_distance_km IS NOT NULL
GROUP BY pickup_address, dropoff_address
HAVING COUNT(*) > 1
   AND (MAX(driving_distance_km) - MIN(driving_distance_km)) > 0.5
ORDER BY spread_km DESC;
```

**Schema fields useful for richer variants:** `trips.id`, `company_id`, `client_id`, `scheduled_at`, `pickup_address`, `dropoff_address`, `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`, `driving_distance_km`, `driving_duration_seconds`, `ingestion_source`, `rule_id`, `created_at` — all available for correlating divergent rows with creation path or coordinate drift.

**NULL or zero distance**

- **`NULL`:** Directions failure (`getDrivingMetrics` returns null), missing `GOOGLE_MAPS_API_KEY`, HTTP/API status not `OK`, missing leg distance/duration (`google-directions.ts` ~89–144); or coords missing so callers skip metrics (e.g. create form only calls `fetchDrivingMetrics` when both pickup and dropoff have coords ~1323–1331); geocoding failure in bulk/cron leaves metrics unset; non-fatal catches in bulk upload allow insert without metrics (`bulk-upload-dialog.tsx` ~1237–1239, ~1365–1367).
- **`0`:** Not explicitly clamped in the routing helper; a literal zero would be unusual unless the API returned zero metres (degenerate route). Most “missing” cases are **`NULL`**, not `0`.

---

## Root Cause Hypothesis

1. **Geocoding + cache-key sensitivity (highest probability):** The same displayed addresses can produce **different lat/lng** when resolved at different times or through different flows (`docs/driving-metrics-api.md` explains intentional 5 dp rounding for this). That yields **different Directions requests or different cache buckets**, so stored `driving_distance_km` can differ between trips users perceive as identical.

2. **Multiple writers and lifecycle edits (medium):** Duplication **copies** metrics from source when present (no fresh Directions call); enrichment and backfill **fill or overwrite** when metrics were null or when scripts run — so two “same” routes created via different paths can legitimately hold different numbers.

3. **Detail-sheet / paired-leg updates (medium):** Saving route changes recomputes metrics (`build-trip-details-patch.ts`, `paired-trip-sync.ts`), **overwriting** prior DB values — two trips that started aligned can diverge after one is edited.

---

## Recommended Next Steps

1. **Instrument and measure:** Log `(source: cache | google)` server-side for `/api/trips/driving-metrics` (already available in `ResolvingMetrics` but stripped before JSON) and optionally persist **rounded cache key** on the trip for forensics — to confirm whether variance correlates with cache miss vs Google drift.

2. **Normalize inputs:** Define a single canonical geocoding + rounding policy per endpoint pair **before** distance lookup (e.g. always snap to building centroid or use Place IDs consistently) to reduce multi-path coordinate jitter.

3. **Product rule for “same route”:** Decide whether repeat trips should **reuse** distance from a prior trip for the same passenger + payer + normalized route hash, instead of trusting each fresh Directions call — trading strict road-network freshness for passenger-facing consistency.

4. **Data audit:** Run the conceptual SQL (and variants grouping by `client_id` + normalized addresses) in production to quantify how often `spread_km > 0.5` occurs and whether it clusters by `ingestion_source` or missing coords.

5. **Document passenger-facing expectation:** If invoices must always match a single canonical distance, **snapshot** explicit `distance_km` onto `invoice_line_items` at issuance (if not already immutable enough) and treat trip-row distance as operational input only — policy decision, not implemented here.
