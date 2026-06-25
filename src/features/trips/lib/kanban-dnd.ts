import type { KanbanColumn, KanbanTrip } from './kanban-types';

/**
 * Resolves a dnd-kit `over.id` value to a real board column id.
 *
 * why: Both the main Kanban board and the overview widget must resolve drop
 * targets from either a raw column id (pointer over empty column space) or a
 * trip-{id} droppable (pointer over a card, because pointerWithin always
 * prefers the smallest droppable). Without this resolution, dropping on a card
 * writes trip-{id} as a column field value, placing trips in an unrendered
 * bucket and making them disappear from the board.
 *
 * The caller supplies getTripColumnId because derivation strategy differs:
 * - Main board: groupBy-aware (driver_id / status / payer_id)
 * - Widget board: driver-only, Fremdfirma trips forced to unassigned
 * Keeping derivation injected prevents groupBy logic from leaking into a
 * shared utility.
 */
export function resolveKanbanDropColumnId({
  overId,
  columns,
  trips,
  getTripColumnId
}: {
  overId: string | number;
  columns: KanbanColumn[];
  trips: KanbanTrip[];
  getTripColumnId: (trip: KanbanTrip) => string;
}): string | null {
  const overStr = String(overId);

  // Direct column id — pointer was over empty column space.
  if (columns.some((c) => c.id === overStr)) return overStr;

  // trip-{id} — pointer was over a card droppable; derive from target trip.
  if (overStr.startsWith('trip-')) {
    const targetTripId = overStr.replace(/^trip-/, '');
    const targetTrip = trips.find((t) => t.id === targetTripId);
    return targetTrip ? getTripColumnId(targetTrip) : null;
  }

  return null;
}
