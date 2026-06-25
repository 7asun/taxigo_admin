'use client';

import { useCallback, useMemo, useState } from 'react';
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core';
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent
} from '@dnd-kit/core';
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

type DriverRow = Pick<
  Database['public']['Tables']['accounts']['Row'],
  'id' | 'name'
>;

interface TripsOverviewWidgetBoardProps {
  trips: KanbanTrip[];
  drivers: DriverRow[];
  selectedDriverIds: string[];
  isLoading: boolean;
  isError: boolean;
  onAssign: (trip: KanbanTrip, newDriverId: string | null) => void;
  onCardClick?: (trip: KanbanTrip) => void;
}

const UNASSIGNED_COLUMN_ID = 'unassigned';

/**
 * Horizontal driver-column board for one calendar day with DnD reassignment.
 */
export function TripsOverviewWidgetBoard({
  trips,
  drivers,
  selectedDriverIds,
  isLoading,
  isError,
  onAssign,
  onCardClick
}: TripsOverviewWidgetBoardProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // why: pointerWithin prefers child trip droppables over the column body, so
  // the widget must track the resolved hover column manually to keep drop
  // feedback aligned with the actual reassignment outcome.
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const sensors = useKanbanSensors();

  const columns = useMemo(() => {
    const allColumns = buildWidgetColumns(trips, drivers);
    const selected = new Set(selectedDriverIds);
    return allColumns.filter(
      (column) => column.id === UNASSIGNED_COLUMN_ID || selected.has(column.id)
    );
  }, [trips, drivers, selectedDriverIds]);

  const itemsByColumn = useMemo(
    () => buildWidgetItemsByColumn(trips, columns),
    [trips, columns]
  );

  const groupLabels = useMemo(() => buildGroupLabels(trips), [trips]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  // why: The widget only supports column reassignment, not card-on-card grouping.
  // Resolve the hovered column from either a raw column droppable or a trip-{id}
  // droppable so column feedback remains stable while dragging over cards.
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overId = event.over?.id == null ? null : String(event.over.id);

      if (!overId || overId.startsWith('group-')) {
        setDragOverColumnId(null);
        return;
      }

      const hoveredColumnId = resolveKanbanDropColumnId({
        overId,
        columns,
        trips,
        getTripColumnId: resolveWidgetColumnId
      });

      setDragOverColumnId(hoveredColumnId);
    },
    [columns, trips]
  );

  const handleDragCancel = () => {
    setActiveDragId(null);
    setDragOverColumnId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    setDragOverColumnId(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const isGroupDrag = activeId.startsWith('group-');

    // why: overStr may be a column id or trip-{id}; resolveKanbanDropColumnId
    // handles both cases so group members are never written to an unrendered bucket.
    const resolvedColumnId = resolveKanbanDropColumnId({
      overId: over.id,
      columns,
      trips,
      getTripColumnId: resolveWidgetColumnId
    });
    if (!resolvedColumnId) return;

    const newDriverId =
      resolvedColumnId === 'unassigned' ? null : resolvedColumnId;

    if (isGroupDrag) {
      // why: GroupedTripsContainer emits group-{groupId} as active.id.
      // useWidgetTripAssignment already updates all rows sharing the same
      // group_id when the representative trip has group_id set.
      const groupId = activeId.replace(/^group-/, '');
      const representativeTrip = trips.find(
        (t) => t.group_id === groupId && !isTripFremdfirma(t)
      );
      if (!representativeTrip) return;
      if (representativeTrip.driver_id === newDriverId) return;
      onAssign(representativeTrip, newDriverId);
      return;
    }

    // Existing single-trip path — preserved exactly.
    const trip = trips.find((t) => t.id === activeId);
    if (!trip) return;
    if (isTripFremdfirma(trip) || trip.group_id) return;
    if (trip.driver_id === newDriverId) return;
    onAssign(trip, newDriverId);
  };

  if (isLoading) {
    return (
      <div className='text-muted-foreground flex min-h-0 flex-1 items-center justify-center gap-2 text-sm'>
        <Loader2 className='h-4 w-4 animate-spin' />
        Fahrten werden geladen…
      </div>
    );
  }

  if (isError) {
    return (
      <div className='text-destructive flex min-h-0 flex-1 items-center justify-center text-sm'>
        Fahrten konnten nicht geladen werden.
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className='text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-sm'>
        Keine Fahrten für diesen Tag geplant
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={handleDragCancel}
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
                dragOverColumnId={dragOverColumnId}
                onCardClick={onCardClick}
              />
            ))}
          </div>
        </div>
        {/* DragOverlay is a sibling to the scroll container (not nested inside it). */}
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            // why: Group drags now exist in the widget, so the overlay must receive the
            // real groupLabels map to render the same numbered preview label as the main board.
            <KanbanDragPreview
              activeId={activeDragId}
              effectiveTrips={trips}
              groupLabels={groupLabels}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
