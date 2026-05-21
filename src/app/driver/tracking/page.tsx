'use client';

/**
 * Standort-Tracking — control screen only (consent, status, start/stop).
 * GPS runs in DriverTrackingRoot (driver layout), not on this page.
 */

import { Button } from '@/components/ui/button';
import { TRACKING_CONSENT_STORAGE_KEY } from '@/lib/tracking/constants';
import { useTracking } from '@/lib/tracking/tracking-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

function hasSessionConsent(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(TRACKING_CONSENT_STORAGE_KEY) === '1';
}

export default function DriverTrackingPage() {
  const {
    trackingEnabled,
    setTrackingEnabled,
    status,
    error: trackingError,
    lastPosition,
    profileLoading,
    profileError
  } = useTracking();

  const [consented, setConsented] = useState(false);

  useEffect(() => {
    setConsented(hasSessionConsent());
  }, []);

  const handleStartConsent = useCallback(() => {
    sessionStorage.setItem(TRACKING_CONSENT_STORAGE_KEY, '1');
    setConsented(true);
    setTrackingEnabled(true);
  }, [setTrackingEnabled]);

  const handleStopTracking = useCallback(() => {
    sessionStorage.removeItem(TRACKING_CONSENT_STORAGE_KEY);
    setConsented(false);
    setTrackingEnabled(false);
  }, [setTrackingEnabled]);

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

  if (!consented) {
    return (
      <div className='flex flex-1 flex-col justify-center gap-6 p-6'>
        <h1 className='text-xl font-semibold'>Standort-Tracking</h1>
        <p className='text-muted-foreground text-sm leading-relaxed'>
          Während des Trackings werden Ihre Position, Geschwindigkeit und die
          GPS-Genauigkeit etwa alle 5 Sekunden an die Zentrale übermittelt.
          Disponenten sehen Sie auf der Flottenkarte. Sie können das Tracking
          jederzeit beenden.
        </p>
        <p className='text-muted-foreground text-xs'>
          Hinweis: Nach längerem Wechsel in andere Apps (besonders iOS Safari)
          kann erneut „Tracking starten“ nötig sein. Tracking läuft in allen
          Fahrer-Bereichen, sobald es gestartet wurde.
        </p>
        <Button size='lg' className='w-full' onClick={handleStartConsent}>
          Tracking starten
        </Button>
        <Button asChild variant='ghost' className='w-full'>
          <Link href='/driver/startseite'>Ablehnen</Link>
        </Button>
      </div>
    );
  }

  const isActive = trackingEnabled && status === 'tracking';
  const displayError = status === 'error' ? trackingError : null;

  return (
    <div className='flex flex-1 flex-col gap-6 p-6'>
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
          {isActive ? 'Tracking aktiv' : 'Tracking inaktiv'}
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

      {trackingEnabled ? (
        <Button
          variant='outline'
          size='lg'
          className='w-full'
          onClick={handleStopTracking}
        >
          Tracking beenden
        </Button>
      ) : (
        <Button
          size='lg'
          className='w-full'
          onClick={() => {
            sessionStorage.setItem(TRACKING_CONSENT_STORAGE_KEY, '1');
            setConsented(true);
            setTrackingEnabled(true);
          }}
        >
          Tracking fortsetzen
        </Button>
      )}
    </div>
  );
}
