/**
 * Trip-only fields snapshotted on invoice line items (`trip_meta_snapshot` JSONB).
 * Separate from pricing snapshots — §14 UStG immutability at issue time.
 */

export type TripDirectionSnapshot = 'hin' | 'rueck';

export interface TripMetaSnapshot {
  driver_name?: string | null;
  direction?: TripDirectionSnapshot | null;
}

export function snapshotDirectionFromTrip(
  trip: Pick<
    { link_type: string | null; linked_trip_id: string | null },
    'link_type' | 'linked_trip_id'
  >
): TripDirectionSnapshot | null {
  if (trip.link_type === 'return') return 'rueck';
  if (trip.link_type === 'outbound') return 'hin';
  if (trip.linked_trip_id) return 'rueck';
  return null;
}

export function buildTripMetaFromTrip(
  trip: Pick<
    {
      link_type: string | null;
      linked_trip_id: string | null;
      driver?: { name: string | null } | null;
    },
    'link_type' | 'linked_trip_id' | 'driver'
  >
): TripMetaSnapshot {
  const name = trip.driver?.name?.trim();
  return {
    driver_name: name && name.length > 0 ? name : null,
    direction: snapshotDirectionFromTrip(trip)
  };
}

export function tripMetaDirectionPdfLabel(
  meta: TripMetaSnapshot | null | undefined
): string {
  if (!meta?.direction) return '';
  return meta.direction === 'rueck' ? 'Rück' : 'Hin';
}

export function parseTripMetaSnapshot(
  raw: Record<string, unknown> | null | undefined
): TripMetaSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const driver_name =
    typeof raw.driver_name === 'string' ? raw.driver_name.trim() || null : null;
  const d = raw.direction;
  const direction =
    d === 'hin' || d === 'rueck' ? (d as TripDirectionSnapshot) : null;
  if (!driver_name && !direction) return null;
  return { driver_name, direction };
}
