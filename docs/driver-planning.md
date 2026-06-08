# Fahrerschichtplanung (Driver Planning)

Admin module for scheduling driver days per calendar week. Separate from **shift actuals** (`shifts` / Schichtenzettel) and **Schichtzettel-Abgleich** (trip reconciliation).

## Route

| Route | Role | Purpose |
| --- | --- | --- |
| `/dashboard/fahrerschichtplanung` | `admin` | **Dienstplan roster:** all active drivers as rows, seven day columns for the selected week |

Nav: **Account → Fahrerschichtplanung** (`icon: kanban` in [`nav-config.ts`](../src/config/nav-config.ts)).

URL state (nuqs):

- `?week=<YYYY-MM-DD>` — Monday of the selected ISO week (Europe/Berlin)
- `?driver=<uuid>` — optional; filters roster to one driver row (client-side; omit or clear for all drivers)

## Phase 3A (shipped)

| Change | Detail |
| --- | --- |
| Popover fix | `DayPlanEditPopover` guards `onInteractOutside` / `onPointerDownOutside` when the target is inside portaled Select dropdowns — without this, Status/Fahrzeug clicks dismiss the popover before selection commits |
| Driver filter | Restored `?driver=`; `DriverRosterGrid` filters rows client-side from the RSC driver list (no extra query) |
| Quick-create | Toolbar **Planung hinzufügen** (+) opens `DayPlanCreateDialog` — Dialog shell with Fahrer + Datum pickers, then shared `DayPlanEditForm` |

**Create dialog gating:** Datum pre-fills today; `DayPlanEditForm` mounts only after a Fahrer is selected.

**Not in 3A:** auto week navigation after create-dialog save (follow-up once stable); planned break field; multi-day bulk.

## Phase 4 (shipped) — Admin shift entry (payroll actuals)

Admins can create, overwrite, and delete **shift actuals** (`shifts` + `shift_events`) on behalf of any driver. This is the payroll source of truth for Ist-Zeiten entered from the dashboard.

| Change | Detail |
| --- | --- |
| Migration | [`20260608130000_admin_shift_entry.sql`](../supabase/migrations/20260608130000_admin_shift_entry.sql) — `entered_by`, unique index, admin RLS |
| Server writes | [`admin-shifts.service.ts`](../src/features/driver-planning/api/admin-shifts.service.ts) — `requireAdminContext()`, `buildScheduledAt`, `getZonedDayBoundsIso` |
| Shared form | [`ShiftEntryForm`](../src/features/driver-portal/components/shift-entry-form.tsx) extracted; driver [`ShiftTimeForm`](../src/features/driver-portal/components/shift-time-form.tsx) unchanged in behaviour |
| Cell entry | Popover **Ist-Zeit** tab → `AdminShiftEntryForm` |
| Backfill | Toolbar **Schicht erfassen** → `AdminShiftEntrySheet` (any driver + date) |

### Product decisions (Phase 4)

| ID | Rule |
| --- | --- |
| D1 | Admin-entered shifts set `shifts.entered_by` to admin account id; driver self-entry leaves `NULL` |
| D2 | Admin blocked when existing shift has `status !== SHIFT_STATUSES.ENDED` (`active` / `on_break`) — `ACTIVE_SHIFT_BLOCKED` |
| D3 | Admin authoritative — ended shifts overwritten after inline notice (no blocking AlertDialog) |
| D4 | One shift per driver per Berlin calendar date — DB unique index `shifts_driver_berlin_date_unique` |

### Schema: `shifts.entered_by`

| Column | Type | Notes |
| --- | --- | --- |
| `entered_by` | uuid nullable | FK → `accounts`. Admin id when entered on behalf; `NULL` = driver app entry |

### Unique index

```sql
shifts_driver_berlin_date_unique ON (driver_id, (started_at AT TIME ZONE 'Europe/Berlin')::date)
```

Service layer uses `getZonedDayBoundsIso` + `buildScheduledAt` so app duplicate detection matches the index.

### RLS added (shifts / shift_events)

| Policy | Table | Operation |
| --- | --- | --- |
| `shifts_insert_company_admin` | `shifts` | INSERT |
| `shifts_update_company_admin` | `shifts` | UPDATE |
| `shifts_delete_company_admin` | `shifts` | DELETE |
| `shift_events_insert_company_admin` | `shift_events` | INSERT |
| `shift_events_delete_company_admin` | `shift_events` | DELETE |

Uses `current_user_is_admin()` + `current_user_company_id()` (same helpers as `driver_day_plans`). Driver policies unchanged.

### Server actions

[`actions.ts`](../src/features/driver-planning/actions.ts): `getAdminShiftForDriverDateAction`, `createAdminShiftAction`, `deleteAdminShiftAction`. Never accept `companyId` from client.

**Not in 4:** Ist overlay on roster grid (Phase 4B); `calcWeekHours` net-of-break; `shift_reconciliations` integration; `/driver/shift` changes.


### Table: `public.driver_day_plans`

Migration: [`supabase/migrations/20260524120000_add_driver_day_plans.sql`](../supabase/migrations/20260524120000_add_driver_day_plans.sql)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `company_id` | uuid | FK → `companies` |
| `driver_id` | uuid | FK → `accounts` |
| `plan_date` | date | Berlin calendar date (YYYY-MM-DD) |
| `status` | text | CHECK — see enum below |
| `planned_start` | time | Nullable; shown for working-type statuses |
| `planned_end` | time | Nullable |
| `vehicle_id` | uuid | Nullable FK → `vehicles` |
| `notes` | text | Nullable, max 500 chars in UI |
| `created_by` | uuid | Admin who created/last upserted |
| `created_at` | timestamptz | Default `now()` |
| `updated_at` | timestamptz | App-maintained on upsert (no DB trigger) |

**UNIQUE** `(company_id, driver_id, plan_date)` — at most one plan row per driver per day.

### Status enum (`PLAN_STATUSES`)

Defined in [`src/features/driver-planning/types.ts`](../src/features/driver-planning/types.ts):

| Key | German label |
| --- | --- |
| `working` | Arbeitstag |
| `day_off` | Frei |
| `vacation` | Urlaub |
| `sick` | Krank |
| `half_day_vacation` | Halber Urlaub |
| `overtime` | Überstunden |
| `training` | Fortbildung |
| `special_leave` | Sonderurlaub |

Phase 1 uses a Postgres `CHECK` + TS const (not a reference table).

## RLS

- **Admins:** full CRUD on rows where `company_id = current_user_company_id()` and `current_user_is_admin()`.
- **Drivers:** no access in phase 1.

Policy name: `admin_all_own_company` on `driver_day_plans`.

## Feature structure

```
src/features/driver-planning/
├── api/
│   ├── driver-planning.service.ts   # Plans: getCompanyWeekPlan, upsert, delete
│   └── admin-shifts.service.ts      # Shift actuals: create, read, delete (admin)
├── actions.ts                       # 'use server' thin delegates (plans + shifts)
├── hooks/use-driver-week-plan.ts    # useCompanyWeekPlan + mutations
├── lib/
│   ├── week-dates.ts                # Monday snap, week bounds (Berlin TZ)
│   ├── plan-hours.ts                # TIME duration math (no Date objects)
│   └── planning-url-params.ts       # nuqs keys + filter sentinels
├── types.ts                         # PLAN_STATUSES, DriverDayPlan, AdminShiftForDate
└── components/
    ├── driver-planning-filters.tsx  # Week nav, driver filter, plan + shift entry
    ├── driver-roster-grid.tsx       # Sticky table roster
    ├── roster-plan-cell.tsx         # Compact color-coded cell
    ├── day-plan-edit-form.tsx       # Shared plan edit fields
    ├── day-plan-edit-popover.tsx    # Popover: Dienstplan + Ist-Zeit tabs
    ├── day-plan-create-dialog.tsx   # Toolbar plan create (Dialog)
    ├── admin-shift-entry-form.tsx   # Admin wrapper → ShiftEntryForm
    ├── admin-shift-entry-sheet.tsx  # Toolbar backfill Sheet
    └── plan-status-badge.tsx        # STATUS_VARIANT (exported for cells)
```

**Removed in phase 2:** `driver-week-grid.tsx`, `day-plan-cell.tsx`, `day-plan-edit-sheet.tsx`.

## Behaviour

- **Plan writes** go to `driver_day_plans` via `DayPlanEditForm` / server actions.
- **Shift actual writes** (Phase 4) go to `shifts` + `shift_events` via `AdminShiftEntryForm` → server actions only (never browser `shiftsService`).
- **Roster fetch:** `getCompanyWeekPlan(weekStartYmd)` — one query for all company plans in the week; client groups by `driver_id` + `plan_date`.
- **Edit plan:** click cell → popover **Dienstplan** tab **or** toolbar **Planung hinzufügen**.
- **Edit shift actual:** click cell → popover **Ist-Zeit** tab **or** toolbar **Schicht erfassen** (any date backfill).
- **Driver filter:** optional `?driver=` narrows visible rows; **Besetzt** footer still counts all company `working` plans for the week (not filter-scoped).
- **Row totals:** `calcWeekHours` sums `PLAN_STATUSES_WITH_TIMES` rows with both times (German `8,5 h` format).
- **Column footer:** **Besetzt** counts drivers with `status = 'working'` per day.
- **Date math:** all calendar keys use `Europe/Berlin` helpers from [`trip-business-date.ts`](../src/features/trips/lib/trip-business-date.ts) and [`week-dates.ts`](../src/features/driver-planning/lib/week-dates.ts).

## Deferred

- Auto week jump after create-dialog save when plan date is outside visible week
- Planned break field on `driver_day_plans` (Phase 3B)
- Bulk edit / week copy / recurring templates / multi-day selection (Phase 3B)
- **Ist overlay** for all drivers on roster grid (Phase 4B — read display only)
- `calcWeekHours` net-of-break deduction
- `shift_reconciliations` integration with admin shift entry
- Single-driver card view toggle, monthly view
- Driver-facing plan view
- Leave balances, sick-note attachments
- Trip dispatch guardrails
- Payroll export, overtime auto-calculation
- Row virtualization, mobile drawer fallback for popover

## Integration touchpoints (future)

| Module | Connection |
| --- | --- |
| `/driver/shift` + Startseite shifts | Plan vs actual hours |
| `/dashboard/shift-reconciliations` | Day status on reconciliation list |
| Trips / dispatch | Warn when assigning on vacation/sick |
| `/dashboard/fleet` | Planned vs actual vehicle |
| Driver management | `is_active`, `default_vehicle_id` |

See also [`plans/driver-planning-module-audit.md`](plans/driver-planning-module-audit.md), [`plans/driver-planning-phase2-audit.md`](plans/driver-planning-phase2-audit.md), and [`plans/fahrerschichtplanung-audit.md`](plans/fahrerschichtplanung-audit.md).
