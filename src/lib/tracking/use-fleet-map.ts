'use client';

/**
 * Admin fleet map data: initial load + postgres_changes on live_locations and trips.
 *
 * Why postgres_changes (not Broadcast) for Phase 1: matches trips-realtime-sync pattern;
 * ~5s driver upsert cadence is acceptable for dispatch overview; trips UPDATE updates
 * is_busy immediately on Tour starten / Tour beenden without waiting for GPS.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  isTrackingBusyStatus,
  TRACKING_ACCOUNTS_FK,
  TRACKING_BUSY_TRIP_STATUSES,
  TRACKING_OFFLINE_AFTER_MS,
  TRACKING_REALTIME_CHANNEL,
  TRACKING_TABLE,
  TRACKING_TRIPS_REALTIME_CHANNEL
} from '@/lib/tracking/constants';

export type DriverPosition = {
  driver_id: string;
  name: string;
  lat: number;
  lng: number;
  speed_kmh: number | null;
  accuracy_m: number | null;
  updated_at: string;
  is_online: boolean;
  is_busy: boolean;
};

type LiveLocationRow = {
  driver_id: string;
  company_id: string;
  lat: number;
  lng: number;
  speed_kmh: number | null;
  accuracy_m: number | null;
  updated_at: string;
  accounts:
    | {
        first_name: string | null;
        name: string | null;
      }
    | {
        first_name: string | null;
        name: string | null;
      }[]
    | null;
};

type TripUpdatePayload = {
  driver_id: string | null;
  status: string;
  company_id: string | null;
};

function formatDriverName(accounts: LiveLocationRow['accounts']): string {
  const row = Array.isArray(accounts) ? accounts[0] : accounts;
  if (!row) return 'Unbekannt';
  const first_name = row.first_name;
  const accountName = row.name;
  return first_name?.trim() || accountName?.trim() || 'Unbekannt';
}

function rowToPosition(
  row: LiveLocationRow,
  now: number,
  isBusy: boolean
): DriverPosition {
  const updatedAt = row.updated_at;
  const is_online =
    now - new Date(updatedAt).getTime() <= TRACKING_OFFLINE_AFTER_MS;
  return {
    driver_id: row.driver_id,
    name: formatDriverName(row.accounts),
    lat: row.lat,
    lng: row.lng,
    speed_kmh: row.speed_kmh,
    accuracy_m: row.accuracy_m,
    updated_at: updatedAt,
    is_online,
    is_busy: is_online && isBusy
  };
}

function payloadToPosition(
  payload: Record<string, unknown>,
  existing: DriverPosition | undefined,
  now: number
): DriverPosition {
  const updatedAt = String(payload.updated_at ?? new Date().toISOString());
  const is_online =
    now - new Date(updatedAt).getTime() <= TRACKING_OFFLINE_AFTER_MS;
  return {
    driver_id: String(payload.driver_id),
    name: existing?.name ?? 'Unbekannt',
    lat: Number(payload.lat),
    lng: Number(payload.lng),
    speed_kmh: payload.speed_kmh != null ? Number(payload.speed_kmh) : null,
    accuracy_m: payload.accuracy_m != null ? Number(payload.accuracy_m) : null,
    updated_at: updatedAt,
    is_online,
    is_busy: existing?.is_busy ?? false
  };
}

const SELECT_QUERY = `
  driver_id,
  company_id,
  lat,
  lng,
  speed_kmh,
  accuracy_m,
  updated_at,
  accounts!${TRACKING_ACCOUNTS_FK} ( first_name, name )
`;

export function useFleetMap() {
  const [driversMap, setDriversMap] = useState<Map<string, DriverPosition>>(
    () => new Map()
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Nicht angemeldet.');
        setIsLoading(false);
        return;
      }

      const { data: account } = await supabase
        .from('accounts')
        .select('company_id')
        .eq('id', user.id)
        .maybeSingle();

      if (account?.company_id) {
        setCompanyId(account.company_id);
      } else {
        setError('Kein Unternehmen für diesen Benutzer.');
        setIsLoading(false);
      }
    };
    void init();
  }, []);

  const loadInitial = useCallback(async () => {
    if (!companyId) return;

    const supabase = createClient();

    const [locationsResult, busyTripsResult] = await Promise.all([
      supabase.from(TRACKING_TABLE).select(SELECT_QUERY),
      supabase
        .from('trips')
        .select('driver_id')
        .eq('company_id', companyId)
        .in('status', [...TRACKING_BUSY_TRIP_STATUSES])
    ]);

    if (locationsResult.error) {
      setError(locationsResult.error.message);
      setIsLoading(false);
      return;
    }

    if (busyTripsResult.error) {
      setError(busyTripsResult.error.message);
      setIsLoading(false);
      return;
    }

    const busySet = new Set(
      (busyTripsResult.data ?? [])
        .map((t) => t.driver_id)
        .filter((id): id is string => id != null)
    );

    const ts = Date.now();
    const next = new Map<string, DriverPosition>();
    for (const row of (locationsResult.data ??
      []) as unknown as LiveLocationRow[]) {
      next.set(
        row.driver_id,
        rowToPosition(row, ts, busySet.has(row.driver_id))
      );
    }
    setDriversMap(next);
    setError(null);
    setIsLoading(false);
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setIsLoading(true);
    void loadInitial();
  }, [companyId, loadInitial]);

  useEffect(() => {
    if (!companyId) return;

    const supabase = createClient();

    const locationsChannel = supabase
      .channel(TRACKING_REALTIME_CHANNEL)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: TRACKING_TABLE },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const driverId = String(row.driver_id);
          setDriversMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(driverId);
            next.set(driverId, payloadToPosition(row, existing, Date.now()));
            return next;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: TRACKING_TABLE },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const driverId = String(row.driver_id);
          setDriversMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(driverId);
            next.set(driverId, payloadToPosition(row, existing, Date.now()));
            return next;
          });
        }
      )
      .subscribe();

    const tripsChannel = supabase
      .channel(TRACKING_TRIPS_REALTIME_CHANNEL)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
          filter: `company_id=eq.${companyId}`
        },
        (payload) => {
          const trip = payload.new as TripUpdatePayload;
          if (trip.company_id !== companyId) return;
          if (!trip.driver_id) return;
          const isBusy = isTrackingBusyStatus(trip.status);
          setDriversMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(trip.driver_id!);
            if (existing) {
              next.set(trip.driver_id!, { ...existing, is_busy: isBusy });
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(locationsChannel);
      void supabase.removeChannel(tripsChannel);
    };
  }, [companyId]);

  // Why a slow tick: DB has no disconnect event — offline is derived from updated_at age
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const drivers = useMemo(() => {
    const list = Array.from(driversMap.values());
    return list.map((d) => {
      const is_online =
        now - new Date(d.updated_at).getTime() <= TRACKING_OFFLINE_AFTER_MS;
      return {
        ...d,
        is_online,
        is_busy: is_online ? d.is_busy : false
      };
    });
  }, [driversMap, now]);

  return { drivers, isLoading, error };
}
