'use client';

/**
 * Client boundary for `/dashboard/trips` so `TripsRscRefreshProvider` wraps **both**
 * the main content and `pageHeaderAction` (e.g. bulk upload) — all trip mutations
 * can call `refreshTripsPage()` without leaving the provider.
 */

import type { ReactNode } from 'react';
import { TripsRscRefreshProvider } from '@/features/trips/providers';

export function FahrtenPageShell({ children }: { children: ReactNode }) {
  return <TripsRscRefreshProvider>{children}</TripsRscRefreshProvider>;
}
