/** SECURITY: Layer 3 — requireSession(); see docs/access-control.md */

import { NextResponse } from 'next/server';

import { requireSession } from '@/lib/api/require-session';

export async function GET() {
  try {
    const session = await requireSession();
    if ('error' in session) {
      return session.error;
    }
    const { supabase } = session;

    const { data: shortestData, error: shortestError } = await supabase
      .from('trips')
      .select('*')
      .not('driving_distance_km', 'is', null)
      .order('driving_distance_km', { ascending: true })
      .limit(1);

    if (shortestError) throw shortestError;

    const { data: longestData, error: longestError } = await supabase
      .from('trips')
      .select('*')
      .not('driving_distance_km', 'is', null)
      .order('driving_distance_km', { ascending: false })
      .limit(1);

    if (longestError) throw longestError;

    const { data: avgData, error: avgError } = await supabase
      .from('trips')
      .select('driving_distance_km', { head: false, count: 'exact' });

    if (avgError) throw avgError;

    const distances =
      avgData?.map(
        (t: { driving_distance_km: number | null }) => t.driving_distance_km
      ) || [];
    const validDistances = distances.filter(
      (d): d is number => typeof d === 'number'
    );

    const averageDistanceKm =
      validDistances.length > 0
        ? validDistances.reduce((sum, v) => sum + v, 0) / validDistances.length
        : null;

    return NextResponse.json({
      shortest_trip: shortestData?.[0] ?? null,
      longest_trip: longestData?.[0] ?? null,
      average_distance_km: averageDistanceKm
    });
  } catch (error: unknown) {
    console.error('Error in /api/trips/metrics', error);
    const message =
      error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
