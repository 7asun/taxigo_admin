# Driver availability read model

Shared **read-only** layer that merges `driver_day_plans` (planned schedule / leave) and `shifts` (actual worked time) into a single derived picture for a Berlin calendar date.

Writes stay in existing feature services (`upsertDayPlan`, `createAdminShiftForDriver`, etc.). This module does not mutate data.

## Scope

| In scope | Out of scope (deferred) |
| --- | --- |
| `DriverDayContext` derivation | Blocking drag-assign onto unavailable drivers in Kanban |
| TanStack Query hooks | Zod schema for plan statuses |
| Fahrerschichtplanung Ist overlay (Phase 4B) | Regenerating `database.types.ts` via Supabase CLI |
| Kanban column header badges | Trip assignment form availability guard |

## Module layout

```
src/lib/driver-availability.ts          — types, UNAVAILABLE_STATUSES, client-safe helpers
src/lib/driver-availability.server.ts — admin Supabase reads (server/RSC/actions only)
src/lib/driver-availability.actions.ts — thin server actions
src/lib/driver-availability-cache.ts  — TanStack Query invalidation helpers
src/hooks/useDriverAvailability.ts    — single driver + date
src/hooks/useDriversWithAvailability.ts — all active drivers for one date (Kanban)
src/query/keys/driver-availability.ts — query key factory
```

## `DriverDayContext`

One row per `(driverId, dateYmd)`:

| Field | Source | Notes |
| --- | --- | --- |
| `driverId` | argument | Account UUID |
| `date` | argument | Berlin YMD (`YYYY-MM-DD`) |
| `plan` | `driver_day_plans` | `null` when no plan row |
| `plan.status` | `driver_day_plans.status` | Mapped to `DriverAvailability` (`working` → `available`) |
| `plan.plannedStart/End` | `planned_start/end` | `HH:MM` wall-clock |
| `shift` | `shifts` + `shift_events` | `null` when no shift in Berlin day bounds |
| `shift.startedAt/endedAt` | `shifts` | UTC ISO; display via `parseScheduledAtOrFallback` |
| `shift.breakMinutes` | paired break events | Same pairing logic as admin shift entry |
| `availability` | derived | From plan status, else `'unknown'` |
| `isDispatchable` | derived | `false` when `availability ∈ UNAVAILABLE_STATUSES` |

## `UNAVAILABLE_STATUSES`

| Value | Reason |
| --- | --- |
| `vacation` | Full-day Urlaub — not dispatchable |
| `sick` | Krank — not dispatchable |
| `day_off` | Frei — not dispatchable |
| `special_leave` | Sonderurlaub — not dispatchable |
| `training` | Fortbildung — not dispatchable |

**Not in list (dispatchable by default):**

- `half_day_vacation` — product treats as dispatchable with caution; add to list only with HR sign-off
- `overtime`, `available`, `unknown`

## Berlin date invariants

- **Plans:** `driver_day_plans.plan_date` is a Postgres `date` — query with YMD string directly.
- **Shifts:** Always filter with `getZonedDayBoundsIso(dateYmd)` → `startISO` / `endExclusiveISO`. Never use UTC midnight as a day proxy.
- **Week shift map keys:** `instantToYmdInBusinessTz(new Date(started_at).getTime())` — matches `shifts_driver_berlin_date_unique` and existing `getActualShiftDatesForWeek` usage in [`driver-planning.service.ts`](../src/features/driver-planning/api/driver-planning.service.ts).

## Query keys

| Key | Hook | Stale time |
| --- | --- | --- |
| `driverAvailabilityKeys.day(driverId, dateYmd)` | `useDriverAvailability` | 2 min |
| `driverAvailabilityKeys.driversDay(dateYmd)` | `useDriversWithAvailability` | 2 min |
| `companyWeekShiftsKeys.week(weekStartYmd)` | `useCompanyWeekShifts` | 5 min |

### Invalidation triggers

After plan upsert/delete, shift save/delete (planning or reconciliation):

- `driverAvailabilityKeys.root` (prefix)
- `['drivers-availability']` (prefix)
- `companyWeekShiftsKeys.week(snapYmdToWeekStart(planDate))`

Server actions also call `revalidatePath('/dashboard/fahrerschichtplanung')` when Ist-Zeit is saved from shift-reconciliations.

## Adding a new consumer

1. **Server/RSC:** Import from `driver-availability.server.ts` — e.g. `getDriverDayContext(driverId, dateYmd)`.
2. **Client:** Use `useDriverAvailability(driverId, dateYmd)` or `useDriversWithAvailability(dateYmd)`.
3. **UI:** Read `context.isDispatchable` and `context.availability`; use `PLAN_STATUSES` for German labels when a plan row exists.

Do not fetch in leaf components — pass `DriverDayContext` or `ShiftSummary` via props.

## Consumers today

| Surface | Usage |
| --- | --- |
| Fahrerschichtplanung roster | `useCompanyWeekShifts` → `RosterPlanCell` Ist line |
| Schichtzettel-Abgleich | Invalidates availability caches on inline Ist save (list still uses `get_shift_day_summaries` RPC) |
| Kanban (`/dashboard/trips?view=kanban`) | `useDriversWithAvailability` → column header badge when `!isDispatchable` |

## Kanban behaviour

- Business date from URL `scheduled_at` via `resolveTripsFilterDateYmd` (defaults to today Berlin; range filters use start YMD).
- Columns are **never hidden** for unavailable drivers — trips may already be assigned.
- **Graceful degradation:** if availability query is loading or errored, board renders without badges (DnD unchanged).

## Related docs

- [`driver-planning.md`](driver-planning.md) — Phase 4B Ist overlay
- [`shift-reconciliations.md`](shift-reconciliations.md) — inline Ist save
- [`kanban-view.md`](kanban-view.md) — availability badges
- [`plans/shift-availability-audit.md`](plans/shift-availability-audit.md) — original audit
