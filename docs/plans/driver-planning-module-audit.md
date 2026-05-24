# Driver Planning Module — Read-Only Audit

## Phase 1 status: implemented (2026-05-24)

| Step | Outcome |
| --- | --- |
| Migration `20260524120000_add_driver_day_plans.sql` | `driver_day_plans` table, status CHECK, UNIQUE, index, admin-only RLS; `updated_at` app-maintained (no trigger) |
| Types + `database.types.ts` | `PLAN_STATUSES`, `DriverDayPlan`, manual `driver_day_plans` block |
| `driver-planning.service.ts` | `getPlanningDrivers`, `getDriverWeekPlan`, `getActualShiftDatesForWeek`, `upsertDayPlan`, `deleteDayPlan` |
| `actions.ts` | Server actions for reads + writes |
| `use-driver-week-plan.ts` | React Query week fetch + upsert/delete mutations |
| UI components | Filters, week grid, day cell, edit sheet, status badge |
| Route `/dashboard/fahrerschichtplanung` | RSC prefetch + nuqs URL state |
| Nav | Account → Fahrerschichtplanung (`icon: kanban`) |
| Docs | [driver-planning.md](../driver-planning.md), updated [driver-system.md](../driver-system.md) |

**Unchanged:** `/driver/*`, `driver-portal/**`, `shift-reconciliations/**`, existing shift RLS migrations.

---

**Date:** 2026-05-24  
**Mode:** Read-only (no code, schema, or refactors)  
**Scope:** `/driver/shift` and its dependency tree; related Supabase schema/RLS; admin dashboard patterns; feasibility of an admin **driver planning** module distinct from existing **shift actuals** and **Schichtzettel-Abgleich**.

---

## Repository path notes

| Requested path | Actual equivalent in this repo |
| --- | --- |
| `app/driver/shift/page.tsx` | `src/app/driver/shift/page.tsx` |
| `app/driver/shift/layout.tsx` | **Does not exist** — route uses parent `src/app/driver/layout.tsx` only |
| `app/driver/shift/loading.tsx` | **Does not exist** |
| `app/driver/shift/error.tsx` | **Does not exist** |
| `app/admin/**` | **Does not exist** — admin UI lives under `src/app/dashboard/**` |
| `lib/supabase/**` | `src/lib/supabase/**` (5 files) |
| `supabase/functions/**` | **Does not exist** in this repo |

Stack note: AGENTS.md documents **React 19** and **Next.js 16**; the audit user brief mentioned React 18 — implementation should follow the repo’s actual versions.

---

## Files reviewed (driver/shift dependency tree)

### Route shell

| File | Role |
| --- | --- |
| `src/app/driver/shift/page.tsx` | RSC page — title “Schichtenzettel”, renders `DriverShiftPageContent` |
| `src/app/driver/layout.tsx` | Server role guard (`accounts.role === 'driver'`), wraps `DriverLayoutClient` |
| `src/app/driver/driver-layout-client.tsx` | Mobile shell: `DriverHeader` + `DriverTrackingRoot` |

### Feature components (direct + indirect imports from `page.tsx`)

| File | Role |
| --- | --- |
| `src/features/driver-portal/components/driver-shift-page-content.tsx` | Coordinates form + history refresh |
| `src/features/driver-portal/components/shift-time-form.tsx` | Manual Zeiterfassung form (create/overwrite) |
| `src/features/driver-portal/components/shift-history-list.tsx` | Fetches last 60 completed shifts |
| `src/features/driver-portal/components/shift-history-row.tsx` | Read-only expandable row (date, hours, breaks) |
| `src/features/driver-portal/api/shifts.service.ts` | Browser Supabase CRUD for `shifts` / `shift_events` |
| `src/features/driver-portal/types.ts` | `SHIFT_STATUSES`, `SHIFT_EVENT_TYPES`, `BreakReason`, `Shift` type |

### Shared UI / lib touched by the route

| File | Role |
| --- | --- |
| `src/components/ui/alert-dialog.tsx`, `button.tsx`, `card.tsx`, `collapsible.tsx`, `form.tsx`, `input.tsx`, `label.tsx`, `switch.tsx` | shadcn form shell |
| `src/lib/supabase/client.ts` | Browser Supabase client (profile lookup in form/list) |
| `src/lib/utils.ts` | `cn()` |

### Related driver-portal code (same domain, different routes — **not** imported by `/driver/shift`)

| File | Role |
| --- | --- |
| `src/features/driver-portal/components/startseite/shift-status-card.tsx` | Real-time shift start/pause/end on `/driver/startseite` |
| `src/features/driver-portal/components/shift-tracker.tsx` | **Deprecated** tap-to-track UI (reference only) |
| `src/features/driver-portal/components/driver-header.tsx` | Nav link to Schichtenzettel |

### Hooks, server actions, API routes used by `/driver/shift`

| Category | Finding |
| --- | --- |
| **Custom hooks** (`src/hooks/**`) | **None** — components use `useState` / `useEffect` / `react-hook-form` directly |
| **Server actions** | **None** — all writes go through browser `createClient()` → PostgREST |
| **API route handlers** (`src/app/api/**`) | **None** for shifts; cron/recurring-trips unrelated |

### Admin shift-adjacent module (planning context, not driver route)

| File | Role |
| --- | --- |
| `src/app/dashboard/shift-reconciliations/page.tsx` | Admin Schichtzettel-Abgleich (trips + confirm) |
| `src/features/shift-reconciliations/**` | Filters, day list, detail panel, React Query hooks, server actions |
| `src/config/nav-config.ts` | Nav item “Schichtzettel-Abgleich” → `/dashboard/shift-reconciliations` |

### Supabase migrations (shifts / drivers / scheduling-related)

| File | Role |
| --- | --- |
| `supabase/migrations/20260319100000_add_shifts_shift_events_rls.sql` | RLS on `shifts`, `shift_events` |
| `supabase/migrations/20260319110000_fix_shift_events_event_type_check.sql` | `event_type` CHECK |
| `supabase/migrations/20260320000000_fix_shifts_status_check.sql` | `status` CHECK + column comments |
| `supabase/migrations/20260318000000_add_driver_extended_fields.sql` | `driver_profiles` address fields |
| `supabase/migrations/20260318100000_add_users_driver_profiles_rls.sql` | RLS helpers + `users`/`driver_profiles` policies (pre-`accounts` rename) |
| `supabase/migrations/20260318130000_rename_users_to_accounts.sql` | `users` → `accounts` |
| `supabase/migrations/20260428120000_shift_reconciliations.sql` | `shift_reconciliations` table + admin RLS |
| `supabase/migrations/20260502120000_get_shift_day_summaries.sql` | RPC for admin day aggregates (trips, not planning) |

**Missing in repo:** `CREATE TABLE public.shifts` migration — table predates tracked migrations; shape comes from `src/types/database.types.ts` and comments in `20260320000000_fix_shifts_status_check.sql`. See also `docs/plans/schichtzettel-shifts-audit.md`.

### Generated types

| File | Relevant tables |
| --- | --- |
| `src/types/database.types.ts` | `accounts`, `driver_profiles`, `driver_documents`, `vehicles`, `shifts`, `shift_events`, `shift_reconciliations`, `trips`, `trip_assignments`, `rides`, `recurring_rules`, `live_locations` |

### Docs

| File | Relevance |
| --- | --- |
| `docs/access-control.md` | 5-layer RBAC, RLS summary |
| `docs/driver-portal.md` | Route map, shift lifecycle split (Startseite vs Schichtenzettel) |
| `docs/driver-system.md` | Driver roster + shifts overview (**partially stale** — still describes tap tracker at `/driver/shift`) |
| `docs/shift-reconciliations.md` | Admin reconciliation workflow |
| `docs/plans/schichtzettel-shifts-audit.md` | Deep dive on `shifts` as **actuals**, not planning |
| `docs/trips-date-filter.md` / `src/features/trips/lib/trip-business-date.ts` | `Europe/Berlin` business-day bounds |

---

## 1. Current state summary

### What `/driver/shift` does today

The page title is **Schichtenzettel** (`src/app/driver/shift/page.tsx`). It is **not** the live shift tracker; that lives on **`/driver/startseite`** via `ShiftStatusCard` (`docs/driver-portal.md`, `shift-status-card.tsx` header comment).

`/driver/shift` provides:

1. **Manual time entry** — collapsible “Zeiterfassung” form (`ShiftTimeForm`).
2. **Read-only history** — last 60 completed shifts with expandable start/break/end details (`ShiftHistoryList` + `ShiftHistoryRow`).

There is **no edit** of historical rows, **no delete** from history UI, **no notes field**, **no location fields**, and **no vehicle picker** on this page.

### Fields the driver can create, edit, or submit

| Field | UI | Persisted | Notes |
| --- | --- | --- | --- |
| **Date** (`date`) | `<Input type="date">` | `shifts.started_at` / `ended_at` (via date + time concat) | Default today — `shift-time-form.tsx` `getTodayDate()` |
| **Start time** | `<Input type="time">` | `shifts.started_at` + `shift_events` (`shift_start`) | Default `08:00` |
| **End time** | `<Input type="time">` | `shifts.ended_at` + `shift_events` (`shift_end`) | Default `17:00` |
| **Breaks** (optional, multiple) | Switch + time pairs | `shift_events` (`break_start` / `break_end`); metadata `{ reason: 'Mittagspause' }` on manual breaks | No per-break reason UI on Schichtenzettel form |
| **Overwrite existing day** | Alert dialog | Deletes prior shift + events, then inserts | `getShiftForDriverByDate` + `deleteShift` |

**Not exposed on `/driver/shift` but supported in service layer:**

- `vehicle_id` — optional param on `createManualShift` / `startShift` (`shifts.service.ts` **171**, **245**) — used by deprecated `ShiftTracker` / Startseite paths, **not** `ShiftTimeForm`.
- GPS `lat`/`lng` on events — real-time path only (`startShift`, `startBreak`, etc.).
- Odometer — columns exist on `shifts` (`start_odometer`, `end_odometer`) but **not** used by Schichtenzettel form.

**Edit model:** drivers can **replace** a day’s shift via overwrite confirm; they cannot patch individual fields on existing history rows from the UI.

### What is stored in the database

**`public.shifts`** (`database.types.ts` **1218–1283**, comments in `20260320000000_fix_shifts_status_check.sql`):

| Column | Used by Schichtenzettel? |
| --- | --- |
| `driver_id`, `company_id` | Yes — from `accounts` lookup |
| `started_at`, `ended_at` | Yes |
| `status` | Always `'ended'` for manual entry (`SHIFT_STATUSES.ENDED`) |
| `vehicle_id` | No (UI) |
| `start_odometer`, `end_odometer`, `total_distance_km`, `total_earnings` | No — NULL in practice |
| `created_at` | Auto |

**`public.shift_events`:** append-only timeline — `shift_start`, optional `break_start`/`break_end` pairs, `shift_end`. Manual flow inserts all events at save time (`shifts.service.ts` **201–234**).

**Documented intent:** “One row per **driver working day**” (`20260320000000_fix_shifts_status_check.sql` **27–32**). **DB does not enforce** unique `(driver_id, business_date)`; app enforces at most one per form date via duplicate check + overwrite.

### Day-based, shift-based, or event-based?

| Layer | Model |
| --- | --- |
| **Product / UI** | **Day-based** — one manual entry per calendar date per driver |
| **`shifts` row** | **Shift-based** — one row = one worked session (real-time or manual) |
| **Timeline detail** | **Event-based** — breaks and boundaries in `shift_events` |

Planning (future) must **not** be confused with this: `shifts` records **actuals** (work performed), not **planned** availability.

### Route model: day vs shift vs event (answer to Q1)

- **Schichtenzettel route:** day-anchored manual **actuals** entry.
- **Startseite:** session-anchored **live** shift state machine (`active` → `on_break` → `ended`).
- **Admin Schichtzettel-Abgleich:** day-anchored **trip reconciliation**, optionally linking to a `shifts` row (`shift_reconciliations.shift_id`).

---

## 2. Reusable assets

### Tables and columns that support driver / fleet concepts (not planning)

| Table | Reusable for planning module? | Details |
| --- | --- | --- |
| **`accounts`** | **Partial** — driver roster | `role`, `company_id`, `is_active`, name fields (`database.types.ts` **1738–1783**). Active driver list pattern: `shift-reconciliations.service.ts` **70–84**. |
| **`driver_profiles`** | **Partial** — profile + default vehicle | `default_vehicle_id`, address, `license_number`, `notes` (**517–575**). No employment/leave fields. |
| **`vehicles`** | **Yes** — assignment target | `name`, `license_plate`, `is_active`, `status` (**1785–1815**). Admin CRUD; drivers have **no** RLS on `vehicles` (`docs/access-control.md` **65**). |
| **`shifts` / `shift_events`** | **Read-only overlay later** — actuals | Full CRUD for driver own rows; admin **SELECT only** (`20260319100000_...sql` **31–37**). **Do not reuse as planning store.** |
| **`shift_reconciliations`** | **Adjacent workflow** — post-factum admin confirm | One row per `(company_id, driver_id, date)` (**20260428120000_...sql** **11–21**). Different purpose from planning. |
| **`trips` / `trip_assignments`** | **Dispatch scheduling** — not HR planning | Trip `scheduled_at`, `driver_id`; assignment table for dispatch. Separate domain. |
| **`recurring_rules`** | **Pattern reference** — recurrence | Client trip recurrence (`rrule_string`, `pickup_time`); not driver availability. |
| **`live_locations`** | **Future touchpoint** — who is on road | Tied to active driver session, not plan. |
| **`driver_documents`** | **Deferred** — compliance attachments | `document_type`, `valid_until`, `file_path` (**472–515**). Could later hold license/medical docs, not leave notes. |
| **`rides`** | **Do not reuse** | FK to `shifts`; **no** `src/**` queries found — legacy/unused in app. |

**No tables found** for: leave, vacation balance, sick leave, availability, driver day plans, or planning status enums (grep across `supabase/migrations/**`, `src/types/database.types.ts`, `docs/**`).

### Indexes and relations worth mirroring

- `shift_reconciliations_driver_id_date_idx` on `(driver_id, date)` — good precedent for `(driver_id, plan_date)` uniqueness.
- Business-day grouping uses `Europe/Berlin`: `get_shift_day_summaries` **25**, `getZonedDayBoundsIso` in `trip-business-date.ts`.
- Company scoping via `company_id` on all tenant tables.

### Permissions model (reusable pattern)

Five layers documented in `docs/access-control.md`:

1. `src/proxy.ts` — role-based redirect (`driver` ↔ `/driver/*`, `admin` ↔ `/dashboard/*`).
2. `src/app/dashboard/layout.tsx` — admin-only render guard.
3. `src/lib/api/require-admin.ts` — API / server service guard.
4. Supabase RLS — company-scoped policies via `current_user_is_admin()` / `current_user_company_id()`.
5. `src/hooks/use-nav.ts` — client nav filtering.

**Safest admin planning approach:** new table(s) with **admin CRUD + company scope** policies; **optional driver SELECT** only if product requires drivers to see their plan (not in scope today). **Do not** widen `shifts` admin policies to INSERT/UPDATE — that would let admins mutate driver-owned actuals and blur audit boundaries.

### UI and component leverage

| Asset | Reuse for admin planning? | Must remain unchanged |
| --- | --- | --- |
| **`ShiftTimeForm`** | **No** — mobile collapsible actuals entry | Entire `/driver/shift` form UX and overwrite flow |
| **`ShiftHistoryList` / `ShiftHistoryRow`** | **Display pattern only** — duration formatting, collapsible rows | Read-only history; no admin coupling |
| **`ShiftReconciliationFilters`** | **Yes** — driver `<Select>` + `DatePicker` + nuqs URL state | Reconciliation filters behaviour on `/dashboard/shift-reconciliations` |
| **`ShiftDayList`** + `groupByMonth` | **Partial** — single-driver day list with month headers | Reconciliation list + inline expand |
| **`DatePicker`** (`src/components/ui/date-time-picker.tsx`) | **Yes** | Existing date picker API |
| **`PageContainer`** + dashboard layout | **Yes** — admin page shell | — |
| **`getDrivers()` pattern** | **Yes** — active drivers in company | Shift reconciliation driver query |
| **`driver-management` roster** | **Yes** — richer driver metadata, `default_vehicle_id` | User management flows |
| **TanStack Query + server actions** | **Yes** — follow `shift-reconciliations` feature folder | Existing reconciliation hooks/actions |
| **Badge / Skeleton / Tooltip** | **Yes** — status chips in grid | — |

**Shared extraction candidates (future, not now):**

- `displayDriverName()` — duplicated in shift-reconciliations and driver-management.
- Business-day helpers — already centralized in `trip-business-date.ts`; **must** be used for planning date keys (contrast: `getShiftForDriverByDate` uses **UTC** day bounds — `shifts.service.ts` **128–129** — inconsistent with admin reconciliation).

### Closest existing admin UI shapes (for Q5 evaluation)

| UI shape | Exists today? | Fit for planning phase 1 |
| --- | --- | --- |
| **(a) Day-based status per driver** | **No** dedicated UI | **Best phase 1** — smallest schema, matches `(driver, date)` patterns already used |
| **(b) Weekly grid, one row per driver** | **No** | Phase 2 — higher UI cost, needs bulk fetch + cell editing |
| **(c) Monthly overview** | **Partial** — `ShiftDayList` month grouping for **trips** | Read-only aggregation; editing at month scale is awkward |
| **(d) Single-driver detail plan** | **Partial** — shift-reconciliations driver + date detail | Good **phase 1 shell** — extend with plan fields beside trip/reconciliation data |

---

## 3. Gaps

### Domain gaps (mapped to audit questions)

| Requirement | Current state |
| --- | --- |
| **Planning states** (working, day off, vacation, sick, half-day vacation, overtime, training, special leave) | **Not represented** anywhere in schema or UI |
| **Planned start/end time** | **Not in schema** (only actual `shifts.started_at` / `ended_at`) |
| **Start/end location** | **Not in schema** for planning; shift events have optional GPS for actuals only |
| **Notes** | `driver_profiles.notes` (admin profile); `shift_reconciliations.notes` (admin reconciliation); **no** driver-day plan notes |
| **Assigned vehicle (planned)** | `driver_profiles.default_vehicle_id`, `shifts.vehicle_id` (actual); **no planned vehicle per day** |
| **Leave entitlement / vacation balance** | **Missing** |
| **Sick leave attachments / doctor note flag** | **Missing** (`driver_documents` is generic, no leave workflow) |
| **Bulk editing** | **Missing** |
| **Recurring plan entries / templates** | **Missing** (recurring_rules is trip/client scoped) |
| **Admin planning route** | **Missing** — only `/dashboard/shift-reconciliations` touches driver+day |

### Technical gaps

| Gap | Evidence |
| --- | --- |
| **`shifts` is actuals, not plan** | Comments + manual `status='ended'` insert path |
| **Admin cannot write `shifts`** | RLS: admin SELECT only (`20260319100000_...sql`) |
| **No shared “planning” types or service** | — |
| **Timezone inconsistency on driver duplicate-day check** | `getShiftForDriverByDate` uses UTC `T00:00:00.000Z`–`T23:59:59.999Z` vs `getZonedDayBoundsIso` elsewhere |
| **Manual shift time encoding** | `new Date(\`${date}T${time}:00\`).toISOString()` in `createManualShift` — browser-local, not `buildScheduledAt` / Berlin (`shifts.service.ts` **179–184**); differs from trips invariant in AGENTS.md |
| **Stale docs** | `docs/driver-system.md` still describes tap tracker at `/driver/shift`; types path `src/features/drivers/types.ts` does not exist (actual: `driver-portal/types.ts`) |
| **No `/driver/shift` loading/error boundaries** | Only parent layout guards |

### Required planning states — technical representation (Q6)

**No product spec exists in repo** for German HR categories. Recommended direction aligned with existing architecture:

| Approach | Matches codebase? | Reporting |
| --- | --- | --- |
| **Postgres CHECK + TS const object** (like `SHIFT_STATUSES`) | **Best fit** | Simple filters; migration adds values explicitly |
| **Normalized `planning_statuses` reference table** | Good if labels evolve per company | Join for i18n / custom labels later |
| **Free-text status** | **Avoid** | Breaks reporting |

**Suggested initial enum values (proposal — not in repo):** `working`, `day_off`, `vacation`, `sick`, `half_day_vacation`, `overtime`, `training`, `special_leave`.

**Half-day vacation:** store as distinct status **or** `working` + `planned_hours` / `is_half_day` flag — repo has no precedent; **defer detail** until payroll rules are defined.

**Do not** overload `shifts.status` (`active`/`on_break`/`ended`) for leave types — different lifecycle domain.

### Missing domain pieces — now vs later (Q7)

| Field / capability | Needed now (phase 1) | Defer |
| --- | --- | --- |
| Day status per `(company, driver, date)` | **Yes** | — |
| Optional planned start/end time (when status = working) | **Yes** — nullable | — |
| Notes (admin-only) | **Yes** — single text field | Rich text / thread |
| Planned vehicle | **Nice** — FK `vehicles.id` nullable | Auto-assign rules |
| Start/end location | **Defer** | Address autocomplete infra exists for trips, not drivers |
| Leave balance / entitlement | **Defer** | Requires HR rules |
| Doctor note / attachments | **Defer** | Storage + privacy |
| Bulk week edit / copy week | **Defer** | After single-driver week view works |
| Recurring templates | **Defer** | `recurring_rules` pattern exists for trips only |
| Driver read-only view of plan | **Defer** | Optional SELECT policy later |

### Integration touchpoints (Q8 — identification only)

| Module | Likely future connection |
| --- | --- |
| **`/driver/shift` + Startseite shifts** | Compare plan vs actual hours; flag overtime |
| **`/dashboard/shift-reconciliations`** | Show planned status on day list; reconcile only when `working` |
| **Trips / dispatch** | Warn when assigning trips on `vacation`/`sick`; filter available drivers |
| **`/dashboard/fleet` + `live_locations`** | Planned vehicle vs actual vehicle |
| **Driver management** | `is_active`, `default_vehicle_id`, documents |
| **Payroll / PDF exports** | Aggregate planned vs actual days by status |
| **Cron / recurring trips** | No direct link today |

---

## 4. Risks

| Risk | Severity | Detail |
| --- | --- | --- |
| **Conflating `shifts` with planning** | **High** | Admins would need write access to driver actuals; breaks reconciliation audit and driver CRUD ownership |
| **RLS complexity / 42P17 loops** | **High** | Cross-table policies must use SECURITY DEFINER helpers (`docs/access-control.md` rules 1–5). Planning table referencing `accounts`/`vehicles` needs careful policy design |
| **Timezone drift** | **High** | Driver shift duplicate check uses UTC days; trips/reconciliation use `Europe/Berlin`. Planning **must** use `getZonedDayBoundsIso` / `instantToYmdInBusinessTz` consistently |
| **Manual shift time vs Berlin invariant** | **Medium** | Existing `/driver/shift` behaviour must not change when adding shared date libs elsewhere |
| **Weekly grid UI cost** | **Medium** | N drivers × 7 cells × edit states → many queries or one heavy RPC; sticky headers, keyboard nav, mobile unusable on dashboard |
| **Shared component regression** | **Medium** | Extracting form pieces from `ShiftTimeForm` risks Schichtenzettel UX — **keep driver components untouched** |
| **German UX** | **Low** | Existing domain strings are German; planning labels must follow (`Schicht`, `Urlaub`, `Krank`, etc.) |
| **Migration / type drift** | **Medium** | `database.types.ts` already has manual `shift_reconciliations` block with TODO; new tables need regeneration discipline |
| **No leave legal rules in repo** | **Medium** | Enum design may need revision when HR requirements arrive — prefer extensible CHECK or reference table |

**Weekly planner fragility:** dashboard uses dense data tables (TanStack Table) elsewhere, but **no multi-driver calendar grid** exists. Building (b) from scratch without a dedicated virtualized grid component is the main frontend risk.

---

## 5. Recommended phase-1 scope

**Goal:** Smallest safe foundation that does **not** modify `/driver/shift` behaviour or schema of `shifts`.

### In scope

1. **New admin route** (proposed): `/dashboard/driver-planning` (name TBD) under `src/app/dashboard/`, with nav entry in `nav-config.ts`.
2. **New table** (proposed): e.g. `driver_day_plans` with:
   - `company_id`, `driver_id`, `plan_date` (DATE, business calendar)
   - `status` (CHECK enum — see §6)
   - `planned_start_time`, `planned_end_time` (TIME or timestamptz — prefer TIME + `plan_date` for simplicity)
   - `vehicle_id` (nullable FK)
   - `notes` (text, nullable)
   - `created_by`, `updated_at`
   - **UNIQUE** `(company_id, driver_id, plan_date)`
3. **RLS:** admin CRUD company-scoped (mirror `shift_reconciliations` policy shape); **no** driver access in phase 1.
4. **UI shape (d) single-driver detail** extending to **(a) day-based status** for **one week**:
   - Reuse reconciliation-style **driver select** + **week picker** (or prev/next week).
   - Seven day cells: status badge + optional times + notes edit (sheet or inline).
   - Read-only hint when a **`shifts` row** exists for that day (admin SELECT already allowed) — comparison only, no write to `shifts`.
5. **Server-side data access:** `src/features/driver-planning/` with server service + server actions + React Query (match `shift-reconciliations`).

### Explicitly out of phase 1

- Weekly multi-driver grid (b)
- Monthly calendar (c)
- Extending `/driver/shift` UI or `shiftsService`
- Leave balances, attachments, bulk copy, recurring templates
- Auto-blocking trip assignment
- Driver-facing plan visibility

### Why phase 1 = (d) + (a), not (b)

- Matches existing **driver + date** mental model (`shift-reconciliations`, `shift_reconciliations.date`).
- One UNIQUE row per day keeps reporting SQL trivial.
- Avoids expensive grid until status enum and RLS are proven.
- (b) can be a **read-only projection** of the same table in phase 2 without schema change.

---

## 6. Proposed data model direction

```text
companies
  └── accounts (role = driver)
        └── driver_day_plans [NEW]
              plan_date DATE
              status TEXT CHECK (...)
              planned_start_time TIME NULL
              planned_end_time TIME NULL
              vehicle_id → vehicles NULL
              notes TEXT NULL
              UNIQUE (company_id, driver_id, plan_date)

  └── shifts [EXISTING — actuals, driver-owned CRUD]
        └── shift_events

  └── shift_reconciliations [EXISTING — admin trip confirm per day]
```

**Reuse as-is:** `accounts`, `vehicles`, `driver_profiles.default_vehicle_id` (default suggestion in UI only).

**Reuse read-only:** `shifts` / `shift_events` for actual hours overlay.

**Do not reuse for planning storage:** `shifts`, `shift_reconciliations`, `trips`, `recurring_rules`, `rides`.

**Status storage recommendation:** Postgres `CHECK` constraint + exported TS const (same pattern as `SHIFT_STATUSES` in `src/features/driver-portal/types.ts` **22–27**). Migrate new values with explicit ALTER when HR adds categories.

**Time fields:** store local **TIME** + **`plan_date`**; convert to timestamptz only for display/export using `buildScheduledAt` / business TZ when needed — **do not** copy `createManualShift`’s `new Date(...).toISOString()` pattern for new code.

---

## 7. Proposed route / component strategy

```text
src/app/dashboard/driver-planning/page.tsx          (RSC — prefetch drivers + week)
src/features/driver-planning/
  api/driver-planning.service.ts                    (requireAdminContext pattern)
  actions.ts                                        ('use server' delegates)
  hooks/use-driver-week-plan.ts                     (React Query)
  components/
    driver-planning-filters.tsx                     (adapt from shift-reconciliation-filters)
    driver-week-plan-grid.tsx                       (7 columns, one driver)
    day-plan-cell.tsx                               (status badge + edit dialog)
    plan-status-badge.tsx                           (shared status colors)
  types.ts                                          (PLAN_STATUSES const + row type)
```

**Driver route — no changes:**

| Route | Strategy |
| --- | --- |
| `/driver/shift` | **Frozen** — keep `ShiftTimeForm`, overwrite dialog, history list exactly as today |
| `/driver/startseite` | **Frozen** — `ShiftStatusCard` remains live actuals control |

**Shared primitives (underneath, optional phase 1.5):**

- `src/features/scheduling/lib/plan-status.ts` — enum + German labels
- `src/features/scheduling/lib/plan-date.ts` — wrap `getZonedDayBoundsIso` for plan dates only

Do **not** merge `ShiftTimeForm` into shared components until a second consumer exists; duplication is safer than regression.

---

## 8. Deferred items

| Item | Reason to defer |
| --- | --- |
| Multi-driver weekly grid | UI complexity; needs virtualisation |
| Monthly overview | Derived view; not needed to validate schema |
| Driver portal plan visibility | Requires driver RLS + UX spec |
| Leave entitlement balances | No HR rules in repo |
| Sick note uploads | `driver_documents` integration + storage policies |
| Bulk edit / week copy | Depends on stable single-driver editor |
| Recurring plan templates | Separate from trip `recurring_rules` |
| Trip dispatch guardrails | Integration phase |
| Payroll PDF / export | Reporting phase |
| Overtime auto-calculation | Needs plan vs actual rules |
| Start/end location on plan | Address UX scope |
| Extending `shifts` admin write | Breaks actuals / audit model |
| `supabase/functions` edge jobs | Folder does not exist; use cron/API if needed later |

---

## Appendix A — Answers cross-reference (audit questions 1–10)

| # | Question | Section |
| --- | --- | --- |
| 1 | Current `/driver/shift` capability | §1 |
| 2 | Data model and reuse | §2, §6 |
| 3 | Permissions and RLS | §2 (Permissions), §4, §5 |
| 4 | UI leverage | §2 (UI) |
| 5 | Scheduling module feasibility | §2 (UI shapes), §5 |
| 6 | Required planning states | §3 (Q6) |
| 7 | Missing domain pieces | §3 (Q7) |
| 8 | Integration touchpoints | §3 (Q8) |
| 9 | Technical risks | §4 |
| 10 | Recommended path | §5, §7, §8 |

---

## Appendix B — RLS implications summary (Q3)

| Table | Driver | Admin today | Planning module need |
| --- | --- | --- | --- |
| `shifts` | CRUD own | SELECT company | **Keep** — read-only overlay |
| `shift_events` | SELECT/INSERT/DELETE own | SELECT company | **Keep** |
| `shift_reconciliations` | none | ALL company | **Keep separate** from plan |
| `vehicles` | none | CRUD company | SELECT for plan FK picker |
| `accounts` | SELECT/UPDATE own | SELECT/UPDATE company | SELECT drivers |
| **`driver_day_plans` [new]** | none (phase 1) | ALL company | New policies; no cross-table subquery to `trips` |

**Do not** add admin UPDATE on `shifts` for planning — use a dedicated table.

---

## Appendix C — Protecting existing `/driver/shift` behaviour

The following must remain **functionally and visually unchanged** when planning work proceeds:

1. **`ShiftTimeForm`** — collapsible card, fields (date, start, end, breaks), live “Bezahlte Zeit”, overwrite dialog (`shift-time-form.tsx`).
2. **`ShiftHistoryList`** — 60-row limit, read-only, refresh on save (`shift-history-list.tsx` **28**, **64–67**).
3. **`shiftsService.createManualShift` / `deleteShift` / `getShiftForDriverByDate`** — driver client write path (`shifts.service.ts`).
4. **RLS driver ownership** on `shifts` / `shift_events` (`20260319100000_add_shifts_shift_events_rls.sql`).
5. **Proxy default** for drivers → `/driver/shift` after sign-in (`src/proxy.ts` **72–73**, **84–85**).

Any shared date utility adoption must **not** alter stored timestamps for existing manual shifts without an explicit migration project.

---

*End of audit.*
