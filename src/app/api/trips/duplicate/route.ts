/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import {
  executeDuplicateTrips,
  fetchTripsExpandedForDuplicate
} from '@/features/trips/lib/duplicate-trips';
import { parseDuplicateTripsPayload } from '@/features/trips/lib/duplicate-trip-schedule';
import { requireAdmin } from '@/lib/api/require-admin';
import {
  loadPricingContext,
  type PricingContext
} from '@/features/trips/lib/trip-price-engine';
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

    // Contexts are loaded here at the route boundary (where the admin client lives)
    // rather than inside executeDuplicateTrips, keeping I/O at the boundary and
    // pure-ish computation inside the lib function.
    const includeLinkedLeg = payload.includeLinkedLeg !== false;
    const sourceTrips = await fetchTripsExpandedForDuplicate(
      admin,
      payload.ids,
      companyId,
      includeLinkedLeg
    );

    const contextKeys = new Map<
      string,
      { companyId: string; payerId: string | null; clientId: string | null }
    >();
    for (const trip of sourceTrips) {
      const key = `${trip.company_id}:${trip.payer_id ?? 'null'}:${trip.client_id ?? 'null'}`;
      if (!contextKeys.has(key)) {
        contextKeys.set(key, {
          companyId: trip.company_id!,
          payerId: trip.payer_id ?? null,
          clientId: trip.client_id ?? null
        });
      }
    }

    const contextMap = new Map<string, PricingContext>();
    const emptyCtx: PricingContext = {
      rules: [],
      clientPriceTags: [],
      clientPriceTag: null
    };
    await Promise.all(
      Array.from(contextKeys.entries()).map(async ([key, params]) => {
        try {
          const ctx = await loadPricingContext({ supabase: admin, ...params });
          contextMap.set(key, ctx);
        } catch (e) {
          console.error(
            '[trip-price-engine] loadPricingContext failed in duplicate route',
            key,
            e
          );
        }
      })
    );

    const getCtx = (trip: {
      company_id: string | null;
      payer_id: string | null;
      client_id: string | null;
    }): PricingContext => {
      const key = `${trip.company_id}:${trip.payer_id ?? 'null'}:${trip.client_id ?? 'null'}`;
      return contextMap.get(key) ?? emptyCtx;
    };

    const result = await executeDuplicateTrips(
      admin,
      payload,
      companyId,
      auth.userId,
      getCtx
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
