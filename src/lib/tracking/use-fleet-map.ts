'use client';

/**
 * Admin fleet map data: initial load + postgres_changes on live_locations.
 *
 * Why postgres_changes (not Broadcast) for Phase 1: matches trips-realtime-sync pattern;
 * ~5s driver upsert cadence is acceptable for dispatch overview.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  TRACKING_ACCOUNTS_FK,
  TRACKING_OFFLINE_AFTER_MS,
  TRACKING_REALTIME_CHANNEL,
  TRACKING_TABLE
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

function formatDriverName(accounts: LiveLocationRow['accounts']): string {
  const row = Array.isArray(accounts) ? accounts[0] : accounts;
  if (!row) return 'Unbekannt';
  const first_name = row.first_name;
  const accountName = row.name;
  return first_name?.trim() || accountName?.trim() || 'Unbekannt';
}

function rowToPosition(row: LiveLocationRow, now: number): DriverPosition {
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
    is_online
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
    is_online
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

  const loadInitial = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from(TRACKING_TABLE)
      .select(SELECT_QUERY);

    if (fetchError) {
      setError(fetchError.message);
      setIsLoading(false);
      return;
    }

    const ts = Date.now();
    const next = new Map<string, DriverPosition>();
    for (const row of (data ?? []) as unknown as LiveLocationRow[]) {
      next.set(row.driver_id, rowToPosition(row, ts));
    }
    setDriversMap(next);
    setError(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
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

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadInitial]);

  // Why a slow tick: DB has no disconnect event — offline is derived from updated_at age
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const drivers = useMemo(() => {
    const list = Array.from(driversMap.values());
    return list.map((d) => ({
      ...d,
      is_online:
        now - new Date(d.updated_at).getTime() <= TRACKING_OFFLINE_AFTER_MS
    }));
  }, [driversMap, now]);

  return { drivers, isLoading, error };
}
