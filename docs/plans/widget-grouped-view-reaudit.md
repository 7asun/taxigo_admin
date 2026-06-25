# Widget Grouped View Re-Audit

**Status: Implemented** (2026-06-25).

Changed files:

- `src/features/trips/components/kanban/kanban-group-container.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`

## Scope

Read-only re-audit of the overview widget grouped-trip rendering state.

Files read completely before writing this document:

- `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`
- `src/features/trips/components/kanban/kanban-group-container.tsx`
- `src/features/trips/lib/kanban-grouping.ts`

## 1. `kanban-group-container.tsx` current state

File: `src/features/trips/components/kanban/kanban-group-container.tsx`

Function/component: `GroupedTripsContainer`

### Props interface

Line range: 22-30

```tsx
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

Finding: `GroupedTripsContainerProps` does **not** currently include `hideUngroupAction?: boolean`.

### Ungroup button JSX

Line range: 84-96

```tsx
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

Finding: the `×` ungroup button is **not** wrapped in a `!hideUngroupAction` conditional. It is always rendered when the group header renders.

## 2. `trips-overview-widget-column.tsx` current state

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`

Function/component: `TripsOverviewWidgetColumn`

### Chunk rendering block

Line range: 68-136

```tsx
        {items.length === 0 ? (
          <div className='text-muted-foreground flex flex-1 items-center justify-center text-xs'>
            Keine Fahrten
          </div>
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

Finding: the widget column still flattens every chunk into individual `TripCard` renders by calling `chunk.trips.map(...)`. It does **not** branch on `chunk.type === 'group'` and does **not** render `GroupedTripsContainer` for grouped chunks.

Additional note: grouped trips are explicitly made non-draggable by `const isNonDraggable = isFremdfirma || Boolean(trip.group_id);` and each `TripCard` receives `disableDrag={isNonDraggable}`.

## 3. `trips-overview-widget-board.tsx` current state

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Function/component: `TripsOverviewWidgetBoard`

Nested function: `handleDragEnd`

Line range: 77-99

```tsx
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const tripId = String(active.id);
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    if (isTripFremdfirma(trip) || trip.group_id) return;

    const resolvedColumnId = resolveKanbanDropColumnId({
      overId: over.id,
      columns,
      trips,
      getTripColumnId: resolveWidgetColumnId
    });
    if (!resolvedColumnId) return;

    const newDriverId =
      resolvedColumnId === 'unassigned' ? null : resolvedColumnId;
    if (trip.driver_id === newDriverId) return;
    onAssign(trip, newDriverId);
  };
```

Finding: `handleDragEnd` does **not** currently handle `active.id` values starting with `group-`.

Current behavior:

- It always treats `active.id` as a plain trip id via `const tripId = String(active.id)`.
- If `active.id` is `group-{id}`, `trips.find((t) => t.id === tripId)` will not find a trip, so the handler returns at `if (!trip) return;`.
- Even for a real trip id, grouped trips are blocked by `if (isTripFremdfirma(trip) || trip.group_id) return;`.

## 4. Imports

### `trips-overview-widget-column.tsx`

Line range: 3-21

```tsx
import type { DraggableAttributes } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { TripAssigneeBadge } from '@/features/trips/components/trip-assignee-badge';
import { KanbanDriverColumnHeader } from '@/features/trips/components/kanban/kanban-driver-column-header';
import { TripCard } from '@/features/trips/components/kanban/kanban-trip-card';
import type {
  KanbanTrip,
  OnStopOrderChange,
  OnTimeChange,
  OnUngroup
} from '@/features/trips/lib/kanban-types';
import { chunkItemsByGroup } from '@/features/trips/lib/kanban-grouping';
import {
  isTripFremdfirma,
  resolveTripAssignee,
  type TripAssignee
} from '@/features/trips/lib/trip-assignee';
import type { WidgetColumn } from '@/features/trips/lib/widget-columns';
import { cn } from '@/lib/utils';
```

Finding: `trips-overview-widget-column.tsx` does **not** import `GroupedTripsContainer`.

### `trips-overview-widget-board.tsx`

Line range: 3-23

```tsx
import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import type { Database } from '@/types/database.types';
import { KanbanDragPreview } from '@/features/trips/components/kanban/kanban-drag-preview';
import { useKanbanSensors } from '@/features/trips/hooks/use-kanban-sensors';
import type { KanbanTrip } from '@/features/trips/lib/kanban-types';
import { isTripFremdfirma } from '@/features/trips/lib/trip-assignee';
import { buildGroupLabels } from '@/features/trips/lib/kanban-grouping';
import { resolveKanbanDropColumnId } from '@/features/trips/lib/kanban-dnd';
import {
  buildWidgetColumns,
  buildWidgetItemsByColumn,
  resolveWidgetColumnId
} from '@/features/trips/lib/widget-columns';
import { TripsOverviewWidgetColumn } from './trips-overview-widget-column';
```

Finding: `trips-overview-widget-board.tsx` imports shared DnD utilities (`useKanbanSensors`, `resolveKanbanDropColumnId`) but does **not** import anything specifically related to group drag handling. There is no helper import for resolving `group-{id}` active ids or expanding a group id into trip ids.

## Summary

The grouped-trip widget rendering plan has not been applied in the current code state:

1. `GroupedTripsContainer` has no `hideUngroupAction?: boolean` prop and always renders the `×` ungroup button.
2. `TripsOverviewWidgetColumn` still renders grouped chunks as flat individual `TripCard`s with group badges.
3. `TripsOverviewWidgetBoard.handleDragEnd` still handles only plain trip ids and returns for `group-{id}` active ids.
4. The widget column does not import `GroupedTripsContainer`, and the widget board has no group-drag-specific imports or logic.

