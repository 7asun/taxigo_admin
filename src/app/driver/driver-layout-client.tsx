'use client';

/**
 * Client shell for /driver/* — header + layout-wide GPS tracking via context.
 *
 * Why client: watchPosition and sessionStorage require the browser; server
 * layout keeps metadata and role redirect only.
 */

import { DriverHeader } from '@/features/driver-portal/components/driver-header';
import { DriverTrackingRoot } from '@/lib/tracking/tracking-context';

export function DriverLayoutClient({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className='bg-background min-h-dvh min-h-screen pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]'>
      <main className='mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-w-lg flex-col'>
        <DriverHeader />
        <DriverTrackingRoot>{children}</DriverTrackingRoot>
      </main>
    </div>
  );
}
