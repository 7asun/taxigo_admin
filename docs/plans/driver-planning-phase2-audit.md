# Driver Planning — Phase 2 Feasibility Audit

## Phase 2 status: implemented (2026-05-24)

| Step | Outcome |
| --- | --- |
| `getCompanyWeekPlan` + action + `useCompanyWeekPlan` | One company-scoped query; query key `['company-week-plan', weekStartYmd]` |
| Mutation invalidation | Upsert/delete invalidate both per-driver and company keys via `snapYmdToWeekStart(planDate)` |
| `lib/plan-hours.ts` | Pure TIME duration helpers; row **Std** totals + German formatting |
| `driver-roster-grid.tsx` | Sticky table: drivers × 7 days, **Besetzt** footer, single popover |
| `roster-plan-cell.tsx` | Imports exported `STATUS_VARIANT`; compact status + times |
| `day-plan-edit-form.tsx` + `day-plan-edit-popover.tsx` | Inline create/edit; delete passes `{ planId, planDate }` |
| Filters + page | Week-only nuqs; removed `?driver=` and Ist overlay prefetch |
| Removed | `driver-week-grid`, `day-plan-cell`, `day-plan-edit-sheet` |

**Unchanged:** schema, RLS, `types.ts`, `week-dates.ts`, driver-portal, shift-reconciliations.

---

**Date:** 2026-05-24  
**Mode:** Read-only (no code, schema, or refactors)  
**Inputs:** Phase 1 implementation under `src/features/driver-planning/`, attached Phase 1 plan, and dashboard UI/data patterns.

---

## 1. Current Phase 1 state

### 1.1 What `/dashboard/fahrerschichtplanung` renders today

The RSC page (`src/app/dashboard/fahrerschichtplanung/page.tsx`) renders:

1. `PageContainer` with title **Fahrerschichtplanung** and description **Wochenplanung pro Fahrer — Status und geplante Zeiten verwalten.** (lines 55–57)
2. `DriverPlanningFilters` (lines 60–64)
3. `DriverWeekGrid` (lines 65–70)

Server-side prefetch (when `driverId` is known):

- `getPlanningDrivers()` → driver list for filters (line 31)
- `getDriverWeekPlan(driverId, weekStartYmd)` → `initialPlans` (lines 46–50)
- `getActualShiftDatesForWeek(driverId, weekStartYmd)` → `actualShiftDates` (lines 46–51)

URL defaults: first driver alphabetically (`drivers[0]?.id`, lines 33–34); week = Monday snap of today or `?week=` param (lines 35–40).

### 1.2 Components, props, and responsibilities

| Component | File | Props | Responsibility |
| --- | --- | --- | --- |
| `DriverPlanningFilters` | `driver-planning-filters.tsx:44–48` | `drivers: PlanningDriverListItem[]`, `defaultDriverId?`, `defaultWeekYmd?` | nuqs `driver` + `week`; driver `<Select>`; week `DatePicker` with Monday snap; prev/next week chevrons; `router.refresh()` on driver/week change (lines 78–79, 89–90, 115–116) |
| `DriverWeekGrid` | `driver-week-grid.tsx:18–23` | `initialPlans?`, `initialDriverId?`, `initialWeekStartYmd?`, `actualShiftDates: string[]` | Reads nuqs `driver`/`week`; fetches week plan via React Query; maps 7 dates → `DayPlanCell`; owns single `DayPlanEditSheet` instance |
| `DayPlanCell` | `day-plan-cell.tsx:36–42` | `plan`, `planDate`, `dayIndex`, `hasActualShift`, `onOpenEdit` | Day label (Mo–So + DD.MM); status badge + time range; **Ist** chip; today highlight; click/`+` opens edit |
| `DayPlanEditSheet` | `day-plan-edit-sheet.tsx:49–57` | `open`, `onOpenChange`, `plan`, `driverId`, `planDate`, `weekStartYmd`, `onSaved` | Right-side Sheet: status select, conditional time inputs, vehicle select (browser Supabase), notes, save/delete |
| `PlanStatusBadge` | `plan-status-badge.tsx:40–43` | `status`, `className?` | Maps `PlanStatus` → shadcn `Badge` variant + German label from `PLAN_STATUSES` |

Supporting modules (not page components but in the data path):

- `types.ts` — `PLAN_STATUSES`, `DriverDayPlan`, `UpsertDayPlanPayload` (lines 11–55)
- `driver-planning.service.ts` — CRUD + read-only shifts overlay
- `actions.ts` — server action delegates (lines 20–41)
- `use-driver-week-plan.ts` — query key `['driver-week-plan', driverId, weekStartYmd]` (lines 14–16)
- `lib/week-dates.ts` — `snapYmdToWeekStart`, `buildWeekPlanDates`, `getWeekEndYmd`

### 1.3 `DriverWeekGrid` structure

**Layout:** Tailwind **CSS grid**, not an HTML `<table>`.

- Loading skeleton: `grid grid-cols-1 gap-3 md:grid-cols-7` (`driver-week-grid.tsx:99–103`)
- Data grid: same classes (`driver-week-grid.tsx:116–129`)
- **Not** flex rows; **not** TanStack Table
- Mobile: 1 column stacked; `md+`: 7 equal columns (one driver, seven days)

When no driver selected: dashed empty state **Bitte einen Fahrer auswählen.** (`driver-week-grid.tsx:84–89`).

### 1.4 Data fetch and time display

**Fetch path:**

1. RSC prefetch: `getDriverWeekPlan` (`page.tsx:46–48`, `driver-planning.service.ts:111–136`)
2. Client: `useDriverWeekPlan` → `getDriverWeekPlanAction` (`use-driver-week-plan.ts:30–36`, `actions.ts:26–31`)

Query is **scoped to one driver** per week (`driver_id` equality + `plan_date` range, `driver-planning.service.ts:126–129`).

**Time display:** `DayPlanCell` calls `formatTimeRange(plan)` (`day-plan-cell.tsx:26–34, 57, 88–91`):

- DB `time` values sliced to `HH:mm` via `.slice(0, 5)` (line 28)
- Both set → `"08:00 – 16:00"` (lines 29–30)
- Start only → `"ab HH:mm"` (line 31)
- End only → `"bis HH:mm"` (line 32)
- No plan / no times → em dash in empty cell (lines 94–96)

Statuses without times (`PLAN_STATUSES_WITH_TIMES` exclusion) show badge only — times cleared on upsert in service (`types.ts:25–30`, `driver-planning.service.ts:171–182`).

**Actual shifts overlay:** RSC passes `actualShiftDates` (ended shifts only, `driver-planning.service.ts:151–157`); grid builds a `Set` (`driver-week-grid.tsx:79–82`); cell shows **Ist** badge (`day-plan-cell.tsx:74–77`). Refreshed via `router.refresh()` when filters change (`driver-planning-filters.tsx:78–79, 89–90, 115–116`) — **not** refetched client-side in the grid.

### 1.5 Edit interaction

**Sheet (side panel), not popover or inline.**

- Cell click or `+` button → `openEdit` → `DayPlanEditSheet` (`driver-week-grid.tsx:92–95, 132–142`)
- shadcn `Sheet` side=`right` (`day-plan-edit-sheet.tsx:164–165`)
- Delete via nested `AlertDialog` (`day-plan-edit-sheet.tsx:283–304`)
- Mutations: `useUpsertDayPlan` / `useDeleteDayPlan` with week-key invalidation (`use-driver-week-plan.ts:39–64`)

### 1.6 Phase 2: replace vs keep vs extend

| Asset | Verdict | Rationale |
| --- | --- | --- |
| `types.ts` (`PLAN_STATUSES`, payloads) | **Keep** | Single source of status strings (plan invariant, `types.ts:4–6`) |
| `plan-status-badge.tsx` | **Keep / extend** | Color coding ready; may need compact variant for roster cells |
| `driver-planning.service.ts` upsert/delete | **Keep** | Conflict key and `updated_at` pattern unchanged (`driver-planning.service.ts:189–227`) |
| `getPlanningDrivers` | **Keep** | Becomes roster row source (`driver-planning.service.ts:90–105`) |
| `getDriverWeekPlan` | **Keep** (optional) | Useful for single-driver drill-down; not sufficient alone for roster |
| `getActualShiftDatesForWeek` | **Extend or defer** | Per-driver; roster needs batch variant or phase 3 overlay |
| `lib/week-dates.ts` | **Keep** | Shared Berlin week math |
| `use-driver-week-plan.ts` mutations | **Extend** | Invalidate roster query key in addition to per-driver key |
| `DriverPlanningFilters` | **Extend** | Remove or demote driver `<Select>`; keep week navigation + nuqs `week` |
| `DriverWeekGrid` | **Replace** | Single-driver 7-column card grid is the wrong topology for N×7 roster |
| `DayPlanCell` | **Replace / fork** | Card layout (`min-h-[120px]`, weekday header per cell) too tall for roster rows; extract compact cell |
| `DayPlanEditSheet` | **Extract form → popover** | Form fields reusable; Sheet shell wrong for inline cell edit (phase 2 spec) |
| `page.tsx` prefetch | **Replace shape** | Prefetch all drivers’ plans for week, not one driver |
| `actions.ts` | **Extend** | Add `getCompanyWeekPlanAction` (name TBD) |

---

## 2. Roster grid feasibility

### 2.1 Existing sticky table / grid patterns

**shadcn `Table` primitives** (`src/components/ui/table.tsx`):

- Thin wrappers around native `<table>`, `<thead>`, `<th>`, `<td>` (lines 7–88)
- **No** built-in sticky first column or sticky header — styling is caller responsibility
- `Table` wraps `<table>` in `relative w-full min-w-0` div (lines 9–15)

**Sticky header example (manual Tailwind):**

- CSV export preview: `TableHeader className='bg-background sticky top-0 z-10'` inside `ScrollArea` (`preview-step.tsx:144–147`)

**Sticky header in draggable data table:**

- `DraggableTableHeader` sets `position: sticky; top: 0; zIndex: 10` when not dragging (`draggable-column.tsx:21–28`)

**Column pinning helper (TanStack Table, not wired in UI):**

- `getCommonPinningStyles` in `src/lib/data-table.ts:10–38` — computes `position: sticky`, `left`/`right` offsets for pinned columns
- Imported in `data-table.tsx:32` but **not applied** to any cell/header in that file (dead import as of this audit)

**CSS grid roster precedent:** Phase 1 `DriverWeekGrid` uses CSS grid for 7 day columns (`driver-week-grid.tsx:116`) — pattern works for **columns** but not yet for **rows × columns** with sticky axes.

**Conclusion:** No production roster with sticky row header + sticky driver column exists. Closest building blocks:

1. shadcn `Table` + `ScrollArea` + manual `sticky top-0` / `sticky left-0` on `<th>`/`<td>`
2. Optional TanStack Table pinning styles from `getCommonPinningStyles` if using `@tanstack/react-table` for column defs only

### 2.2 Does `table.tsx` support required layout?

**Partially.** It provides semantic table markup and consistent cell padding (`table.tsx:65–87`). Sticky layout, scroll container, and z-index stacking must be added by the feature — same approach as `preview-step.tsx:144–147`.

A **raw HTML table inside shadcn `Table`/`TableCell`** (or pure `<table>` with Tailwind) is the straightforward path. The shared `DataTable` component (`data-table.tsx`) targets paginated, server-filtered lists with DnD column reorder — **not** a roster matrix (lines 36–49, 115–193).

### 2.3 TanStack Virtual / TanStack Table

From `package.json`:

- **`@tanstack/react-table`: `^8.21.2`** (line 72) — **installed**
- **`@tanstack/react-virtual`** — **not** a direct dependency in `package.json`
- `react-virtual@2.x` appears only transitively via `kbar` in lockfiles — not a project pattern for dashboard grids

### 2.4 Safest grid implementation for this stack

**Recommended approach (phase 2):**

```
ScrollArea (overflow auto)
  └─ <table> via shadcn Table primitives
       ├─ thead: sticky top-0 z-20 — 7 day headers + optional totals column
       ├─ tbody rows: one per driver
       │    ├─ td sticky left-0 z-10 bg-background — driver name
       │    └─ 7 × RosterPlanCell (compact, color-coded)
       └─ tfoot (optional): column coverage counts
```

**Why this over TanStack Table + DataTable:**

- Fixed topology (1 name column + 7 days + totals); no pagination, sorting, or column DnD needed
- Avoids coupling to `use-data-table.ts` server-side filter/pagination model (`use-data-table.ts:317–319`)
- Sticky CSS on native cells is well-understood; `preview-step.tsx` already proves sticky thead in ScrollArea

**Interactive cells:**

- One **controlled** popover open at a time (`{ driverId, planDate } | null`) — avoids 350 simultaneous Radix popover roots
- Reuse form logic from `day-plan-edit-sheet.tsx:173–250` inside popover content

**Virtualization:** Defer until >~80 drivers. At 50×7 = 350 DOM cells, React 19 + single open popover is acceptable. Add `@tanstack/react-virtual` in phase 3 if needed.

**Color coding:** Reuse `PlanStatusBadge` styling map (`plan-status-badge.tsx:7–37`) applied to cell background/border instead of full badge text in compact cells.

---

## 3. Popover feasibility

### 3.1 `popover.tsx` — standard shadcn / Radix

Yes. `src/components/ui/popover.tsx` wraps `@radix-ui/react-popover` (`popover.tsx:4, 8–11, 20–38`). Exports: `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor` (line 48).

Default content width `w-72`, `z-50`, animated open/close (lines 33–34).

### 3.2 Dashboard popover reference patterns

| File | Pattern | Relevance |
| --- | --- | --- |
| `pricing-rule-delete-button.tsx:49–85` | Popover + confirm buttons | Simple actions; **no** form fields |
| `invoice-builder/step-2-params.tsx:172–255` | Popover + Command multi-select | Complex content in popover; **no** time inputs |
| `pending-assignments-popover.tsx:18–22, 272–281` | Popover (md+) / Drawer (narrow) with lists + assign actions | Large shell; driver select inside list items |
| `data-table-date-filter.tsx:177–217` | Popover + calendar | Date picking only |
| `day-plan-edit-sheet.tsx:164–280` | **Sheet** with status Select + two `type="time"` inputs + save | **Closest form fields** — but not a popover today |

**Inline table editing (no popover):** `driver-select-cell.tsx:31–80` — Select directly in table cell with immediate persist; different UX from plan edit (vehicle/notes/delete).

### 3.3 Popover with select + two times + save

**No exact match** in the codebase. Nearest composition:

1. Form fields from `day-plan-edit-sheet.tsx:174–214` (status Select + time Inputs)
2. Popover shell from `pricing-rule-delete-button.tsx:50–62` or `step-2-params.tsx:172–210`
3. Controlled `open` state + `onOpenChange` to close on save (sheet pattern `day-plan-edit-sheet.tsx:138–139`)

**Radix caveat:** Nested `Select` inside `Popover` requires careful focus/portal handling — project already uses portaled `SelectContent` (`day-plan-edit-sheet.tsx:183–188`), which is the established fix elsewhere.

**Recommendation:** Extract `DayPlanEditForm` from sheet body; mount inside `PopoverContent` with `align="start"`, `className="w-80"`, `z-[100]` (compare `pricing-rule-delete-button.tsx:62`).

---

## 4. Data fetch shape for roster

### 4.1 Single query vs parallel per-driver

**Recommend: one company-scoped query** for phase 2.

| Approach | Pros | Cons |
| --- | --- | --- |
| **`getCompanyWeekPlan(weekStartYmd)`** — one SELECT on `driver_day_plans` WHERE `company_id` AND `plan_date` BETWEEN Mon–Sun | Single round trip; one React Query key; simple invalidation after upsert; matches roster UI | Client groups by `driver_id`; sparse rows (drivers with no plans) merged with `getPlanningDrivers` list |
| **N × `getDriverWeekPlan`** in parallel | Reuses existing function | N admin HTTP/action calls; N query keys; poor cache coherence; unnecessary load at 30–50 drivers |

New service function sketch (conceptual):

```sql
SELECT *, vehicle:vehicles(...)
FROM driver_day_plans
WHERE company_id = $1
  AND plan_date >= $weekStart AND plan_date <= $weekEnd
ORDER BY driver_id, plan_date
```

Client builds `Map<driverId, Map<planDate, DriverDayPlan>>`.

Keep `getDriverWeekPlan` for optional single-driver view or tests.

### 4.2 Current driver list query shape

`getPlanningDrivers()` (`driver-planning.service.ts:90–105`):

- Table: `accounts`
- Select: `id, name, first_name, last_name`
- Filters: `company_id`, `role = 'driver'`, `is_active = true`
- Order: `name`
- Returns: `{ id, full_name }[]` via `displayDriverName` (lines 101–104)

Identical query shape to shift-reconciliations `getDrivers()` (`shift-reconciliations.service.ts:70–84`).

### 4.3 Join vs separate fetch — RLS safety

**Single plans query is RLS-safe** for the same reason per-driver queries are:

- Policy `admin_all_own_company` filters `company_id = current_user_company_id() AND current_user_is_admin()` (`20260524120000_add_driver_day_plans.sql:50–61`)
- No cross-table subqueries in policy (migration comment lines 5–6; `docs/driver-planning.md:59–63`)

A join to `accounts` in PostgREST is optional — driver names already come from `getPlanningDrivers`. Join would not weaken RLS but adds embed complexity; **merge in application layer** is simpler.

**No security benefit** to per-driver fetching; admin already sees all company drivers’ plans by design.

---

## 5. Weekly hours calculation

### 5.1 Existing TIME duration utilities

**None in `driver-planning/`.** Phase 1 displays times as formatted strings only (`day-plan-cell.tsx:26–34`).

**Closest codebase pattern:** driver portal manual shift form — local helpers in `shift-time-form.tsx`:

- `parseTimeToMinutes(time: string): number` — splits `HH:mm`, returns minutes (lines 57–59)
- `formatPaidDuration(start, end, breaks)` — end-before-start adds 24h (`shift-time-form.tsx:64–71`)

These are **private to the component**, not exported from a shared lib.

`trip-time.ts` handles **timestamptz** construction (`buildScheduledAt`), not duration between two Postgres `time` columns.

### 5.2 Safest TypeScript approach (no new dependency)

Add a small pure function in `src/features/driver-planning/lib/plan-hours.ts` (phase 2):

1. Parse `planned_start` / `planned_end` with `.slice(0, 5)` (match `day-plan-cell.tsx:28`)
2. Convert to minutes (same math as `shift-time-form.tsx:57–59`)
3. If `endMin < startMin`, add `24 * 60` (overnight shift, `shift-time-form.tsx:70–71`)
4. Sum only rows where `PLAN_STATUSES_WITH_TIMES.includes(status)` and both times present (`types.ts:25–30`)
5. For `half_day_vacation`, phase 2 can count full computed duration or apply 0.5× — **product rule needed**; document in phase 2 spec

Display: reuse `formatPaidDuration` output style or decimal hours (`7.5 h`) for row totals.

**Do not** use `Date`/`toISOString()` for TIME-only math (violates trip date invariants in `AGENTS.md` trips time system section).

---

## 6. Bulk action feasibility

### 6.1 Existing multi-select / bulk patterns

| Location | Mechanism | Notes |
| --- | --- | --- |
| `trips-tables/columns.tsx:64–80` | Checkbox column; `table.getIsAllPageRowsSelected()` / `row.toggleSelected()` | TanStack Table row selection |
| `hooks/use-data-table.ts:114–115, 295, 304–305` | `rowSelection` state; `enableRowSelection: true` | Shared table hook |
| `trips-pagination-bulk-actions.tsx:28–52` | Bulk delete/duplicate when rows selected | Uses `table.getSelectedRowModel()` |
| `data-table-pagination.tsx:27–28, 44, 104–106` | `bulkActions` slot when `selectedCount > 0` | Pagination bar integration |
| `unassigned-trips/bulk-action-bar.tsx:25–43` | Custom bulk bar; `selectedTrips` record; assign dropdown | Domain-specific, not table-integrated |
| `trips/api/trips.service.ts:100` | `bulkCreateTrips` | API-level bulk, not UI selection |

**Driver planning phase 1:** no checkboxes, no bulk actions.

### 6.2 Assessment

Bulk actions (copy week, multi-driver status set) are a **net-new UI pattern** for this feature. Infrastructure exists in **Fahrten** tables but would require:

- Row/column selection model distinct from trip table pagination
- New mutations (likely multiple `upsertDayPlan` calls or a future RPC)
- Confirmation UX

**Relative complexity:** medium–high vs roster grid itself — grid + popover + totals is the critical path; bulk is orthogonal and fits **phase 3** (`docs/driver-planning.md:93` already lists bulk edit / week copy as deferred).

---

## 7. Risks and constraints

### 7.1 Main risks replacing single-driver view with roster

1. **URL state regression** — `?driver=` is central today (`driver-planning-filters.tsx:56–57`, `page.tsx:34`). Roster may drop driver param or use it only to scroll/highlight; deep links to one driver need a defined behavior.
2. **Prefetch/cache mismatch** — Phase 1 `initialData` only applies when URL matches RSC params (`driver-week-grid.tsx:44–60). Roster needs new query key, e.g. `['company-week-plan', weekStartYmd]`.
3. **Edit UX on small viewports** — Sheet works on mobile; popover may need Drawer fallback (pattern: `pending-assignments-popover.tsx:44, 59–60`).
4. **Popover + Select focus traps** — Radix nesting bugs; mitigated elsewhere but worth QA.
5. **Column totals definition** — “Driver coverage” must define numerator (e.g. count `status = 'working'` vs any planned row vs unique drivers).
6. **Half-day / overtime hour rules** — ambiguous without HR rules (see §5.2).

### 7.2 Shared components — regression surface

Grep shows driver-planning components are **only imported within the feature and the page**:

- `DriverWeekGrid` → `page.tsx:3, 65`
- `DayPlanCell`, `DayPlanEditSheet`, `PlanStatusBadge` → only under `driver-planning/components/`

**No external consumers.** Replacing grid/sheet does not risk Fahrten, shift-reconciliations, or driver-portal.

**Do not modify:** `shift-reconciliations/**`, `driver-portal/**` (phase 1 hard isolation, `docs/driver-planning.md:84–86`).

### 7.3 RLS: one query vs many

**No difference** — same rows visible. Policy is row-level on `company_id` + admin role, not per `driver_id` session variable (`20260524120000_add_driver_day_plans.sql:54–60`).

`getActualShiftDatesForWeek` reads `shifts` with same company filter (`driver-planning.service.ts:151–157`) — batch variant for all drivers is a **read amplification** question, not RLS.

### 7.4 Performance: 50 × 7 interactive cells

- **350 cells** static DOM: fine for modern browsers
- **350 popovers mounted:** avoid — use **one** shared popover anchored to active cell
- **350 React Query subscriptions:** avoid — one roster query
- **Re-render on week change:** memoize rows (`useMemo` on grouped plan map)
- If driver count grows past ~100, add row virtualization (phase 3)

---

## 8. Recommended Phase 2 scope

### 8.1 Smallest phase 2 delivering a–e

| Requirement | Delivery |
| --- | --- |
| **a) Roster grid (all drivers, current week)** | Replace `DriverWeekGrid` with `DriverRosterGrid`; week from nuqs `week` only; rows from `getPlanningDrivers` merged with plans |
| **b) Color-coded status + planned times visible** | Compact `RosterPlanCell` using `STATUS_VARIANT` colors from `plan-status-badge.tsx:7–37` + monospace time line (`day-plan-cell.tsx:26–34` logic) |
| **c) Inline popover create/edit** | Extract form from `DayPlanEditSheet`; `DayPlanEditPopover` with shared save/delete mutations |
| **d) Row weekly hour totals** | New `lib/plan-hours.ts`; footer cell per driver row |
| **e) Column driver coverage count** | `<tfoot>` or header secondary line — count drivers with `working` (or product-defined status set) per `plan_date` |

### 8.2 Component disposition

| Component | Action |
| --- | --- |
| `types.ts`, `plan-status-badge.tsx`, `lib/week-dates.ts` | Keep |
| `driver-planning.service.ts` | Add `getCompanyWeekPlan(weekStartYmd)`; keep upsert/delete |
| `actions.ts` | Add `getCompanyWeekPlanAction` |
| `use-driver-week-plan.ts` | Add `useCompanyWeekPlan`; extend mutations to invalidate `company-week-plan` key |
| `driver-planning-filters.tsx` | Remove driver select; keep week picker + chevrons |
| `driver-week-grid.tsx` | **Replace** with `driver-roster-grid.tsx` |
| `day-plan-cell.tsx` | **Replace** with compact `roster-plan-cell.tsx` (or heavily refactor) |
| `day-plan-edit-sheet.tsx` | **Split** → `day-plan-edit-form.tsx` + `day-plan-edit-popover.tsx`; deprecate sheet or keep for mobile drawer |
| `page.tsx` | Prefetch `getCompanyWeekPlan` + drivers; drop single-driver plan prefetch |

### 8.3 Net-new components (suggested)

- `driver-roster-grid.tsx` — table + scroll + sticky axes
- `roster-plan-cell.tsx` — click target, colors, times, optional Ist dot (defer full Ist chip to phase 3)
- `day-plan-edit-form.tsx` — shared fields (status, times, vehicle, notes)
- `day-plan-edit-popover.tsx` — popover shell + single-open state
- `lib/plan-hours.ts` — duration sum helpers
- `roster-column-totals.tsx` / inline tfoot — coverage counts

### 8.4 Service / action / hook changes

```text
getCompanyWeekPlan(weekStartYmd): Promise<DriverDayPlan[]>
  → group client-side by driver_id + plan_date

getCompanyWeekPlanAction(weekStartYmd)

useCompanyWeekPlan(weekStartYmd, { initialData? })
  queryKey: ['company-week-plan', weekStartYmd]

useUpsertDayPlan / useDeleteDayPlan
  → invalidate ['company-week-plan', weekStartYmd]
  → optionally keep per-driver key for backwards compatibility
```

No schema migration required for phase 2.

### 8.5 Explicitly defer to Phase 3

From plan deferred list (`docs/driver-planning.md:88–96`) plus audit findings:

- Bulk edit, week copy, recurring templates
- **Ist overlay for all drivers** (batch `getActualShiftDatesForWeek` or SQL aggregate on `shifts`)
- Single-driver card view toggle (optional UX nicety)
- Monthly view, multi-week
- Driver-facing plan
- Leave balances, sick attachments
- Dispatch guardrails, payroll export, overtime auto-calc
- Row virtualization (`@tanstack/react-virtual`)
- Vehicle/notes in popover vs simplified popover (status + times only) — if popover too tight, use Sheet on mobile only

### 8.6 Suggested implementation order

1. `getCompanyWeekPlan` + hook + page prefetch
2. `DriverRosterGrid` read-only (sticky table, colors, times)
3. `plan-hours.ts` + row/column totals
4. Extract form + popover edit
5. Filter simplification + docs update
6. Build gate: `bun run build` + `bun test` (per `AGENTS.md:148–156`)

---

## Appendix — Phase 1 invariant checklist (unchanged for phase 2)

Phase 2 must preserve:

- Writes only to `driver_day_plans` (`driver-planning.service.ts:4–5`, `docs/driver-planning.md:84`)
- Berlin DATE string bounds, no UTC midnight keys (`driver-planning.service.ts:107–109`)
- `PLAN_STATUSES` single source (`types.ts:4–6`)
- `requireAdminContext()` first in service exports (`driver-planning.service.ts:30–53`)
- Admin-only RLS unchanged (no migration needed)
