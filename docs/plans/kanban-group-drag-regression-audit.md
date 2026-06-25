# Kanban Group Drag Regression Audit

## Files Read

- `src/features/trips/components/kanban/kanban-board.tsx`
- `src/features/trips/components/kanban/kanban-group-container.tsx`
- `src/features/trips/components/kanban/kanban-column.tsx`
- `src/features/trips/lib/kanban-columns.ts`

## 1. Group Drag Data

Group drags are registered in `src/features/trips/components/kanban/kanban-group-container.tsx`, lines 44-56:

```48:56:src/features/trips/components/kanban/kanban-group-container.tsx
  } = useDraggable({
    id: `group-${groupId ?? 'empty'}`,
    disabled: !hasGroup,
    data: hasGroup
      ? { groupId, tripIds: trips.map((t) => t.id) }
      : { groupId: null, tripIds: [] }
  });
```

For a group drag, `active.data.current` contains:

- `groupId`
- `tripIds`

It does **not** contain `columnId`.

That matters because card drags do include `columnId` in `TripCard`, but group drags do not. `GroupedTripsContainer` receives `columnId` as a prop at lines 22-39, and passes it to child `TripCard`s at lines 99-111, but it does not include `columnId` in the group draggable data.

## 2. `handleDragStart` Regression Check

`handleDragStart` is in `src/features/trips/components/kanban/kanban-board.tsx`, lines 354-358:

```354:358:src/features/trips/components/kanban/kanban-board.tsx
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    // why: Tracked so child cards can suppress their drop-target highlight when a cross-column drag passes over them.
    setActiveDragColumnId(event.active.data.current?.columnId ?? null);
  }, []);
```

For a group drag, `event.active.data.current?.columnId` is `undefined`, because the group draggable data only contains `{ groupId, tripIds }`. Therefore `activeDragColumnId` becomes `null`.

`handleDragStart` does not mutate `pendingChanges`, `effectiveTrips`, `itemsByColumn`, or any trip/group membership. It only sets:

- `activeDragId`
- `activeDragColumnId`

So `handleDragStart` itself does not remove the group or its trips. The missing `columnId` on group drag data only affects highlight context, not the data model.

## 3. `onDragOver` Regression Check

`handleDragOver` is in `src/features/trips/components/kanban/kanban-board.tsx`, lines 360-385:

```360:385:src/features/trips/components/kanban/kanban-board.tsx
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
    },
    [activeDragColumnId, effectiveColumns, effectiveTrips, getTripColumnId]
  );
```

Walkthrough for a group drag from Column A over a card in Column B:

1. `event.over?.id` is expected to be the child card droppable id, e.g. `trip-{targetTripId}`, because `pointerWithin` prefers the smallest droppable under the pointer.
2. `overId` is not `null`, does not start with `column-`, and does not start with `group-`, so the early `setDragOverColumnId(null)` branch does not run.
3. `effectiveColumns.some((column) => column.id === overId)` is false because `trip-{id}` is not a column id.
4. `overId.startsWith('trip-')` is true.
5. The handler extracts the target trip id, finds that trip in `effectiveTrips`, and resolves `hoveredColumnId` through `getTripColumnId(trip)`.
6. Since `activeDragColumnId` is `null` for group drags, `hoveredColumnId !== activeDragColumnId` is true.
7. `dragOverColumnId` is set to the target card's column id.

This is not unexpected for visuals. It causes the target column body to highlight for group drags over cards, which matches the desired highlight behavior. It does not mutate trip data, group data, or pending assignment data.

If `event.over?.id` starts with `group-`, the handler sets `dragOverColumnId` to `null` and returns. In the current rendered tree, group containers are draggable but not droppable, while their child cards are droppable, so card ids are the more relevant case.

## 4. `handleDragEnd` Group Branch

There is no separate explicit `if (isDraggingGroup) { ... }` block in `handleDragEnd` anymore. The group path is inside the extracted `applyColumnAssignment` helper and is reached by the final assignment branch in `handleDragEnd`.

The group-specific part of `applyColumnAssignment` is in `src/features/trips/components/kanban/kanban-board.tsx`, lines 387-440:

```387:440:src/features/trips/components/kanban/kanban-board.tsx
  const applyColumnAssignment = useCallback(
    (draggedId: string, targetColumnId: string) => {
      const isDraggingGroup = draggedId.startsWith('group-');
      const tripIdsToUpdate = isDraggingGroup
        ? effectiveTrips
            .filter((t) => t.group_id === draggedId.replace('group-', ''))
            .map((t) => t.id)
        : [draggedId];

      const draggedTrip = effectiveTrips.find((t) => t.id === draggedId);
      const isSingleTripLeavingGroup =
        !isDraggingGroup && !!draggedTrip?.group_id;

      const value =
        groupBy === 'driver'
          ? targetColumnId === 'unassigned'
            ? null
            : targetColumnId
          : groupBy === 'status'
            ? targetColumnId
            : targetColumnId === 'no_payer'
              ? null
              : targetColumnId;

      setPendingChanges((prev) => {
        const next = { ...prev };
        for (const id of tripIdsToUpdate) {
          const current = next[id] ?? {};
          if (groupBy === 'driver') {
            const newDriverId = value as string | null;
            current.driver_id = newDriverId;
            // Stage derived status immediately so the badge reflects truth.
            const derivedStatus = deriveStatusForPending(
              id,
              newDriverId,
              prev,
              trips
            );
            if (derivedStatus !== undefined) current.status = derivedStatus;
          } else if (groupBy === 'status') {
            current.status = value as string;
          } else if (groupBy === 'payer') {
            current.payer_id = value as string | null;
          }
          if (isSingleTripLeavingGroup && id === draggedId) {
            current.group_id = null;
            current.stop_order = null;
          }
          next[id] = current;
        }
        return next;
      });
    },
    [effectiveTrips, groupBy, trips]
  );
```

The call site for assignment, including group drags, is in `handleDragEnd`, lines 553-555:

```553:555:src/features/trips/components/kanban/kanban-board.tsx
      // 3. Trip/group → column: assignment
      const targetColumnId = overStr;
      applyColumnAssignment(draggedId, targetColumnId);
```

The new column guard is in the trip-to-trip grouping branch, lines 507-551:

```507:551:src/features/trips/components/kanban/kanban-board.tsx
      // 2. Trip → trip: grouping
      if (!isDraggingGroup && overStr.startsWith('trip-')) {
        const targetId = overStr.replace(/^trip-/, '');
        if (targetId === draggedId) return;

        const draggedTrip = effectiveTrips.find((t) => t.id === draggedId);
        const targetTrip = effectiveTrips.find((t) => t.id === targetId);
        if (!draggedTrip || !targetTrip) return;

        // why: Grouping across columns is not permitted — a cross-column card-on-card drop is silently promoted to a plain column move to prevent cards from ending up grouped but in different columns.
        if (getTripColumnId(draggedTrip) !== getTripColumnId(targetTrip)) {
          // Resolve the target column from the target trip — do not use overStr here,
          // because overStr is "trip-{id}" not a column id when the pointer lands on a card.
          const targetColumnId = getTripColumnId(targetTrip);
          applyColumnAssignment(draggedId, targetColumnId);
          return;
        }

        const targetGroupId = targetTrip.group_id ?? crypto.randomUUID();
        const groupTrips = effectiveTrips.filter(
          (t) =>
            (t.group_id ?? (t.id === targetId ? targetGroupId : null)) ===
            targetGroupId
        );
        const maxStop = targetTrip.group_id
          ? Math.max(...groupTrips.map((t) => t.stop_order ?? 0), 0)
          : 1;
        const newStopOrder = maxStop + 1;

        setPendingChanges((prev) => {
          const next = { ...prev };
          const draggedChange = next[draggedId] ?? {};
          draggedChange.group_id = targetGroupId;
          draggedChange.stop_order = newStopOrder;
          next[draggedId] = draggedChange;
          if (!targetTrip.group_id) {
            const targetChange = next[targetId] ?? {};
            targetChange.group_id = targetGroupId;
            targetChange.stop_order = 1;
            next[targetId] = targetChange;
          }
          return next;
        });
        return;
      }
```

Because the branch is guarded by `!isDraggingGroup`, group drags never enter this branch. Therefore:

- The column guard is not called for group drags.
- `getTripColumnId` is not called from the guard for group drags.
- The guard's early returns cannot directly interfere with group drags.

However, the final assignment branch still passes `overStr` directly as `targetColumnId`. For a group dropped over a card, `overStr` is `trip-{targetTripId}`, not a column id. That value then becomes the assignment value for all group members.

## 5. `effectiveTrips` During Group Drag

`effectiveTrips` is built in `src/features/trips/components/kanban/kanban-board.tsx`, lines 209-222:

```209:222:src/features/trips/components/kanban/kanban-board.tsx
  /**
   * Server `trips` (from RSC) merged with **staged** `pendingChanges`. A background
   * `refreshTripsPage()` updates `trips` only — unsaved edits in `pendingChanges` stay
   * until Speichern/Verwerfen (they are not wiped by RSC refresh).
   */
  const effectiveTrips = useMemo(
    () =>
      trips.map((trip) => {
        const override = pendingChanges[trip.id];
        if (!override) return trip;
        return { ...trip, ...override };
      }),
    [trips, pendingChanges]
  );
```

`effectiveTrips` depends only on:

- `trips`
- `pendingChanges`

It does not depend on:

- `activeDragId`
- `activeDragColumnId`
- `dragOverColumnId`

The follow-up filtering for visible trips is in lines 224-236:

```224:236:src/features/trips/components/kanban/kanban-board.tsx
  // Internal planning only — Fremdfirma trips are delegated externally.
  const hiddenFremdfirmaCount = useMemo(
    () => effectiveTrips.filter((trip) => isTripFremdfirma(trip)).length,
    [effectiveTrips]
  );

  const visibleTrips = useMemo(
    () =>
      effectiveTrips.filter(
        (trip) => trip.status !== 'cancelled' && !isTripFremdfirma(trip)
      ),
    [effectiveTrips]
  );
```

This also does not use `activeDragId`, `activeDragColumnId`, or `dragOverColumnId`.

So all member trips are still present during the drag unless they were already hidden by status/fremdfirma logic. The new drag-start and drag-over state does not remove or filter them.

## 6. Column Assignment for Groups

After `applyColumnAssignment` writes `pendingChanges`, the downstream column placement comes from:

1. `effectiveTrips`, which merges `pendingChanges` into each trip, lines 209-222.
2. `visibleTrips`, lines 230-236.
3. `buildItemsByColumn(visibleTrips, columns, groupBy)`, lines 301-304 in `kanban-board.tsx`.
4. `buildItemsByColumn` itself, in `src/features/trips/lib/kanban-columns.ts`, lines 124-162.

Relevant `buildItemsByColumn` logic:

```124:162:src/features/trips/lib/kanban-columns.ts
export function buildItemsByColumn(
  trips: KanbanTrip[],
  columns: KanbanColumn[],
  groupBy: GroupByMode
): Record<string, KanbanTrip[]> {
  const itemsByColumn: Record<string, KanbanTrip[]> = {};

  for (const column of columns) {
    itemsByColumn[column.id] = [];
  }

  for (const trip of trips) {
    const columnId =
      groupBy === 'driver'
        ? (trip.driver_id ?? 'unassigned')
        : groupBy === 'status'
          ? trip.status
          : (trip.payer_id ?? 'no_payer');

    if (!itemsByColumn[columnId]) {
      itemsByColumn[columnId] = [];
    }
    itemsByColumn[columnId].push(trip);
  }

  const getSortPosition = (trip: KanbanTrip) => {
    if (trip.scheduled_at) return new Date(trip.scheduled_at).getTime();
    if (trip.link_type === 'return') return Infinity;
    return -1;
  };

  Object.keys(itemsByColumn).forEach((columnId) => {
    itemsByColumn[columnId].sort(
      (a, b) => getSortPosition(a) - getSortPosition(b)
    );
  });

  return itemsByColumn;
}
```

`buildItemsByColumn` can create an ad-hoc bucket for an unknown `columnId`, but `KanbanColumnView` is only rendered for `effectiveColumns` in `kanban-board.tsx`, lines 677-693:

```677:693:src/features/trips/components/kanban/kanban-board.tsx
          {effectiveColumns.map((column) => {
            const items = itemsByColumn[column.id] ?? [];
            return (
              <KanbanColumnView
                key={column.id}
                column={column}
                items={items}
                groupBy={groupBy}
                groupLabels={groupLabels}
                activeDragId={activeDragId}
                activeDragColumnId={activeDragColumnId}
                dragOverColumnId={dragOverColumnId}
                onTimeChange={onTimeChange}
                onStopOrderChange={onStopOrderChange}
                onUngroup={onUngroup}
```

Nothing downstream uses `activeDragColumnId` or `dragOverColumnId` to override or discard pending changes. The disappearance is more likely caused by invalid pending changes being written:

- Group dropped over a card gives `overStr = trip-{id}`.
- `handleDragEnd` passes `targetColumnId = overStr` to `applyColumnAssignment`.
- In driver mode, each member gets `driver_id = 'trip-{id}'`.
- `buildItemsByColumn` buckets those trips under `itemsByColumn['trip-{id}']`.
- No rendered column has id `trip-{id}`, so the group appears to disappear.

The same shape can happen in status or payer mode:

- Status mode can set `status = 'trip-{id}'`.
- Payer mode can set `payer_id = 'trip-{id}'`.

Those are invalid board column values and can place rows into an unrendered bucket.

## Senior Recommendation

### Most Likely Single Cause

The most likely single cause is the final assignment branch in `handleDragEnd` using `overStr` directly as the target column id for group drags:

```553:555:src/features/trips/components/kanban/kanban-board.tsx
      // 3. Trip/group → column: assignment
      const targetColumnId = overStr;
      applyColumnAssignment(draggedId, targetColumnId);
```

When a group is dropped over a target card, `pointerWithin` returns `trip-{targetTripId}`, not the column id. The group assignment helper then writes that `trip-{id}` string into the current grouping field for all group members. `buildItemsByColumn` can bucket those rows, but the board does not render an `effectiveColumn` with id `trip-{id}`, so the group disappears.

### Where the Fix Belongs

The fix is isolated to `handleDragEnd`, specifically the final trip/group assignment path. It does not belong in:

- `handleDragStart`: that only records drag identity/highlight context.
- `onDragOver`: that only drives highlight state and does not write assignments.
- Downstream memo code: `effectiveTrips`, `visibleTrips`, and `itemsByColumn` are behaving consistently with the data they receive.

### Minimal Change

Add target-column resolution before calling `applyColumnAssignment` in the final assignment branch. Reuse the same derivation already used in the column-reorder branch and the cross-column card guard:

- If `overStr` is an actual column id, use it.
- If `overStr.startsWith('trip-')`, find the target trip in `effectiveTrips` and use `getTripColumnId(targetTrip)`.
- If `overStr.startsWith('group-')` or cannot resolve, do not write assignment.

This restores group drag without touching:

- the working card-highlight behavior,
- the same-column card grouping guard,
- collision detection,
- sensors,
- `buildItemsByColumn`.

The minimal shape is to resolve `targetColumnId` in `handleDragEnd` immediately before `applyColumnAssignment(draggedId, targetColumnId)`, and return early if it cannot resolve to a real board column id.
