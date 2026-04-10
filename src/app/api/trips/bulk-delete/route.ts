/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { hardDeleteTripsByIds } from '@/features/trips/api/trip-hard-delete';
import { requireAdmin } from '@/lib/api/require-admin';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

type Body = {
  ids?: unknown;
};

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) {
      return auth.error;
    }
    const companyId = auth.companyId;

    const supabaseUser = await createClient();

    const body = (await request.json()) as Body;
    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    const ids = rawIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length === 0) {
      return NextResponse.json(
        { error: 'Keine Fahrt-IDs übergeben.' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            'Server: SUPABASE_SERVICE_ROLE_KEY fehlt. Bitte in der Umgebung setzen, damit Löschvorgänge zuverlässig ausgeführt werden können.'
        },
        { status: 500 }
      );
    }

    const admin = createAdminClient<Database>(supabaseUrl, serviceRoleKey);

    const { data: owned, error: ownErr } = await admin
      .from('trips')
      .select('id')
      .in('id', uniqueIds)
      .eq('company_id', companyId);

    if (ownErr) {
      return NextResponse.json({ error: ownErr.message }, { status: 500 });
    }

    const ownedIds = new Set((owned ?? []).map((r) => r.id));
    if (ownedIds.size !== uniqueIds.length) {
      return NextResponse.json(
        {
          error:
            'Einige Fahrten existieren nicht oder gehören nicht zu Ihrem Unternehmen.'
        },
        { status: 403 }
      );
    }

    const { deletedIds } = await hardDeleteTripsByIds(admin, uniqueIds);

    return NextResponse.json({ deleted: deletedIds.length, ids: deletedIds });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
