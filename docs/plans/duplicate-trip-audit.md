# Audit: trip appears on two consecutive calendar days (read-only)

**Date:** 2026-04-27  
**Scope:** Code review only. No production database access, no schema or app changes.  
**Symptom (reported):** One trip (example passenger name “Kunna Höpken”) for **2026-04-27** also appears when viewing **2026-04-28**, though dispatch expects a single day only.

---

## Executive summary

- **Data model:** `trips` uses **`scheduled_at`** (instant in DB; exposed as ISO **string** in `database.types.ts`) and a separate **date** field **`requested_date`** for unscheduled / date-only rows. The repository does **not** include the original `CREATE TABLE public.trips` migration; types and comments (e.g. invoice line items) imply **`timestamptz`-style** semantics for `scheduled_at` (stored absolute instant; **UTC in Postgres** under the hood; compared as instants in queries).
- **Day filter for the main Fahrten schedule (list + kanban):** `src/features/trips/components/trips-listing.tsx` builds a **half-open** UTC window per **calendar** day in the **business timezone** (`Europe/Berlin` by default, `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`), via `getZonedDayBoundsIso` in `src/features/trips/lib/trip-business-date.ts`. A **single** `scheduled_at` value cannot fall into **two** adjacent Berlin day windows—unless different screens use **different** bounds (they do in some other features—see below).
- **Most plausible explanations** for the *reported* “same trip on two days” (in order):
  1. **Two `trips` rows** (same or similar `client_name`, e.g. linked **Hin- und Rückfahrt** on two dates, a **duplicate** flow, or **recurring** materialization), mistaken for one logical trip in dispatch.
  2. **Timezone mismatch** between **write** path (browser **local** `Date` → `toISOString()`) and **read** path (fixed **Europe/Berlin** day bucketing in Fahrten). This usually moves a card between days or hides it, but it is the **highest-risk architectural** area if users operate outside Berlin local time.
  3. **Stale RSC/URL** or user comparing **two UIs** with different “today” definitions (less likely if the same URL `scheduled_at` and hard refresh was verified).

- **If `id` is truly the same** on 27 and 28 with the same `scheduled_at` in SQL: the OR-filter in `trips-listing.tsx` should **not** return one row **twice**; investigate **caching/refresh** or a **second** surface, not the PostgREST `or()` alone.

---

## 1. Schema check (column types, UTC, date derivation)

| Column (app)         | `database.types` (`src/types/database.types.ts` ~L1224–L1227) | Notes |
|----------------------|-----------------------------------------------------------------|--------|
| `scheduled_at`       | `string \| null`                                                | Treated as full **instant** in code (`toISOString()` writes, `.gte` / `.lt` in queries). In Postgres/Supabase this is effectively **`timestamptz`**-style storage (repo lacks CREATE TABLE, but line items migration references “from `trips.scheduled_at`” as a timestamp). **Supabase/PostgREST does not re-encode “in German time”**—it stores and returns ISO instants. |
| `requested_date`     | `string \| null`                                                | **Date-only** intent for unscheduled work (CSV, “time open”). Used in the Fahrten date filter for `scheduled_at IS NULL` rows. |
| `created_at`         | `string \| null`                                                | Auditing only for this issue. |
| (passenger)          | `client_name` (not `passenger_name`)                            | Fahrten search uses `client_name` in `trips-listing.tsx`. |

**Conclusion:** There is no separate `scheduled_date` column in generated types. **Calendar “day” in Fahrten** is derived from **`scheduled_at` instant** in the business TZ **at query time** (or from **`requested_date`** when `scheduled_at` is null).

---

## 2. Timezone / insert: what is written for “today” in the UI?

### Create flow (primary)

`CreateTripForm` calls `combineDepartureForTripInsert` (`src/features/trips/components/create-trip/create-trip-form.tsx` ~L1219–L1225):

- Implementation: `src/features/trips/lib/departure-schedule.ts` ~L18–L58.  
- With time: `new Date( year, month, day, hours, minutes, … )` in the **JavaScript “local”** sense, then **`return { scheduled_at: full.toISOString(), requested_date: ymd }`**. So the DB gets a **UTC ISO** string of that **local** wall time (whatever the **browser** timezone is).  
- With date but **no** time: `scheduled_at: null`, `requested_date: ymd` (string).

**Exact insert call:** `tripsService.createTrip({...})` → `src/features/trips/api/trips.service.ts` `insert(trip)` ~L42–L47. Field values come from the form as above; no second server transformation in the service.

### Trip detail sheet (edit)

`buildTripDetailsPatch` (`src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` ~L183–L232) sets `scheduled_at` with:

- `buildScheduledAtFromYmdAndHm` / `applyTimeToScheduledDate` in `src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts`—again **`Date` in local (browser) semantics** and `.toISOString()`.

**Conclusion (Q2):** The DB stores an **absolute instant** (ISO in UTC on the wire). The **intended** local calendar and clock come from the **user agent’s** timezone, **not** from `getTripsBusinessTimeZone()` used on the Fahrten list.

---

## 3. Query boundary: exact Fahrten query for a calendar day

**File:** `src/features/trips/components/trips-listing.tsx` (RSC, server)

When `scheduled_at` URL is a **single** `YYYY-MM-DD` (or a legacy **numeric** ms that is mapped to YMD in business TZ):

1. `getZonedDayBoundsIso(dayStr)` → `startISO`, `endExclusiveISO` (half-open `[start, end)` in `trip-business-date.ts` ~L41–L52).  
2. PostgREST filter built as `or` of:

- `and(scheduled_at.gte.<startISO>,scheduled_at.lt.<endExclusiveISO>)`  
- `and(scheduled_at.is.null,requested_date.eq.<dayStr>)`  
- If **viewing** the **business-TZ “today”** and `dayStr === todayYmdInBusinessTz()`: an extra branch `and(scheduled_at.is.null,requested_date.is.null)` (lines ~L214–L221). That last branch **adds** fully undated unscheduled rows **only** on the *current* business “today” — not on arbitrary future/past day picks.

**Exact passage:** `trips-listing.tsx` ~L200–L223 (single-day branch).

**Could a 23:00 local / 00:30 local trip “straddle” the wrong *Berlin* day?**

- Fahrten uses **Berlin (or `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`)** for **buckets**, not the browser.  
- A **single** `scheduled_at` instant lies in **exactly one** half-open Berlin day window, **unless** two different UIs use different window math.

**Other code (not Fahrten, but important):**

- `src/features/driver-portal/api/driver-trips.service.ts` ~L88–L92 uses  
  `dayStart = \`${date}T00:00:00.000Z\`` and `dayEnd = \`${date}T23:59:59.999Z\`**.** That is **UTC** midnight–end, **not** Berlin. The same `scheduled_at` instant can be **included or excluded** relative to a **Berlin** day used elsewhere. If “schedule view” includes the driver app, this is a **separate, confirmed** bug pattern (wrong day bucket).

- `useUpcomingTrips` (`src/features/trips/hooks/use-upcoming-trips.ts` ~L25–L35) uses `startOfDay` / `endOfDay` from **`date-fns` without a TZ** (runtime local). Feeds `tripsService.getUpcomingTrips` (`trips.service.ts` ~L161–L169: `.gte` / `.lte` on `scheduled_at`). Again **not** the same as Fahrten’s Berlin-bounded RSC query.

**Conclusion (Q3):** For the **Fahrten** RSC, boundaries are **Berlin (configurable)**, `gte` + **`lt`**, not a naive `23:59:59.999Z` in UTC. The “23:00 local → 21:00 UTC” fact alone does not put one instant into **two** Fahrten day filters; it can misalign **Fahrten** vs **driver portal** or **upcoming** widgets.

---

## 4. Duplicate row check (Kunna Höpken) — how to run in Supabase

**Cannot run in this audit** (no DB credentials to production). Use the SQL editor (or `psql`) against the project:

```sql
-- Passenger label in this codebase is `client_name` (and optionally `client_id`).

SELECT
  id,
  scheduled_at,
  requested_date,
  created_at,
  status,
  link_type,
  linked_trip_id,
  rule_id,
  ingestion_source
FROM public.trips
WHERE client_name ILIKE '%Kunna%Höpken%'
   OR client_name ILIKE '%Höpken%Kunna%'
ORDER BY COALESCE(scheduled_at::date, requested_date, created_at::date), created_at;
```

**Interpretation:**

- **Two+ rows** with different `id` but same name → *not* one row in two day buckets; likely **Hin/Rück**, **duplicate** (`ingestion_source = 'trip_duplicate'`), or **recurrence** (`rule_id` / cron).  
- **One row** → then re-check the **exact** `scheduled_at` (instant) and whether the UI compare was **the same** URL, hard refresh, and same **route** (Fahrten vs driver vs overview).

---

## 5. Grouping / client-side date bucketing (schedule view)

**Fahrten list/kanban:** The **server** query applies the day filter. The kanban only **merges** `trips` with `pendingChanges` (local overrides) in `src/features/trips/components/kanban/kanban-board.tsx` ~L184–L191. It does **not** re-bucket by date. **There is no second client-side “which day is this trip?”** pass for the initial membership set—only field overrides for rows already returned.

**Default URL:** `TripsFiltersBar` (`src/features/trips/components/trips-filters-bar.tsx` ~L111–L118) one-time `router.replace` sets `scheduled_at` to `todayYmdInBusinessTz()` if missing, aligning the **default** day with the **same** business TZ as the RSC.

---

## 6. Recurrence, copy, “silent” second day

| Mechanism | File / entry | Can it create a **second** row for “tomorrow”? |
|-----------|----------------|-----------------------------------------------|
| **Recurring rules + cron** | `src/app/api/cron/generate-recurring-trips/route.ts` | **Yes** — new `trips` rows per rule, separate `id`. `toScheduledIso` (same file, ~L51–L53) uses `new Date(\`${dateStr}T${t}\`)` in **server** runtime; **Vercel default is UTC**, not Berlin—separate class of time bugs for *generated* rows. |
| **Duplicate (dispatch)** | `src/features/trips/lib/duplicate-trips.ts`, `POST /api/trips/duplicate` | **Yes** — explicit new rows; `ingestion_source = 'trip_duplicate'`. |
| **Rückfahrt** | `src/features/trips/lib/build-return-trip-insert.ts` (e.g. `scheduled_at: params.scheduledAt.toISOString()`) | **Yes** — new row, often next leg on another day if user set it. |
| **Linked Hin/Rück** | `linked_trip_id`, `link_type` | **Two rows** by design, same passenger. |

**Conclusion (Q6):** Nothing in the reviewed code **splits** one row across two days in SQL; there **are** features that add **a second** row.

---

## Confirmed or best-effort root cause

**Best-supported technical story for “one logical trip, two days” in operations:**

- **Data:** two rows (return leg, duplicate, recurring child), **or** one row viewed under **two different** day-bounding implementations (Fahrten vs driver portal / upcoming) **or** a **stale** client bundle.

**If the investigation proves a *single* `id` with one `scheduled_at` appears under both 2026-04-27 and 2026-04-28 on **Fahrten** with the same filter semantics:** that is **inconsistent** with the current `or()` filter logic (a single instant cannot satisfy `gte+lt` in two disjoint Berlin day windows). Treat **cache/navigation** or **measurement** error as the next hypothesis.

**Architectural risk (even for single-day correctness):** **Writes** (create + details patch) use **browser local** time; Fahrten **reads** use **fixed business timezone** (`trip-business-date.ts`). Remote users not in `Europe/Berlin` can get **wrong-day** inclusion, which can look like “it jumped to tomorrow/ yesterday” in edge cases.

**Where the “day” decision lives in code (Fahrten):** `src/features/trips/components/trips-listing.tsx` **lines 155–223** (and helpers `getZonedDayBoundsIso` / `instantToYmdInBusinessTz` in `src/features/trips/lib/trip-business-date.ts` **lines 24–52**). **Where writes get their instant:** `src/features/trips/lib/departure-schedule.ts` **45–57**; `apply-time-to-scheduled.ts` **15–27**.

---

## What a fix would touch (recommendation only; no code in this doc)

- **Unify** “business calendar + clock” for **all** `scheduled_at` **writes** (create, edit, reschedule) with the same IANA zone used for Fahrten (`getTripsBusinessTimeZone()` + explicit zoned `Date` construction, or `Temporal` with named offset), and **re-test** day boundaries.  
- **Fix** `getDriverTrips` day filter to use **Berlin (or org) day bounds** instead of `T00:00:00.000Z` (see `driver-trips.service.ts` ~L88–L92).  
- **Align** `useUpcomingTrips` with business TZ or document it as “browser local” only.  
- **Product/data:** For duplicate-name reports, always compare **`id`**, `scheduled_at`, `linked_trip_id`, `ingestion_source`, `rule_id` in SQL.  
- **Stability:** If a same-`id` Fahrten bug is reproduced, add logging of **URL `scheduled_at` + returned row ids** before changing SQL.

**Safest approach (senior recommendation):** Treat **(a)** *two rows* and **(b)** *timezone* as separate hypotheses. First confirm with SQL (`id` count) for the named passenger. If two rows, trace `link_type` / `rule_id` / `ingestion_source`. If one row, reproduce on Fahrten with a hard full reload and a single `scheduled_at` URL, then only then consider RSC or cross-feature bugs. The **largest durable fix** is **consistent zoned** read/write in **`Europe/Berlin`** (or env) end-to-end, plus **driver** day bounds; that removes whole classes of off-by-one-day issues without overfitting to one `or()` quirk in `trips-listing.tsx` (which is already using half-open Berlin windows).

---

## References (files read in full or in substantive part)

- `src/types/database.types.ts` (trips Row)  
- `src/features/trips/api/trips.service.ts`  
- `src/features/trips/lib/trip-business-date.ts`  
- `src/features/trips/components/trips-listing.tsx`  
- `src/features/trips/lib/departure-schedule.ts`  
- `src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts`  
- `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts`  
- `src/features/trips/components/trips-filters-bar.tsx` (default `scheduled_at`)  
- `src/features/trips/components/kanban/kanban-board.tsx` (no date grouping)  
- `docs/trips-date-filter.md` (historical `scheduled_at IS NULL` / “stuck cards”)  
- `src/features/driver-portal/api/driver-trips.service.ts` (UTC day bug risk)  
- `src/features/trips/hooks/use-upcoming-trips.ts` (local `startOfDay`)  
- `src/app/api/cron/generate-recurring-trips/route.ts` (toScheduledIso on server)  

`CREATE TABLE` for `public.trips` was **not** found in `supabase/migrations/`; column behaviour is inferred from **generated types** and app usage.
