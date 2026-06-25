# Widget Grouped Container Audit

## Files Read

- `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-dialog.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-date-nav.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-reassign-drawer.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-trigger.tsx`
- `src/features/trips/components/trips-overview-widget/index.ts`
- `src/features/trips/components/kanban/kanban-group-container.tsx`
- `src/features/trips/components/kanban/kanban-column.tsx`
- `src/features/trips/lib/kanban-columns.ts`
- `src/features/trips/lib/kanban-types.ts`

Additional context read because it defines widget buckets and writes:

- `src/features/trips/lib/widget-columns.ts`
- `src/features/trips/hooks/use-widget-trip-assignment.ts`
- `src/features/trips/lib/kanban-grouping.ts`

## 1. Widget Board Structure

`TripsOverviewWidgetBoard` renders its own widget-specific columns. It does **not** reuse `KanbanColumnView`.

Board-level column rendering is in `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`, lines 151-190:

```151:190:src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className='min-h-0 flex-1 overflow-x-auto overflow-y-auto'>
          <div className='inline-flex min-h-full w-max flex-row gap-3 px-1 pb-2'>
            {columns.map((column) => (
              <TripsOverviewWidgetColumn
                key={column.id}
                column={column}
                items={itemsByColumn[column.id] ?? []}
                groupLabels={groupLabels}
                onCardClick={onCardClick}
              />
            ))}
          </div>
        </div>
        {/*
         * DragOverlay is a sibling to the scroll container (not nested inside it).
         * dnd-kit portals the overlay, but tree position under DndContext still matters.
         * groupLabels={{}} is safe: KanbanDragPreview only reads groupLabels when
         * activeId.startsWith('group-'); widget v2 drags plain trip UUIDs only.
         */}
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <KanbanDragPreview
              activeId={activeDragId}
              effectiveTrips={trips}
              groupLabels={{}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
```

The widget has its own column component: `TripsOverviewWidgetColumn` in `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`.

`TripsOverviewWidgetColumn` already imports `chunkItemsByGroup` from the shared grouping utility, but it currently flattens chunks back into individual `TripCard`s:

```13:20:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
} from '@/features/trips/lib/kanban-types';
import { chunkItemsByGroup } from '@/features/trips/lib/kanban-grouping';
import {
  isTripFremdfirma,
  resolveTripAssignee,
  type TripAssignee
} from '@/features/trips/lib/trip-assignee';
```

```72:136:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
        ) : (
          chunkItemsByGroup(items).map((chunk, chunkIdx) =>
            chunk.trips.map((trip) => {
              const isFremdfirma = isTripFremdfirma(trip);
              const isNonDraggable = isFremdfirma || Boolean(trip.group_id);
              const assignee: TripAssignee = isFremdfirma
                ? resolveTripAssignee({
                    driver_id: trip.driver_id,
                    fremdfirma_id: trip.fremdfirma_id,
                    fremdfirma: trip.fremdfirma_id
                      ? { name: 'Fremdfirma' }
                      : null
                  })
                : resolveTripAssignee({
                    driver_id: trip.driver_id,
                    driver: trip.driver?.name
                      ? { name: trip.driver.name }
                      : null,
                    fremdfirma_id: null
                  });
              const groupLabel =
                trip.group_id != null ? groupLabels[trip.group_id] : undefined;

              const card = (
                <TripCard
                  trip={trip}
                  columnId={column.id}
                  groupLabel={groupLabel}
                  disableDrag={isNonDraggable}
                  onTimeChange={noopTimeChange}
                  onStopOrderChange={noopStopOrderChange}
                  onUngroup={noopUngroup}
                />
              );

              return (
                <div
                  key={`${chunk.type}-${trip.id}-${chunkIdx}`}
                  className={cn(
                    'flex flex-col gap-1.5',
                    isFremdfirma && 'rounded-md border border-dashed opacity-75'
                  )}
                >
                  {onCardClick && !isNonDraggable ? (
                    <div
                      className='cursor-pointer md:cursor-default'
                      onClick={() => onCardClick(trip)}
                    >
                      {card}
                    </div>
                  ) : (
                    card
                  )}

                  {isFremdfirma ? (
                    <TripAssigneeBadge
                      assignee={assignee}
                      className='px-1 text-left'
                    />
                  ) : null}
                </div>
              );
            })
          )
        )}
```

So the widget currently has partial grouping awareness (`chunkItemsByGroup` plus `groupLabels`) but does not render grouped chunks as `GroupedTripsContainer`.

## 2. Widget Card Component

The widget uses the same shared `TripCard` from the main Kanban:

```3:8:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
import type { DraggableAttributes } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { TripAssigneeBadge } from '@/features/trips/components/trip-assignee-badge';
import { KanbanDriverColumnHeader } from '@/features/trips/components/kanban/kanban-driver-column-header';
import { TripCard } from '@/features/trips/components/kanban/kanban-trip-card';
```

The group badge is rendered inside `TripCard`, not in the widget column. `TripCard` renders the group badge when `isGrouped && groupLabel && !hideGroupBadge`, in `src/features/trips/components/kanban/kanban-trip-card.tsx`, lines 351-372:

```351:372:src/features/trips/components/kanban/kanban-trip-card.tsx
          {isGrouped && groupLabel && !hideGroupBadge && (
            <Badge
              variant='secondary'
              className='gap-0.5 px-1.5 py-0 text-[10px]'
            >
              <Users className='h-3 w-3' />
              {groupLabel}
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation();
                  onUngroup(trip.group_id!);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className='hover:bg-muted ml-0.5 rounded p-0.5'
                title='Gruppe auflösen'
                aria-label='Gruppe auflösen'
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          )}
```

The widget column passes `groupLabel` into each `TripCard`, lines 92-104:

```92:104:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
              const groupLabel =
                trip.group_id != null ? groupLabels[trip.group_id] : undefined;

              const card = (
                <TripCard
                  trip={trip}
                  columnId={column.id}
                  groupLabel={groupLabel}
                  disableDrag={isNonDraggable}
                  onTimeChange={noopTimeChange}
                  onStopOrderChange={noopStopOrderChange}
                  onUngroup={noopUngroup}
```

Currently grouped widget cards are individually rendered but set `disableDrag={true}` because `isNonDraggable = isFremdfirma || Boolean(trip.group_id)`.

## 3. Widget DnD Context

The widget has its own `DndContext` in `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`, lines 151-158:

```151:158:src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
```

It uses `pointerWithin`, same as the main Kanban.

The sensors are also equivalent in shape to the main Kanban:

```57:62:src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 }
    })
  );
```

The widget column itself only registers the column body droppable:

```44:46:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
  const droppableId = column.id ?? 'unassigned';
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
```

Card draggables/droppables come from the shared `TripCard`, which registers:

```115:129:src/features/trips/components/kanban/kanban-trip-card.tsx
  // ── DnD ───────────────────────────────────────────────────────────────────
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `trip-${trip.id}`
  });

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    isDragging
  } = useDraggable({
    id: trip.id,
    data: { tripId: trip.id, columnId }
  });
```

So individual widget cards use the same `useDraggable({ data: { tripId, columnId } })` shape when `disableDrag` is false.

The widget does **not** currently support grouping drag behavior. It only supports driver reassignment:

```102:124:src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx
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

Current grouped rows are explicitly ignored by `handleDragEnd` via `if (isTripFremdfirma(trip) || trip.group_id) return;`, and the widget column disables dragging for grouped individual cards.

If `GroupedTripsContainer` is introduced, its group header will register a draggable id of `group-{groupId}`:

```48:56:src/features/trips/components/kanban/kanban-group-container.tsx
  } = useDraggable({
    id: `group-${groupId ?? 'empty'}`,
    disabled: !hasGroup,
    data: hasGroup
      ? { groupId, tripIds: trips.map((t) => t.id) }
      : { groupId: null, tripIds: [] }
  });
```

The current widget `handleDragEnd` does not handle `group-{id}` at all: `const trip = trips.find((t) => t.id === tripId)` will return `undefined` for `tripId = "group-{id}"`, then `if (!trip) return`.

## 4. `GroupedTripsContainer` Compatibility

Current `GroupedTripsContainer` props in `src/features/trips/components/kanban/kanban-group-container.tsx`, lines 22-29:

```22:29:src/features/trips/components/kanban/kanban-group-container.tsx
export interface GroupedTripsContainerProps {
  trips: KanbanTrip[];
  groupLabel?: string;
  columnId: string;
  activeDragColumnId: string | null;
  onTimeChange: OnTimeChange;
  onStopOrderChange: OnStopOrderChange;
  onUngroup: OnUngroup;
}
```

The prompt omitted `activeDragColumnId`, but the current code requires it.

Widget equivalents:

- `trips`: yes, each `chunk.type === 'group'` has `chunk.trips`.
- `groupLabel`: yes, the board builds `groupLabels`, and the column receives it.
- `columnId`: yes, `TripsOverviewWidgetColumn` has `column.id`.
- `activeDragColumnId`: not currently tracked in widget board, but can be passed as `null` if the widget does not need same-column card highlight gating for group containers.
- `onTimeChange`: widget has no real time edit behavior, but already defines `noopTimeChange`.
- `onStopOrderChange`: widget has no real stop-order edit behavior, but already defines `noopStopOrderChange`.
- `onUngroup`: widget has no real ungroup behavior, but already defines `noopUngroup`.

The existing no-op callbacks are in `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`, lines 30-32:

```30:32:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
const noopTimeChange: OnTimeChange = () => {};
const noopStopOrderChange: OnStopOrderChange = () => {};
const noopUngroup: OnUngroup = () => {};
```

Important compatibility note: `GroupedTripsContainer` shows a visible "×" ungroup button in its header and calls `onUngroup(groupId)`, lines 82-96:

```82:96:src/features/trips/components/kanban/kanban-group-container.tsx
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation();
            onUngroup(groupId);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className='text-muted-foreground hover:text-foreground text-[10px]'
          title='Gruppe auflösen'
          aria-label='Gruppe auflösen'
        >
          ×
        </button>
```

Using `noopUngroup` will render an ungroup affordance that does nothing. That is technically compatible but poor UX. A minimal widget migration should either accept this as a temporary fallback or add a prop to hide the ungroup action. That latter option touches `GroupedTripsContainer`.

## 5. `chunkItemsByGroup` Availability

`chunkItemsByGroup` is **not** exported from `kanban-columns.ts`. `kanban-columns.ts` exports only:

- `buildColumns`
- `buildItemsByColumn`

See `src/features/trips/lib/kanban-columns.ts`, lines 23-28 and 124-128:

```23:28:src/features/trips/lib/kanban-columns.ts
export function buildColumns(
  trips: KanbanTrip[],
  groupBy: GroupByMode,
  drivers: { id: string; name: string }[],
  availabilityMap?: Map<string, DriverDayContext>
): KanbanColumn[] {
```

```124:128:src/features/trips/lib/kanban-columns.ts
export function buildItemsByColumn(
  trips: KanbanTrip[],
  columns: KanbanColumn[],
  groupBy: GroupByMode
): Record<string, KanbanTrip[]> {
```

`chunkItemsByGroup` lives in `src/features/trips/lib/kanban-grouping.ts`, lines 29-75:

```29:75:src/features/trips/lib/kanban-grouping.ts
export function chunkItemsByGroup(items: KanbanTrip[]): KanbanChunk[] {
  const groupMap = new Map<string, KanbanTrip[]>();
  const singles: KanbanTrip[] = [];

  for (const trip of items) {
    if (!trip.group_id) {
      singles.push(trip);
    } else {
      const existing = groupMap.get(trip.group_id) ?? [];
      existing.push(trip);
      groupMap.set(trip.group_id, existing);
    }
  }

  const getSortPosition = (t: KanbanTrip): number => {
    if (t.scheduled_at) return new Date(t.scheduled_at).getTime();
    if (t.link_type === 'return') return Infinity;
    return -1;
  };

  const blocks: {
    type: 'single' | 'group';
    trips: KanbanTrip[];
    position: number;
  }[] = [];

  for (const trip of singles) {
    blocks.push({
      type: 'single',
      trips: [trip],
      position: getSortPosition(trip)
    });
  }

  for (const groupTrips of groupMap.values()) {
    groupTrips.sort((a, b) => {
      if (a.stop_order != null && b.stop_order != null)
        return a.stop_order - b.stop_order;
      return getSortPosition(a) - getSortPosition(b);
    });
    const position = Math.min(...groupTrips.map(getSortPosition));
    blocks.push({ type: 'group', trips: groupTrips, position });
  }

  blocks.sort((a, b) => a.position - b.position);
  return blocks.map(({ type, trips }) => ({ type, trips }));
}
```

It is already imported in both:

- `KanbanColumnView`, `src/features/trips/components/kanban/kanban-column.tsx`, line 25.
- `TripsOverviewWidgetColumn`, `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`, line 14.

## 6. `groupLabels` Availability

The widget board already builds a `groupLabels` map equivalent to the main board's `groupLabels`.

In `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`, lines 77-96:

```77:96:src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx
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

The board passes `groupLabels` to each widget column at lines 161-168:

```161:168:src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx
            {columns.map((column) => (
              <TripsOverviewWidgetColumn
                key={column.id}
                column={column}
                items={itemsByColumn[column.id] ?? []}
                groupLabels={groupLabels}
                onCardClick={onCardClick}
              />
```

The widget column then resolves each card's label at lines 92-93:

```92:93:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
              const groupLabel =
                trip.group_id != null ? groupLabels[trip.group_id] : undefined;
```

So no new label concept is required.

## 7. Sizing and Scroll

The widget dialog is constrained and scrolls horizontally/vertically inside the board.

Dialog shell in `src/features/trips/components/trips-overview-widget/trips-overview-widget-dialog.tsx`, lines 257-263:

```257:263:src/features/trips/components/trips-overview-widget/trips-overview-widget-dialog.tsx
      <DialogContent
        className={cn(
          'flex h-full max-h-[100dvh] min-h-0 w-full max-w-none flex-col gap-0 overflow-hidden p-0',
          'fixed inset-0 h-[100dvh] translate-x-0 translate-y-0 rounded-none border-0',
          'sm:inset-auto sm:top-[50%] sm:left-[50%] sm:h-full sm:max-h-[85vh] sm:w-full sm:max-w-[90vw] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-0'
        )}
```

Board scroll container in `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`, lines 159-160:

```159:160:src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx
        <div className='min-h-0 flex-1 overflow-x-auto overflow-y-auto'>
          <div className='inline-flex min-h-full w-max flex-row gap-3 px-1 pb-2'>
```

Widget column sizing in `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`, line 48:

```48:48:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
    <div className='bg-muted/40 flex h-full w-[17rem] min-w-[200px] shrink-0 flex-col rounded-lg border'>
```

Column body constraints are lines 61-67:

```61:67:src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 px-2 pt-2 pb-8',
          isOver && 'ring-primary/40 ring-2'
        )}
      >
```

`GroupedTripsContainer` does not impose a hard width, min-height, or overflow. It is a flex column with padding and border:

```66:73:src/features/trips/components/kanban/kanban-group-container.tsx
    <div
      ref={setDraggableRef}
      style={dragStyle}
      className={cn(
        'border-primary/25 bg-primary/5 flex flex-col gap-1.5 rounded-lg border-2 p-1.5',
        isDragging && 'shadow-none'
      )}
```

The child `TripCard`s do not hardcode width either; they fill the parent width. Therefore `GroupedTripsContainer` can likely fit inside the widget's `w-[17rem]` column as-is.

The main sizing issue is not width; it is interaction surface:

- `GroupedTripsContainer` adds a group header row and border/padding, making grouped blocks taller than flat cards.
- In a compact dialog, that increases vertical scroll. The widget already has `overflow-y-auto`, so this is probably acceptable.
- The ungroup `×` button is visible even if `onUngroup` is a no-op.

## Senior Recommendation

### Minimal Changes Needed

The minimal rendering change is in `TripsOverviewWidgetColumn`:

- Keep `chunkItemsByGroup(items)`.
- For `chunk.type === 'single'`, render the existing single-card path.
- For `chunk.type === 'group'`, render `GroupedTripsContainer` with:
  - `trips={chunk.trips}`
  - `groupLabel={chunk.trips[0]?.group_id ? groupLabels[chunk.trips[0].group_id] : undefined}`
  - `columnId={column.id}`
  - `activeDragColumnId={null}` unless the widget starts tracking it like the main board.
  - existing no-op callbacks for time, stop order, and ungroup, or real widget callbacks if desired.

But rendering alone is not enough if the goal includes "group moves" via DnD.

The minimal DnD support changes are in `TripsOverviewWidgetBoard`:

- `handleDragStart` can keep tracking `activeDragId`.
- `handleDragEnd` must recognize `active.id` values that start with `group-`.
- For `group-{groupId}`, find at least one representative trip from `trips` with that `group_id`.
- Resolve target column from either:
  - column id directly, or
  - `trip-{id}` via `resolveWidgetColumnId(targetTrip)`.
- Call `onAssign(representativeTrip, newDriverId)`.

This works with the existing `useWidgetTripAssignment` behavior, because that hook already updates all rows with the same `group_id` when `trip.group_id` is present:

```24:40:src/features/trips/hooks/use-widget-trip-assignment.ts
  const mutation = useMutation({
    mutationFn: async ({ trip, newDriverId }: AssignDriverInput) => {
      const patch = buildAssignmentPatch(trip, { driver_id: newDriverId });

      if (trip.group_id) {
        const supabase = createClient();
        const { error } = await supabase
          .from('trips')
          .update(patch)
          .eq('group_id', trip.group_id);

        if (error) throw error;
        return;
      }

      await tripsService.updateTrip(trip.id, patch);
    },
```

### Does `GroupedTripsContainer` Need Changes?

For visual rendering, `GroupedTripsContainer` can be used mostly as-is. It has no hardcoded width or overflow assumptions that conflict with the widget.

For good widget UX, one adjustment is advisable:

- Add an optional way to hide or disable the ungroup `×` action, because the widget currently has no ungroup behavior and a no-op button is misleading.

That is not strictly required for a technical first pass if `noopUngroup` is accepted, but it is the main prop/UX mismatch.

One more compatibility note: current `GroupedTripsContainer` group draggable data does not include `columnId`, lines 48-56. If the widget wants the same drag-origin highlight behavior as the main board, it would need either:

- group draggable data to include `columnId`, or
- widget drag logic that does not rely on `active.data.current?.columnId`.

For simple group moves, this is not required.

### Prop Gaps

The widget already has fallback callbacks:

- `noopTimeChange`
- `noopStopOrderChange`
- `noopUngroup`

It already has:

- `groupLabels`
- `column.id`
- `chunk.trips`

The only current prop not explicitly present in widget state is `activeDragColumnId`. It can be passed as `null` for a minimal migration.

The bigger behavioral gap is not props; it is `TripsOverviewWidgetBoard.handleDragEnd`, which currently assumes `active.id` is a trip id and ignores grouped trips:

```107:110:src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx
    const tripId = String(active.id);
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    if (isTripFremdfirma(trip) || trip.group_id) return;
```

This must be changed before `GroupedTripsContainer` group drags can work.

### Correct Order of Changes

1. Update `TripsOverviewWidgetBoard.handleDragEnd` to safely resolve both trip ids and `group-{id}` active ids, while preserving current single-card reassignment behavior.
2. Resolve drop targets defensively, same as the main Kanban: column id directly, or `trip-{id}` to that target trip's widget column via `resolveWidgetColumnId`.
3. In `TripsOverviewWidgetColumn`, change rendering so `chunk.type === 'group'` renders `GroupedTripsContainer` instead of flattening all `chunk.trips`.
4. Keep single-card rendering unchanged for `chunk.type === 'single'`, including Fremdfirma badge handling.
5. Decide how to handle the visible ungroup button:
   - quick migration: pass `noopUngroup`;
   - cleaner migration: add an optional `showUngroupAction` or similar prop to `GroupedTripsContainer`.
6. Only after that, consider parity improvements such as active drag column context, widget column highlight parity for group drags, or DragOverlay labels for `group-{id}`.

This order avoids breaking existing widget DnD because the board will understand group drags before the column starts emitting `group-{id}` drag events through `GroupedTripsContainer`.
