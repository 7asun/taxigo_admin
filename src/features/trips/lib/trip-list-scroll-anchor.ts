import { subMinutes } from 'date-fns';

export type TripWithSchedule = {
  id: string;
  scheduled_at: string | null;
};

/**
 * Same rule as `UpcomingTrips`: anchor to the last trip at or before (now − leadMinutes),
 * else first trip after that window. Skips rows without `scheduled_at`.
 */
export function getTripListScrollAnchorId<T extends TripWithSchedule>(
  trips: T[],
  options?: { leadMinutes?: number }
): string | null {
  const leadMinutes = options?.leadMinutes ?? 15;
  if (!trips.length) return null;

  const anchorTime = subMinutes(new Date(), leadMinutes);

  const sorted = [...trips].sort((a, b) => {
    const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
    const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
    return aTime - bTime;
  });

  let anchorTrip: T | null = null;

  for (let i = sorted.length - 1; i >= 0; i--) {
    const trip = sorted[i];
    if (!trip?.scheduled_at) continue;
    const scheduled = new Date(trip.scheduled_at);
    if (scheduled <= anchorTime) {
      anchorTrip = trip;
      break;
    }
  }

  if (!anchorTrip) {
    anchorTrip =
      sorted.find((trip) => {
        if (!trip?.scheduled_at) return false;
        return new Date(trip.scheduled_at) > anchorTime;
      }) ??
      sorted[0] ??
      null;
  }

  return anchorTrip?.id ?? null;
}
