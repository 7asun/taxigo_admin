'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { tripsService, type Trip } from '@/features/trips/api/trips.service';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import {
  buildScheduledAt,
  parseScheduledAt,
  parseScheduledAtOrFallback,
  TripTimeError
} from '@/features/trips/lib/trip-time';
import { buildAssignmentPatch } from '@/features/trips/lib/trip-assignee';
import { invalidateAfterTripSave } from '@/features/trips/lib/invalidate-after-trip-save';
import { FREMDFIRMA_JOIN_FRAGMENT } from '@/features/trips/lib/trip-query-fragments';

// ─── Types ─────────────────────────────────────────────────────────────────

export type DriverOption = { id: string; name: string };

export type DispatchTrip = Pick<
  Trip,
  | 'id'
  | 'client_name'
  | 'pickup_address'
  | 'dropoff_address'
  | 'scheduled_at'
  | 'greeting_style'
  | 'status'
  | 'driver_id'
  | 'fremdfirma_id'
  | 'fremdfirma_payment_mode'
  | 'fremdfirma_cost'
> & {
  requested_date?: string | null;
  linked_trip?: { scheduled_at?: string | null } | null;
  tripDate: string;
};

export interface DispatchInboxData {
  /** Trips scheduled for today with no driver assigned. */
  unassignedToday: DispatchTrip[];
  /** Trips for today with no scheduled_at (need time + driver). */
  openTours: DispatchTrip[];
  /** CSV-imported trips where driver name matching failed. */
  csvPending: DispatchTrip[];
  drivers: DriverOption[];
  isLoading: boolean;
  isAssigning: Record<string, boolean>;
  selectedDriverByTrip: Record<string, string>;
  setSelectedDriverByTrip: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  handleAssign: (tripId: string, timeString?: string) => Promise<void>;
  /** Total actionable items (all three categories). */
  totalCount: number;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useDispatchInbox(
  filter: 'today' | 'all' = 'today'
): DispatchInboxData {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = React.useState(true);
  const [isAssigning, setIsAssigning] = React.useState<Record<string, boolean>>(
    {}
  );
  const [unassignedToday, setUnassignedToday] = React.useState<DispatchTrip[]>(
    []
  );
  const [openTours, setOpenTours] = React.useState<DispatchTrip[]>([]);
  const [csvPending, setCsvPending] = React.useState<DispatchTrip[]>([]);
  const [drivers, setDrivers] = React.useState<DriverOption[]>([]);
  const [selectedDriverByTrip, setSelectedDriverByTrip] = React.useState<
    Record<string, string>
  >({});

  const load = React.useCallback(async () => {
    setIsLoading(true);
    const supabase = createSupabaseClient();

    // ── "Heute" filter string (Berlin civil date, not UTC slice) ────────
    const todayStr = todayYmdInBusinessTz();

    // ── Auth & company scope ────────────────────────────────────────────
    const {
      data: { user }
    } = await supabase.auth.getUser();

    let companyId: string | null = null;
    if (user?.id) {
      const { data: profile } = await supabase
        .from('accounts')
        .select('company_id')
        .eq('id', user.id)
        .single();
      companyId = profile?.company_id ?? null;
    }

    // ── Run all queries + drivers in parallel ──────────────────────────
    const TRIP_FIELDS = `id, client_name, pickup_address, dropoff_address, scheduled_at, requested_date, status, driver_id, fremdfirma_id, fremdfirma_payment_mode, fremdfirma_cost, greeting_style, linked_trip:trips!linked_trip_id(scheduled_at), ${FREMDFIRMA_JOIN_FRAGMENT}`;

    const driversQueryBase = supabase
      .from('accounts')
      .select('id, name')
      .eq('role', 'driver')
      .eq('is_active', true);

    const upcomingQuery = supabase
      .from('trips')
      .select(TRIP_FIELDS)
      .is('driver_id', null)
      .is('fremdfirma_id', null)
      .not('scheduled_at', 'is', null)
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true })
      .limit(100);

    const openQuery = supabase
      .from('trips')
      .select(TRIP_FIELDS)
      .is('driver_id', null)
      .is('fremdfirma_id', null)
      .is('scheduled_at', null)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(100);

    const [driversResult, todayResult, openToursResult, csvResult] =
      await Promise.all([
        companyId
          ? driversQueryBase.eq('company_id', companyId)
          : driversQueryBase,

        upcomingQuery,
        openQuery,

        // 3. CSV imports where driver matching failed
        supabase
          .from('trips')
          .select(TRIP_FIELDS)
          .eq('needs_driver_assignment', true)
          .is('driver_id', null)
          .is('fremdfirma_id', null)
          .neq('status', 'cancelled')
          .order('scheduled_at', { ascending: true, nullsFirst: false })
          .limit(50)
      ]);

    setDrivers(
      (driversResult.data || []).map((d: any) => ({
        id: d.id as string,
        name: (d.name as string) || 'Unbenannter Fahrer'
      }))
    );

    const toTrip = (t: any): DispatchTrip => {
      // ── Date Fallback Hierarchy ───────────────
      // Sourcing the exact date an unassigned trip actually falls on is complex if
      // the trip lacks a dedicated requested_date. This mimics the dashboard widget.
      // Priority: own scheduled_at → requested_date → linked outbound trip's scheduled_at → fallback to today.
      // WHY: new Date(scheduled_at).toISOString().slice(0,10) returns
      // UTC calendar date — wrong vs Berlin civil day near midnight.
      // parseScheduledAtOrFallback returns Berlin ymd (same TZ as
      // Fahrten filter) so tripDate === todayStr comparison is correct.
      const computedTripDate = (() => {
        if (t.scheduled_at) {
          return (
            parseScheduledAtOrFallback(t.scheduled_at)?.ymd ??
            todayYmdInBusinessTz()
          );
        }
        if (t.requested_date) return t.requested_date;
        const linkedAt = t.linked_trip?.scheduled_at;
        if (linkedAt) {
          return (
            parseScheduledAtOrFallback(linkedAt)?.ymd ?? todayYmdInBusinessTz()
          );
        }
        return todayYmdInBusinessTz();
      })();

      return {
        id: t.id,
        client_name: t.client_name ?? null,
        greeting_style: t.greeting_style ?? null,
        pickup_address: t.pickup_address ?? null,
        dropoff_address: t.dropoff_address ?? null,
        scheduled_at: t.scheduled_at ?? null,
        requested_date: t.requested_date ?? null,
        linked_trip: t.linked_trip ?? null,
        tripDate: computedTripDate,
        status: t.status ?? 'pending',
        driver_id: t.driver_id ?? null,
        fremdfirma_id: t.fremdfirma_id ?? null,
        fremdfirma_payment_mode: t.fremdfirma_payment_mode ?? null,
        fremdfirma_cost: t.fremdfirma_cost ?? null
      };
    };

    let todayTripsRaw = (todayResult.data || []).map(toTrip);
    let openToursRaw = (openToursResult.data || []).map(toTrip);

    // ── Client-Side Filtering ───────────────
    // If we only selected `requested_date = today` from Supabase, we would inherently
    // drop trips that only have a valid date from a linked outbound trip. By fetching
    // the whole unassigned list and strictly filtering the calculated Javascript string,
    // "Heute" seamlessly captures those connected trips perfectly.
    if (filter === 'today') {
      todayTripsRaw = todayTripsRaw.filter((t) => t.tripDate === todayStr);
      openToursRaw = openToursRaw.filter((t) => t.tripDate === todayStr);
    }

    setUnassignedToday(todayTripsRaw);
    setOpenTours(openToursRaw);

    // Deduplicate CSV list against already-shown trips
    const shownIds = new Set([
      ...todayTripsRaw.map((t) => t.id),
      ...openToursRaw.map((t) => t.id)
    ]);

    let csvTripsRaw = (csvResult.data || [])
      .filter((t: any) => !shownIds.has(t.id))
      .map(toTrip);

    if (filter === 'today') {
      csvTripsRaw = csvTripsRaw.filter((t) => t.tripDate === todayStr);
    }

    setCsvPending(csvTripsRaw);
    setIsLoading(false);
  }, [filter]);

  React.useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    load();
  }, [load]);

  const handleAssign = async (tripId: string, timeString?: string) => {
    const driverId = selectedDriverByTrip[tripId];
    // If neither time nor driver is provided, nothing to do
    if (!driverId && !timeString) return;

    setIsAssigning((prev) => ({ ...prev, [tripId]: true }));
    try {
      const allTrips = [...unassignedToday, ...openTours, ...csvPending];
      const trip = allTrips.find((t) => t.id === tripId);

      const updates: Partial<Trip> = {};

      if (driverId && trip) {
        Object.assign(
          updates,
          buildAssignmentPatch(trip, { driver_id: driverId })
        );
      }

      // Berlin civil day + `buildScheduledAt`: same UTC contract as Kanban / detail sheet (not UTC-slice YMD).
      const tripDate = (() => {
        if (trip?.scheduled_at) {
          try {
            return parseScheduledAt(trip.scheduled_at).ymd;
          } catch {
            /* fall through */
          }
        }
        if (trip?.requested_date) return trip.requested_date;
        const linkedAt = trip?.linked_trip?.scheduled_at;
        if (linkedAt) {
          try {
            return parseScheduledAt(linkedAt).ymd;
          } catch {
            /* fall through */
          }
        }
        return todayYmdInBusinessTz();
      })();

      if (timeString) {
        try {
          updates.scheduled_at = buildScheduledAt(tripDate, timeString);
        } catch (e) {
          if (e instanceof TripTimeError) {
            toast.error(e.message);
            return;
          }
          throw e;
        }
      }

      await tripsService.updateTrip(tripId, updates);

      // WHY: 'auto' — assignment writes scheduled_at/driver_id when present
      await invalidateAfterTripSave(queryClient, {
        tripIds: [tripId],
        patch: updates,
        includePlanningWidgets: 'auto'
      });

      if (driverId) {
        // Assigned a driver -> remove from lists
        setUnassignedToday((prev) => prev.filter((t) => t.id !== tripId));
        setOpenTours((prev) => prev.filter((t) => t.id !== tripId));
        setCsvPending((prev) => prev.filter((t) => t.id !== tripId));
      } else {
        // Just updated the time. Rather than doing piecemeal array updates,
        // just reload the board so it flows exactly into the right section.
        await load();
      }
    } finally {
      setIsAssigning((prev) => ({ ...prev, [tripId]: false }));
    }
  };

  const totalCount =
    unassignedToday.length + openTours.length + csvPending.length;

  return {
    isLoading,
    isAssigning,
    unassignedToday,
    openTours,
    csvPending,
    drivers,
    selectedDriverByTrip,
    setSelectedDriverByTrip,
    handleAssign,
    totalCount
  };
}
