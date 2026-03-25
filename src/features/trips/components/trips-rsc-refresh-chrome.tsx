'use client';

/**
 * Subtle busy affordance while `refreshTripsPage()` runs (RSC refetch + Query invalidation).
 * Does **not** replace the table/kanban with a skeleton — only a top strip + `aria-busy`.
 * Only meaningful under `TripsRscRefreshProvider` (`/dashboard/trips`).
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useTripsRscRefresh } from '@/features/trips/providers';

export function TripsRscRefreshChrome({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  const { isRscRefreshPending } = useTripsRscRefresh();

  return (
    <div
      className={cn('relative', className)}
      aria-busy={isRscRefreshPending}
      aria-live='polite'
    >
      {isRscRefreshPending ? (
        <div
          className='bg-primary/70 pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse'
          aria-hidden
        />
      ) : null}
      {children}
    </div>
  );
}
