# Phase 5 audit — UTC calendar vs Berlin business calendar (pre-fix mapping)

**Scope:** Map remaining date/time patterns that use **UTC calendar** or **runtime-local** day math where **Berlin business calendar** (`getTripsBusinessTimeZone()` / `trip-business-date.ts`) is the product intent. **No code changes** in this document.

**Reference helpers (already correct):**

- [`src/features/trips/lib/trip-business-date.ts`](../../src/features/trips/lib/trip-business-date.ts) — `todayYmdInBusinessTz`, `instantToYmdInBusinessTz`, `getZonedDayBoundsIso(ymd)`.
- [`src/features/trips/lib/trip-time.ts`](../../src/features/trips/lib/trip-time.ts) — `parseScheduledAt(iso)` → `{ ymd, hm }` in business TZ (throws `TripTimeError` on invalid ISO).
- [`src/query/keys/trips.ts`](../../src/query/keys/trips.ts) — `timelessRuleTrips(todayYmd, tomorrowYmd)` already keys off **Berlin** pair (Phase 3B); no Phase 5 issue here.

---

## Grep results (pattern scan)

Command intent (repo used workspace search equivalent of):

`toISOString().slice` | `toISOString().split` | `startOfDay` | `endOfDay` | `new Date().toISOString`

Paths: `src/features/trips/`, `src/features/dashboard/`, `src/app/api/`  
Excluding: `node_modules`, `.next`, `__tests__`, and (per user filter) **not** listing `trip-time.ts` / `duplicate-trip-schedule.ts` as *new* bugs — those files use `startOfDay` **in-zone** by design.

| File | Line(s) | Pattern | Classification |
|------|---------|---------|----------------|
| `use-pending-assignments.ts` | 76–80 | `setHours` local “bounds” + `now.toISOString().slice(0, 10)` | **UTC-calendar bug** (`todayStr`) + **dead / misleading** local `startOfDay`/`endOfDay` (not used in query) |
| `use-pending-assignments.ts` | 159–163 | `new Date(…scheduled_at…).toISOString().slice(0, 10)` | **UTC-calendar bug** (computed `tripDate` vs Berlin) |
| `pending-assignment-item.tsx` | 57–61 | Same slice pattern for display date | **UTC-calendar bug** (display / label) |
| `recurring-rules.service.ts` | 97 | `new Date().toISOString().split('T')[0]` | **UTC-calendar bug** (`requested_date` delete threshold) |
| `use-upcoming-trips.ts` | 27–34 | `startOfDay` / `endOfDay` / `endOfWeek` + `.toISOString()` | **Runtime-local bug** (browser/server local day, not Berlin) |
| `print-trips-button.tsx` | 58–65 | `startOfDay(date).toISOString()` / `endOfDay(date).toISOString()` | **Runtime-local / print range** (user-selected `Date` interpreted in local TZ) |
| `recurring-exceptions.actions.ts` | 82 | `scheduledDate.toISOString().split('T')[0]` | **UTC-calendar-adjacent** (pairing / matching, not Fahrten filter) |
| `recurring-exceptions.actions.ts` | 291 | `new Date().toISOString()` in `.gte('scheduled_at', …)` | **Instant “now”** (UTC ISO) — usually OK for “future trips”; not a civil-day label bug |
| `duplicate-trips.ts` | 68 | `scheduledDate.toISOString().split('T')[0]` | **UTC-calendar-adjacent** (same-day pairing query) |
| `use-create-trip-draft.ts` | 25 | `new Date().toISOString()` | **Read-only metadata** (`updatedAt` draft blob) |
| `use-bulk-upload-resume-store.ts` | 42 | `new Date().toISOString()` | **Read-only metadata** (resume store) |
| `trip-business-date.ts` | 1, 47 | `startOfDay` with `{ in: inTz }` | **Already fixed** (authoritative Berlin bounds) |
| `occupancy-utils.ts` (dashboard) | 2–3, 44–46, 100–101 | `startOfDay` / `endOfDay` on `Date` | **Runtime-local / dashboard** (outside `trips/` widget list; same class of risk) |
| `pending-tours-widget.tsx` (dashboard) | 167–171 | `toISOString().slice(0, 10)` on `scheduled_at` | **UTC-calendar bug** (parallel to dispatch inbox item) |
| `cron/generate-recurring-trips/route.ts` | 105–106, 430–436 | `startOfDay`/`endOfDay` with `inTz` | **Already fixed** (Berlin) |
| `cron/.../route.ts` | 126, 642 | `new Date().toISOString()` | **Skip** (log / metadata timestamps) |

---

## 1. Dispatch inbox `todayStr` — `use-pending-assignments.ts`

**Exact line — `todayStr` construction**

```80:80:src/features/trips/components/pending-assignments/use-pending-assignments.ts
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
```

So: **`now.toISOString().slice(0, 10)`** — this is the **UTC calendar date** of the current instant, not `todayYmdInBusinessTz()`.

**How `todayStr` is used**

- Not used in Supabase `.eq` / `.gte` on the server query. The hook loads broad lists (`upcomingQuery`, `openQuery`, CSV query) then **client-side filters** when `filter === 'today'`:

```187:189:src/features/trips/components/pending-assignments/use-pending-assignments.ts
    if (filter === 'today') {
      todayTripsRaw = todayTripsRaw.filter((t) => t.tripDate === todayStr);
      openToursRaw = openToursRaw.filter((t) => t.tripDate === todayStr);
```

- Comparison is **`tripDate === todayStr`**. `tripDate` comes from `computedTripDate`:

```157:164:src/features/trips/components/pending-assignments/use-pending-assignments.ts
      const computedTripDate = (() => {
        if (t.scheduled_at)
          return new Date(t.scheduled_at).toISOString().slice(0, 10);
        if (t.requested_date) return t.requested_date;
        const linkedAt = t.linked_trip?.scheduled_at;
        if (linkedAt) return new Date(linkedAt).toISOString().slice(0, 10);
        return new Date().toISOString().slice(0, 10);
      })();
```

So for rows **with** `scheduled_at` (or linked leg clock), `tripDate` is also a **UTC calendar slice**, not Berlin `ymd`. For `requested_date`-only rows, the string is already a civil date (usually aligned with intent).

**Consequence (UTC vs Berlin)**

- **Early morning Berlin (e.g. 00:30–02:30)** can still be **previous UTC date**. Then `todayStr` is “yesterday” in UTC while operations “today” is already the **next Berlin calendar day**. Trips whose true Berlin `ymd` is “today” can **fail** `tripDate === todayStr` (or wrong trips from “yesterday” Berlin appear).
- **Late evening Berlin** less often crosses UTC midnight the other way, but **near midnight UTC** the opposite can happen: `todayStr` advances to “tomorrow” UTC while Berlin is still “today”.
- **Unscheduled / `requested_date` legs** compared to a UTC `todayStr` can be wrong vs Berlin “today” for the same boundary reasons.

**Note:** Lines 76–79 build **local** `startOfDay` / `endOfDay` with `setHours`, but those variables are **not referenced** later in `load()` — only `todayStr` drives the filter. The comment “Calendar bounds” is misleading.

**Recommended fix (1–2 sentences)**  
Replace `todayStr` with `todayYmdInBusinessTz()` and replace `computedTripDate` branches that use `scheduled_at` / linked `scheduled_at` with `parseScheduledAt(iso).ymd` (or a null-safe `parseScheduledAtOrFallback`) so **both sides** of the equality use Berlin civil day.

---

## 2. Recurring rules “today” — `recurring-rules.service.ts`

**Exact line**

```97:104:src/features/trips/api/recurring-rules.service.ts
      const today = new Date().toISOString().split('T')[0];
      const { error: tripError } = await supabase
        .from('trips')
        .delete()
        .eq('rule_id', id)
        .gte('requested_date', today)
```

So: **`new Date().toISOString().split('T')[0]`** — **UTC date** `YYYY-MM-DD`, equivalent to `slice(0, 10)`.

**What query uses it**

- Only when **`deleteRule(id, deleteFutureTrips: true)`** runs: **hard delete** of `trips` with `rule_id = id`, **`requested_date >= today`**, status not completed/cancelled, and ingestion_source filter.
- Not used for listing rules or normal trip reads.

**What breaks when UTC date ≠ Berlin date**

- **Deleting “future” rule-generated trips** can **omit** Berlin “today” rows (if UTC `today` is still “yesterday” while Berlin is already the next calendar day) or **include** rows that are still “today” in Berlin but “tomorrow” in UTC — wrong **cutoff** for `requested_date`.
- Impact is **destructive** (wrong rows deleted or rows left behind) but **only** on that explicit delete path.

**Recommended fix (1–2 sentences)**  
Use `todayYmdInBusinessTz()` (or `instantToYmdInBusinessTz(Date.now())`) for `today` so `requested_date` comparisons match operations calendar in Berlin.

---

## 3. `use-upcoming-trips` query window

**Exact construction**

```21:35:src/features/trips/hooks/use-upcoming-trips.ts
      const now = new Date();
      let startDate = '';
      let endDate = '';

      if (filter === 'tomorrow') {
        const tomorrow = addDays(now, 1);
        startDate = startOfDay(tomorrow).toISOString();
        endDate = endOfDay(tomorrow).toISOString();
      } else if (filter === 'week') {
        startDate = startOfDay(now).toISOString();
        endDate = endOfWeek(now, { weekStartsOn: 1 }).toISOString();
      } else {
        startDate = startOfDay(now).toISOString();
        endDate = endOfDay(now).toISOString();
      }
```

**Timezone**

- `date-fns` `startOfDay` / `endOfDay` / `endOfWeek` use the **environment’s local timezone** (browser for client hook; server TZ if ever run on server), **not** `Europe/Berlin` unless the runtime happens to be Berlin.

**Downstream query**

```161:169:src/features/trips/api/trips.service.ts
  async getUpcomingTrips(startDate: string, endDate: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('trips')
      ...
      .gte('scheduled_at', startDate)
      .lte('scheduled_at', endDate)
```

So the window is applied to **`scheduled_at`** (UTC instants in DB), which is **correct in principle**, but the **bounds** are wrong if the product intends “today in Berlin” while the browser is elsewhere or near DST boundaries.

**Display vs mutation**

- **Read-only / display list** for dashboard “upcoming” UI; **no direct mutation** in this hook. It **does** drive which trips appear and can mislead dispatchers about what is “today”.

**Recommended fix (1–2 sentences)**  
Build `[startDate, endDate]` from `getZonedDayBoundsIso(todayYmd)` (and `addDays` on Berlin picker dates) so “today / tomorrow / week” match Fahrten; optionally replace `endOfWeek` with explicit Berlin week bounds.

---

## 4. `parseScheduledAtOrFallback` gap — display `toISOString().slice(0, 10)` on `scheduled_at`

**Call sites under `src/features/trips/`** (slice used as a **civil day label**, not for persisting `scheduled_at`):

| File | Lines | Role |
|------|-------|------|
| [`use-pending-assignments.ts`](../../src/features/trips/components/pending-assignments/use-pending-assignments.ts) | 159, 162, 163 | `computedTripDate` for **inbox filter + `tripDate` prop** |
| [`pending-assignment-item.tsx`](../../src/features/trips/components/pending-assignments/pending-assignment-item.tsx) | 57, 60, 61 | **Display** date string in UI |

**Count:** **2 files**, **6** slice expressions (3 per file in the `scheduled_at` / linked / fallback paths).

**Would `parseScheduledAtOrFallback(iso)` eliminate all?**

- **For `scheduled_at` and linked `scheduled_at`:** A helper that returns **`{ ymd } | null`** (no throw) would replace those slices and align labels with Berlin **if** it uses the same TZ as `parseScheduledAt`.
- **Not sufficient alone for the inbox “today” filter** until **`todayStr`** also uses Berlin (`todayYmdInBusinessTz`).
- **Fallback line** `return new Date().toISOString().slice(0, 10)` is “today” in **UTC**, not display of `scheduled_at` — a fallback would need **`todayYmdInBusinessTz()`** or explicit product rule, not only `parseScheduledAtOrFallback`.
- **Rows with only `requested_date`:** already strings; no slice — helper not needed there.

**Related (outside `trips/` but same pattern):** [`pending-tours-widget.tsx`](../../src/features/dashboard/components/pending-tours-widget.tsx) lines 167–171 — same slice stack for widget trip dating.

---

## 5. Risk ranking (dispatcher 06:00–22:00 Berlin)

| Rank | Issue | Most visible wrong behaviour | Typical time-of-day |
|------|--------|------------------------------|---------------------|
| **1** | **Dispatch inbox** (`todayStr` + `tripDate` UTC slice) | Wrong trips in **“Heute”** inbox: missing urgent unassigned rows or showing yesterday/tomorrow rows; wrong date label on cards | **00:00–03:00 Berlin** (UTC date still “yesterday” for ~1–3h after Berlin midnight); also **any** browser TZ ≠ Berlin |
| **2** | **Upcoming trips** (`startOfDay`/`endOfDay` local) | “Heute” / “Morgen” dashboard lists **shift** vs Fahrten / driver reality; wrong count near boundaries | **Morning stand-up** if laptop TZ ≠ Berlin; **DST** transition days |
| **3** | **Recurring rule delete** (`requested_date >= UTC today`) | **Wrong set of trips deleted** (or not deleted) when admin deletes rule with “delete future trips” — rare but **data loss** | **Whenever** the delete action runs near UTC midnight mismatch (~**00:00–02:00 Berlin** worst); low **frequency** compared to inbox |

**Reasoning:** The inbox is used **continuously** during the shift and gates **who must be assigned**; a wrong “today” filter is immediately visible. Upcoming trips are high-visibility but slightly less operationally blocking than inbox assignment. Recurring delete is **high severity per incident** but **low frequency** and admin-only.

---

## Recommended fix summary (per bug)

| Bug | Approach |
|-----|----------|
| Dispatch inbox | Berlin `todayStr`; Berlin `ymd` from `scheduled_at` / linked via `parseScheduledAt` or safe fallback; drop unused local `startOfDay`/`endOfDay` or repurpose with `getZonedDayBoundsIso` if ever needed server-side. |
| Recurring rules delete | `todayYmdInBusinessTz()` for `gte('requested_date', today)`. |
| Upcoming trips | Derive window ISO bounds from `getZonedDayBoundsIso` / Berlin calendar arithmetic; align “week” with business week. |
| Display slices | Introduce `parseScheduledAtOrFallback` for non-throwing UI; pair with Berlin “today” fallback where the intent is operations day, not UTC. |

---

## Appendix — `tripKeys` / Phase 5

[`src/query/keys/trips.ts`](../../src/query/keys/trips.ts): **`timelessRuleTrips(todayYmd, tomorrowYmd)`** is already the correct **two-day Berlin key** pattern. No change required for Phase 5 from this file.
