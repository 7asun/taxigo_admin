'use client';

/**
 * Standort & Tempo — read-only speed/accuracy display.
 * GPS runs in DriverTrackingRoot (auto on active/on_break shift), not on this page.
 */

import { Button } from '@/components/ui/button';
import { isShiftTrackable } from '@/lib/tracking/constants';
import { useTracking } from '@/lib/tracking/tracking-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function DriverTrackingPage() {
  const {
    trackingEnabled,
    status,
    error: trackingError,
    lastPosition,
    profileLoading,
    profileError,
    shiftStatus
  } = useTracking();

  if (profileLoading) {
    return (
      <div className='flex flex-1 items-center justify-center p-6'>
        <p className='text-muted-foreground text-sm'>Laden…</p>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-4 p-6'>
        <p className='text-destructive text-center text-sm'>{profileError}</p>
        <Button asChild variant='outline'>
          <Link href='/driver/startseite'>Zur Startseite</Link>
        </Button>
      </div>
    );
  }

  const isActive = trackingEnabled && status === 'tracking';
  const displayError = status === 'error' ? trackingError : null;
  const hasActiveShift = isShiftTrackable(shiftStatus);

  return (
    <div className='flex flex-1 flex-col gap-6 p-6'>
      <div>
        <h1 className='text-xl font-semibold'>Standort & Tempo</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Tracking läuft automatisch während deines Dienstes.
        </p>
      </div>

      <div className='flex items-center gap-3'>
        <span className='relative flex h-4 w-4'>
          {isActive && (
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60' />
          )}
          <span
            className={cn(
              'relative inline-flex h-4 w-4 rounded-full',
              isActive ? 'bg-green-500' : 'bg-gray-300'
            )}
          />
        </span>
        <span className='text-sm font-medium'>
          {isActive
            ? 'Tracking aktiv'
            : hasActiveShift
              ? 'Tracking startet…'
              : 'Kein aktiver Dienst'}
        </span>
      </div>

      <div className='text-center'>
        <p className='text-muted-foreground mb-1 text-xs'>Geschwindigkeit</p>
        <p className='font-mono text-5xl font-bold tabular-nums'>
          {lastPosition?.speed_kmh != null ? lastPosition.speed_kmh : '—'}
          <span className='text-muted-foreground ml-2 text-2xl font-normal'>
            km/h
          </span>
        </p>
        {lastPosition?.accuracy_m != null && (
          <p className='text-muted-foreground mt-2 text-sm'>
            Genauigkeit: {lastPosition.accuracy_m} m
          </p>
        )}
      </div>

      {displayError && (
        <p className='text-destructive text-center text-sm'>{displayError}</p>
      )}
    </div>
  );
}
