'use client';

/**
 * Continuous driver GPS via watchPosition → upsert live_locations.
 *
 * Why watchPosition (not setInterval): the browser pushes fixes when GPS updates;
 * we only throttle writes to TRACKING_UPDATE_INTERVAL_MS inside the callback.
 *
 * Why speed is nullable: coords.speed is often null on stationary or iOS devices.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  TRACKING_HIGH_ACCURACY,
  TRACKING_MAX_AGE_MS,
  TRACKING_SPEED_MS_TO_KMH,
  TRACKING_TABLE,
  TRACKING_TIMEOUT_MS,
  TRACKING_UPDATE_INTERVAL_MS
} from '@/lib/tracking/constants';

export type TrackingStatus = 'idle' | 'tracking' | 'error';

export type LastPosition = {
  lat: number;
  lng: number;
  speed_kmh: number | null;
  accuracy_m: number | null;
};

type UseDriverTrackingParams = {
  driverId: string;
  companyId: string;
  enabled: boolean;
};

function geolocationErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'GPS-Zugriff verweigert. Bitte Einstellungen prüfen.';
    case 2:
      return 'Standort konnte nicht ermittelt werden.';
    case 3:
      return 'GPS-Zeitüberschreitung. Bitte erneut versuchen.';
    default:
      return 'Standortfehler. Bitte erneut versuchen.';
  }
}

export function useDriverTracking({
  driverId,
  companyId,
  enabled
}: UseDriverTrackingParams) {
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastPosition, setLastPosition] = useState<LastPosition | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastUpsertAtRef = useRef(0);
  const noSleepRef = useRef<{ enable: () => void; disable: () => void } | null>(
    null
  );

  const upsertPosition = useCallback(
    async (coords: GeolocationCoordinates) => {
      const speed_kmh =
        coords.speed != null
          ? +(coords.speed * TRACKING_SPEED_MS_TO_KMH).toFixed(1)
          : null;
      const accuracy_m =
        coords.accuracy != null ? +coords.accuracy.toFixed(1) : null;

      const position: LastPosition = {
        lat: coords.latitude,
        lng: coords.longitude,
        speed_kmh,
        accuracy_m
      };
      setLastPosition(position);

      const supabase = createClient();
      const { error: upsertError } = await supabase.from(TRACKING_TABLE).upsert(
        {
          driver_id: driverId,
          company_id: companyId,
          lat: coords.latitude,
          lng: coords.longitude,
          speed_kmh,
          accuracy_m,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'driver_id' }
      );

      if (upsertError) {
        setStatus('error');
        setError(upsertError.message);
        return;
      }

      setError(null);
      setStatus('tracking');
    },
    [driverId, companyId]
  );

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      noSleepRef.current?.disable();
      noSleepRef.current = null;
      if (!enabled) {
        setStatus('idle');
      }
      return;
    }

    if (!navigator.geolocation) {
      setStatus('error');
      setError('Geolocation wird von diesem Gerät nicht unterstützt.');
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const NoSleep = (await import('nosleep.js')).default;
        if (cancelled) return;
        const noSleep = new NoSleep();
        noSleepRef.current = noSleep;
        noSleep.enable();
      } catch {
        // NoSleep is best-effort; tracking still works without it
      }
    })();

    lastUpsertAtRef.current = 0;
    setStatus('tracking');
    setError(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (
          lastUpsertAtRef.current > 0 &&
          now - lastUpsertAtRef.current < TRACKING_UPDATE_INTERVAL_MS
        ) {
          setLastPosition({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed_kmh:
              pos.coords.speed != null
                ? +(pos.coords.speed * TRACKING_SPEED_MS_TO_KMH).toFixed(1)
                : null,
            accuracy_m:
              pos.coords.accuracy != null
                ? +pos.coords.accuracy.toFixed(1)
                : null
          });
          return;
        }
        lastUpsertAtRef.current = now;
        void upsertPosition(pos.coords);
      },
      (geoError) => {
        setStatus('error');
        setError(geolocationErrorMessage(geoError.code));
      },
      {
        enableHighAccuracy: TRACKING_HIGH_ACCURACY,
        maximumAge: TRACKING_MAX_AGE_MS,
        timeout: TRACKING_TIMEOUT_MS
      }
    );

    return () => {
      cancelled = true;
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      noSleepRef.current?.disable();
      noSleepRef.current = null;
    };
  }, [enabled, upsertPosition]);

  return { status, error, lastPosition };
}
