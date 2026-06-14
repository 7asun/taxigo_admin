'use client';

/**
 * Client boundary for `/dashboard/kts` so `TripsRscRefreshProvider` wraps the page.
 * why: KTS rows are trips — same RSC refresh + TanStack invalidation as Fahrten.
 */

import type { ReactNode } from 'react';
import { TripsRscRefreshProvider } from '@/features/trips/providers';

export function KtsPageShell({ children }: { children: ReactNode }) {
  return <TripsRscRefreshProvider>{children}</TripsRscRefreshProvider>;
}
