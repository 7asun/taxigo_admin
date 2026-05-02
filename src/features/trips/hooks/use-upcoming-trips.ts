import { useState, useEffect } from 'react';
import { addDays, endOfWeek, format, startOfWeek } from 'date-fns';
import { tz } from '@date-fns/tz';
import { tripsService } from '../api/trips.service';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  getTripsBusinessTimeZone,
  getZonedDayBoundsIso,
  instantToYmdInBusinessTz,
  todayYmdInBusinessTz,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';

export type TripFilter = 'today' | 'tomorrow' | 'week';
export type StatusFilter = 'all' | 'completed' | 'open' | 'assigned';

/** Last instant inside a Berlin calendar day (for PostgREST `.lte` on `scheduled_at`). */
function zonedDayEndInclusiveIso(ymd: string): string {
  const { endExclusiveISO } = getZonedDayBoundsIso(ymd);
  return new Date(new Date(endExclusiveISO).getTime() - 1).toISOString();
}

export function useUpcomingTrips() {
  const [trips, setTrips] = useState<any[]>([]);
  const [filter, setFilter] = useState<TripFilter>('today');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchUpcomingTrips = async () => {
    try {
      setIsLoading(true);

      const zone = getTripsBusinessTimeZone();
      const inTz = tz(zone);
      const todayYmd = todayYmdInBusinessTz();

      // WHY: date-fns startOfDay/endOfDay use runtime local timezone
      // (browser or server), not Europe/Berlin. getZonedDayBoundsIso
      // always returns Berlin day boundaries matching Fahrten filter.
      let startDate = '';
      let endDate = '';

      if (filter === 'tomorrow') {
        const tomorrowYmd = instantToYmdInBusinessTz(
          addDays(ymdToPickerDate(todayYmd), 1, { in: inTz }).getTime()
        );
        const { startISO } = getZonedDayBoundsIso(tomorrowYmd);
        startDate = startISO;
        endDate = zonedDayEndInclusiveIso(tomorrowYmd);
      } else if (filter === 'week') {
        const anchor = ymdToPickerDate(todayYmd);
        const weekStart = startOfWeek(anchor, { weekStartsOn: 1, in: inTz });
        const weekEnd = endOfWeek(anchor, { weekStartsOn: 1, in: inTz });
        const weekStartYmd = format(weekStart, 'yyyy-MM-dd', { in: inTz });
        const weekEndYmd = format(weekEnd, 'yyyy-MM-dd', { in: inTz });
        startDate = getZonedDayBoundsIso(weekStartYmd).startISO;
        endDate = zonedDayEndInclusiveIso(weekEndYmd);
      } else {
        const { startISO } = getZonedDayBoundsIso(todayYmd);
        startDate = startISO;
        endDate = zonedDayEndInclusiveIso(todayYmd);
      }

      const raw = await tripsService.getUpcomingTrips(startDate, endDate);

      // Cross-reference linked partners within the same result set.
      // This covers the common case where both Hin- and Rückfahrt fall in the
      // same time window and adds zero extra DB queries.
      const idToTrip = new Map(raw.map((t: any) => [t.id, t]));
      const data = raw.map((trip: any) => {
        let linkedPartnerStatus: string | null = null;

        if (trip.linked_trip_id) {
          // Forward link: I am the Rückfahrt, partner is the Hinfahrt
          const partner = idToTrip.get(trip.linked_trip_id);
          if (partner) linkedPartnerStatus = partner.status ?? null;
        } else {
          // Inverse link: I am the Hinfahrt, find the Rückfahrt pointing to me
          const partner = raw.find((t: any) => t.linked_trip_id === trip.id);
          if (partner) linkedPartnerStatus = partner.status ?? null;
        }

        return { ...trip, linked_partner_status: linkedPartnerStatus };
      });

      setTrips(data);
      setError(null);
    } catch (err) {
      const error = err as Error;
      setError(error);
      toast.error(`Failed to fetch upcoming trips: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUpcomingTrips();
  }, [filter]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`schema-db-changes-${filter}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trips'
        },
        () => {
          fetchUpcomingTrips();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filter]);

  const filteredTrips = trips.filter((trip) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') {
      return ['pending', 'open', 'assigned', 'in_progress', 'driving'].includes(
        trip.status
      );
    }
    return trip.status === statusFilter;
  });

  return {
    trips: filteredTrips,
    allTrips: trips,
    filter,
    setFilter,
    statusFilter,
    setStatusFilter,
    isLoading,
    error,
    refresh: fetchUpcomingTrips
  };
}
