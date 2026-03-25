'use client';

/**
 * Fahrten (`/dashboard/trips`) coordinates **two** caches:
 * - **Next.js RSC** — `trips-listing.tsx` runs the Supabase query on the server; `router.refresh()`
 *   re-executes that tree so Liste/Kanban get new props.
 * - **TanStack Query** — trip detail, unplanned widget, etc. use `queryKey`s under `tripKeys`.
 *
 * `refreshTripsPage()` runs **both**: await `router.refresh()`, then `invalidateQueries(tripKeys.all)`.
 * That is **not** the same as Query-only `refetch()` — the grid data lives in RSC until you migrate it.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';

export interface TripsRscRefreshContextValue {
  /** Re-fetch the Fahrten RSC payload and align TanStack Query trip caches. */
  refreshTripsPage: () => Promise<void>;
  /** True while `router.refresh()` (and follow-up Query invalidation) is in flight. */
  isRscRefreshPending: boolean;
}

const TripsRscRefreshContext =
  createContext<TripsRscRefreshContextValue | null>(null);

export function TripsRscRefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isRscRefreshPending, setIsRscRefreshPending] = useState(false);

  const refreshTripsPage = useCallback(async () => {
    setIsRscRefreshPending(true);
    try {
      await router.refresh();
      await queryClient.invalidateQueries({ queryKey: tripKeys.all });
    } finally {
      setIsRscRefreshPending(false);
    }
  }, [router, queryClient]);

  const value = useMemo(
    () => ({ refreshTripsPage, isRscRefreshPending }),
    [refreshTripsPage, isRscRefreshPending]
  );

  return (
    <TripsRscRefreshContext.Provider value={value}>
      {children}
    </TripsRscRefreshContext.Provider>
  );
}

/** Must be used under `TripsRscRefreshProvider` (Fahrten route). */
export function useTripsRscRefresh(): TripsRscRefreshContextValue {
  const ctx = useContext(TripsRscRefreshContext);
  if (!ctx) {
    throw new Error(
      'useTripsRscRefresh must be used within TripsRscRefreshProvider'
    );
  }
  return ctx;
}

/** Same as `useTripsRscRefresh` but returns `null` outside the Fahrten provider (e.g. trip sheet on overview). */
export function useOptionalTripsRscRefresh(): TripsRscRefreshContextValue | null {
  return useContext(TripsRscRefreshContext);
}
