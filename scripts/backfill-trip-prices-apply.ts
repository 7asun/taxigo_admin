/**
 * Phase 2: apply recalc_* from trip_price_backfill_audit to trips for full audit history
 * (all rows with needs_update = true). Does not read or write the audit table beyond SELECT.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Run: bun run backfill:apply
 *
 * Note: each trip can receive different price fields. Postgres/PostgREST cannot express
 * one `.update()` with `.in('id', …)` and per-row values, so each batch runs up to 50
 * `.update(…).eq('id', trip_id)` calls grouped under one try/catch.
 */
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

import type { Database, TablesUpdate } from '@/types/database.types';

const BATCH = 50;

type AuditRow = Pick<
  Database['public']['Tables']['trip_price_backfill_audit']['Row'],
  | 'trip_id'
  | 'recalc_gross_price'
  | 'recalc_net_price'
  | 'recalc_base_net_price'
  | 'recalc_approach_fee_net'
  | 'recalc_tax_rate'
>;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function isPresent(v: unknown): v is number | string {
  return v !== null && v !== undefined;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Expected finite number, got ${String(v)}`);
}

function allRecalcPresent(row: AuditRow): boolean {
  return (
    isPresent(row.recalc_gross_price) &&
    isPresent(row.recalc_net_price) &&
    isPresent(row.recalc_base_net_price) &&
    isPresent(row.recalc_approach_fee_net) &&
    isPresent(row.recalc_tax_rate)
  );
}

async function main(): Promise<void> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let skippedNullRecalc = 0;
  const toApply: AuditRow[] = [];
  /** Last audit row wins when duplicates exist for the same trip_id. */
  const auditByTripId = new Map<string, AuditRow>();

  const FETCH_PAGE = 500;
  for (let offset = 0; ; offset += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('trip_price_backfill_audit')
      .select(
        'trip_id, recalc_gross_price, recalc_net_price, recalc_base_net_price, recalc_approach_fee_net, recalc_tax_rate'
      )
      .eq('needs_update', true)
      .order('id', { ascending: true })
      .range(offset, offset + FETCH_PAGE - 1);

    if (error) {
      console.error('[backfill-trip-prices-apply] audit fetch failed', error);
      throw error;
    }

    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const raw of rows) {
      const row = raw as AuditRow;
      auditByTripId.set(row.trip_id, row);
    }

    if (rows.length < FETCH_PAGE) break;
  }

  for (const row of auditByTripId.values()) {
    if (!allRecalcPresent(row)) {
      skippedNullRecalc += 1;
      continue;
    }
    toApply.push(row);
  }

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < toApply.length; i += BATCH) {
    const batch = toApply.slice(i, i + BATCH);
    try {
      const outcomes = await Promise.allSettled(
        batch.map(async (row) => {
          const patch = {
            base_net_price: toNumber(row.recalc_base_net_price),
            approach_fee_net: toNumber(row.recalc_approach_fee_net),
            tax_rate: toNumber(row.recalc_tax_rate),
            gross_price: toNumber(row.recalc_gross_price)
          } as TablesUpdate<'trips'>;

          const { error } = await supabase
            .from('trips')
            .update(patch)
            .eq('id', row.trip_id);

          if (error) {
            throw Object.assign(new Error(error.message), {
              tripId: row.trip_id,
              details: error
            });
          }
          return row.trip_id;
        })
      );

      for (const o of outcomes) {
        if (o.status === 'fulfilled') {
          updated += 1;
        } else {
          errors += 1;
          const reason = o.reason as Error & { tripId?: string };
          const tid = reason?.tripId ?? '(unknown trip id)';
          console.error(
            `[backfill-trip-prices-apply] update failed trip ${tid}`,
            reason
          );
        }
      }
    } catch (e) {
      console.error(
        `[backfill-trip-prices-apply] batch ${Math.floor(i / BATCH) + 1} unexpected failure`,
        e
      );
      errors += batch.length;
    }
  }

  console.log('Phase 2 apply — full history');
  console.log(`Trips updated: ${updated}`);
  console.log(`Trips skipped (unresolved / null recalc): ${skippedNullRecalc}`);
  console.log(`Errors: ${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
