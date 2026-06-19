# Trip assignee abstraction

Trips can be assigned to an **internal driver**, a **Fremdfirma** (external company), or remain **genuinely unassigned**. Fremdfirma trips intentionally keep `driver_id = null`, so `driver_id IS NULL` must never alone mean “needs dispatch”.

## Types and helpers (read model)

Module: `src/features/trips/lib/trip-assignee.ts`

| Export | Use when |
|--------|----------|
| `TripAssignee` | Display or branching on the resolved assignee (`kind`: `driver` \| `fremdfirma` \| `unassigned`) |
| `resolveTripAssignee(trip)` | Rendering assignee label from a row that includes assignee joins |
| `isTripUnassignedForDispatch(trip)` | Counting/filtering trips that still need internal driver dispatch |
| `isTripFremdfirma(trip)` | Excluding external trips from Kanban / internal queues |
| `parseAssigneeParam(driverIdParam)` | Parsing the overloaded `driver_id` URL filter once before building Supabase queries |
| `formatFremdfirmaAssigneeParam(id)` | Building `fremdfirma:<uuid>` option values in the Fahrer filter |
| `FREMDFIRMA_ALL_ASSIGNEE_PARAM` | Literal `fremdfirma:all` for “all Fremdfirma trips” filter |

**Precedence:** If both `fremdfirma_id` and `driver_id` are set (data inconsistency), `resolveTripAssignee` treats the trip as Fremdfirma-assigned.

## Write model

Also in `src/features/trips/lib/trip-assignee.ts`. All assignment writes must go through these helpers — **`getStatusWhenDriverChanges` was removed** (display labels remain in `src/lib/trip-status.ts`).

| Export | Use when |
|--------|----------|
| `AssignmentPatchInput` | Partial assignee/billing fields being changed |
| `getStatusWhenAssignmentChanges(currentStatus, effective)` | Staging-only status preview (Kanban drag) when effective assignee state is already resolved |
| `buildAssignmentPatch(current, next)` | Every persist path that changes `driver_id`, `fremdfirma_id`, or related billing fields |

### Status transition matrix (admin open/assigned only)

| Current status | Effective assignee | New status |
|----------------|-------------------|------------|
| `pending` / `open` | driver or Fremdfirma set | `assigned` |
| `pending` / `open` | both null | *(unchanged)* |
| `assigned` | both null | `pending` |
| `assigned` | driver or Fremdfirma set | *(unchanged)* |
| `in_progress`, `driving`, `completed`, `cancelled`, `scheduled` | any | *(unchanged — terminal guard)* |

### DB invariants enforced by `buildAssignmentPatch`

- **Mutual exclusion:** `fremdfirma_id` set → `driver_id = null`, `needs_driver_assignment = false`
- **Driver assign:** `driver_id` set → Fremdfirma billing fields cleared, `needs_driver_assignment = false`
- **Fully unassigned:** both null → `needs_driver_assignment = true`
- **Status:** included in patch only when the matrix above returns a value

### Write consumers

| Consumer | API used |
|----------|----------|
| `trip-fremdfirma-section.tsx` | `buildAssignmentPatch` |
| `driver-select-cell.tsx` | `buildAssignmentPatch` |
| `trip-detail-sheet.tsx` | `buildAssignmentPatch` |
| `kanban-board.tsx` | `buildAssignmentPatch` (only when `change.driver_id !== undefined`) |
| `kanban-grouping.ts` | `getStatusWhenAssignmentChanges` |
| `pending-tours-widget.tsx` | `buildAssignmentPatch` |
| `use-pending-assignments.ts` | `buildAssignmentPatch` |
| `create-trip-form.tsx` | `buildAssignmentPatch` (insert) |
| `build-return-trip-insert.ts` | `buildAssignmentPatch` (insert) |
| `duplicate-trips.ts` | `buildAssignmentPatch` (insert) |
| Read/filter surfaces | `resolveTripAssignee`, `parseAssigneeParam`, etc. |

## Supabase joins

Module: `src/features/trips/lib/trip-query-fragments.ts`

- `DRIVER_JOIN_FRAGMENT` — `driver:accounts!trips_driver_id_fkey(name)`
- `FREMDFIRMA_JOIN_FRAGMENT` — `fremdfirma:fremdfirmen(id, name, default_payment_mode)`
- `ASSIGNEE_JOIN_FRAGMENT` — both fragments combined

Import these constants in any query that displays or resolves assignee information. Do not inline join strings.

## URL filter convention

The existing `driver_id` search param carries assignee semantics (saved views stay compatible):

| Value | Meaning |
|-------|---------|
| *(absent or `all`)* | No assignee filter |
| `unassigned` | `driver_id IS NULL` **and** `fremdfirma_id IS NULL` |
| `<driver-uuid>` | Internal driver |
| `fremdfirma:<uuid>` | Specific Fremdfirma |
| `fremdfirma:all` | Any Fremdfirma-assigned trip |

Listing applies filters via `parseAssigneeParam()` in `trips-listing.tsx`.

## Display component

`src/features/trips/components/trip-assignee-badge.tsx` — pure UI for an already-resolved `TripAssignee`. Used in the Fahrer column (via `DriverSelectCell`), mobile cards, and anywhere else that needs consistent assignee text.

## Read consumers

- Fahrten listing + filter bar
- Dashboard “Offene Touren” widget + unplanned query
- Dispatch inbox (`use-pending-assignments`)
- Kanban board (Fremdfirma trips hidden + info banner)
- Print ZIP grouping

## Deferred (out of scope)

- CSV export (`src/app/api/trips/export/`)
- Invoice line item snapshots
- Client trips panel assignee display
- Controlling driver revenue chart grouping
- Dedicated Fremdfirma planning view
