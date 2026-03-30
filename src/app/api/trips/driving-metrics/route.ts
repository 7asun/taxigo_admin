/**
 * POST /api/trips/driving-metrics
 *
 * Proxies Google Directions (driving distance + duration) so `GOOGLE_MAPS_API_KEY` stays
 * server-only. Browser/client components must not import `@/lib/google-directions` —
 * they cannot read non-NEXT_PUBLIC env vars; use `@/features/trips/lib/fetch-driving-metrics`.
 *
 * Auth matches other trip mutations (`bulk-delete`, `duplicate`): Supabase session + row in
 * `accounts` with `company_id` so the endpoint is not a public Directions proxy.
 *
 * GCP: enable **Directions API** for the same key as Geocoding if you use one key.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDrivingMetrics } from '@/lib/google-directions';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  originLat: z.number().finite().gte(-90).lte(90),
  originLng: z.number().finite().gte(-180).lte(180),
  destLat: z.number().finite().gte(-90).lte(90),
  destLng: z.number().finite().gte(-180).lte(180)
});

export async function POST(request: Request) {
  try {
    const supabaseUser = await createClient();
    const {
      data: { user },
      error: sessionError
    } = await supabaseUser.auth.getUser();

    if (sessionError || !user) {
      return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
    }

    const { data: account, error: accountError } = await supabaseUser
      .from('accounts')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle();

    if (accountError) {
      return NextResponse.json(
        { error: accountError.message },
        { status: 500 }
      );
    }

    if (!account?.company_id) {
      return NextResponse.json(
        { error: 'Kein Unternehmen zugeordnet.' },
        { status: 403 }
      );
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
        { error: 'Ungültige Koordinaten.' },
        { status: 400 }
      );
    }

    const { originLat, originLng, destLat, destLng } = parsed.data;
    const metrics = await getDrivingMetrics(
      originLat,
      originLng,
      destLat,
      destLng
    );

    return NextResponse.json({ metrics });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
