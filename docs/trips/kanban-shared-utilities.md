# Kanban Shared Utilities

Shared utilities extracted from the main Kanban board and the overview widget board so both surfaces consume one source of truth for group labels, DnD sensors, and drop-target column resolution.

## Extracted utilities

| Utility | File | Consumers |
|---|---|---|
| `buildGroupLabels(trips)` | `src/features/trips/lib/kanban-grouping.ts` | `TripsKanbanBoard` (`kanban-board.tsx`), `TripsOverviewWidgetBoard` (`trips-overview-widget-board.tsx`) |
| `useKanbanSensors()` | `src/features/trips/hooks/use-kanban-sensors.ts` | `TripsKanbanBoard`, `TripsOverviewWidgetBoard` |
| `resolveKanbanDropColumnId({ overId, columns, trips, getTripColumnId })` | `src/features/trips/lib/kanban-dnd.ts` | `TripsKanbanBoard` (drag-over highlight + trip/group assignment), `TripsOverviewWidgetBoard` (drag-end driver assignment) |
| `getKanbanTripColumnId(trip, groupBy)` | `src/features/trips/lib/kanban-columns.ts` | `buildItemsByColumn`, `TripsKanbanBoard` drag guard / hover / assignment logic |
| `GroupedTripsContainer` | `src/features/trips/components/kanban/kanban-group-container.tsx` | `KanbanColumnView`, `TripsOverviewWidgetColumn` with `hideUngroupAction={true}` |

## Trip Column Derivation

`getKanbanTripColumnId(trip, groupBy)` is the single source of truth for the main board's trip-to-column mapping. Both `buildItemsByColumn` and `TripsKanbanBoard` drag logic use it, so rendered buckets and drag-time assignment targets cannot drift.

`resolveKanbanDropColumnId` resolves a dnd-kit `over.id` to a column id but does **not** decide how a trip maps to a column. Callers pass the relevant trip-to-column derivation:

- **Main board** — `getKanbanTripColumnId(trip, groupBy)`, `groupBy`-aware (`driver_id` / `status` / `payer_id`).
- **Widget board** — `resolveWidgetColumnId` from `widget-columns.ts`, driver-only; Fremdfirma trips forced to `unassigned`.

Do not merge these strategies into the shared resolver.

## Grouped visual units

`GroupedTripsContainer` is also consumed by the overview widget to render grouped trips as the same stacked visual unit used by the main Kanban board. The widget passes `hideUngroupAction={true}` because it does not expose an ungroup action in that context; existing main Kanban call sites omit the prop and continue to show the ungroup button.

## Stable Widget Drop Feedback

The overview widget mirrors the main board's hover-column resolution pattern for stable drag feedback. Its board-level `onDragOver` resolves `over.id` through `resolveKanbanDropColumnId` using `resolveWidgetColumnId`, then passes `dragOverColumnId` to each widget column so column highlighting remains stable even when `pointerWithin` reports a child `trip-{id}` droppable instead of the column body.

## Related docs

- Audit: [docs/plans/kanban-shared-utilities-audit.md](../plans/kanban-shared-utilities-audit.md) (implemented)
- Kanban behaviour: [docs/kanban-view.md](../kanban-view.md)
