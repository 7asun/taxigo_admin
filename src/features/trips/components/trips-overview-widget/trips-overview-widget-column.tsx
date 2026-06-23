'use client';

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

interface TripsOverviewWidgetColumnProps {
  column: WidgetColumn;
  items: KanbanTrip[];
  groupLabels: Record<string, string>;
  onCardClick?: (trip: KanbanTrip) => void;
}

const noopTimeChange: OnTimeChange = () => {};
const noopStopOrderChange: OnStopOrderChange = () => {};
const noopUngroup: OnUngroup = () => {};

/**
 * One driver column in the widget board — reuses Kanban card/header visuals.
 * Grouped trips stay disableDrag to preserve group integrity (group drag deferred to v3).
 */
export function TripsOverviewWidgetColumn({
  column,
  items,
  groupLabels,
  onCardClick
}: TripsOverviewWidgetColumnProps) {
  const droppableId = column.id ?? 'unassigned';
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <div className='bg-muted/40 flex h-full w-[17rem] min-w-[200px] shrink-0 flex-col rounded-lg border'>
      <div className='shrink-0'>
        <KanbanDriverColumnHeader
          title={column.title}
          subtitle={column.subtitle}
          tripCount={items.length}
          dayContext={column.dayContext}
          isColumnDropTarget={false}
          listeners={undefined}
          attributes={{} as DraggableAttributes}
        />
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 px-2 pt-2 pb-8',
          isOver && 'ring-primary/40 ring-2'
        )}
      >
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
      </div>
    </div>
  );
}
