# Driving Metrics Reliability & Deduplication — Audit

> **Status: Implemented — 2026-04-17**
> All findings below have been addressed. See the implementation plan at
> `.cursor/plans/driving_metrics_fix_86970a22.plan.md` and the updated
> documentation at `docs/driving-metrics-api.md`.
>
> **Deviations from plan:** none. All steps completed as specified.

> Read-only audit. No code was changed in this file.  
> All file paths are relative to the workspace root unless stated otherwise.  
> Line numbers reference the files as they exist at the time of this audit.

---

## Section 1 — Exact Column Name

**The exact column name is `driving_distance_km`** (not `distance_km`).  
The companion column is `driving_duration_seconds`.

Evidence — every location where these columns are read or written:

| File | Lines | Operation |
|---|---|---|
| `src/types/database.types.ts` | 1145–1146 (Row), 1210–1211 (Insert), 1271–1272 (Update) | Type definitions — canonical source of truth |
| `src/lib/google-directions.ts` | 176–184 | SELECT (DB cache lookup) |
| `src/app/api/trips/driving-metrics/route.ts` | (indirectly via `resolveDrivingMetricsWithCache`) | POST handler |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | 1332–1333, 1388–1389, 1508–1509 | INSERT (anonymous mode outbound + return, passenger mode return) |
| `src/features/trips/components/bulk-upload-dialog.tsx` | 1162–1164 | INSERT (bulk upload outbound rows) |
| `src/features/trips/lib/duplicate-trips.ts` | 255–256, 297–298, 371–372 | COPY from source (copyRouteAndPassengerFields + enrichInsertWithMetrics) |
| `src/app/api/cron/generate-recurring-trips/route.ts` | 190–213, 264–265 | INSERT (recurring-rule materialisation) |
| `scripts/backfill-driving-distance.ts` | 31–32 (filter), 83–84 (UPDATE) | Backfill script |

---

## Section 2 — How the Cache Works and Why It Is Likely Failing

### 2.1 Cache architecture

There is **no dedicated cache table**. The cache is a live query against the `trips` table itself.

**Function:** `resolveDrivingMetricsWithCache` in `src/lib/google-directions.ts` lines 163–212.

Tier 1 (DB cache) — `google-directions.ts` lines 174–197:
```
SELECT driving_distance_km, driving_duration_seconds
FROM trips
WHERE pickup_lat = <originLat>    -- exact float equality
  AND pickup_lng = <originLng>    -- exact float equality
  AND dropoff_lat = <destLat>     -- exact float equality
  AND dropoff_lng = <destLng>     -- exact float equality
  AND driving_distance_km IS NOT NULL
  AND driving_duration_seconds IS NOT NULL
LIMIT 1
```

If a matching row is found, the values are returned with `source: 'cache'` and Google is never called.  
If no row is found, `getDrivingMetrics` is called (Google Directions API) and the result is returned with `source: 'google'`. **The result is not persisted anywhere at this point** — it is only committed to the DB when the calling code does its own INSERT/UPDATE of the trip row.

The cron job (`route.ts` lines 113–114) adds a second tier: an **in-memory Map** (`drivingMetricsCache`) that lives only for the duration of a single cron invocation. It prevents redundant DB queries for the same route within one run. It resets to empty on every invocation — this is correct behaviour and not a bug.

### 2.2 Why the DB cache is fragile

**No coordinate rounding is applied before the cache key is built** (`google-directions.ts` lines 172–173 explicitly state this is intentional). The comment argues: *"coordinates are always stored as-returned by the geocoder so the same address always yields the same value."*

This assumption breaks in the following real-world scenarios:

1. **Geocoding API non-determinism.** The Google Geocoding API does not guarantee bit-identical results across calls. Minor representation differences (e.g. `53.14000000000001` vs `53.14`) result in a cache miss and a redundant Google call.

2. **Multiple geocoding paths.** The cron uses `geocodeAddressLineToStructured` (`google-geocoding.ts`). The create form uses `fetch('/api/geocode-address', ...)` via `ensureGroupHasCoords`. Bulk upload uses the same `/api/geocode-address` endpoint. If these resolve the same address to coordinates that differ by even one ULP (unit in the last place), the exact-equality cache query will miss.

3. **Manually geocoded trips.** If an admin ever manually patches `pickup_lat` or `dropoff_lat` on a trip, the stored value will differ from what the geocoder would return. Any future trip to the same address will miss the cache.

4. **Legacy trips with different precision.** Trips stored before the current geocoder was in place may carry coordinates encoded with different precision.

**Practical consequence:** The DB cache will often miss on the very routes it is most valuable for (frequently repeated patient routes), because even a single coordinate digit difference causes a miss, and the system has no mechanism to detect or warn about near-misses.

### 2.3 Why the cache provides zero deduplication during bulk upload

In `bulk-upload-dialog.tsx` the geocoding and metrics resolution run inside one large `Promise.all` (lines 1052–1174). All rows resolve coordinates and call `fetchDrivingMetrics` **concurrently**.

The trips are only inserted **after** this `Promise.all` resolves, in a later sequential call at line 1188 (`tripsService.bulkCreateTrips(outboundTrips)`).

The DB cache query therefore always finds an empty result for a brand-new route because no trips for that route exist yet. Every concurrent row calls Google independently. This is addressed in more detail in Section 4.

---

## Section 3 — Where Distance Calculation Happens and Where It Is Skipped

### 3.1 Anonymous mode (manual form)

**File:** `create-trip-form.tsx`

Outbound trip — lines 1283–1305:
- Guard: `if (pickupHasCoords && dropoffHasCoords)` (line 1293).
- Call: `await fetchDrivingMetrics(...)` — properly awaited.
- No individual try/catch; the outer `handleSubmit` try/catch (line 1149–1527) catches any thrown error and aborts the submission with a toast. The trip is **not** saved if `fetchDrivingMetrics` throws a hard error (network failure, JSON parse error).
- If `fetchDrivingMetrics` returns `null` (Google error, missing API key), the metrics are omitted (`outboundDrivingDistanceKm = null`) and the trip **is still saved** without metrics — this is intentional fallback behaviour (`driving-metrics-api.md` line 110).
- If either address has no coordinates (geocoding failed silently in `ensureGroupHasCoords`), the guard skips the Google call entirely. The trip is saved with null coordinates and null metrics, and `has_missing_geodata` is **not set** in the anonymous-mode insert object (lines 1307–1334 — `has_missing_geodata` is absent from the spread). The DB default applies; if it is `false`, the trip would appear as having valid geodata.

Return trip — lines 1338–1390: same pattern, properly awaited, same skip condition.

### 3.2 Passenger mode (manual form) — CRITICAL GAP

**File:** `create-trip-form.tsx` lines 1392–1439

Outbound trips in passenger mode are created **unconditionally with hardcoded `null` metrics:**

```typescript
// create-trip-form.tsx lines 1435–1436
driving_distance_km: null,
driving_duration_seconds: null
```

The comment at lines 1433–1434 reads: *"For passenger mode, we currently compute driving distance in the backfill script to avoid excessive synchronous API calls when creating many trips at once."*

This means **every single outbound trip created in passenger mode will have null metrics at insert time**, regardless of whether coordinates are available. These trips will only get metrics if the backfill script is run separately — there is no automated trigger.

Return trips in passenger mode (lines 1443–1513) **do** calculate metrics (`fetchDrivingMetrics` at line 1461), but they run inside `Promise.all` — see Section 4 for the concurrent cache-miss implication.

**Net result: every passenger-mode outbound trip starts life with `driving_distance_km = null`. There is no fallback that runs immediately.**

### 3.3 Bulk upload

**File:** `bulk-upload-dialog.tsx` lines 1039–1174

- Geocoding and metrics are in `Promise.all` (fully concurrent).
- The metrics call is inside a nested try/catch (lines 1154–1168) that swallows errors silently with the comment *"Non-fatal: metrics will be missing but trip is still created."*
- If geocoding fails (non-ok HTTP response at line 1080 or 1083), lat/lng remain null, the guard at lines 1145–1150 fails, and `fetchDrivingMetrics` is never called. The trip is saved with null metrics and no error is surfaced to the user.
- `has_missing_geodata` is initialised to `true` for every row (line 962) and only cleared to `false` when all four coordinates are populated (line 1151). This is correct for the geocoding failure case.
- Return trips created by `buildReturnTrip` (lines 500–533) inherit all fields from the outbound trip via `...outbound` spread. This means return trips get the same `driving_distance_km` as the outbound trip. The value is the distance for the forward direction (pickup→dropoff), but the return trip is dropoff→pickup. For routes with one-way streets, this value is wrong. No recalculation is done for the reversed route.

### 3.4 Duplicate trips

**File:** `duplicate-trips.ts` lines 351–375

`enrichInsertWithMetrics` is called after `buildDuplicateInsert` for every unit (lines 453, 521, 537). It only acts when `insert.driving_distance_km == null`. If the source trip had metrics, `copyRouteAndPassengerFields` already copied them and `enrichInsertWithMetrics` exits immediately — no Google call, no DB query.

- All calls are properly awaited.
- `resolveDrivingMetricsWithCache` handles its own errors internally (returns `null` on failure). There is no try/catch wrapping `enrichInsertWithMetrics` in `executeDuplicateTrips` — if `resolveDrivingMetricsWithCache` were to throw (it does not), the duplication would fail entirely. In practice this is safe.

### 3.5 Cron — recurring-rule materialisation

**File:** `src/app/api/cron/generate-recurring-trips/route.ts` lines 190–213

- `resolveDrivingMetricsWithCache` is called inside `buildTripPayload` (properly awaited).
- The in-memory `drivingMetricsCache` (line 114) is checked first, which prevents redundant DB queries for the same route within one cron invocation.
- No explicit try/catch around the metrics call; `resolveDrivingMetricsWithCache` handles errors internally and returns `null`. If it returns `null`, `driving_distance_km` remains `null` and the trip is still inserted — correct graceful degradation.

### 3.6 Trip detail-sheet save

Referenced in `driving-metrics-api.md` (row 42: *"Recalculates when pickup/dropoff coords change"*) but the file `build-trip-details-patch.ts` was not in the audit file list. It is noted here as an untested code path.

---

## Section 4 — Exact Deduplication Failure in Bulk Upload

### 4.1 The race condition

In `bulk-upload-dialog.tsx`, the outer `Promise.all` at line 1052 processes all valid CSV rows **fully in parallel**. Within each row:

1. Two geocoding HTTP calls run in parallel (lines 1057–1078).
2. If both return coordinates, `fetchDrivingMetrics` is called (line 1155).
3. `fetchDrivingMetrics` POSTs to `/api/trips/driving-metrics`.
4. That route handler calls `resolveDrivingMetricsWithCache`, which queries the `trips` table for an existing row with the same coordinates and a non-null `driving_distance_km`.
5. **At this exact moment, no trips have been inserted yet.** The insert happens at line 1188, which runs only after the entire `Promise.all` at line 1052 resolves.

**Concrete example:** A CSV with 20 rows, all trips to the same dialysis clinic (identical pickup/dropoff).  
- All 20 rows geocode the same address → same lat/lng values.  
- All 20 rows call `fetchDrivingMetrics` in parallel.  
- All 20 `resolveDrivingMetricsWithCache` calls query the DB → all find zero rows → all fall through to Google.  
- Result: 20 Google Directions API calls instead of 1.

### 4.2 Is there pre-deduplication?

No. There is no Map or Set that deduplicates by coordinate pair before launching the concurrent calls. The comment at lines 1047–1051 explicitly acknowledges this and calls it "acceptable" for the first import. This is disputed by the behaviour described in the problem statement.

### 4.3 Why subsequent uploads do not always benefit from the cache

After the first bulk upload, the trips are in the DB and the DB cache should hit on subsequent imports of the same route — **but only if the coordinates are exactly equal** (see Section 2.2). If the geocoder returns a slightly different value for the same address on a later date, the cache misses again.

---

## Section 5 — What the Backfill Script Does

**File:** `scripts/backfill-driving-distance.ts`

### 5.1 Does it skip already-populated trips?

Yes. The query at lines 28–38 filters `.is('driving_distance_km', null)`, so only trips where `driving_distance_km IS NULL` are fetched. Re-running the script will not overwrite any trip that already has a value.

### 5.2 Does it check the cache before calling Google?

Yes. It calls `resolveDrivingMetricsWithCache` (line 67), which queries the `trips` table first. Within a batch, after the first trip for a route is updated (line 82–87), subsequent trips in the same batch that share the same route will find the just-updated row and return the cached values — no additional Google calls. The cache benefit is real and effective here because trips are processed sequentially, not concurrently.

### 5.3 Batching and rate limiting

- `BATCH_SIZE = 50`: fetches up to 50 trips per iteration.
- `SLEEP_MS = 500`: sleeps 500 ms **after each individual trip** update.
- For a batch of 50 all-unique routes, this is 25 seconds/batch — well within Google's default 50 QPS. However, the 500 ms sleep applies even to cache-hit rows, making the script slower than necessary for repeated routes.
- No explicit concurrency limit — the loop is sequential, not parallel. Safe.

### 5.4 Is it safe to run repeatedly?

Yes. The `driving_distance_km IS NULL` filter ensures idempotency. Running it twice causes no duplicate API calls or data overwrites.

### 5.5 Issues worth flagging

- The script does **not filter by `has_missing_geodata`**. It relies solely on the coordinate null-checks at lines 55–60 (which are redundant because the DB query already requires non-null coordinates). This is fine but slightly confusing.
- There is no pagination guard beyond the `while(true)` loop — if the DB query never returns 0 rows (e.g. an update fails repeatedly and the row stays null), the script runs forever. In practice updates only fail with a logged error and the script moves on, so this is not a practical risk.
- The script does not report total rows processed or total Google calls made. Monitoring quota usage requires Vercel/GCP logs.

---

## Section 6 — Additional Findings Not Covered by the Questions

### 6.1 Passenger-mode outbound trips permanently skip distance calculation

Already described in Section 3.2, but worth re-stating as a standalone finding because of its scope. **Every trip created through the manual form in passenger mode is written with hardcoded null metrics.** The backfill script is the only mechanism to fill these in. The backfill script is not scheduled — it requires a manual `bun run scripts/backfill-driving-distance.ts` invocation. If it is not run regularly, a growing cohort of passenger-mode trips will permanently lack metrics.

### 6.2 Return trips in bulk upload inherit the wrong driving metrics

`buildReturnTrip` (`bulk-upload-dialog.tsx` lines 500–533) spreads `...outbound` which includes `driving_distance_km` and `driving_duration_seconds`. These are the metrics for the **outbound route** (pickup→dropoff). The return trip is the **reverse route** (dropoff→pickup). On roads with one-way segments, different speed limits by direction, or time-of-day penalties, these values can be materially wrong. No recalculation is done for the reversed route in the bulk upload path.

This is in contrast to the manual create form (passenger mode return, line 1461) and the anonymous mode return (lines 1343–1354), both of which call `fetchDrivingMetrics` with the coordinates reversed.

### 6.3 `has_missing_geodata` is never set in the create-trip form

The `baseTrip` object (lines 1254–1273) and neither anonymous-mode nor passenger-mode insert objects set `has_missing_geodata`. If `ensureGroupHasCoords` fails to resolve coordinates (network error, geocoding failure), the trip is inserted with null `pickup_lat`/`pickup_lng` but `has_missing_geodata` is not explicitly set to `true`. The DB-level default determines the stored value. If the default is `false`, these trips are invisible to any filter that uses `has_missing_geodata = true` to identify backfill candidates.

### 6.4 DB cache errors are silently swallowed

In `google-directions.ts` lines 186–197, the cache hit check is `if (!error && data && ...)`. If the DB query returns a non-null `error`, the condition evaluates to false and execution falls through to the Google call without any log entry. This is graceful degradation but means DB connectivity issues are invisible in production — the system will silently over-call Google whenever Supabase has elevated error rates.

### 6.5 Cron in-memory cache does not survive between concurrent invocations

`drivingMetricsCache` in `route.ts` line 114 is declared inside the `GET` handler — it is scoped to a single invocation. If Vercel's scheduler triggers two concurrent cron executions (rare but possible on the boundary of a cron window), both invocations will independently query the DB cache. For routes not yet in the DB, both will call Google simultaneously. This is the same class of race condition as bulk upload but much less likely in practice.

### 6.6 `resolveDrivingMetricsWithCache` never writes the Google result to the DB

The function (`google-directions.ts` lines 163–212) returns the Google result but does **not** write it back to the DB. The caller is responsible for persisting the metrics when it inserts/updates the trip. If the caller abandons the operation after receiving metrics (e.g. an error between the metrics call and the insert), the result is lost. On the next attempt for the same route, Google is called again.

This also means: if `fetchDrivingMetrics` is called in bulk upload for a row but that row later fails to insert (e.g. a DB error in `bulkCreateTrips`), the result is lost and no trip row exists to serve as a cache entry for the next attempt.

### 6.7 `fetchDrivingMetrics` in bulk upload goes through an HTTP hop

`bulk-upload-dialog.tsx` is `'use client'` and therefore cannot import `google-directions.ts` directly. It calls `fetchDrivingMetrics` which POSTs to `/api/trips/driving-metrics`. Each of the N concurrent rows in `Promise.all` issues a separate HTTP request to the same route handler. Each handler invocation is independent — there is no shared in-memory state between them. The in-memory `drivingMetricsCache` from the cron does not apply here because that code lives in a different route.

---

## Section 7 — Root Cause Hypothesis

The following hypotheses are ranked by estimated contribution to the observed problem of trips having null `driving_distance_km`.

### Rank 1 — Passenger mode trips never get metrics at creation time (VERY HIGH likelihood)

The passenger-mode code path in `create-trip-form.tsx` hardcodes null metrics for every outbound trip (lines 1435–1436). This is a silent, unconditional omission. Any clinic using the manual form with passenger mode (which is the default mode for `requirePassenger` billing families) will produce trips that never get metrics unless the backfill script is run.

**This is the most likely primary cause of missing data at scale.**

### Rank 2 — Geocoding failure silently skips the metrics call (HIGH likelihood)

In all creation paths, the metrics call is gated on `pickupHasCoords && dropoffHasCoords`. If geocoding fails for any reason (Google Geocoding API error, missing `GOOGLE_MAPS_API_KEY`, network timeout, invalid address), the coordinates are null and the metrics call is silently skipped. The trip is saved without metrics and without a clear flag indicating why. No toast or log distinguishes "geocoding succeeded but metrics API failed" from "geocoding failed entirely".

### Rank 3 — Missing or expired `GOOGLE_MAPS_API_KEY` (HIGH likelihood, environmentally dependent)

`getDrivingMetrics` returns `null` immediately if the key is missing (`google-directions.ts` lines 69–72). Every call to `resolveDrivingMetricsWithCache` would silently fall through to `getDrivingMetrics`, receive `null`, and return `null`. All metrics would be null for every creation path in every environment where the key is absent or expired. This would produce a complete absence of metrics — not a partial one — making it easy to identify but also easy to miss if the environment is inconsistent between deployments.

### Rank 4 — DB cache exact-float equality misses (MEDIUM likelihood, affects deduplication cost but not necessarily data presence)

The DB cache fragility (Section 2.2) causes redundant Google calls — it does not by itself cause missing metrics. However, if Google's rate limit is hit due to excessive calls (caused partly by cache misses), some calls will fail, causing some trips to have null metrics. This is a second-order effect of the deduplication failure rather than a direct cause of missing data.

### Rank 5 — Bulk upload concurrent calls all miss the DB cache on first import (MEDIUM likelihood, cost issue)

The race condition in `Promise.all` (Section 4) causes multiple Google calls for the same route. As with Rank 4, this is primarily a cost/quota concern. If quota is exhausted, some rows will fail and get null metrics. It does not cause systematic missing data unless the CSV is extremely large and quota limits are tight.

### Rank 6 — Bulk upload return trips inherit forward-direction metrics (LOW impact on data presence, MEDIUM impact on accuracy)

Return trips get metrics (inherited from outbound), so they are not "missing" metrics — they are *inaccurate*. This is a data quality issue rather than a data presence issue.

---

*End of audit.*
