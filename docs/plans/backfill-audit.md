# Backfill Script Audit — `scripts/backfill-driving-distance.ts`

> Date: 2026-04-19  
> Read-only. No code was changed.

---

## Q1 — Dry-run flag

**Yes.** The script has a `--dry-run` CLI flag.

**Activation:** CLI argument `--dry-run` is detected at module load time:

```typescript
const DRY_RUN = process.argv.includes('--dry-run');
```

**Write gate:** The entire `else` branch that builds `updatePayload` and calls `supabase.from('trips').update(...)` is wrapped in `if (DRY_RUN) { ... } else { ... }`:

```typescript
if (DRY_RUN) {
  console.log(
    `[dry-run] Would update trip ${id} (source=${source}) distance=${distanceKm.toFixed(3)} km, duration=${durationSeconds} s`
  );
} else {
  // updatePayload construction, price recalculation, and DB write
  const { error: updateError } = await supabase
    .from('trips')
    .update(updatePayload)
    .eq('id', id);
  ...
}
```

The dry-run summary line at the end of the script also conditionally appends:

```typescript
if (DRY_RUN) console.log('  Mode            : DRY RUN — no writes made');
```

**Note:** `resolveDrivingMetricsWithCache` is still called in dry-run mode, which means the `route_metrics_cache` table **is written to** even when `--dry-run` is set. Google calls are still made and cached. Only the `trips` table update is suppressed.

---

## Q2 — Date range filter

**No.** The script has no `--from`, `--after`, `--since`, or any date-based CLI argument. The `WHERE` clause does not filter on `scheduled_at`, `created_at`, or any date field. All trips matching the coordinate + `driving_distance_km IS NULL` condition are eligible regardless of date.

---

## Q3 — SELECT WHERE clause

The query selects trips where:

```typescript
.is('driving_distance_km', null)
.not('pickup_lat', 'is', null)
.not('pickup_lng', 'is', null)
.not('dropoff_lat', 'is', null)
.not('dropoff_lng', 'is', null)
.not('company_id', 'is', null)
```

In full:

```
driving_distance_km IS NULL
AND pickup_lat IS NOT NULL
AND pickup_lng IS NOT NULL
AND dropoff_lat IS NOT NULL
AND dropoff_lng IS NOT NULL
AND company_id IS NOT NULL
```

**Key observations:**

- Filters on `driving_distance_km IS NULL` — trips that already have a distance are **not processed**. This is self-terminating: once a trip is updated, it leaves the result set on the next iteration.
- Does **not** filter on `net_price IS NULL`. Trips that already have a price but lack a distance will be processed and will have their price recomputed (Phase 3 wiring added this behaviour).
- No `company_id` equality filter — processes trips across **all tenants**.
- Processed in batches of 50 (`BATCH_SIZE = 50`) with no `ORDER BY`, so batch membership is non-deterministic across runs if the table changes between iterations.

---

## Q4 — End-of-run summary

**Yes.** The script prints a formatted summary after the `while (true)` loop exits:

```typescript
console.log('\n── Backfill summary ──────────────────────────────');
console.log(`  Trips processed : ${totalProcessed}`);
console.log(
  `  Cache hits      : ${totalCacheHits} (${totalProcessed > 0 ? ((totalCacheHits / totalProcessed) * 100).toFixed(1) : 0}%)`
);
console.log(`  Google calls    : ${totalGoogleCalls}`);
console.log(`  Errors / skipped: ${totalErrors}`);
if (DRY_RUN) console.log('  Mode            : DRY RUN — no writes made');
console.log('──────────────────────────────────────────────────\n');
```

Fields reported:

| Field | Counter incremented when |
|-------|--------------------------|
| `Trips processed` | `totalProcessed++` — after `resolveDrivingMetricsWithCache` returns a non-null result |
| `Cache hits` | `totalCacheHits++` — when `metrics.source === 'cache'`; shown with % of processed |
| `Google calls` | `totalGoogleCalls++` — when `metrics.source !== 'cache'` (i.e. a live Google API call was made) |
| `Errors / skipped` | `totalErrors++` — when `resolveDrivingMetricsWithCache` returns null **or** when the DB update fails |

**What the summary does not report:** trips skipped at the null-coordinate inner guard (`continue` at lines 88–96), trips skipped in dry-run mode, number of trips with `net_price` recalculated (Phase 3 addition is not reflected in summary counters).

---

## Q5 — Rate limiting and batching

**Yes, both are in place.**

**Outer batch loop:** Trips are fetched in pages of 50 rows via `.limit(BATCH_SIZE)` inside a `while (true)` loop. The loop exits when the result set is empty (`trips.length === 0`).

**Google API rate limiting:** A sliding window counter tracks live Google calls within the current window. After every `RATE_LIMIT_BATCH_SIZE = 10` live Google calls, the script sleeps for `SLEEP_AFTER_GOOGLE_BATCH_MS = 200` ms and resets the window counter:

```typescript
if (googleCallsInWindow >= RATE_LIMIT_BATCH_SIZE) {
  await sleep(SLEEP_AFTER_GOOGLE_BATCH_MS);
  googleCallsInWindow = 0;
}
```

Cache hits do not increment `googleCallsInWindow` and do not trigger the sleep — only live API calls count toward the rate limit window.
