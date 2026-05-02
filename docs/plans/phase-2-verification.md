# Phase 2 — Verification report (Berlin TZ)

**Scope:** Automated QA, build, Supabase pre-flight SQL, temporary debug HTTP checks (since removed), and assessment.  
**Execution environment:** Local machine with `.env.local` (Supabase service role for debug routes).  
**Observed Berlin “today” in app logic during curl run:** `2026-05-01` (`todayYmdInBusinessTz` / `todayYmd` in JSON responses).

**Temporary debug routes:** `phase2-cron-check`, `phase2-dedup-check`, `phase2-driver-check` were added under `src/app/api/debug/`, verified with `bun run build`, exercised via `bun run dev` + `curl`, then **deleted**. Final tree has **no** `/api/debug/phase2-*` routes; `bun run build` is green after deletion.

---

## Section 1 — Test suite (`bun test`)

**Command:** `bun test`

**Summary:**

- **Total passing:** 79  
- **Total failing:** 0  
- **Test files:** 8  
- **Regressions (previously passing, now failing):** None identified in this run (full suite green).

**Complete output (abridged tail only; full run was ~304 ms):**

```
 79 pass
 0 fail
 144 expect() calls
Ran 79 tests across 8 files.
```

---

## Section 2 — Build (`bun run build`)

**Runs:**

1. With temporary debug routes present: **exit code 0**.
2. After deleting temporary debug routes: **exit code 0**.

**Warnings (both runs):**

- Repeated `[baseline-browser-mapping] The data in this module is over two months old. To ensure accurate Baseline data, please update: npm i baseline-browser-mapping@latest -D`

**Errors:** None.

---

## Section 3 — Pre-flight duplicate SQL

**Executed via:** Supabase MCP `execute_sql` on linked project (`project_id`: `etwluibddvljuhkxjkxs`).

**SQL:**

```sql
SELECT
  client_id,
  rule_id,
  requested_date,
  link_type,
  COUNT(*) AS row_count
FROM public.trips
WHERE rule_id IS NOT NULL
GROUP BY client_id, rule_id, requested_date, link_type
HAVING COUNT(*) > 1
ORDER BY row_count DESC;
```

**Result:** **Not zero rows.** One duplicate group returned:

| client_id | rule_id | requested_date | link_type | row_count |
|-----------|---------|----------------|-----------|-----------|
| `32c84992-b9b5-444c-8891-fb08daddf62f` | `bca1875d-d43b-4f71-a225-3a1e0760ff77` | `2026-04-27` | `null` | **2** |

**Expected for production-ready data hygiene:** zero rows.

---

## Section 4 — Cron UTC encoding check (`phase2-cron-check`)

**Endpoint:** `GET http://localhost:3000/api/debug/phase2-cron-check` (temporary; **removed**).

**Behaviour:** Loaded one active `public.recurring_rules` row (`is_active`, `pickup_time` present, `start_date <=` Berlin today), compared `buildScheduledAt` / `parseScheduledAt` to latest `trips` for that `rule_id`.

**Full JSON response (actual):**

```json
{
  "error": "No active recurring_rules row with pickup_time and start_date <= today (Berlin)",
  "todayYmd": "2026-05-01",
  "businessTz": "Europe/Berlin"
}
```

**Assessment:**

- **Stored `scheduled_at` vs rule / `buildScheduledAt`:** **Not verified** — no qualifying rule row in the linked database at execution time, so Steps A–D did not produce a rule or trip comparison.
- **Cron reference (production):** `GET /api/cron/generate-recurring-trips`; secret: `Authorization: Bearer <CRON_SECRET>` or header `x-cron-secret` (see `generate-recurring-trips/route.ts`).

**Requires manual execution (production / staging):** Re-run equivalent checks when at least one `recurring_rules` row matches the debug route’s criteria, or widen selection criteria locally for QA only.

---

## Section 5 — Dedup check (`phase2-dedup-check`)

**Endpoint:** `GET http://localhost:3000/api/debug/phase2-dedup-check` (temporary; **removed**).

**Behaviour:** Count trips for `(rule_id, requested_date = Berlin today)`, `GET` cron twice with `x-cron-secret`, recount; `dedupWorking` when counts stable and cron not `403`.

**Full JSON response (actual):**

```json
{
  "error": "No rule matching phase2-cron-check criteria",
  "requestedDate": "2026-05-01"
}
```

**Assessment:**

- **`dedupWorking`:** **Not evaluated** — no rule id; cron was not invoked meaningfully by this route.
- **Counts before/after two runs:** **N/A.**

**Requires manual execution:** Same as Section 4 (need eligible `recurring_rules` + valid `CRON_SECRET` in env).

---

## Section 6 — Driver portal day bounds (`phase2-driver-check`)

### 6a — Temporary route (`phase2-driver-check`)

**Full JSON response (actual):**

```json
{
  "stepA": {
    "todayBerlinYmd": "2026-05-01",
    "via": "todayYmdInBusinessTz / instantToYmdInBusinessTz pattern"
  },
  "stepB_note": "Candidate rows: scheduled_at in last 7d, Berlin local hour >= 22 (via parseScheduledAt)",
  "stepC": {
    "lateEveningTripsFound": 1,
    "trips": [
      {
        "id": "adfa5996-11f8-49a9-b1a4-565265e6748c",
        "client_name": "Lisa Fritz",
        "scheduled_at": "2026-04-28T21:17:00+00:00",
        "requested_date": "2026-04-28",
        "berlin_ymd": "2026-04-28",
        "berlin_hm": "23:17",
        "berlin_hour": 23,
        "utc_calendar_date_from_iso_split": "2026-04-28",
        "berlin_date_differs_from_utc_split": false,
        "bounds": {
          "startISO": "2026-04-28T00:00:00.000+02:00",
          "endExclusiveISO": "2026-04-29T00:00:00.000+02:00"
        },
        "withinBerlinHalfOpenWindow": true
      }
    ]
  }
}
```

**Assessment:**

- One late-evening trip (Berlin hour **≥ 22**) was found in the scan window.
- **`berlin_date` vs naive UTC calendar split:** For this row they **do not differ** (`berlin_date_differs_from_utc_split`: false), so it is **not** an example of the classic “UTC-midnight vs Berlin day” bug for this specific timestamp.
- **Half-open Berlin window:** `scheduled_at` is **within** `[startISO, endExclusiveISO)` — **PASS** for this sample.

### 6b — Spec SQL (Supabase MCP `execute_sql`, same project)

```sql
SELECT id, client_name, scheduled_at,
  (scheduled_at AT TIME ZONE 'Europe/Berlin') AS berlin_local,
  (scheduled_at AT TIME ZONE 'Europe/Berlin')::date AS berlin_date,
  scheduled_at::date AS utc_date
FROM public.trips
WHERE scheduled_at IS NOT NULL
  AND EXTRACT(HOUR FROM scheduled_at AT TIME ZONE 'Europe/Berlin') >= 22
  AND scheduled_at >= NOW() - INTERVAL '7 days'
ORDER BY scheduled_at DESC
LIMIT 5;
```

**Result set:** One row:

- `id`: `adfa5996-11f8-49a9-b1a4-565265e6748c`
- `client_name`: Lisa Fritz
- `scheduled_at`: `2026-04-28 21:17:00+00`
- `berlin_local`: `2026-04-28 23:17:00`
- `berlin_date`: `2026-04-28`
- `utc_date`: `2026-04-28`

**Note:** No sample was found where `berlin_date` ≠ `utc_date` in this 7-day late-evening window; that does not prove absence of historical edge cases elsewhere.

### 6c — `driver-trips.service.ts` fix (code presence)

Half-open Berlin day bounds use `getZonedDayBoundsIso` and `gte` / `lt` on `scheduled_at` (imports and usage present in `src/features/driver-portal/api/driver-trips.service.ts`).

---

## Section 7 — Overall verdict

**Verdict: PARTIAL**

| Check | Result |
|--------|--------|
| **Test suite (`bun test`)** | **PASS** — 79/79 |
| **`bun run build` (final, after debug deletion)** | **PASS** — exit 0 |
| **Pre-flight duplicate SQL** | **FAIL vs expectation** — 1 duplicate group (2 rows); expected 0 |
| **Cron UTC encoding (`phase2-cron-check`)** | **Not completed** — no eligible recurring rule at run time |
| **Cron dedup (`phase2-dedup-check`)** | **Not completed** — blocked by same prerequisite |
| **Driver bounds spot check (`phase2-driver-check` + spec SQL)** | **PASS for available sample** — 1 late trip; within half-open window; no `berlin_date` vs `utc_date` mismatch for that row |

**Blocking “production-ready” declaration from this run alone:**

1. **Duplicate rows** still exist for `(client_id, rule_id, requested_date, link_type)` (see Section 3) — reconcile data and re-run SQL until zero rows.  
2. **Cron encoding + dedup** were **not exercised end-to-end** against live rules/trips because no matching `recurring_rules` row existed when the temporary routes ran — repeat after data/prerequisites satisfy the debug criteria (or adjust selection in a QA-only harness).

---

## Appendix — Legacy operator checklist

The table below is retained for humans doing UI-level checks; automate pass/fail above does not replace dispatcher sign-off.

| # | Area | Procedure | Expected | Result |
|---|------|-----------|---------|--------|
| 1 | Driver **Touren** | Day with post-22:00 Berlin pickup | Trip on correct calendar day | See Section 6 |
| 2 | Cron **encoding** | Cron with secret, rule at fixed wall time | `scheduled_at` encodes Berlin wall as correct UTC instant | Section 4 — not completed |
| 3 | Cron **dedup** | Cron twice same horizon | No duplicate leg rows | Section 5 — not completed |
| 4–6 | Widgets / Fahrten | Manual | Berlin intent preserved in DB/UI | Not tested in this automation pass |

Duplicated `(client_id, rule_id, requested_date, link_type)` in `trips` can still cause **`maybeSingle` errors** in cron dedup lookups — resolve duplicates before trusting cron behaviour in production.
