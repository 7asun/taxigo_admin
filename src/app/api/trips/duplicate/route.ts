/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { executeDuplicateTrips } from '@/features/trips/lib/duplicate-trips';
import { parseDuplicateTripsPayload } from '@/features/trips/lib/duplicate-trip-schedule';
import { requireAdmin } from '@/lib/api/require-admin';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

/**
 * Duplicates trips to another day (one-off rows, `rule_id` cleared). Auth + company ownership
 * mirror `bulk-delete`; writes use the service role so RLS does not block inserts.
 * Body: `parseDuplicateTripsPayload` (`includeLinkedLeg`, `explicitPerLegUnifiedTimes`, ISO fields).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) {
      return auth.error;
    }
    const companyId = auth.companyId;

    const json = (await request.json().catch(() => null)) as unknown;
    const payload = parseDuplicateTripsPayload(json);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            'Server: SUPABASE_SERVICE_ROLE_KEY fehlt. Bitte in der Umgebung setzen.'
        },
        { status: 500 }
      );
    }

    const admin = createAdminClient<Database>(supabaseUrl, serviceRoleKey);

    const result = await executeDuplicateTrips(
      admin,
      payload,
      companyId,
      auth.userId
    );

    return NextResponse.json({
      created: result.createdIds.length,
      ids: result.createdIds
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
    if (message.includes('gehören nicht')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    const isClient =
      message.includes('Keine') ||
      message.includes('Ungültig') ||
      message.includes('Bitte') ||
      message.includes('existieren nicht');
    return NextResponse.json(
      { error: message },
      { status: isClient ? 400 : 500 }
    );
  }
}
