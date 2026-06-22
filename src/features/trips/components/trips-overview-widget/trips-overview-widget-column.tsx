'use client';

import type { DraggableAttributes } from '@dnd-kit/core';
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
}

const noopTimeChange: OnTimeChange = () => {};
const noopStopOrderChange: OnStopOrderChange = () => {};
const noopUngroup: OnUngroup = () => {};

/**
 * One driver column in the widget board — reuses Kanban card/header visuals.
 * Driver reassignment is deferred to v2 DnD (`useWidgetTripAssignment` + onDragEnd).
 */
export function TripsOverviewWidgetColumn({
  column,
  items,
  groupLabels
}: TripsOverviewWidgetColumnProps) {
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

      <div className='flex min-h-0 flex-1 flex-col gap-2 px-2 pt-2 pb-8'>
        {items.length === 0 ? (
          <div className='text-muted-foreground flex flex-1 items-center justify-center text-xs'>
            Keine Fahrten
          </div>
        ) : (
          chunkItemsByGroup(items).map((chunk, chunkIdx) =>
            chunk.trips.map((trip) => {
              const isFremdfirma = isTripFremdfirma(trip);
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

              return (
                <div
                  key={`${chunk.type}-${trip.id}-${chunkIdx}`}
                  className={cn(
                    'flex flex-col gap-1.5',
                    isFremdfirma && 'rounded-md border border-dashed opacity-75'
                  )}
                >
                  <TripCard
                    trip={trip}
                    columnId={column.id}
                    groupLabel={groupLabel}
                    disableDrag
                    onTimeChange={noopTimeChange}
                    onStopOrderChange={noopStopOrderChange}
                    onUngroup={noopUngroup}
                  />

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
