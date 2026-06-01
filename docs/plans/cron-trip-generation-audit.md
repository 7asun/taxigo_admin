# Audit: recurring-trip cron (`generate-recurring-trips`)

**Date:** 2026-04-29  
**Scope:** Read-only code review. No database access, no code or schema changes.

**Route:** `src/app/api/cron/generate-recurring-trips/route.ts`  
**Context:** The prior audit noted that `toScheduledIso()` uses `new Date(\`${dateStr}T${t}\`)` on the server. On Vercel the default process timezone is **UTC**, not **Europe/Berlin**, so generated `scheduled_at` values may not match the intended local (Berlin) wall time and can interact badly with Fahrten day bucketing (`getZonedDayBoundsIso` in `trip-business-date.ts`).

---

## 1. `toScheduledIso()` — exact implementation and Europe/Berlin

**File / lines:** `src/app/api/cron/generate-recurring-trips/route.ts` **lines 51–53**

```51:53:src/app/api/cron/generate-recurring-trips/route.ts
function toScheduledIso(dateStr: string, timeHhMmSs: string): string {
  const t = clockToHhMmSs(timeHhMmSs);
  return new Date(`${dateStr}T${t}`).toISOString();
}
```

**Answer:** There is **no** `Europe/Berlin` offset, no `Z` suffix control, and **no** use of `getTripsBusinessTimeZone()` / `@date-fns/tz` (unlike `trip-business-date.ts`).

The string `${dateStr}T${t}` is a **timezone-naive** ISO-like datetime. In **Node.js** (Vercel serverless), such values are interpreted in the **runtime’s local timezone**. When that runtime is **UTC** (Vercel default unless `TZ` is set project-wide), **“10:00:00” means 10:00 UTC**, not 10:00 in Berlin.

**Comparison — non-cron write path:** `src/features/trips/lib/departure-schedule.ts` `combineDepartureForTripInsert` (lines 45–58) builds the instant with `new Date(y, m-1, d, hours, minutes, …)` (browser/JS local components) and then `toISOString()`. That is still **not** the same as explicit `Europe/Berlin`, but it follows the **user agent** local clock on the client, not the **UTC** server in the cron.

**Comparison — business TZ helpers:** `src/features/trips/lib/trip-business-date.ts` uses `tz(getTripsBusinessTimeZone())` with default **`Europe/Berlin`** and optional `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE` — the cron route **does not** call this module for scheduling instants.

**Confirmed “timezone bug” location (if the product intent is Berlin wall clock for recurring trips):** `toScheduledIso` at **lines 51–53** in `generate-recurring-trips/route.ts`.

---

## 2. Vercel runtime timezone and `TZ` in this repo

**Vercel:** Serverless/Node on Vercel uses **UTC** as the default **process** timezone unless you configure otherwise (e.g. environment `TZ=Europe/Berlin`). This is a platform/runtime default, not something this audit can read from a live project.

**Repository checks:**

- **`vercel.json`:** Only `installCommand`, `buildCommand`, and `crons` — **no** `TZ` or env block (see `vercel.json` in repo root; lines 1–9).
- **`next.config.ts`:** No `TZ` or timezone setting (Sentry/Next config only; lines 1–60).
- **`env.example.txt`:** Contains `CRON_SECRET` but **no** `TZ=…` (grep result empty for `TZ`).

**Conclusion (Q2):** This codebase **does not** set `TZ=Europe/Berlin` in the committed deployment config. Unless it is set **only in the Vercel dashboard** (not visible in the repo), the Node runtime is expected to use **UTC** for `new Date` resolution of naïve strings and for `date-fns`’ `startOfDay(new Date())` in this route (lines 90–91, 416–419, 442–447).

---

## 3. Walkthrough: cron time, “tomorrow” in Berlin, and stored `scheduled_at`

**Note on premise:** The question mentions **02:00 UTC**. In **this** repository, the schedule is:

```4:7:vercel.json
  "crons": [
    {
      "path": "/api/cron/generate-recurring-trips",
      "schedule": "0 3 * * *"
```

Vercel cron expressions use **UTC** for `schedule`. **`0 3 * * *` = 03:00 UTC daily** — not 02:00. Below we use the **code’s actual** 03:00 UTC trigger unless stated otherwise. The *logic* of `toScheduledIso` does not depend on the wall-clock time the job runs, only on `dateStr`, `pickup_time`, and exceptions.

### 3.1 “Today” window in the cron (also relevant)

At the start of the handler (lines 90–91):

```90:91:src/app/api/cron/generate-recurring-trips/route.ts
    const todayLocal = startOfDay(new Date());
    const windowEndLocal = endOfDay(addDays(todayLocal, 14));
```

`startOfDay` / `endOfDay` are from `date-fns` **without** a named IANA zone. They follow the **JavaScript environment’s local zone** — on default Vercel, that is **UTC**. So the variable `todayLocal` is **not** “today in Europe/Berlin”; it is **start of the UTC day** of the `Date` the handler sees when it runs. That affects which **RRule** window is searched, separate from `toScheduledIso` itself.

### 3.2 Occurrence `dateStr`

For each RRule hit (line 477–478):

```477:478:src/app/api/cron/generate-recurring-trips/route.ts
      for (const dateUTC of occurrencesUTC) {
        const dateStr = dateUTC.toISOString().split('T')[0];
```

`dateStr` is the **UTC calendar** portion of the occurrence instant (YYYY-MM-DD in **UTC**), not an explicit “Berlin calendar” date. Near midnight, this can disagree with a Berlin `YYYY-MM-DD` for the same business intent.

### 3.3 Example: “tomorrow” with a 10:00 pickup (numeric walkthrough)

Assume:

- RRule produces an occurrence `dateStr = '2026-04-29'`.
- Rule `pickup_time` (after `clockToHhMmSs`) is `10:00:00` (outbound, not “timeless”).

The cron calls (lines 488–497):

- `outboundScheduledIso = toScheduledIso('2026-04-29', '10:00:00' /* or similar */)`.

**Execution of `toScheduledIso`:**

1. `clockToHhMmSs` → `"10:00:00"`.
2. `new Date('2026-04-29T10:00:00')` on Node in **UTC**:
   - Per ECMAScript, a date-time string **without** `Z` or offset is treated as **local**; with **local = UTC**, this is **2026-04-29T10:00:00.000Z**.
3. `.toISOString()` → **`2026-04-29T10:00:00.000Z`**

**Intended (if 10:00 were Berlin local on 2026-04-29 in CEST, UTC+2):** that instant would be approximately **`2026-04-29T08:00:00.000Z`**, not `10:00:00.000Z`.

**What gets written to Postgres:** the insert uses `scheduled_at: scheduledAtIso` from the built payload (e.g. line 290), so the stored `timestamptz` is the **wrong** instant relative to a Berlin 10:00 intent — typically **+1h (CET) or +2h (CEST)** off on the clock. Whether it **switches** the **Fahrten** calendar day depends on the edge of the Berlin day window; in most mid-day times it stays the same **Berlin** calendar date but at the **wrong** time; near **day boundaries** (and combined with the UTC-`dateStr` issue) **wrong-day** effects are more likely.

**If the cron “runs at 02:00 UTC” (hypothetical):** that only changes which **UTC** “today” and **14-day** window `startOfDay(new Date())` uses; it does not change the **`toScheduledIso` arithmetic** for a given `dateStr` + time string.

---

## 4. How many rows are “cron/recurring” — queries to run

**Cannot** execute against production from this environment. **Suggested SQL** in Supabase (or any Postgres client):

**Trips with a rule link (any source that set `rule_id`):**

```sql
SELECT count(*)::bigint
FROM public.trips
WHERE rule_id IS NOT NULL;
```

**Trips with the cron’s ingestion label** (`route.ts` line 292 sets `ingestion_source: 'recurring_rule'`):

```sql
SELECT count(*)::bigint
FROM public.trips
WHERE ingestion_source = 'recurring_rule';
```

**Union-style count (rows matching either, without double-counting):**

```sql
SELECT count(*)::bigint
FROM public.trips
WHERE rule_id IS NOT NULL
   OR ingestion_source = 'recurring_rule';
```

**Optional breakdown (sanity: should largely overlap):**

```sql
SELECT
  (rule_id IS NOT NULL) AS has_rule_id,
  (ingestion_source = 'recurring_rule') AS is_recurring_ingest,
  count(*)::bigint
FROM public.trips
GROUP BY 1, 2
ORDER BY 1, 2;
```

---

## 5. Deduplication and manual vs cron trips on the same day

**There is** explicit deduplication before insert, via `insertIfAbsent` → `findExistingRecurringLegId` (lines 301–357).

**`findExistingRecurringLegId` keys** (roughly):

- `client_id`  
- `rule_id`  
- `requested_date` (always set to `dateStr` in `buildTripPayload` line 270)  
- `scheduled_at` **exact match** to the candidate, **or** both null for timeless legs  
- **Leg type:** `link_type` filter for `outbound` vs `return` (lines 321–325)

**Effect:**

- A **second** run of the cron the same day with the same computed `scheduled_at` / null + same `client_id` + `rule_id` + `requested_date` **should** hit the existing row and **not** insert again (`insertIfAbsent` line 343: returns existing `id` without incrementing `tripsInserted` per comment line 139).

**Manual trip same passenger same day:** If a dispatcher creates a **manual** trip, it will typically have **`rule_id` IS NULL** and a different `ingestion_source` (e.g. null or other). The cron deduplication **does not** look up “any trip for this client on this `requested_date`” — it requires **`eq('rule_id', q.rule_id)`** (line 312). So a **manually** created trip and a **cron** trip for the same client and same calendar day **can** both exist; the cron is **not** “blocked” by a manual row unless that manual row was somehow saved with the **same** `rule_id` and matching fields (unusual for normal UI flows).

**Answer (Q5):** Yes, deduplication exists for **recurring** identity (client + rule + date + time + leg). No, it does not generally prevent a **separate** manual trip for the same passenger/day.

---

## 6. What triggers the cron; double execution

| Trigger | Evidence |
|--------|----------|
| **Vercel Cron** | `vercel.json` `crons`: `path` `/api/cron/generate-recurring-trips`, `schedule` `0 3 * * *` (**03:00 UTC** daily). Vercel invokes the **GET** route on that schedule. |
| **Manual / external** | The handler is `GET` and accepts **Authorization: Bearer** `CRON_SECRET` or **x-cron-secret** (lines 59–70). Any client that knows the URL and secret can call it (e.g. curl, monitoring). |

**Double trigger same calendar day?**

- Vercel could retry a failed request (platform-dependent); a **successful** second run is mostly handled by `insertIfAbsent` as above.  
- If the **first** run **partially** failed (e.g. insert error after a prior insert) or if dedup keys differ (bug, clock skew, or data change) **duplicate** rows are theoretically possible but not the “happy path”.

**Conclusion (Q6):** Primary schedule is **Vercel cron** in **UTC** at **03:00**; additional **manual** invocations are possible. Same-day re-runs are **usually** idempotent for identical dedup keys; **not** a guarantee of zero duplicates in all error paths.

---

## Summary table

| Topic | Finding |
|--------|---------|
| `toScheduledIso` | `new Date(\`${dateStr}T${t}\`)` then `.toISOString()` — **no Berlin offset**; on default UTC server, naïve time is interpreted in **UTC**. **Lines 51–53**, `generate-recurring-trips/route.ts`. |
| `TZ` in repo | **Not** set in `vercel.json`, `next.config.ts`, or `env.example.txt`. |
| Fahrten vs cron | Fahrten uses `trip-business-date.ts` (default **Europe/Berlin**). Cron does **not** use it for `scheduled_at` or for `startOfDay` “today”. |
| Deduplication | **Yes** — `insertIfAbsent` + `findExistingRecurringLegId`; scoped to `rule_id` + `client_id` + `requested_date` + `scheduled_at` + leg. |
| Manual + cron duplicate | **Possible** (manual trip usually has `rule_id` null). |
| Vercel schedule | **`0 3 * * *` UTC** (not 02:00). |

---

## Fix direction (recommendation only; no code in this doc)

- Construct `scheduled_at` instants in **one** IANA zone (`Europe/Berlin` or `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`) in the cron, matching Fahrten and `departure-schedule` *intent*.  
- Align **“which calendar day for generation”** (`todayLocal`, RRule `dateStr`) with the same zone so UTC/Berlin nights do not split days incorrectly.  
- Optionally set **`TZ=Europe/Berlin`** in Vercel for this app **only** after validating all server-side `Date` and `date-fns` calls — global `TZ` can have **wide** side effects, so **explicit** zoned construction in the cron is often safer.

---

## Resolution (2026-06-01)

**Shipped fix:** Regelfahrten cron DTSTART weekday offset (+1 Berlin day when user selected e.g. Monday but trips landed on Tuesday).

| Issue | Status |
| --- | --- |
| `toScheduledIso` / naive UTC time encoding | **Resolved** (Phase 2) — replaced by `buildScheduledAt` |
| UTC `dateStr` from `toISOString().split('T')[0]` | **Resolved** (Phase 2) — `instantToYmdInBusinessTz` |
| UTC `startOfDay(new Date())` for cron window | **Resolved** (Phase 2) — Berlin `startOfDay` via `getTripsBusinessTimeZone()` |
| **DTSTART encoded as UTC `Z`** (Berlin midnight → previous UTC day; RRule `BYDAY` in UTC) | **Resolved (2026-06-01)** — `DTSTART;TZID=${getTripsBusinessTimeZone()}:${start_date}T000000` in `generate-recurring-trips/route.ts` (~lines 495–504). See [`regelfahrten-cron-day-offset-audit.md`](./regelfahrten-cron-day-offset-audit.md) and [`trips-date-filter.md`](../trips-date-filter.md) cron row. |

**Do not revert** DTSTART to `format(..., 'Z')` on `getZonedDayBoundsIso(...).startISO` — that reintroduces the weekday +1 bug.

---

## Files read (complete or substantive)

- `src/app/api/cron/generate-recurring-trips/route.ts` (full)  
- `src/features/trips/lib/departure-schedule.ts` (full)  
- `src/features/trips/lib/trip-business-date.ts` (full)  
- `vercel.json` (full)  
- `next.config.ts` (full)  
- `recurring_rules` / `ingestion_source` — inferred from this route and `src/types/database.types.ts` (not re-printed); migrations referenced via grep in repo.  

**Note:** A dedicated `recurring_rules` `CREATE TABLE` in migrations was not required for this audit; the running code’s **Insert** type and the cron’s `from('recurring_rules').select` are the source of truth for which columns exist at runtime (see route lines 94–95, 370–374).
