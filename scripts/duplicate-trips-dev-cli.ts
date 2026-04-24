/**
 * Dev-only: duplicate trips using the service role (no browser session).
 * Mirrors POST /api/trips/duplicate after auth — same as `bun run scripts/backfill-*.ts`.
 *
 * Usage:
 *   bun scripts/duplicate-trips-dev-cli.ts --ids <uuid> [--ids <uuid>...] \
 *     [--include-linked-leg | --no-include-linked-leg] \
 *     [--target-date YYYY-MM-DD] [--schedule-mode preserve_original_time|unified_time|time_open]
 *
 * Loads `.env.local` then `.env` (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * If `--target-date` is omitted, uses the first trip’s business calendar day + 1.
 */
import { config as loadEnv } from 'dotenv';
import { addDays } from 'date-fns';
import { createClient } from '@supabase/supabase-js';

import {
  executeDuplicateTrips,
  fetchTripsExpandedForDuplicate
} from '@/features/trips/lib/duplicate-trips';
import { parseDuplicateTripsPayload } from '@/features/trips/lib/duplicate-trip-schedule';
import { parseYmdToLocalDate } from '@/features/trips/lib/departure-schedule';
import {
  instantToYmdInBusinessTz,
  isYmdString
} from '@/features/trips/lib/trip-business-date';
import { loadPricingContext } from '@/features/trips/lib/trip-price-engine';
import type { Database } from '@/types/database.types';
import type { PricingContext } from '@/features/trips/lib/trip-price-engine';
import type { Trip } from '@/features/trips/api/trips.service';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function parseArgs(argv: string[]): {
  ids: string[];
  includeLinkedLeg: boolean;
  targetDateYmd: string | null;
  scheduleMode: 'preserve_original_time' | 'unified_time' | 'time_open';
} {
  const ids: string[] = [];
  let includeLinkedLeg = true;
  let targetDateYmd: string | null = null;
  let scheduleMode: 'preserve_original_time' | 'unified_time' | 'time_open' =
    'preserve_original_time';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ids' && argv[i + 1]) {
      ids.push(argv[++i]);
      continue;
    }
    if (a === '--include-linked-leg') {
      includeLinkedLeg = true;
      continue;
    }
    if (a === '--no-include-linked-leg') {
      includeLinkedLeg = false;
      continue;
    }
    if (a === '--target-date' && argv[i + 1]) {
      targetDateYmd = argv[++i].trim();
      continue;
    }
    if (a === '--schedule-mode' && argv[i + 1]) {
      const raw = argv[++i];
      if (
        raw !== 'preserve_original_time' &&
        raw !== 'unified_time' &&
        raw !== 'time_open'
      ) {
        throw new Error(`Invalid --schedule-mode: ${raw}`);
      }
      scheduleMode = raw;
      continue;
    }
  }

  return { ids, includeLinkedLeg, targetDateYmd, scheduleMode };
}

function defaultTargetYmdFromTrip(trip: {
  requested_date: string | null;
  scheduled_at: string | null;
}): string {
  const baseYmd =
    trip.requested_date ??
    (trip.scheduled_at
      ? instantToYmdInBusinessTz(new Date(trip.scheduled_at).getTime())
      : null);

  if (!baseYmd || !isYmdString(baseYmd)) {
    throw new Error(
      'Trip has no requested_date / scheduled_at; pass --target-date YYYY-MM-DD'
    );
  }

  const d = parseYmdToLocalDate(baseYmd);
  if (!d) {
    throw new Error('Could not parse source date');
  }

  const next = addDays(d, 1);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const day = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main(): Promise<void> {
  const {
    ids,
    includeLinkedLeg,
    targetDateYmd: argYmd,
    scheduleMode
  } = parseArgs(process.argv.slice(2));

  if (ids.length === 0) {
    throw new Error('Pass at least one --ids <uuid>');
  }

  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: first, error: firstErr } = await admin
    .from('trips')
    .select('company_id, requested_date, scheduled_at')
    .eq('id', ids[0])
    .maybeSingle();

  if (firstErr) throw new Error(firstErr.message);
  if (!first?.company_id) {
    throw new Error(`Trip not found: ${ids[0]}`);
  }

  const companyId = first.company_id;
  const targetDateYmd = argYmd ?? defaultTargetYmdFromTrip(first);

  if (!isYmdString(targetDateYmd) || !parseYmdToLocalDate(targetDateYmd)) {
    throw new Error(`Invalid target date: ${targetDateYmd}`);
  }

  const body: Record<string, unknown> = {
    ids,
    targetDateYmd,
    scheduleMode,
    includeLinkedLeg
  };

  const payload = parseDuplicateTripsPayload(body);

  const includeExpand = payload.includeLinkedLeg !== false;
  const sourceTrips = await fetchTripsExpandedForDuplicate(
    admin,
    payload.ids,
    companyId,
    includeExpand
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
          '[trip-price-engine] loadPricingContext failed in duplicate CLI',
          key,
          e
        );
      }
    })
  );

  const getCtx = (trip: Trip): PricingContext => {
    const key = `${trip.company_id}:${trip.payer_id ?? 'null'}:${trip.client_id ?? 'null'}`;
    return contextMap.get(key) ?? emptyCtx;
  };

  const result = await executeDuplicateTrips(
    admin,
    payload,
    companyId,
    null,
    getCtx
  );

  console.log(
    JSON.stringify(
      {
        created: result.createdIds.length,
        ids: result.createdIds,
        targetDateYmd,
        scheduleMode,
        includeLinkedLeg: payload.includeLinkedLeg !== false
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
