# Phase 1 — Manual verification (`trip-time.ts`)

Temporary debug routes exercised `GET /api/debug/trip-time-check` and `GET /api/debug/trip-time-supabase`, then **those route files were deleted** so they are not merged to `main` (see final line).

**Environment:** Production build succeeded (`bun run build`). Math checks ran as three sequential `next dev -p 3999` processes (lock cleared between runs). Supabase check ran immediately after math Run 3; the Supabase probe used `TZ=UTC` for its dev process (closest to detached host default unless `TZ` was already set).

Capture timestamp references in JSON bodies: `2026-05-01T11:55:*Z`.

---

## Section 1 — Math verification results

### Run 1 — Default process `TZ` (host), `next dev`

**Command:** `bun run dev -p 3999` then `curl -s http://127.0.0.1:3999/api/debug/trip-time-check`

**Full JSON:**

```json
{
  "serverTimezone": "Europe/Berlin",
  "nodeEnvTZ": "(not set)",
  "allPassed": true,
  "timestamp": "2026-05-01T11:55:24.467Z",
  "cases": [
    {
      "label": "CEST 10:00",
      "input": { "ymd": "2026-06-15", "hm": "10:00" },
      "result": "2026-06-15T08:00:00.000Z",
      "expected": "2026-06-15T08:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "10:00" }
    },
    {
      "label": "CET 10:00",
      "input": { "ymd": "2026-01-15", "hm": "10:00" },
      "result": "2026-01-15T09:00:00.000Z",
      "expected": "2026-01-15T09:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-01-15", "hm": "10:00" }
    },
    {
      "label": "CEST 23:30 late night",
      "input": { "ymd": "2026-06-15", "hm": "23:30" },
      "result": "2026-06-15T21:30:00.000Z",
      "expected": "2026-06-15T21:30:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "23:30" }
    },
    {
      "label": "Cron HH:mm:ss format",
      "input": { "ymd": "2026-06-15", "hm": "10:00:00" },
      "result": "2026-06-15T08:00:00.000Z",
      "expected": "2026-06-15T08:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "10:00" }
    },
    {
      "label": "Leon production row parse",
      "input": { "iso": "2026-04-03T23:10:00.000Z" },
      "result": { "ymd": "2026-04-04", "hm": "01:10" },
      "expected": { "ymd": "2026-04-04", "hm": "01:10" },
      "pass": true
    },
    {
      "label": "Round-trip CEST",
      "input": { "ymd": "2026-06-15", "hm": "10:00" },
      "builtIso": "2026-06-15T08:00:00.000Z",
      "result": { "ymd": "2026-06-15", "hm": "10:00" },
      "expectedRoundTrip": { "ymd": "2026-06-15", "hm": "10:00" },
      "pass": true
    },
    {
      "label": "Round-trip late night CEST",
      "input": { "ymd": "2026-06-15", "hm": "23:30" },
      "builtIso": "2026-06-15T21:30:00.000Z",
      "result": { "ymd": "2026-06-15", "hm": "23:30" },
      "expectedRoundTrip": { "ymd": "2026-06-15", "hm": "23:30" },
      "pass": true
    }
  ]
}
```

**`allPassed`:** `true`.

**Cases:** all seven logical checks reported `pass: true` (four builds + Leon parse + two round-trips).

---

### Run 2 — `TZ=UTC` (Vercel-style)

**Command:** `env TZ=UTC bun run dev -p 3999` then same `curl`.

**Full JSON:**

```json
{
  "serverTimezone": "UTC",
  "nodeEnvTZ": "UTC",
  "allPassed": true,
  "timestamp": "2026-05-01T11:55:33.678Z",
  "cases": [
    {
      "label": "CEST 10:00",
      "input": { "ymd": "2026-06-15", "hm": "10:00" },
      "result": "2026-06-15T08:00:00.000Z",
      "expected": "2026-06-15T08:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "10:00" }
    },
    {
      "label": "CET 10:00",
      "input": { "ymd": "2026-01-15", "hm": "10:00" },
      "result": "2026-01-15T09:00:00.000Z",
      "expected": "2026-01-15T09:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-01-15", "hm": "10:00" }
    },
    {
      "label": "CEST 23:30 late night",
      "input": { "ymd": "2026-06-15", "hm": "23:30" },
      "result": "2026-06-15T21:30:00.000Z",
      "expected": "2026-06-15T21:30:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "23:30" }
    },
    {
      "label": "Cron HH:mm:ss format",
      "input": { "ymd": "2026-06-15", "hm": "10:00:00" },
      "result": "2026-06-15T08:00:00.000Z",
      "expected": "2026-06-15T08:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "10:00" }
    },
    {
      "label": "Leon production row parse",
      "input": { "iso": "2026-04-03T23:10:00.000Z" },
      "result": { "ymd": "2026-04-04", "hm": "01:10" },
      "expected": { "ymd": "2026-04-04", "hm": "01:10" },
      "pass": true
    },
    {
      "label": "Round-trip CEST",
      "input": { "ymd": "2026-06-15", "hm": "10:00" },
      "builtIso": "2026-06-15T08:00:00.000Z",
      "result": { "ymd": "2026-06-15", "hm": "10:00" },
      "expectedRoundTrip": { "ymd": "2026-06-15", "hm": "10:00" },
      "pass": true
    },
    {
      "label": "Round-trip late night CEST",
      "input": { "ymd": "2026-06-15", "hm": "23:30" },
      "builtIso": "2026-06-15T21:30:00.000Z",
      "result": { "ymd": "2026-06-15", "hm": "23:30" },
      "expectedRoundTrip": { "ymd": "2026-06-15", "hm": "23:30" },
      "pass": true
    }
  ]
}
```

**`allPassed`:** `true`.

---

### Run 3 — `TZ=America/New_York` (stress test)

**Command:** `env TZ=America/New_York bun run dev -p 3999` then same `curl`.

**Full JSON:**

```json
{
  "serverTimezone": "America/New_York",
  "nodeEnvTZ": "America/New_York",
  "allPassed": true,
  "timestamp": "2026-05-01T11:55:42.253Z",
  "cases": [
    {
      "label": "CEST 10:00",
      "input": { "ymd": "2026-06-15", "hm": "10:00" },
      "result": "2026-06-15T08:00:00.000Z",
      "expected": "2026-06-15T08:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "10:00" }
    },
    {
      "label": "CET 10:00",
      "input": { "ymd": "2026-01-15", "hm": "10:00" },
      "result": "2026-01-15T09:00:00.000Z",
      "expected": "2026-01-15T09:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-01-15", "hm": "10:00" }
    },
    {
      "label": "CEST 23:30 late night",
      "input": { "ymd": "2026-06-15", "hm": "23:30" },
      "result": "2026-06-15T21:30:00.000Z",
      "expected": "2026-06-15T21:30:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "23:30" }
    },
    {
      "label": "Cron HH:mm:ss format",
      "input": { "ymd": "2026-06-15", "hm": "10:00:00" },
      "result": "2026-06-15T08:00:00.000Z",
      "expected": "2026-06-15T08:00:00.000Z",
      "pass": true,
      "parsedBack": { "ymd": "2026-06-15", "hm": "10:00" }
    },
    {
      "label": "Leon production row parse",
      "input": { "iso": "2026-04-03T23:10:00.000Z" },
      "result": { "ymd": "2026-04-04", "hm": "01:10" },
      "expected": { "ymd": "2026-04-04", "hm": "01:10" },
      "pass": true
    },
    {
      "label": "Round-trip CEST",
      "input": { "ymd": "2026-06-15", "hm": "10:00" },
      "builtIso": "2026-06-15T08:00:00.000Z",
      "result": { "ymd": "2026-06-15", "hm": "10:00" },
      "expectedRoundTrip": { "ymd": "2026-06-15", "hm": "10:00" },
      "pass": true
    },
    {
      "label": "Round-trip late night CEST",
      "input": { "ymd": "2026-06-15", "hm": "23:30" },
      "builtIso": "2026-06-15T21:30:00.000Z",
      "result": { "ymd": "2026-06-15", "hm": "23:30" },
      "expectedRoundTrip": { "ymd": "2026-06-15", "hm": "23:30" },
      "pass": true
    }
  ]
}
```

**`allPassed`:** `true`.

---

## Section 2 — Supabase round-trip result

**Note:** Probe used `TZ=UTC` for its dev process (see Section 3 context).

**Command:** `curl -s http://127.0.0.1:3999/api/debug/trip-time-supabase`

**Full JSON:**

```json
{
  "scheduledAtInserted": "2026-06-15T21:30:00.000Z",
  "expectedBerlinDate": "2026-06-15",
  "appearsOnJune15": true,
  "appearsOnJune16": false,
  "testRowDeleted": true,
  "pass": true,
  "serverTimezone": "UTC",
  "nodeEnvTZ": "UTC"
}
```

**Assessment for this checklist:** **`pass`** is **`true`**; **`testRowDeleted`** is **`true`**.

---

## Section 3 — TZ invariance check

Compared Run 1, Run 2, and Run 3:

- **`allPassed`:** identical (`true` in each run).
- **`cases[]`:** for every case (`label`), the fields that encode math outcomes (`result`, `expected`, `pass`, `builtIso` where present, nested `parsedBack` / `result` / `expectedRoundTrip`) are identical across runs.
- **Expected differences:** `serverTimezone`, `nodeEnvTZ`, and `timestamp` vary by run/host and process environment; those are instrumentation, not `trip-time` outputs.

Answer: yes — for the deterministic parts of the payload, results are identical across Run 1, Run 2, and Run 3.

---

## Section 4 — Summary

**PASS:** All math-route cases reported `pass: true` in all three `TZ`/host scenarios; **`allPassed`** was **`true`** each time; the deterministic `cases` payloads match across runs (**TZ-invariant** for `buildScheduledAt` / `parseScheduledAt` semantics). Supabase probe returned **`pass: true`** with **`appearsOnJune15: true`**, **`appearsOnJune16: false`**, and **`testRowDeleted: true`**.

---

**Debug routes deleted:** `src/app/api/debug/trip-time-check/route.ts` and `src/app/api/debug/trip-time-supabase/route.ts` (and empty `debug` dirs); they are absent from the tree after verification.
