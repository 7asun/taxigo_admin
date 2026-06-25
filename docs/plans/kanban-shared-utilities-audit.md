# Kanban Shared Utilities Extraction Audit

**Status: Implemented** (2026-06-25). See [docs/trips/kanban-shared-utilities.md](../trips/kanban-shared-utilities.md).

## Scope

Pure extraction audit only. No behavior changes, no visual changes, no new features.

Files read completely:

- `src/features/trips/components/kanban/kanban-board.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`
- `src/features/trips/lib/kanban-grouping.ts`
- `src/features/trips/lib/kanban-columns.ts`
- `src/features/trips/lib/kanban-types.ts`
- `src/features/trips/lib/widget-columns.ts`

Additional read-only searches were run across `src/features/trips/` for direct board imports, target resolution duplicates, `groupLabels` duplicates, and sensor duplicates.

## Drop Target Resolution

### 1. Main Board Resolution Blocks

File: `src/features/trips/components/kanban/kanban-board.tsx`

Function: `TripsKanbanBoard`, nested callback `handleDragEnd`

Line range: 462-504

This block resolves the target column for column-header drags. It starts with raw `overStr`, then derives a real column id when `overStr` is a `trip-{id}` droppable.

```tsx
      // 1. Column reorder
      // pointerWithin may report a trip-card droppable (trip-{id}) as `over`
      // instead of the column droppable when the pointer lands on a card inside
      // the target column. Resolve the actual target column in both cases.
      if (draggedId.startsWith('column-')) {
        const draggedColumnId = draggedId.replace(/^column-/, '');

        let targetColumnId = overStr;

        // If we landed on a trip card, find which column owns that trip.
        if (overStr.startsWith('trip-')) {
          const tripId = overStr.replace(/^trip-/, '');
          const trip = effectiveTrips.find((t) => t.id === tripId);
          if (trip) {
            targetColumnId =
              groupBy === 'driver'
                ? (trip.driver_id ?? 'unassigned')
                : groupBy === 'status'
                  ? (trip.status ?? '')
                  : (trip.payer_id ?? 'no_payer');
          }
        }

        const isOverColumn = effectiveColumns.some(
          (c) => c.id === targetColumnId
        );
        if (isOverColumn && draggedColumnId !== targetColumnId) {
          setColumnOrderByMode((prev) => {
            // Always derive currentOrder from effectiveColumns (which already
            // merges the stored order with any new columns). This prevents the
            // silent no-op when localStorage didn't include the last column.
            const currentOrder = effectiveColumns.map((c) => c.id);
            const fromIdx = currentOrder.indexOf(draggedColumnId);
            const toIdx = currentOrder.indexOf(targetColumnId);
            if (fromIdx === -1 || toIdx === -1) return prev;
            const reordered = [...currentOrder];
            reordered.splice(fromIdx, 1);
            reordered.splice(toIdx, 0, draggedColumnId);
            return { ...prev, [groupBy]: reordered };
          });
        }
        // Always return — column drags must never fall through to grouping logic.
        return;
      }
```

Line range: 516-522

This block resolves the target column for a cross-column card-on-card drop by deriving the target trip's rendered column with `getTripColumnId`.

```tsx
        // why: Grouping across columns is not permitted — a cross-column card-on-card drop is silently promoted to a plain column move to prevent cards from ending up grouped but in different columns.
        if (getTripColumnId(draggedTrip) !== getTripColumnId(targetTrip)) {
          // Resolve the target column from the target trip — do not use overStr here,
          // because overStr is "trip-{id}" not a column id when the pointer lands on a card.
          const targetColumnId = getTripColumnId(targetTrip);
          applyColumnAssignment(draggedId, targetColumnId);
          return;
        }
```

Line range: 553-572

This block resolves the target column for the final trip/group assignment branch. It accepts either a raw column id or a `trip-{id}` droppable and returns early if no real column can be resolved.

```tsx
      // 3. Trip/group → column: assignment
      // why: overStr may be a column id (drop on empty space) or trip-{id} (drop on
      // a card). We must resolve to a real column id before writing assignment —
      // passing trip-{id} as a column value causes trips to disappear into an
      // unrendered bucket in buildItemsByColumn.
      let resolvedColumnId: string | null = null;

      if (effectiveColumns.some((c) => c.id === overStr)) {
        // Dropped on empty column space — overStr is already a valid column id.
        resolvedColumnId = overStr;
      } else if (overStr.startsWith('trip-')) {
        // Dropped on a card — resolve column from the target trip.
        const targetTripId = overStr.replace(/^trip-/, '');
        const targetTrip = effectiveTrips.find((t) => t.id === targetTripId);
        resolvedColumnId = targetTrip ? getTripColumnId(targetTrip) : null;
      }

      if (!resolvedColumnId) return;

      applyColumnAssignment(draggedId, resolvedColumnId);
```

Related but not a drop-end target assignment:

File: `src/features/trips/components/kanban/kanban-board.tsx`

Function: `TripsKanbanBoard`, nested callback `handleDragOver`

Line range: 360-382

This block resolves the hovered column for highlighting, using the same raw-column-id-or-`trip-{id}` shape.

```tsx
  // why: Resolves the hovered column from any droppable under the pointer — card or column — so the column highlight activates regardless of what the pointer lands on.
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overId = event.over?.id == null ? null : String(event.over.id);
      if (!overId || overId.startsWith('column-') || overId.startsWith('group-')) {
        setDragOverColumnId(null);
        return;
      }

      let hoveredColumnId: string | null = null;
      if (effectiveColumns.some((column) => column.id === overId)) {
        hoveredColumnId = overId;
      } else if (overId.startsWith('trip-')) {
        const tripId = overId.replace(/^trip-/, '');
        const trip = effectiveTrips.find((t) => t.id === tripId);
        hoveredColumnId = trip ? getTripColumnId(trip) : null;
      }

      setDragOverColumnId(
        hoveredColumnId && hoveredColumnId !== activeDragColumnId
          ? hoveredColumnId
          : null
      );
```

### 2. Overview Widget Resolution Block

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Function: `TripsOverviewWidgetBoard`, nested callback `handleDragEnd`

Line range: 102-123

This block resolves the target driver column from raw `over.id`, deriving the column from the target trip when `over.id` is a `trip-{id}` droppable.

```tsx
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const tripId = String(active.id);
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    if (isTripFremdfirma(trip) || trip.group_id) return;

    let targetColumnId = String(over.id);
    if (targetColumnId.startsWith('trip-')) {
      const targetTrip = trips.find(
        (t) => t.id === targetColumnId.replace(/^trip-/, '')
      );
      if (!targetTrip) return;
      targetColumnId = resolveWidgetColumnId(targetTrip);
    }

    const newDriverId = targetColumnId === 'unassigned' ? null : targetColumnId;
    if (trip.driver_id === newDriverId) return;
    onAssign(trip, newDriverId);
  };
```

### 3. Differences

The main board is `groupBy`-aware. Its local `getTripColumnId` helper derives the rendered column differently for driver, status, and payer modes.

File: `src/features/trips/components/kanban/kanban-board.tsx`

Function: `TripsKanbanBoard`, nested callback `getTripColumnId`

Line range: 341-352

```tsx
  // why: Must mirror buildItemsByColumn derivation so the guard stays consistent with what the board renders.
  // Derives the effective board column for a trip under the current groupBy mode.
  // Must stay in sync with buildItemsByColumn in kanban-columns.ts.
  const getTripColumnId = useCallback(
    (trip: KanbanTrip): string =>
      groupBy === 'driver'
        ? (trip.driver_id ?? 'unassigned')
        : groupBy === 'status'
          ? (trip.status ?? '')
          : (trip.payer_id ?? 'no_payer'),
    [groupBy]
  );
```

The widget is driver-only and Fremdfirma-aware. It uses `resolveWidgetColumnId`, which forces Fremdfirma trips into `unassigned` even if they have assignment fields.

File: `src/features/trips/lib/widget-columns.ts`

Function: `resolveWidgetColumnId`

Line range: 72-78

```tsx
/** Column bucket key — Fremdfirma trips always land in „Nicht zugewiesen“. */
export function resolveWidgetColumnId(trip: KanbanTrip): string {
  if (isTripFremdfirma(trip)) {
    return UNASSIGNED_COLUMN_ID;
  }
  return trip.driver_id ?? UNASSIGNED_COLUMN_ID;
}
```

Other differences:

- Main board validates resolved ids against `effectiveColumns` for column reordering and assignment. The widget does not validate `targetColumnId` against `columns`; it assumes `over.id` belongs to the widget DnD tree.
- Main board assignment resolution returns `null` when a `trip-{id}` target trip is missing, then returns early at line 570. The widget returns immediately inside the `trip-{id}` branch if the target trip is missing at line 117.
- Main board has multiple consumers of the resolution shape: column reorder, cross-column grouping fallback, final trip/group assignment, and drag-over highlighting. The widget currently only uses it for final plain-trip assignment.
- Main board uses `effectiveTrips`, which includes pending local changes. The widget uses `trips` directly.
- Main board ignores `column-` and `group-` ids in `handleDragOver`; the widget has no `handleDragOver`.
- Widget blocks drag-end assignment for Fremdfirma and already-grouped active trips before resolving the target. Main board permits group drags in the final assignment branch.

### 4. Shared Function Feasibility

A single shared resolver can cover the common mechanics: accept an `overId`, accept the list of rendered columns, accept trips, and accept a caller-provided trip-to-column derivation function. The `groupBy` dependency does not prevent extraction, but it should remain outside the generic resolver.

Recommended signature:

```ts
export function resolveKanbanDropColumnId(args: {
  overId: string | number;
  columns: KanbanColumn[];
  trips: KanbanTrip[];
  getTripColumnId: (trip: KanbanTrip) => string;
}): string | null;
```

Expected behavior:

- Convert `overId` to `String(overId)`.
- If it matches an existing `columns[id]`, return it.
- If it starts with `trip-`, strip the prefix, find the target trip, and return `getTripColumnId(targetTrip)`.
- Otherwise return `null`.

This would be a safe drop-in for the main board's final assignment branch and `handleDragOver` column derivation. It can also replace the widget's `trip-{id}` logic if the widget passes `resolveWidgetColumnId` as `getTripColumnId`.

Hidden risk: the main board's column-reorder branch currently initializes `targetColumnId = overStr` and then validates with `effectiveColumns`. Replacing it with the shared resolver is likely safe, but should be done carefully because column drags use `active.id` values prefixed with `column-`, while `over.id` is expected to be either a raw column id or `trip-{id}`. The resolver should not accept `column-{id}` as a target unless a future DnD change emits that shape for `over.id`.

Target file recommendation:

- Put the shared resolver in `src/features/trips/lib/kanban-dnd.ts`.
- Keep `getTripColumnId` as a board-local callback initially, or extract it separately as `getKanbanTripColumnId(trip, groupBy)` in `src/features/trips/lib/kanban-columns.ts` because it must stay in sync with `buildItemsByColumn`.

## groupLabels Computation

### 5. Main Board groupLabels Block

File: `src/features/trips/components/kanban/kanban-board.tsx`

Function: `TripsKanbanBoard`, `groupLabels` `useMemo`

Line range: 317-337

```tsx
  /** Maps group_id → "Gruppe 1", "Gruppe 2", … (ordered by earliest scheduled_at). */
  const groupLabels = useMemo(() => {
    const ids = [
      ...new Set(effectiveTrips.map((t) => t.group_id).filter(Boolean))
    ] as string[];
    const withMinTime = ids.map((gid) => {
      const groupTrips = effectiveTrips.filter((t) => t.group_id === gid);
      const minTime = Math.min(
        ...groupTrips.map((t) =>
          t.scheduled_at ? new Date(t.scheduled_at).getTime() : Infinity
        )
      );
      return { gid, minTime };
    });
    withMinTime.sort((a, b) => a.minTime - b.minTime);
    const map: Record<string, string> = {};
    withMinTime.forEach(({ gid }, i) => {
      map[gid] = `Gruppe ${i + 1}`;
    });
    return map;
  }, [effectiveTrips]);
```

### 6. Overview Widget groupLabels Block

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Function: `TripsOverviewWidgetBoard`, `groupLabels` `useMemo`

Line range: 77-96

```tsx
  const groupLabels = useMemo(() => {
    const ids = [
      ...new Set(trips.map((t) => t.group_id).filter(Boolean))
    ] as string[];
    const withMinTime = ids.map((gid) => {
      const groupTrips = trips.filter((t) => t.group_id === gid);
      const minTime = Math.min(
        ...groupTrips.map((t) =>
          t.scheduled_at ? new Date(t.scheduled_at).getTime() : Infinity
        )
      );
      return { gid, minTime };
    });
    withMinTime.sort((a, b) => a.minTime - b.minTime);
    const map: Record<string, string> = {};
    withMinTime.forEach(({ gid }, i) => {
      map[gid] = `Gruppe ${i + 1}`;
    });
    return map;
  }, [trips]);
```

### 7. groupLabels Comparison

The logic is identical:

- Same group id collection: unique truthy `group_id` values.
- Same per-group sort key: minimum `scheduled_at` timestamp, with missing `scheduled_at` mapped to `Infinity`.
- Same ascending sort.
- Same output type: `Record<string, string>`.
- Same label format: `Gruppe ${i + 1}`.

The only input difference is the array source: the main board passes `effectiveTrips` while the widget passes `trips`. That does not affect extraction because both are `KanbanTrip[]`.

Safe pure extraction:

```ts
export function buildGroupLabels(trips: KanbanTrip[]): Record<string, string>;
```

Recommended target file:

- `src/features/trips/lib/kanban-grouping.ts`

This file already owns group-related pure utilities and imports only type-level Kanban types plus the pure trip-assignee helper used by `deriveStatusForPending`.

## Sensor Configuration

### 8. Main Board useSensors Block

File: `src/features/trips/components/kanban/kanban-board.tsx`

Function: `TripsKanbanBoard`

Line range: 201-207

```tsx
  // ── DnD sensors ─────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 }
    })
  );
```

### 9. Overview Widget useSensors Block

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Function: `TripsOverviewWidgetBoard`

Line range: 57-62

```tsx
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 }
    })
  );
```

### 10. Sensor Comparison

The activation constraints are identical:

- Same sensor types: `MouseSensor`, `TouchSensor`.
- Same mouse activation: `{ distance: 5 }`.
- Same touch activation: `{ delay: 120, tolerance: 8 }`.
- No keyboard sensor in either board.
- No difference in delay, distance, or tolerance.

Safe hook extraction:

```ts
export function useKanbanSensors(): SensorDescriptor<SensorOptions>[];
```

The exact return type should be taken from `@dnd-kit/core` types during implementation. If the inferred return type is simpler and avoids brittle generic imports, the function can omit an explicit return type.

Recommended target file:

- `src/features/trips/hooks/use-kanban-sensors.ts`

Rationale: it calls React/dnd-kit hooks (`useSensors`, `useSensor`) and therefore should live with other feature hooks, not in `lib/`.

## Extraction Safety

### 11. Direct Imports and Third Copies

Read-only searches across `src/features/trips/` found these direct or indirect board references:

- `src/features/trips/components/kanban/index.ts` re-exports `TripsKanbanBoard` from `./kanban-board`.
- `src/features/trips/components/trips-kanban-board.tsx` re-exports `TripsKanbanBoard` from `./kanban`.
- `src/features/trips/components/trips-listing.tsx` imports `TripsKanbanBoard` from `./trips-kanban-board`.
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-dialog.tsx` imports `TripsOverviewWidgetBoard` from `./trips-overview-widget-board`.
- `src/features/trips/stores/use-kanban-pending-store.ts` mentions `kanban-board.tsx` and `TripsKanbanBoard` in comments only.

No files import implementation details from `src/features/trips/components/kanban/kanban-board.tsx` directly except the local barrel re-export. No files import implementation details from `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx` except the dialog rendering the component.

Third-copy search results:

- Target-resolution duplication was found only in `kanban-board.tsx`, `trips-overview-widget-board.tsx`, and the already-shared widget helper `resolveWidgetColumnId` in `widget-columns.ts`.
- `groupLabels` construction was found only in `kanban-board.tsx` and `trips-overview-widget-board.tsx`. Other files only receive or read the resulting `groupLabels` prop.
- The identical `MouseSensor` + `TouchSensor` configuration was found only in `kanban-board.tsx` and `trips-overview-widget-board.tsx`.
- `src/features/trips/components/ansichten-sheet.tsx` also calls `useSensors`, but it uses `PointerSensor` and `KeyboardSensor` for sortable view settings, with a different activation distance. It is unrelated and should not be included in the Kanban extraction.

### 12. kanban-grouping.ts Client/Server Boundary

File: `src/features/trips/lib/kanban-grouping.ts`

Line range: 1-13

```ts
/**
 * Trip grouping utilities for the Kanban board.
 *
 * chunkItemsByGroup  – splits a flat trip list into chronologically sorted
 *                      single-trip and multi-trip group chunks.
 *
 * deriveStatusForPending – computes the status that should be staged when a
 *                          driver assignment is changed on the board, so the
 *                          badge reflects the correct state before Save.
 */

import { getStatusWhenAssignmentChanges } from './trip-assignee';
import type { KanbanTrip, PendingChange } from './kanban-types';
```

`kanban-grouping.ts` has no `'use client'` directive and no browser-only imports. It imports a trip-assignee utility and type-only Kanban types. Its existing functions use plain JavaScript data structures and `Date`. Adding `buildGroupLabels` here does not introduce a client/server boundary issue.

One implementation note: `deriveStatusForPending` imports `getStatusWhenAssignmentChanges` from `trip-assignee`. If a future server context wants only `buildGroupLabels`, it will still load the module graph for `trip-assignee`. Based on the current file contents, there is no browser-only blocker.

### 13. Hook Location

Existing feature hook convention:

- Feature-scoped hooks live in `src/features/trips/hooks/`.
- Examples include `use-widget-trip-assignment.ts`, `use-trips-overview-widget.ts`, `use-trip-form-data.ts`, `use-trip-field-update.ts`, and query/mutation hooks.

Recommended location for the shared DnD sensor hook:

- `src/features/trips/hooks/use-kanban-sensors.ts`

Reason:

- It is a hook and must follow hook naming.
- It calls `useSensors` and `useSensor`.
- `lib/` currently contains pure utility modules such as `kanban-columns.ts`, `kanban-grouping.ts`, and `widget-columns.ts`. A hook in `lib/` would blur that convention.

## Senior Recommendation

### Safe Pure Drop-Ins

1. `groupLabels` extraction is safe.

- Add `buildGroupLabels(trips: KanbanTrip[]): Record<string, string>` to `src/features/trips/lib/kanban-grouping.ts`.
- Replace both `useMemo` bodies with `useMemo(() => buildGroupLabels(effectiveTrips), [effectiveTrips])` and `useMemo(() => buildGroupLabels(trips), [trips])`.
- This is a pure drop-in with zero behavior change.

2. Sensor extraction is safe.

- Add `useKanbanSensors()` to `src/features/trips/hooks/use-kanban-sensors.ts`.
- Replace both identical local `useSensors` blocks.
- This is behavior-preserving as long as the hook keeps the exact same `MouseSensor` and `TouchSensor` activation constraints.

3. Drop target resolver extraction is possible, but should be treated with more care than the other two.

- Add a generic resolver to `src/features/trips/lib/kanban-dnd.ts`.
- Pass the caller-specific trip-to-column function into the resolver.
- Main board should pass a `groupBy`-aware derivation.
- Widget should pass `resolveWidgetColumnId`.

Recommended resolver shape:

```ts
export function resolveKanbanDropColumnId(args: {
  overId: string | number;
  columns: KanbanColumn[];
  trips: KanbanTrip[];
  getTripColumnId: (trip: KanbanTrip) => string;
}): string | null {
  const overStr = String(args.overId);
  if (args.columns.some((column) => column.id === overStr)) return overStr;
  if (!overStr.startsWith('trip-')) return null;
  const targetTripId = overStr.replace(/^trip-/, '');
  const targetTrip = args.trips.find((trip) => trip.id === targetTripId);
  return targetTrip ? args.getTripColumnId(targetTrip) : null;
}
```

Hidden risk:

- The main board's trip-to-column derivation must remain exactly aligned with `buildItemsByColumn`.
- The widget's derivation intentionally differs from the main board because it is driver-only and forces Fremdfirma trips into `unassigned`.
- Do not hard-code `groupBy` behavior into the shared resolver. Keep derivation strategy injected.
- Do not change null/early-return behavior in the same commit as the extraction.

### Recommended Target Files

- `buildGroupLabels`: `src/features/trips/lib/kanban-grouping.ts`
- `resolveKanbanDropColumnId`: `src/features/trips/lib/kanban-dnd.ts`
- `useKanbanSensors`: `src/features/trips/hooks/use-kanban-sensors.ts`
- Optional follow-up: `getKanbanTripColumnId(trip, groupBy)` in `src/features/trips/lib/kanban-columns.ts`, because it must stay synchronized with `buildItemsByColumn`.

### Recommended Extraction Order

1. Extract `buildGroupLabels` first. It is pure, identical, and lowest risk.
2. Extract `useKanbanSensors` second. It is identical and isolated, but it introduces a new hook import and should be kept separate from pure utility extraction.
3. Extract `resolveKanbanDropColumnId` third. Use the generic injected-derivation signature and replace one branch at a time:
   - main board final trip/group assignment branch,
   - main board drag-over hover resolution if desired,
   - widget drag-end target resolution,
   - main board column-reorder branch only after confirming `over.id` shapes are unchanged.
4. Only after the resolver is stable, consider extracting `getKanbanTripColumnId(trip, groupBy)` from the main board to remove the remaining duplicated inline ternary with `buildItemsByColumn`.

