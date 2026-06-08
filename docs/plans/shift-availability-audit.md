# Shift & Availability Audit

**Date:** 2026-06-09  
**Scope:** `/dashboard/fahrerschichtplanung`, `/dashboard/shift-reconciliations`, Kanban (Fahrten), shared data layer  
**Bugs under investigation:**

- **Bug A:** Time entered in shift-reconciliations does not appear/update in fahrerschichtplanung.
- **Bug B:** A driver marked with Urlaub still appears on the Kanban board.

---

## Executive summary

Driver availability and worked time are **not stored in one place**. The codebase deliberately splits:

| Concern | Table | Used by |
| --- | --- | --- |
| **Planned schedule** (Urlaub, Krank, Arbeitstag, planned hours) | `driver_day_plans` | Fahrerschichtplanung roster |
| **Actual worked time** (Beginn/Ende/Pause) | `shifts` + `shift_events` | Shift-reconciliations, driver portal, Fahrerschichtplanung Ist-Zeit tab |
| **Schichtzettel sign-off** | `shift_reconciliations` | Shift-reconciliations only |
| **Who can be assigned trips** | `accounts` (`is_active`) | Kanban, trip forms, filters |

There is **no unified `driver_availability` concept** and **no shared hook** that all three surfaces consume. Bug A and Bug B are consistent with this fragmentation: each surface reads a different source and none cross-notifies the others reliably.

---

## 1. Data model — how is availability stored?

### Supabase tables

#### `driver_day_plans` — planned schedule / leave status

Migration: `supabase/migrations/20260524120000_add_driver_day_plans.sql`

| Column | Role |
| --- | --- |
| `plan_date` | Berlin calendar date (`date`, not timestamptz) |
| `status` | Planned day type — see enum below |
| `planned_start`, `planned_end` | Planned wall-clock times (`time`, nullable) |
| `vehicle_id`, `notes` | Optional planning metadata |
| `company_id`, `driver_id` | Tenant + driver FK |

**Unique:** `(company_id, driver_id, plan_date)` — one plan row per driver per day.

**Status values** (Postgres `CHECK` + TS `PLAN_STATUSES`):

| Key | German label | Meaning |
| --- | --- | --- |
| `working` | Arbeitstag | Scheduled work day |
| `day_off` | Frei | Day off |
| `vacation` | Urlaub | Vacation |
| `sick` | Krank | Sick leave |
| `half_day_vacation` | Halber Urlaub | Half-day vacation |
| `overtime` | Überstunden | Overtime day |
| `training` | Fortbildung | Training |
| `special_leave` | Sonderurlaub | Special leave |

Source of truth for TS labels: `src/features/driver-planning/types.ts`.

#### `shifts` — actual worked time (payroll / Ist-Zeit)

Documented in `supabase/migrations/20260320000000_fix_shifts_status_check.sql`, extended by `20260608130000_admin_shift_entry.sql`.

| Column | Role |
| --- | --- |
| `started_at`, `ended_at` | Actual shift begin/end (UTC timestamptz, Berlin wall-clock via `buildScheduledAt`) |
| `status` | `active` \| `on_break` \| `ended` |
| `driver_id`, `company_id`, `vehicle_id` | Ownership |
| `entered_by` | Admin account id when entered on behalf; `NULL` = driver app entry |

**Unique index:** one shift per driver per Berlin calendar date (`shifts_driver_berlin_date_unique`).

#### `shift_events` — break pairs and lifecycle

| Column | Role |
| --- | --- |
| `shift_id` | FK → `shifts` |
| `event_type` | `shift_start`, `break_start`, `break_end`, `shift_end` |
| `timestamp` | Event time (UTC) |
| `metadata` | e.g. break reason on `break_start` |

Break duration for reconciliation list is computed in SQL from paired `break_start` / `break_end` events.

#### `shift_reconciliations` — Schichtzettel audit / completion

Migration: `20260428120000_shift_reconciliations.sql`, status added in `20260608140000_add_reconciliation_status.sql`.

| Column | Role |
| --- | --- |
| `date` | Business calendar date |
| `driver_id`, `company_id` | Scope |
| `shift_id` | Optional FK → `shifts` (nullable) |
| `status` | `open` \| `completed` |
| `confirmed_by`, `confirmed_at`, `notes` | Audit trail |

Does **not** store worked hours — only sign-off metadata and optional link to `shifts`.

#### `accounts` — driver roster membership

Kanban and selectors use `role = 'driver'` and `is_active = true`. This is **account-level activation**, not day-level availability.

### Do fahrerschichtplanung and shift-reconciliations write to the same table?

**No — they write to different tables for different concerns:**

| Surface | Primary writes | Secondary writes |
| --- | --- | --- |
| **Fahrerschichtplanung — Dienstplan tab** | `driver_day_plans` | — |
| **Fahrerschichtplanung — Ist-Zeit tab** | `shifts`, `shift_events` | — |
| **Shift-reconciliations — inline Ist-Zeit** | `shifts`, `shift_events` (via shared `createAdminShiftForDriver`) | — |
| **Shift-reconciliations — Abschließen** | `shift_reconciliations` | Resolves `shift_id` from existing `shifts` row |
| **Shift-reconciliations — trip price edit** | `trips.manual_gross_price` | — |

**Shared write path for Ist-Zeit:** both reconciliation inline save and Fahrerschichtplanung Ist-Zeit tab call `createAdminShiftForDriver` in `src/features/driver-planning/api/admin-shifts.service.ts`.

**Sync/join between plan and actual:**

- **Application layer:** Fahrerschichtplanung popover links to reconciliation detail; delete shift in planning can reopen reconciliation.
- **Database layer:** no triggers syncing `driver_day_plans` ↔ `shifts`.
- **Read layer:** RPC `get_shift_day_summaries` (migration `20260608140100_update_shift_day_summaries.sql`) **joins** trips + shifts + plan days for the reconciliation **list view only**. Fahrerschichtplanung does **not** use this RPC.

### Column mapping summary

| Concept | Storage |
| --- | --- |
| Scheduled time | `driver_day_plans.planned_start`, `planned_end` |
| Scheduled status (Urlaub/Krank/…) | `driver_day_plans.status` |
| Actual worked time | `shifts.started_at`, `shifts.ended_at` + break events in `shift_events` |
| Vacation / sick (planning) | `driver_day_plans.status IN ('vacation', 'sick', …)` |
| Reconciliation completion | `shift_reconciliations.status` |
| Live shift state (on road) | `shifts.status` (`active`, `on_break`, `ended`) |

### Unified `driver_availability` concept?

**No.** Availability is fragmented across `driver_day_plans.status`, `shifts` presence/times, `accounts.is_active`, and (indirectly) trip assignments. Nothing aggregates these into a single table, view, or RPC consumed by all three UIs.

---

## 2. Fahrerschichtplanung — what data does it read?

### Route & entry

- **Route:** `/dashboard/fahrerschichtplanung`
- **Page:** `src/app/dashboard/fahrerschichtplanung/page.tsx`
- **Feature module:** `src/features/driver-planning/`

### Server fetches (RSC)

On page load:

1. `getPlanningDrivers()` → `accounts` where `role = 'driver'`, `is_active = true`
2. `getCompanyWeekPlan(weekStartYmd)` → all `driver_day_plans` for the company in the selected ISO week (Mon–Sun, Berlin)

### Client fetches (TanStack Query)

`DriverRosterGrid` uses `useCompanyWeekPlan(weekStartYmd)`:

- Query key: `['company-week-plan', weekStartYmd]`
- Query fn: `getCompanyWeekPlanAction` → `driver_day_plans` only

### What the roster grid displays

`RosterPlanCell` renders **only** `driver_day_plans` data:

- Status label from `PLAN_STATUSES`
- Planned time range from `planned_start` / `planned_end` (via `formatTimeRange`)

It does **not** read or display `shifts` / Ist-Zeit on the grid.

### Does it read shift-reconciliation records?

**No.** It never queries `shift_reconciliations` or `get_shift_day_summaries`.

### Dead code: shift overlay helper exists but is unused

`getActualShiftDatesForWeek()` in `driver-planning.service.ts` reads ended `shifts` for a driver/week. **Nothing in the app imports or calls it.** Docs explicitly defer “Ist overlay on roster grid” to Phase 4B (`docs/driver-planning.md`).

### Ist-Zeit tab (popover only)

`DayPlanEditPopover` → `AdminShiftEntryForm` → `getAdminShiftForDriverDateAction` reads `shifts` + `shift_events` **when the popover Ist-Zeit tab is opened**. This is separate from the grid display.

### Re-fetch after reconciliation submit?

**No automatic cross-surface update.**

When Ist-Zeit is saved from **shift-reconciliations**:

- `saveIstZeitInlineAction` calls `revalidatePath('/dashboard/shift-reconciliations')` only
- TanStack Query invalidates `shiftReconciliationKeys.summaries` / `record`
- **Does not** `revalidatePath('/dashboard/fahrerschichtplanung')` or invalidate `company-week-plan` keys

When Ist-Zeit is saved from **Fahrerschichtplanung** (`createAdminShiftAction`):

- `revalidatePath('/dashboard/fahrerschichtplanung')` runs
- Still no grid overlay — only RSC cache for the page; grid shows plans, not shifts

**Conclusion for Bug A:** Even when data is correctly written to `shifts`, the **roster grid never renders it**. Users expect grid cells to reflect reconciliation input, but Phase 4B display was never shipped.

---

## 3. Shift-reconciliations — what does it write?

### Route & entry

- **Route:** `/dashboard/shift-reconciliations`
- **Page:** `src/app/dashboard/shift-reconciliations/page.tsx`
- **Feature module:** `src/features/shift-reconciliations/`

### Inline Ist-Zeit save (Row 1)

Flow: `ShiftIstZeitRow` → `useSaveIstZeitInline` → `saveIstZeitInlineAction` → `saveIstZeitInline()` → **`createAdminShiftForDriver()`**

**Tables/columns written:**

| Table | Columns |
| --- | --- |
| `shifts` | `driver_id`, `company_id`, `vehicle_id`, `started_at`, `ended_at`, `status = 'ended'`, `entered_by` (admin id) |
| `shift_events` | `shift_start`, optional `break_start`/`break_end` pairs, `shift_end` with timestamps |

Overwrite behavior: deletes existing ended shift + events for that Berlin date; blocks if live shift (`active` / `on_break`).

### Complete / reopen reconciliation

| Action | Table | Columns |
| --- | --- | --- |
| **Abschließen** | `shift_reconciliations` | upsert: `status = 'completed'`, `confirmed_by`, `confirmed_at`, `notes`, optional `shift_id` |
| **Erneut öffnen** | `shift_reconciliations` | `status = 'open'`, updates confirmer audit fields |

### Trip price correction

`updateTripManualPrice` → `trips.manual_gross_price` only (bypasses pricing engine).

### Delete Ist-Zeit

`useDeleteIstZeitInline` → `deleteAdminShiftAction` → deletes `shift_events` + `shifts`; best-effort `reopenReconciliationAction`.

### Side effects after insert/update

| Mechanism | Propagates to other views? |
| --- | --- |
| Postgres triggers | **None** found for cross-table sync |
| `revalidatePath` | Reconciliation page only (except delete shift also revalidates fahrerschichtplanung via `deleteAdminShiftAction`) |
| TanStack Query invalidation | Reconciliation query keys only |
| Realtime | Not used for shifts/plans |

**Shared service note:** `shift-reconciliations.service.ts` imports `createAdminShiftForDriver` from `driver-planning/api/admin-shifts.service.ts` — write logic is centralized; **read/display and cache invalidation are not**.

---

## 4. Kanban — how does it decide which drivers to show?

### Location

There is **no** `/dashboard/kanban` route. Kanban lives on **Fahrten**:

- **Route:** `/dashboard/trips?view=kanban` (and date/filter query params)
- **Board:** `src/features/trips/components/kanban/kanban-board.tsx` (`TripsKanbanBoard`)
- **Orchestrator page:** `src/features/trips/components/trips-listing.tsx`

### Driver list query

Kanban gets drivers via `useTripFormData()` → `useDriversQuery()` → **`fetchActiveDrivers()`**:

```typescript
// src/features/trips/api/trip-reference-data.ts
.from('accounts')
.select('id, name')
.eq('role', 'driver')
.eq('is_active', true)
.order('name')
```

TanStack Query key: `referenceKeys.drivers()` — long stale time (10 min).

### Column construction

`buildColumns(trips, groupBy, drivers)` in `src/features/trips/lib/kanban-columns.ts`:

When `groupBy === 'driver'`:

1. One column per **active driver** from `fetchActiveDrivers`
2. Plus `unassigned` column
3. Plus orphan columns for trip `driver_id` values not in the driver list

### Filter for vacation, Urlaub, or sick?

**No filter exists.**

Confirmed by code review:

- `kanban-board.tsx` — no reference to `driver_day_plans`, `plan_status`, `vacation`, `sick`, or `PLAN_STATUSES`
- `kanban-columns.ts` — uses full `drivers` array without date-scoped filtering
- `fetchActiveDrivers` — only `is_active` + `role`

A driver with `driver_day_plans.status = 'vacation'` for today **still gets a Kanban column** as long as `accounts.is_active = true`.

Trips already assigned to that driver still appear in their column; dispatch can also drag new trips onto them.

### Date context

Trips are filtered by the Fahrten date filter (`scheduled_at` / `requested_date` in `trips-listing.tsx`), but **driver columns are not scoped to that date** — they always show all active drivers.

---

## 5. Shared helpers — what exists today?

### Centralized availability helper?

**None.** Searched for `useDriverAvailability`, `getDriverStatus`, `isDriverAvailable`, `driver_availability` — **no matches**.

### Duplicated driver list fetchers

Three nearly identical “active drivers” queries:

| Function | Module | Select |
| --- | --- | --- |
| `getPlanningDrivers()` | `driver-planning.service.ts` | `id, name, first_name, last_name` + display name helper |
| `getDrivers()` | `shift-reconciliations.service.ts` | same pattern |
| `fetchActiveDrivers()` | `trip-reference-data.ts` | `id, name` only |

All query `accounts` with `role = 'driver'`, `is_active = true`. **No day-plan or shift join.**

### Partial shared write layer

| Shared | Consumers |
| --- | --- |
| `createAdminShiftForDriver` | Fahrerschichtplanung actions, shift-reconciliations inline save |
| `deleteAdminShift` | Fahrerschichtplanung delete, reconciliation inline delete |
| `PLAN_STATUSES` / `PlanStatusBadge` | Fahrerschichtplanung + reconciliation list (`plan_only` days) |
| `get_shift_day_summaries` RPC | Reconciliation list only |

### Unused read helper

`getActualShiftDatesForWeek()` — implemented for “plan vs actual” comparison, **never wired to UI**.

### Availability logic duplication

| Surface | Logic |
| --- | --- |
| Fahrerschichtplanung | Plan status colors, week hour totals from `driver_day_plans` |
| Shift-reconciliations | RPC merges trips/shifts/plans; `plan_only` suppresses Ist-Zeit rows |
| Kanban | Active account list only |
| Trip assignment | No guard against vacation/sick (deferred in docs) |

---

## 6. Type safety — are statuses typed?

### Planned day status (`driver_day_plans.status`)

**Typed in application code:**

```typescript
// src/features/driver-planning/types.ts
export const PLAN_STATUSES = { working: 'Arbeitstag', vacation: 'Urlaub', sick: 'Krank', ... } as const;
export type PlanStatus = keyof typeof PLAN_STATUSES;
```

**Database:** Postgres `CHECK` constraint mirrors the same string set.

**Generated types:** `database.types.ts` types `driver_day_plans.status` as **`string`** (not a union) — comment says “TODO: regenerate with supabase gen types”.

**No Zod schema** for plan status in the audited paths.

### Shift runtime status (`shifts.status`)

**Typed:**

```typescript
// src/features/driver-portal/types.ts
export const SHIFT_STATUSES = { ACTIVE: 'active', ON_BREAK: 'on_break', ENDED: 'ended' } as const;
export type ShiftStatus = ...
```

DB `CHECK`: `('active', 'on_break', 'ended')`.

### Reconciliation status

**Typed** in `src/features/shift-reconciliations/types.ts`:

```typescript
export type ReconciliationStatus = 'open' | 'completed';
export const RECONCILIATION_STATUS = { OPEN: 'open', COMPLETED: 'completed' } as const;
```

### Kanban / trip driver list

`DriverOption` is `{ id: string; name: string }` — **no status field**.

---

## Senior recommendation

### Root cause assessment

#### Bug A — reconciliation time not visible in Fahrerschichtplanung

**Primary cause (by design gap):** Fahrerschichtplanung **roster grid reads only `driver_day_plans`**. Shift-reconciliations Ist-Zeit writes to **`shifts` + `shift_events`**. These are intentionally separate tables; the UI never merges them on the grid. Documentation lists “Ist overlay for all drivers on roster grid (Phase 4B)” as **deferred**.

**Secondary cause (cache):** Saves from shift-reconciliations do not invalidate Fahrerschichtplanung caches (`company-week-plan`) or `revalidatePath('/dashboard/fahrerschichtplanung')`. Even the Ist-Zeit tab in the planning popover could show stale data if opened before save elsewhere — though it refetches on mount via `useEffect([driverId, date])`.

**Not a sync failure:** Data likely **is** persisted correctly to `shifts`; the planning **view** simply does not surface it on cells.

#### Bug B — Urlaub driver still on Kanban

**Primary cause:** Kanban driver columns come from **`accounts.is_active` only**. **`driver_day_plans` is never consulted.** Urlaub/Krank are plan statuses on a date-specific row, not account flags — Kanban has no code path to hide them.

**Expected given current architecture:** Confirmed absence of filter; not a regression in plan writes.

---

### Architectural opinion — should there be a shared helper?

**Yes — a shared read model is warranted**, but it should reflect the existing split tables rather than forcing one write table.

Recommended shape:

```typescript
// Conceptual — not implemented
type DriverDayContext = {
  date: string;           // Berlin YMD
  plan: DriverDayPlan | null;
  shift: AdminShiftForDate | null;
  reconciliation: ShiftReconciliationWithMeta | null;
  availability: 'available' | 'vacation' | 'sick' | 'day_off' | 'working' | 'unknown';
};

// Server: getDriverDayContext(driverId, dateYmd) — single admin-scoped query/RPC
// Client hook: useDriverDayContext(driverId, dateYmd) — TanStack Query wrapper
```

**Availability derivation rules (suggested):**

1. If `driver_day_plans.status` is `vacation` or `sick` → not dispatchable for that date
2. Else if `shifts.status` is `active` or `on_break` → on duty (may still accept assignments per product rules)
3. Else if plan is `working` or shift ended row exists → workable
4. Fall back to `accounts.is_active` for account-level eligibility only

**Consumers:**

| Surface | Use |
| --- | --- |
| Fahrerschichtplanung grid | Show plan badge + optional Ist-Zeit overlay from `shift` |
| Shift-reconciliations | Already partially covered by RPC; could delegate to same helper |
| Kanban | Filter `buildColumns` drivers where `availability` is not `vacation`/`sick` for **trips filter date** |

Keep **writes** in existing services (`upsertDayPlan`, `createAdminShiftForDriver`, `completeReconciliation`). Centralize **reads + derived availability** only.

---

### Risk surface — most fragile module to change

**Kanban (`src/features/trips/components/kanban/`) is the most fragile:**

- Complex client state: DnD, `pendingChanges` in Zustand + localStorage, column reorder persistence
- `buildColumns` affects drop targets — removing a driver column changes where trips can be dragged
- Long-lived `referenceKeys.drivers()` cache (10 min stale) — availability filter must invalidate correctly
- Orphan column logic for unknown `driver_id` on trips must remain for data integrity

**Lower risk:** Fahrerschichtplanung read overlay (additive UI on `RosterPlanCell`) and extending `saveIstZeitInlineAction` with an extra `revalidatePath`.

**Medium risk:** New RPC or shared server function — must respect RLS/admin context and Berlin date bounds consistently (`getZonedDayBoundsIso`, `buildScheduledAt`).

---

### Suggested next step — minimal, lowest-risk fix for both bugs

#### Bug A (two small changes, no data-layer refactor)

1. **Phase 4B-minimum — Ist overlay on roster cells (read-only)**  
   - Extend week fetch: either batch-read `shifts` for `(driver_ids × week dates)` alongside `getCompanyWeekPlan`, or activate existing `getActualShiftDatesForWeek` pattern company-wide.  
   - In `RosterPlanCell`, when a shift exists for that cell date, show a second line with actual times (e.g. `08:00–17:00` from `started_at`/`ended_at`).  
   - Keep plan badge as primary; Ist line is overlay — matches docs’ deferred Phase 4B intent.

2. **Cross-invalidate on Ist-Zeit save from reconciliation**  
   - In `saveIstZeitInlineAction`, add `revalidatePath('/dashboard/fahrerschichtplanung')`.  
   - Optionally invalidate a new query key like `['driver-week-shifts', weekStartYmd]` when overlay query is added.

**Why this is minimal:** Reuses existing `shifts` data already written by reconciliation; no schema change; no merge of plan and actual tables.

#### Bug B (one targeted filter)

3. **Date-scoped plan filter in Kanban**  
   - Determine Kanban “business date” from the same `scheduledAt` / day filter `trips-listing.tsx` already uses (default: today Berlin).  
   - Fetch `driver_day_plans` for that date where `status IN ('vacation', 'sick')` (product may also exclude `day_off`).  
   - Pass excluded driver ids into `buildColumns` / `TripsKanbanBoard` to **omit those columns** (keep orphan column if trips are already assigned — product choice: hide column vs show with warning).  
   - Invalidate when plans change (driver-planning upsert could invalidate `referenceKeys.drivers()` or a new `driver-availability` key).

**Optional hardening (later):** Block drag-assign onto unavailable drivers in `handleDragEnd` with toast — defense in depth if column filter is bypassed via orphan trips.

---

## Appendix — file inventory

### App routes (requested directories)

| Path | Files |
| --- | --- |
| `src/app/dashboard/fahrerschichtplanung/` | `page.tsx` |
| `src/app/dashboard/shift-reconciliations/` | `page.tsx` |
| `src/app/dashboard/kanban/` | **Does not exist** — Kanban is on `/dashboard/trips?view=kanban` |

### Feature modules

| Module | Role |
| --- | --- |
| `src/features/driver-planning/` | Fahrerschichtplanung — plans + admin shift entry |
| `src/features/shift-reconciliations/` | Schichtzettel reconciliation |
| `src/features/trips/components/kanban/` | Kanban board |
| `src/features/driver-portal/` | Driver shift types + forms (shared `ShiftEntryForm`) |

### Components scan (`src/components/`)

No dedicated driver/shift/availability components. Matches found only in fleet map, icons, generic UI — **no shared availability component**.

### Lib scan (`src/lib/`)

`kanban-local-storage.ts` — Kanban pending state only. **No shift/availability utilities.**

### Types (`src/types/`)

- `database.types.ts` — `driver_day_plans`, `shifts`, `shift_events`, `shift_reconciliations`, RPC `get_shift_day_summaries`
- No standalone availability union in `types/index.ts`

### Key migrations (shift / availability related)

| Migration | Purpose |
| --- | --- |
| `20260524120000_add_driver_day_plans.sql` | Plan table + RLS |
| `20260319100000_add_shifts_shift_events_rls.sql` | Shift RLS |
| `20260320000000_fix_shifts_status_check.sql` | Shift status enum + comments |
| `20260428120000_shift_reconciliations.sql` | Reconciliation table |
| `20260502120000_get_shift_day_summaries.sql` | Original RPC (trips only) |
| `20260608130000_admin_shift_entry.sql` | Admin shift writes, unique index |
| `20260608140000_add_reconciliation_status.sql` | `open` / `completed` |
| `20260608140100_update_shift_day_summaries.sql` | Three-source RPC (trips + shifts + plans) |

### Related documentation

- `docs/driver-planning.md` — explicit separation of plans vs actuals; Phase 4B deferred
- `docs/shift-reconciliations.md` — Phase A three-source list, shared `createAdminShiftForDriver`
- `docs/kanban-view.md` — Kanban behavior; no availability filtering documented

---

## Answers index (quick reference)

| # | Question | Short answer |
| --- | --- | --- |
| 1 | Data model | Fragmented: `driver_day_plans` (plan/leave), `shifts` (actual time), `shift_reconciliations` (sign-off); no unified availability table |
| 2 | Fahrerschichtplanung reads | `driver_day_plans` only on grid; `shifts` only in Ist-Zeit popover tab; no reconciliation reads |
| 3 | Shift-reconciliations writes | Ist-Zeit → `shifts`/`shift_events`; complete → `shift_reconciliations`; no DB triggers to other views |
| 4 | Kanban drivers | `accounts` active drivers; **no** Urlaub/Krank filter |
| 5 | Shared helpers | Shared shift **write** service only; **no** shared availability read hook |
| 6 | Type safety | `PlanStatus`, `ShiftStatus`, `ReconciliationStatus` typed in feature modules; DB types often `string` |
