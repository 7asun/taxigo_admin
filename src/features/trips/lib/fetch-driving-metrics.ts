/**
 * Client-side helper for driving distance/duration (Google Directions).
 *
 * Use this only from **`'use client'`** modules. The API key lives on the server; the
 * browser calls `POST /api/trips/driving-metrics`, which runs `getDrivingMetrics` in
 * `@/lib/google-directions`.
 *
 * Server code (Route Handlers, cron, scripts) should import `getDrivingMetrics` directly.
 */
import type { DrivingMetrics } from '@/lib/google-directions';

export async function fetchDrivingMetrics(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<DrivingMetrics | null> {
  try {
    const res = await fetch('/api/trips/driving-metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        originLat,
        originLng,
        destLat,
        destLng
      })
    });

    if (!res.ok) {
      console.error(
        'fetchDrivingMetrics: request failed',
        res.status,
        res.statusText
      );
      return null;
    }

    const data = (await res.json()) as { metrics?: DrivingMetrics | null };
    const metrics = data.metrics;
    if (
      metrics &&
      typeof metrics.distanceKm === 'number' &&
      typeof metrics.durationSeconds === 'number'
    ) {
      return metrics;
    }
    return null;
  } catch (e) {
    console.error('fetchDrivingMetrics:', e);
    return null;
  }
}
