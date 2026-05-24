/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

/**
 * POST /api/fleet/routes
 *
 * Batch driving routes from each online driver to a destination — returns decoded
 * polylines + duration for fleet map rendering. Uses `getRoutePolyline` (no DB cache).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/api/require-admin';
import { getRoutePolyline } from '@/lib/google-directions';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  drivers: z
    .array(
      z.object({
        driver_id: z.string().min(1),
        name: z.string(),
        lat: z.number().finite().gte(-90).lte(90),
        lng: z.number().finite().gte(-180).lte(180)
      })
    )
    .min(1)
    .max(20),
  destLat: z.number().finite().gte(-90).lte(90),
  destLng: z.number().finite().gte(-180).lte(180)
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) {
      return auth.error;
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Ungültiger JSON-Body.' },
        { status: 400 }
      );
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Ungültige Anfrage.' },
        { status: 400 }
      );
    }

    const { drivers, destLat, destLng } = parsed.data;

    const routes = await Promise.all(
      drivers.map(async (driver) => {
        const route = await getRoutePolyline(
          driver.lat,
          driver.lng,
          destLat,
          destLng
        );
        return {
          driver_id: driver.driver_id,
          name: driver.name,
          durationSeconds: route?.durationSeconds ?? null,
          distanceMeters: route?.distanceMeters ?? null,
          polylinePoints: route?.polylinePoints ?? []
        };
      })
    );

    return NextResponse.json({ routes });
  } catch (error) {
    console.error('Error in /api/fleet/routes', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
