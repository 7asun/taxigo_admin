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

    const { data, error } = await supabase
      .from('trips')
      .select('group_id, driving_distance_km')
      .not('group_id', 'is', null)
      .not('driving_distance_km', 'is', null);

    if (error) throw error;

    const groups = new Map<
      string,
      { totalKm: number; minKm: number; maxKm: number; count: number }
    >();

    (data || []).forEach(
      (row: {
        group_id: string | null;
        driving_distance_km: number | null;
      }) => {
        const groupId = row.group_id as string;
        const distance = row.driving_distance_km as number;
        if (!groupId || typeof distance !== 'number') return;

        const existing = groups.get(groupId);
        if (!existing) {
          groups.set(groupId, {
            totalKm: distance,
            minKm: distance,
            maxKm: distance,
            count: 1
          });
        } else {
          existing.totalKm += distance;
          existing.minKm = Math.min(existing.minKm, distance);
          existing.maxKm = Math.max(existing.maxKm, distance);
          existing.count += 1;
        }
      }
    );

    const result = Array.from(groups.entries()).map(([groupId, stats]) => ({
      group_id: groupId,
      trip_count: stats.count,
      group_total_driving_km: stats.totalKm,
      group_min_driving_km: stats.minKm,
      group_max_driving_km: stats.maxKm
    }));

    return NextResponse.json({ groups: result });
  } catch (error: unknown) {
    console.error('Error in /api/trips/groups/metrics', error);
    const message =
      error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
