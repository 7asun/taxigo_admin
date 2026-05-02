# Timeless rule trips widget — code audit

**Scope:** Read-only review of the dashboard “timeless rule trips” data path (`useTimelessRuleTrips` / `fetchTimelessRulePairs`), query keys, schema hints, and RLS. No application code was changed for this document.

**Note on paths:** There is no file `src/query/keys.ts`. Trip keys are defined in `src/query/keys/trips.ts` and re-exported from `src/query/keys/index.ts` (imported elsewhere as `@/query/keys`).

---

## 1. Date passed for “tomorrow’s trips”

**File:** `src/features/dashboard/hooks/use-timeless-rule-trips.ts`

- **Constant:** `TIMELESS_WIDGET_LOOKAHEAD_DAYS = 1` (calendar day offset from “today”).
- **Construction:**
  - `new Date()` — **browser / system local** “now” (not the trips business timezone).
  - `addDays(..., 1)` from `date-fns`.
  - `format(..., 'yyyy-MM-dd')` from `date-fns`.
- **Exact value sent to Supabase:** a **plain calendar date string** `yyyy-MM-dd` (e.g. `2026-05-02`). It is **not** an ISO timestamp with time or `Z`.

This differs from Berlin-centric helpers used elsewhere (`getTripsBusinessTimeZone`, `trip-business-date`, `trip-time.ts`). If the product’s “tomorrow” is meant to match **business TZ** (e.g. Europe/Berlin) while the user’s machine is elsewhere (or near midnight), the filtered **calendar day can disagree** with cron / Fahrten “tomorrow”.

---

## 2. `requested_date` column type vs query format

**Evidence in repo**

- **Generated types** (`src/types/database.types.ts`): `requested_date` on `trips.Row` is typed as `string | null`. That is consistent with PostgREST returning **`date`** or **`text`** as a string; it does **not** prove the SQL type by itself.
- **Migrations in `supabase/migrations/`:** no `CREATE TABLE` / `ALTER` for `trips.requested_date` was found under this repo snapshot, so the **exact Postgres type** (`date` vs `timestamptz` vs `text`) is **not verifiable from SQL here**.
- **Project docs** (e.g. `docs/trips-date-filter.md`, `docs/plans/duplicate-trip-audit.md`) describe `requested_date` as a **calendar day** (`YYYY-MM-DD`) for unscheduled / date-scoped rows.

**Query:** `.eq('requested_date', requestedDate)` with `requestedDate` = `yyyy-MM-dd`.

**Match assessment:** If the column is Postgres **`date`** (or **text** holding the same shape), this filter is appropriate. If it were **`timestamptz`** with midnight UTC storage, equality to a **date-only** string can be **fragile** depending on coercion; the codebase and docs **assume date-only semantics**, not a full instant in `requested_date`.

---

## 3. `scheduled_at IS NULL` filter

**Yes.** The main list query applies:

- `.is('scheduled_at', null)`

That is the **PostgJS / Supabase client** form (`.is(column, null)`), not `.eq('scheduled_at', null)`.

**Partner lookup** (rows referenced by `linked_trip_id`) does **not** re-apply `scheduled_at IS NULL`; it only selects by `id IN (...)`.

---

## 4. Query key registration and `timelessRuleTripsRoot`

**Definitions** (`src/query/keys/trips.ts`):

- `timelessRuleTripsRoot`: `['trips', 'timeless-rules']` (const tuple).
- `timelessRuleTrips(requestedDate)`: `['trips', 'timeless-rules', requestedDate]`.

**Hook registration** (`useTimelessRuleTrips`):

- `useQuery({ queryKey: tripKeys.timelessRuleTrips(tomorrowDateStr), ... })`  
  → exact key: **`['trips', 'timeless-rules', <yyyy-MM-dd>]`**.

**Does `tripKeys.timelessRuleTripsRoot` match exactly?**

- **No** — the hook’s key has **three** elements; the root has **two**.
- **Invalidation:** `createDebouncedInvalidateByQueryKey(queryClient, tripKeys.timelessRuleTripsRoot, …)` calls `invalidateQueries({ queryKey: ['trips', 'timeless-rules'] })`. In TanStack Query, that **prefix-invalidates** all queries whose key starts with that prefix, so **`timelessRuleTrips(tomorrowDateStr)` is included**. The root is a deliberate **family prefix**, not the same key as the active query.

---

## 5. Client-side filtering after Supabase

**Yes.** Even after rows return, many trips never become visible pairs:

**Server query predicates (recap):**

- `rule_id` **not** null  
- `scheduled_at` **is** null  
- `requested_date` **equals** the computed tomorrow string  
- `status` **not in** `cancelled`, `completed`

**`fetchTimelessRulePairs` post-processing:**

- Builds pairs only for rows that pass pairing loops and deduplication.
- **First loop:** only `link_type == null` or `link_type === 'outbound'` (`isOutboundish`). Skips return-only legs here.
- **Skips** rows missing **`rule_id`**, **`client_id`**, or **`requested_date`** (all required to form `dedupKey` and pair).
- **Second loop:** handles `link_type === 'return'` only if that `(rule_id, requested_date, client_id)` key was not already filled.
- **Dedup:** `pairsByKey` keeps **one** pair per `rule_id|requested_date|client_id`.
- **Sort:** `sortByClientNameAsc` — does not drop rows, only orders.

So trips can be **absent from the UI** because: wrong `requested_date` vs filter, `scheduled_at` set, wrong `status`, missing `rule_id`, missing **`client_id`** (nullable in DB but required in this hook), `link_type` pairing edge cases, or deduplication collapsing multiple rows into one pair.

---

## 6. RLS on `trips` (authenticated reads)

**Migrations:** `supabase/migrations/20260409170000_add_missing_rls.sql` (+ driver policy tweak in `20260409180000_fix_rls_helper_recursion.sql`).

**SELECT policies for `authenticated`:**

1. **`trips_select_company_admin`:** `current_user_is_admin()` **and** `company_id = current_user_company_id()`.
2. **`trips_select_own_driver`:** `driver_id = auth.uid()` **or** assignment row in `trip_assignments` for that trip and driver.

PostgreSQL combines multiple permissive policies for the same command with **OR**. So a session can read a trip if **either** policy passes.

**Implications:**

- **Company admin** users: should see **all** trips for their company (subject to filters), including unassigned timeless rows.
- **Driver** users: see only trips **assigned** to them (directly or via `trip_assignments`). **Unassigned** timeless rule trips for “tomorrow” would **not** be visible under RLS, even if the query and client logic are correct.

---

## Senior diagnosis: likely root cause(s) and fix direction

**Not the primary bug:** Query key vs `timelessRuleTripsRoot` — the prefix invalidation pattern is **intentional** and consistent with TanStack Query.

**High-likelihood causes (pick based on symptoms):**

1. **`scheduled_at IS NULL` + product expectation**  
   The widget is explicitly **“timeless” / unscheduled** legs. Any trip that already has **`scheduled_at` set** (rule with fixed time, or dispatcher set a time) **will not appear**. If users expect “all rule trips for tomorrow,” the **root cause is the filter**, not missing data — fix is either **product copy** or a **broader query** (different widget or tab).

2. **Calendar “tomorrow” vs business timezone**  
   “Tomorrow” is **local `new Date()`**, not **Berlin (or `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`)**. That can desync from cron-generated `requested_date` and Fahrten. **Fix:** derive `tomorrowDateStr` using the same **business-TZ “today”** helpers as the rest of trips (e.g. add one day in that TZ, then format `yyyy-MM-dd`), aligned with `trip-time` / `trip-business-date` work.

3. **`client_id` null on rule trips**  
   Rows with null `client_id` are **dropped in pairing**. If data or cron can produce such rows, **fix data** or **relax / adjust** client-side grouping (with clear product rules).

4. **RLS + driver viewing dashboard**  
   If the widget is shown to **drivers**, empty lists may be **correct** under RLS for unassigned trips. **Fix:** hide widget for non-admins or fetch via an admin-only path.

**Recommended fix (if the reported issue is “trips exist in DB / Fahrten but widget is empty for admins”):**  
First confirm **`scheduled_at`**, **`status`**, and **`requested_date`** on the missing rows; then align **tomorrow’s `yyyy-MM-dd`** with the **business timezone** used for trip generation and listing. If rows already have `scheduled_at`, the current query is **working as coded** — change requirements or query scope rather than “fixing” RLS or keys.
