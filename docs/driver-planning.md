# Fahrerschichtplanung (Driver Planning)

Admin module for scheduling driver days per calendar week. Separate from **shift actuals** (`shifts` / Schichtenzettel) and **Schichtzettel-Abgleich** (trip reconciliation).

## Route

| Route | Role | Purpose |
| --- | --- | --- |
| `/dashboard/fahrerschichtplanung` | `admin` | **Dienstplan roster:** all active drivers as rows, seven day columns for the selected week |

Nav: **Account → Fahrerschichtplanung** (`icon: kanban` in [`nav-config.ts`](../src/config/nav-config.ts)).

URL state (nuqs):

- `?week=<YYYY-MM-DD>` — Monday of the selected ISO week (Europe/Berlin)

## Data model

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
├── api/driver-planning.service.ts   # getCompanyWeekPlan, upsert, delete
├── actions.ts                       # 'use server' thin delegates
├── hooks/use-driver-week-plan.ts    # useCompanyWeekPlan + mutations
├── lib/
│   ├── week-dates.ts                # Monday snap, week bounds (Berlin TZ)
│   └── plan-hours.ts                # TIME duration math (no Date objects)
├── types.ts                         # PLAN_STATUSES, DriverDayPlan
└── components/
    ├── driver-planning-filters.tsx  # Week navigation only
    ├── driver-roster-grid.tsx       # Sticky table roster
    ├── roster-plan-cell.tsx         # Compact color-coded cell
    ├── day-plan-edit-form.tsx       # Shared edit fields
    ├── day-plan-edit-popover.tsx    # Single popover instance
    └── plan-status-badge.tsx        # STATUS_VARIANT (exported for cells)
```

**Removed in phase 2:** `driver-week-grid.tsx`, `day-plan-cell.tsx`, `day-plan-edit-sheet.tsx`.

## Behaviour

- **Writes** go only to `driver_day_plans` — never `shifts`, `shift_events`, or `shift_reconciliations`.
- **Roster fetch:** `getCompanyWeekPlan(weekStartYmd)` — one query for all company plans in the week; client groups by `driver_id` + `plan_date`.
- **Edit:** click any cell → single shared popover with status, times, vehicle, notes.
- **Row totals:** `calcWeekHours` sums `PLAN_STATUSES_WITH_TIMES` rows with both times (German `8,5 h` format).
- **Column footer:** **Besetzt** counts drivers with `status = 'working'` per day.
- **Date math:** all calendar keys use `Europe/Berlin` helpers from [`trip-business-date.ts`](../src/features/trips/lib/trip-business-date.ts) and [`week-dates.ts`](../src/features/driver-planning/lib/week-dates.ts).

## Deferred

- Bulk edit / week copy / recurring templates
- **Ist** overlay for all drivers (batch actual shifts)
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

See also [`plans/driver-planning-module-audit.md`](plans/driver-planning-module-audit.md) and [`plans/driver-planning-phase2-audit.md`](plans/driver-planning-phase2-audit.md).
