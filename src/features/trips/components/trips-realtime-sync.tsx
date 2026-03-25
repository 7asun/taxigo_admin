'use client';

/**
 * TripsRealtimeSync — Supabase Realtime on `trips` (INSERT + UPDATE).
 *
 * - Calls `refreshTripsPage()` from `TripsRscRefreshProvider` so **RSC** (Liste/Kanban)
 *   re-fetch and **TanStack Query** trip caches invalidate together (Option A for Query).
 * - **Debounced** so bursts of events do not hammer the server.
 *
 * Must mount under `TripsRscRefreshProvider` (see `FahrtenPageShell` on the Fahrten route).
 *
 * @see src/query/README.md — Query vs `router.refresh()`.
 */

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createDebouncedCallback } from '@/query/realtime-bridge';
import { useTripsRscRefresh } from '@/features/trips/providers';

const REALTIME_DEBOUNCE_MS = 450;

export function TripsRealtimeSync() {
  const { refreshTripsPage } = useTripsRscRefresh();

  useEffect(() => {
    const supabase = createClient();

    const { schedule, cancel } = createDebouncedCallback(
      () => refreshTripsPage(),
      REALTIME_DEBOUNCE_MS
    );

    const channel = supabase
      .channel('trips-realtime-sync')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trips' },
        schedule
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trips' },
        schedule
      )
      .subscribe();

    return () => {
      cancel();
      void supabase.removeChannel(channel);
    };
  }, [refreshTripsPage]);

  return null;
}
