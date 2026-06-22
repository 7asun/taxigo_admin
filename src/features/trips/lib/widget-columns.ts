/**
 * Widget-specific column builder over the shared Kanban column utilities.
 *
 * WHY adapter instead of forking `buildColumns`: the widget reuses driver column
 * titles and orphan handling but must keep Fremdfirma trips visible in
 * „Nicht zugewiesen“ rather than hiding them like the full Kanban board.
 */

import { buildColumns } from '@/features/trips/lib/kanban-columns';
import type {
  GroupByMode,
  KanbanColumn,
  KanbanTrip
} from '@/features/trips/lib/kanban-types';
import { isTripFremdfirma } from '@/features/trips/lib/trip-assignee';

export type WidgetColumn = KanbanColumn;

const WIDGET_GROUP_BY: GroupByMode = 'driver';
const UNASSIGNED_COLUMN_ID = 'unassigned';

/** Trips used for column definitions — Fremdfirma rows must not create driver buckets. */
function tripsForColumnDefinitions(trips: KanbanTrip[]): KanbanTrip[] {
  return trips.map((trip) =>
    isTripFremdfirma(trip) ? { ...trip, driver_id: null } : trip
  );
}

function earliestScheduledAtMs(trips: KanbanTrip[]): number {
  let min = Infinity;
  for (const trip of trips) {
    if (!trip.scheduled_at) continue;
    const ms = new Date(trip.scheduled_at).getTime();
    if (ms < min) min = ms;
  }
  return min;
}

function sortDriverColumnsByEarliestTrip(
  columns: KanbanColumn[],
  itemsByColumn: Record<string, KanbanTrip[]>
): KanbanColumn[] {
  const unassigned = columns.find((c) => c.id === UNASSIGNED_COLUMN_ID);
  const driverColumns = columns.filter(
    (c) => c.id !== UNASSIGNED_COLUMN_ID && c.title !== 'Fahrer (unbekannt)'
  );
  const orphanColumns = columns.filter((c) => c.title === 'Fahrer (unbekannt)');

  driverColumns.sort((a, b) => {
    const aEarliest = earliestScheduledAtMs(itemsByColumn[a.id] ?? []);
    const bEarliest = earliestScheduledAtMs(itemsByColumn[b.id] ?? []);
    const aHasTrips = Number.isFinite(aEarliest);
    const bHasTrips = Number.isFinite(bEarliest);

    if (aHasTrips && bHasTrips && aEarliest !== bEarliest) {
      return aEarliest - bEarliest;
    }
    if (aHasTrips !== bHasTrips) {
      return aHasTrips ? -1 : 1;
    }

    return a.title.localeCompare(b.title, 'de');
  });

  return [
    ...(unassigned ? [unassigned] : []),
    ...driverColumns,
    ...orphanColumns
  ];
}

/** Column bucket key — Fremdfirma trips always land in „Nicht zugewiesen“. */
export function resolveWidgetColumnId(trip: KanbanTrip): string {
  if (isTripFremdfirma(trip)) {
    return UNASSIGNED_COLUMN_ID;
  }
  return trip.driver_id ?? UNASSIGNED_COLUMN_ID;
}

export function buildWidgetItemsByColumn(
  trips: KanbanTrip[],
  columns: WidgetColumn[]
): Record<string, KanbanTrip[]> {
  const itemsByColumn: Record<string, KanbanTrip[]> = {};
  for (const column of columns) {
    itemsByColumn[column.id] = [];
  }

  for (const trip of trips) {
    const columnId = resolveWidgetColumnId(trip);
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

  for (const columnId of Object.keys(itemsByColumn)) {
    itemsByColumn[columnId].sort(
      (a, b) => getSortPosition(a) - getSortPosition(b)
    );
  }

  return itemsByColumn;
}

export function buildWidgetColumns(
  trips: KanbanTrip[],
  drivers: { id: string; name: string }[]
): WidgetColumn[] {
  const normalizedTrips = tripsForColumnDefinitions(trips);
  const baseColumns = buildColumns(normalizedTrips, WIDGET_GROUP_BY, drivers);
  const itemsByColumn = buildWidgetItemsByColumn(trips, baseColumns);
  return sortDriverColumnsByEarliestTrip(baseColumns, itemsByColumn);
}
