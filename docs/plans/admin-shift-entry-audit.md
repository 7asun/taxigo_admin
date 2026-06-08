# Admin Shift Entry — Read-Only Audit

**Scope:** Can an admin enter **shift actuals** (`shifts` / `shift_events`) on behalf of a driver from the dashboard (e.g. Fahrerschichtplanung), reusing driver-portal code?

**Sources read:** `shifts.service.ts`, `shift-time-form.tsx`, `driver/shift/page.tsx`, RLS migrations, `driver-planning.service.ts`, auth helper migrations, `database.types.ts` (shifts / shift_events blocks), docs listed in the audit brief.

**Date:** 2026-06-08

---

## 1. SHIFTS SERVICE — `createManualShift`

### Current state

**a. Full signature and parameters**

Defined on `shiftsService` in [`src/features/driver-portal/api/shifts.service.ts`](src/features/driver-portal/api/shifts.service.ts) **168–176**:

```typescript
async createManualShift(params: {
  driverId: string;
  companyId: string;
  vehicleId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  breaks?: Array<{ start: string; end: string }>;
}): Promise<Shift>
```

Return type `Shift` is `Database['public']['Tables']['shifts']['Row']` — [`src/features/driver-portal/types.ts`](src/features/driver-portal/types.ts) **42**.

**b. Driver identity resolution**

`createManualShift` does **not** call `supabase.auth.getUser()`. The caller must pass `driverId` and `companyId` in `params` (**189–190**). The service uses browser `createClient()` from `@/lib/supabase/client` (**177**).

**c. Columns written to `shifts`**

Single `insert` at **186–195** sets:

| Column | Value |
| --- | --- |
| `driver_id` | `params.driverId` |
| `company_id` | `params.companyId` |
| `vehicle_id` | `params.vehicleId ?? null` |
| `started_at` | ISO string from `new Date(\`${date}T${startTime}:00\`).toISOString()` (**179–181**) |
| `ended_at` | ISO string from `new Date(\`${date}T${endTime}:00\`).toISOString()` (**182–184**) |
| `status` | `SHIFT_STATUSES.ENDED` (`'ended'`) |

Not set (DB defaults / remain null): `id`, `created_at`, `start_odometer`, `end_odometer`, `total_distance_km`, `total_earnings` — see [`database.types.ts`](src/types/database.types.ts) **1299–1327**.

**d. Rows written to `shift_events`**

Via internal `createShiftEvent` (**378–389**), which inserts `shift_id`, `event_type`, `timestamp`, `lat` (null), `lng` (null), `metadata`:

| Order | `event_type` | `timestamp` | `metadata` |
| --- | --- | --- | --- |
| 1 | `shift_start` | `startedAt` | none |
| 2..n | `break_start` / `break_end` (pairs) | per break slot | `break_start` only: `{ reason: 'Mittagspause' }` (**220**); `break_end`: none |
| last | `shift_end` | `endedAt` | none |

Break pairs are created only when `params.breaks` has entries with both `start` and `end` (**207–228**).

**e. Duplicate validation**

**Not in `createManualShift`.** Duplicate-day logic lives in **`ShiftTimeForm`**, which calls `getShiftForDriverByDate(driverId, date)` before insert (**262–271** in [`shift-time-form.tsx`](src/features/driver-portal/components/shift-time-form.tsx)). That helper filters `started_at` between UTC day bounds `${date}T00:00:00.000Z` and `${date}T23:59:59.999Z` (**128–136** in `shifts.service.ts`) — not Berlin zoned bounds.

**f. Other methods in `shifts.service.ts` an admin might need**

| Method | Signature | Relevance |
| --- | --- | --- |
| `getActiveShift` | `(driverId: string) => Promise<Shift \| null>` | **35–47** — unlikely for manual ended shifts |
| `getShiftsWithEvents` | `(driverId, options?: { limit? }) => Promise<…>` | **54–91** — read history with events |
| `getShiftsForDriver` | `(driverId, options?: { limit?, fromDate? }) => Promise<Shift[]>` | **96–117** |
| `getShiftForDriverByDate` | `(driverId: string, date: string) => Promise<Shift \| null>` | **123–143** — duplicate detection |
| `deleteShift` | `(shiftId: string) => Promise<void>` | **148–161** — deletes events then shift (overwrite flow) |
| `createManualShift` | see above | **168–237** |
| `startShift` | `{ driverId, companyId, vehicleId?, startOdometer?, lat?, lng? }` | **242–276** — real-time path |
| `endShift` | `{ shiftId, endOdometer?, lat?, lng? }` | **281–310** |
| `startBreak` / `endBreak` | shift-scoped | **318–373** |
| `createShiftEvent` | internal | **378–392** |

There is **no** `updateManualShift` or general shift update helper for admin edits to times after creation.

### Gap or risk for admin shift entry

- Service API already accepts target `driverId` / `companyId`, but it runs on the **browser Supabase client** under the **session user's RLS** — an admin session cannot INSERT/DELETE today (see §3).
- Duplicate check is **UI-only**, uses **UTC** day window, and lives outside the service.
- No `created_by` / audit column on `shifts` (schema **1299–1313**) — admin-on-behalf writes cannot be attributed in DB.

### Recommendation

Add a **server-side** admin shift write path (mirror `requireAdminContext()` + `upsertDayPlan` pattern) with new RLS policies before calling insert logic. Move duplicate detection into that server layer using `getZonedDayBoundsIso` for consistency with planning/reconciliation. Decide whether to add audit metadata (`entered_by`) — **PRODUCT DECISION REQUIRED** (no column today).

---

## 2. SHIFTTIMEFORM COUPLING

### Current state

**a. How `driverId` and `company_id` are obtained**

[`shift-time-form.tsx`](src/features/driver-portal/components/shift-time-form.tsx) **187–207**:

- `useEffect` on mount calls `createClient()` → `supabase.auth.getUser()` (**189–192**).
- Loads `accounts` row: `.select('id, company_id').eq('id', user.id).single()` (**195–199**).
- Sets local state `driverId` / `companyId` (**201–203**).

No prop, context, or hook from driver-portal layout — **direct Supabase auth inside the component**.

**b. `driverId` prop**

**No.** Only optional `onShiftSaved` prop (**154–156**, **158**). Hardwired to authenticated user’s account id.

**c. Props today**

```typescript
export interface ShiftTimeFormProps {
  onShiftSaved?: () => void;
}
```

(**154–156**)

**d. Changes needed for admin-on-behalf entry**

| Area | Change |
| --- | --- |
| Identity | Add required props e.g. `driverId`, `companyId` (or single `targetDriver` object); remove or gate the `useEffect` auth lookup (**187–207**). |
| Submit | Pass prop ids into `createManualShift` (**229–231**) instead of state from auth. |
| Duplicate UX | Keep overwrite dialog but run duplicate check for **target** driver; consider different copy when existing shift was driver-entered vs admin-entered — **PRODUCT DECISION REQUIRED**. |
| Data layer | Replace client `shiftsService` calls with **server actions** using server Supabase client + admin RLS (client service will fail for admin INSERT/DELETE). |
| Optional | `defaultDate`, `vehicleId`, `onCancel`, `compact` layout for popover embedding in roster cell. |
| Loading gate | Replace “Bitte melden Sie sich an” block (**281–290**) with prop validation, not session driver profile. |

**e. Driver-portal-specific context / layout**

- `ShiftTimeForm` imports only shared UI + `@/lib/supabase/client` + `shiftsService` — **no** `DriverHeader`, tracking context, or driver layout imports.
- Route [`src/app/driver/shift/page.tsx`](src/app/driver/shift/page.tsx) wraps it in `DriverShiftPageContent` (**7–15**).
- [`src/app/driver/layout.tsx`](src/app/driver/layout.tsx) **37–38** redirects non-`driver` roles to dashboard — admins **cannot** use `/driver/shift` today.
- Component **could render in dashboard** from a dependency standpoint, but would incorrectly use the **admin’s** `accounts.id` as `driver_id` unless props/auth logic change.

### Gap or risk

Rendering `ShiftTimeForm` unchanged in Fahrerschichtplanung would write shifts for the **admin**, not the selected driver, and would still fail RLS on insert.

### Recommendation

Extract a **presentational** `ShiftEntryForm` (fields, validation, paid-time display) accepting `driverId`, `companyId`, `defaultDate`, and `onSubmit` callback. Keep driver route as thin wrapper that resolves auth and calls server action. Estimated effort: **medium** (see §7).

---

## 3. RLS — CURRENT STATE ON `shifts` AND `shift_events`

**Source:** [`supabase/migrations/20260319100000_add_shifts_shift_events_rls.sql`](supabase/migrations/20260319100000_add_shifts_shift_events_rls.sql). Grep of `supabase/migrations/*.sql` for `CREATE POLICY` / `ALTER POLICY` on `shifts` or `shift_events` found **only this file** (plus unrelated `shift_reconciliations` policies in `20260428120000_shift_reconciliations.sql`).

### Current state

**a. Policies on `public.shifts`**

| Name | FOR | USING | WITH CHECK |
| --- | --- | --- | --- |
| `shifts_select_own` | SELECT | `driver_id = auth.uid()` | — |
| `shifts_insert_own` | INSERT | — | `driver_id = auth.uid()` |
| `shifts_update_own` | UPDATE | `driver_id = auth.uid()` | `driver_id = auth.uid()` |
| `shifts_delete_own` | DELETE | `driver_id = auth.uid()` | — |
| `shifts_select_company_admin` | SELECT | `current_user_is_admin() AND company_id = current_user_company_id()` | — |

Lines **11–37**.

**b. Policies on `public.shift_events`**

| Name | FOR | USING | WITH CHECK |
| --- | --- | --- | --- |
| `shift_events_select_own` | SELECT | `EXISTS (SELECT 1 FROM shifts s WHERE s.id = shift_events.shift_id AND s.driver_id = auth.uid())` | — |
| `shift_events_insert_own` | INSERT | — | same EXISTS with `driver_id = auth.uid()` |
| `shift_events_delete_own` | DELETE | same EXISTS | — |
| `shift_events_select_company_admin` | SELECT | `current_user_is_admin() AND EXISTS (… s.company_id = current_user_company_id())` | — |

Lines **45–84**. **No UPDATE policy** on `shift_events` for any role.

**c. Postgres helper functions**

| Function | Definition |
| --- | --- |
| `current_user_company_id()` | [`20260409180000_fix_rls_helper_recursion.sql`](supabase/migrations/20260409180000_fix_rls_helper_recursion.sql) **16–25** — `SELECT company_id FROM accounts WHERE id = auth.uid()` |
| `current_user_is_admin()` | Same file **27–36** — `SELECT role = 'admin' FROM accounts WHERE id = auth.uid()` |

Both are `SECURITY DEFINER`, `SET row_security = off`.

**d. Same helpers on `driver_day_plans`?**

Yes. Policy `admin_all_own_company` uses **identical** helpers — [`20260524120000_add_driver_day_plans.sql`](supabase/migrations/20260524120000_add_driver_day_plans.sql) **50–61**:

```sql
USING (company_id = public.current_user_company_id() AND public.current_user_is_admin())
WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_is_admin())
```

No separate admin-check functions for planning vs shifts.

**e. Gap — blocked admin operations today**

| Table | Admin allowed | Admin blocked |
| --- | --- | --- |
| `shifts` | SELECT | INSERT, UPDATE, DELETE |
| `shift_events` | SELECT | INSERT, DELETE (and UPDATE for everyone) |

Admin manual entry (`createManualShift` + overwrite `deleteShift`) requires **INSERT** on `shifts`, **INSERT** on `shift_events`, and **DELETE** on both for overwrite — **all blocked** under current policies.

Docs acknowledge this: [`docs/driver-planning.md`](docs/driver-planning.md) **115** — “Admin shift actuals + RLS (Phase 4)”.

### Gap or risk

Any dashboard UI wired to client `shiftsService` will fail at PostgREST with RLS errors until new policies (or service role — not used in app today) are added.

### Recommendation

Add admin policies parallel to `driver_day_plans`: `FOR ALL` or separate INSERT/UPDATE/DELETE on `shifts` and INSERT/DELETE on `shift_events` with `company_id = current_user_company_id() AND current_user_is_admin()`, ensuring `WITH CHECK` on insert sets `driver_id` to a driver in the same company (validate in app + optional FK subquery in policy). Match Phase 4 in driver-planning roadmap.

---

## 4. DUPLICATE / CONFLICT HANDLING

### Current state

**a. Unique constraint on `shifts`**

**Not present** in tracked migrations. Grep for `UNIQUE` + `driver_id` on `shifts` returned no matches. Closest related constraint: `shift_reconciliations` `UNIQUE (company_id, driver_id, date)` — [`20260428120000_shift_reconciliations.sql`](supabase/migrations/20260428120000_shift_reconciliations.sql) **20**. `driver_day_plans` has `UNIQUE (company_id, driver_id, plan_date)` — [`20260524120000_add_driver_day_plans.sql`](supabase/migrations/20260524120000_add_driver_day_plans.sql) **21–22**.

[`docs/plans/schichtzettel-shifts-audit.md`](docs/plans/schichtzettel-shifts-audit.md) **54** confirms no DB unique on `(driver_id, date)`.

**b. Driver form behaviour on duplicate date**

[`shift-time-form.tsx`](src/features/driver-portal/components/shift-time-form.tsx):

1. On submit, `getShiftForDriverByDate` (**262–265**).
2. If row exists → `AlertDialog` “Schicht überschreiben?” (**514–537**), no silent overwrite.
3. On confirm → `deleteShift(existingShiftId)` then `createManualShift` (**220–221**, **276–278**).
4. If insert fails otherwise → caught, `toast.error` (**244–249**).

**c. Admin enters shift when driver already has one for that date**

**No codebase answer** for admin-specific conflict rules. Driver flow **overwrites** after explicit confirm. Admin-on-behalf could inherit the same UX, block entry, merge times, or require driver approval — none documented.

### Gap or risk

Without DB uniqueness, concurrent driver + admin submits could create **two** shift rows for the same calendar day. UTC vs Berlin bounds in `getShiftForDriverByDate` can miss or double-match edge cases.

### Recommendation

**PRODUCT DECISION REQUIRED:** Admin duplicate policy (overwrite / reject / side-by-side / flag for reconciliation). Technically: align duplicate detection with `getZonedDayBoundsIso` + consider partial unique index on `(driver_id, business_date)` once product rule is fixed.

---

## 5. ADMIN CONTEXT ON THE PLANNING PAGE

### Current state

**a. Auth context when admin clicks a roster cell**

[`day-plan-edit-popover.tsx`](src/features/driver-planning/components/day-plan-edit-popover.tsx) receives **`driverId`** and **`planDate`** from the grid (**29–30**, **73–74**, passed to `DayPlanEditForm` **95–99**).

[`upsertDayPlan`](src/features/driver-planning/api/driver-planning.service.ts) **224–247**:

- `requireAdminContext()` → `userId` (admin) + `companyId`.
- Writes `driver_id: payload.driverId`, `created_by: userId`.

Server actions in [`actions.ts`](src/features/driver-planning/actions.ts) **40–44** delegate to `upsertDayPlan` — same pattern available for a future shift action with `{ driverId, date, … }`.

**Yes:** a server action can safely access **admin `userId`** and **target `driverId`** without trusting client for company scope (company comes from admin account).

**b. `requireAdminContext()` return shape**

[`driver-planning.service.ts`](src/features/driver-planning/api/driver-planning.service.ts) **24–28**, **52**:

```typescript
type AdminContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  companyId: string;
  userId: string;
};
```

Returns **`companyId`** and **`userId`**; throws if not admin or missing company (**45–50**).

**c. Existing dashboard server action for writing shifts**

**None.** [`actions.ts`](src/features/driver-planning/actions.ts) exports only planning reads/writes (`getPlanningDriversAction`, `getCompanyWeekPlanAction`, `upsertDayPlanAction`, `deleteDayPlanAction`). No TODO/stub for shifts.

Related: [`shift-reconciliations.service.ts`](src/features/shift-reconciliations/api/shift-reconciliations.service.ts) **`confirmShift`** (**224–258**) **reads** `shifts` to set `shift_id` on `shift_reconciliations` but does **not** insert shifts.

### Gap or risk

Planning page has correct **identity plumbing** for plans but zero shift write boundary.

### Recommendation

Add `createManualShiftAction` / `deleteShiftForDriverDateAction` in a new or extended server module using `requireAdminContext()`, mirroring `upsertDayPlanAction` thin-delegate style. Pass `driverId` + `planDate` from popover context.

---

## 6. EXISTING SHIFT READ ON THE PLANNING PAGE

### Current state

**a. `getActualShiftDatesForWeek` still present and unused in UI?**

**Present:** [`driver-planning.service.ts`](src/features/driver-planning/api/driver-planning.service.ts) **174–201**.

**Unused in `src/` UI:** grep shows references only in service, plan docs, and audit docs — **not** imported by `driver-roster-grid`, `roster-plan-cell`, or filters.

**b. Return type**

```typescript
export async function getActualShiftDatesForWeek(
  driverId: string,
  weekStartYmd: string
): Promise<string[]>
```

Distinct **YYYY-MM-DD** strings (Berlin) for days with at least one **`status = 'ended'`** shift in the week (**188–200**).

**c. Break data?**

**No.** Select is `'started_at'` only (**185**). No join to `shift_events`.

**d. Sufficient for admin read-overlay?**

**Partially.** Enough for a **dot / badge** (“Ist erfasst”) per cell per driver-week. **Insufficient** for time comparison (start/end/break vs plan), tooltips, or edit pre-fill — would need extension e.g. `started_at`, `ended_at`, aggregated break minutes, or batch query for all drivers in roster.

[`docs/driver-planning.md`](docs/driver-planning.md) **116** lists “**Ist** overlay for all drivers” as deferred.

### Gap or risk

Phase 2 roster shows **plan only**; actuals invisible despite existing read helper (single-driver, dates-only).

### Recommendation

Phase 4 overlay: add `getCompanyActualShiftsForWeek(weekStartYmd)` returning `Map<driverId, Map<ymd, { startedAt, endedAt, breakMinutes? }>>` using Berlin bounds (same as **180–181**). Keep `getActualShiftDatesForWeek` or fold into batch API.

---

## 7. SHARED COMPONENT FEASIBILITY

### Current state

**a. Shared shift form for admin + driver?**

**No.** `ShiftTimeForm` is only referenced from [`driver-shift-page-content.tsx`](src/features/driver-portal/components/driver-shift-page-content.tsx) **17–18** and driver route. No dashboard imports.

**b. Estimated diff to extract driver-agnostic form**

| Layer | Effort |
| --- | --- |
| Presentational form (fields, zod, paid time, breaks UI) | **Small** — mostly move as-is |
| Auth + `shiftsService` client calls + overwrite dialog | **Medium** — replace with props + server actions |
| RLS + server write module | **Medium** (separate from form; prerequisite) |
| Roster integration (popover/tab) | **Medium** |

Overall: **medium** refactor, not a one-prop swap (RLS and server boundary dominate).

**c. Other dashboard pages writing shift data today**

Grep of `src/`: all `createManualShift`, `deleteShift`, `startShift`, `endShift` usage is under **`src/features/driver-portal/`** only.

Dashboard [`shift-reconciliations`](src/app/dashboard/shift-reconciliations/page.tsx) uses reconciliation service (writes **`shift_reconciliations`**, reads **`shifts`**). **No dashboard page INSERT/UPDATE/DELETE on `shifts`.**

### Gap or risk

Reusing driver UI without server/RLS work gives a false sense of progress; admin would see form but saves would fail.

### Recommendation

1. Migration: admin RLS on `shifts` / `shift_events`.
2. Server module: `admin-shifts.service.ts` (or extend planning service) with `createManualShiftForDriver`, duplicate check, delete-for-overwrite.
3. Extract `ShiftEntryForm` + thin wrappers (`ShiftTimeForm` for driver, `AdminShiftEntryPopover` for planning).
4. Wire Ist overlay read before or in parallel with write UX.

---

## Summary table

| Blocker | Severity | Notes |
| --- | --- | --- |
| RLS: admin INSERT/DELETE on shifts + shift_events | **Blocking** | §3 |
| Client-only `shiftsService` | **Blocking** | Needs server actions |
| `ShiftTimeForm` auth hardwired to session user | **Blocking** | §2 |
| Duplicate / overwrite policy for admin vs driver | **Product** | §4 |
| No `created_by` on shifts | **Product / audit** | §1 |
| `getActualShiftDatesForWeek` unused; no times/breaks | **Read gap** | §6 |
| UTC duplicate check in driver form | **Risk** | §1, §4 |

---

## PRODUCT DECISION REQUIRED (explicit)

1. When admin enters a shift for a date where the **driver already submitted** one: overwrite (driver UX), reject, or merge?
2. Should admin-entered shifts record **who entered** them (new column vs infer from logs only)?
3. Should admin entry be allowed when driver has an **active** (non-ended) real-time shift for that day?
4. Should duplicate enforcement move to **DB constraint** or stay application-level only?

---

## Doc cross-references

- Driver portal shift lifecycle: [`docs/driver-portal.md`](docs/driver-portal.md) **99–120**
- Planning deferred Phase 4 admin actuals: [`docs/driver-planning.md`](docs/driver-planning.md) **115–116**
- Shifts table deep-dive: [`docs/plans/schichtzettel-shifts-audit.md`](docs/plans/schichtzettel-shifts-audit.md)
- Prior planning audit (overlay note): [`docs/plans/fahrerschichtplanung-audit.md`](docs/plans/fahrerschichtplanung-audit.md) **327**
