# Phase 3A — Verification (dispatcher `scheduled_at` writes)

## Smoke route (`GET /api/debug/phase3a-create-check`)

Temporary route was added, verified, then **removed** (must not ship to production).

**Command:** `curl -s http://localhost:3000/api/debug/phase3a-create-check`

**Response (full JSON):**

```json
{
  "goldenCEST": {
    "input": { "ymd": "2026-06-15", "hm": "10:00" },
    "result": "2026-06-15T08:00:00.000Z",
    "expected": "2026-06-15T08:00:00.000Z",
    "pass": true
  },
  "goldenLateNight": {
    "input": { "ymd": "2026-06-15", "hm": "23:30" },
    "result": "2026-06-15T21:30:00.000Z",
    "expected": "2026-06-15T21:30:00.000Z",
    "pass": true
  },
  "departureScheduleAligned": true,
  "allPassed": true
}
```

## Summary

| Check | Result |
|--------|--------|
| `buildScheduledAt` CEST 10:00 golden | **PASS** |
| `buildScheduledAt` CEST 23:30 golden | **PASS** |
| `combineDepartureForTripInsert` matches `buildScheduledAt` for both | **PASS** |
| **Overall** | **PASS** |

## Automated tests

`bun test`: **81 pass**, **0 fail** (after Phase 3A implementation on this branch).

## Build

`bun run build`: **exit code 0** after removal of the debug route.
