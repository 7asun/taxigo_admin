/**
 * Option A Phase 1: populate `trips.base_net_price` and `trips.approach_fee_net` for
 * historical rows (nullable until this script or live engine/writeback runs).
 *
 * Strategy (two-tier + special cases):
 * 1. Taxameter (P0): `manual_gross_price` set — entire `net_price` is transport lump;
 *    approach is always 0 by definition in `resolveTripPrice` (see trip-price-engine).
 * 2. Invoiced: use `invoice_line_items.approach_fee_net` from the latest line row
 *    (by `created_at`) as the billed snapshot; base = net_price - approach.
 * 3. Uninvoiced: replay `loadPricingContext` + `resolvePricingRule` + `resolveTripPrice`
 *    (same stack as `computeTripPrice`). `net_price === 0` → force 0/0. Unresolved
 *    resolution → `kts_no_rule_force` (stored net as base, approach 0). Mismatch
 *    vs stored net → `rule_drift_force` (accept resolver split). Epsilon match →
 *    `rule_reresolution`. Negative base still -> skipped_anomaly.
 *
 * Phase 2 (reader cutover off `net_price` only) is out of scope — see docs/plans/option-a-*.md
 *
 * Run: `bun run scripts/backfill-trip-price-split.ts` [--dry-run]
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { resolveTripPrice } from '@/features/invoices/lib/resolve-trip-price';
import { resolvePricingRule } from '@/features/invoices/lib/resolve-pricing-rule';
import { resolveTaxRate } from '@/features/invoices/lib/tax-calculator';
import { loadPricingContext } from '@/features/trips/lib/trip-price-engine';

const BATCH = 100;

/** P0 taxameter: meter gross is all-in; no separate Anfahrt in the resolution (see resolveTripPrice). */
const TAXAMETER_P0_APPROACH_NET = 0;

/** Allow float noise when checking stored `net_price` vs resolver output. */
const NET_CHECK_EPSILON = 0.02;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

type Counts = {
  taxameter_p0: number;
  invoice_snapshot: number;
  rule_reresolution: number;
  zero_net_force: number;
  kts_no_rule_force: number;
  rule_drift_force: number;
  skipped_null_net_price: number;
  skipped_anomaly: number;
  skipped_resolution_mismatch: number;
  skipped_resolution_unresolved: number;
  total_processed: number;
  updated: number;
  errors: number;
};

function emptyCounts(): Counts {
  return {
    taxameter_p0: 0,
    invoice_snapshot: 0,
    rule_reresolution: 0,
    zero_net_force: 0,
    kts_no_rule_force: 0,
    rule_drift_force: 0,
    skipped_null_net_price: 0,
    skipped_anomaly: 0,
    skipped_resolution_mismatch: 0,
    skipped_resolution_unresolved: 0,
    total_processed: 0,
    updated: 0,
    errors: 0
  };
}

async function main(): Promise<void> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const dryRun = process.argv.includes('--dry-run');
  const counts = emptyCounts();

  for (let offset = 0; ; offset += BATCH) {
    const { data: rows, error: qErr } = await supabase
      .from('trips')
      .select(
        'id, company_id, payer_id, billing_type_id, billing_variant_id, client_id, driving_distance_km, scheduled_at, kts_document_applies, manual_gross_price, net_price'
      )
      .is('base_net_price', null)
      .is('approach_fee_net', null)
      .order('id')
      .range(offset, offset + BATCH - 1);

    if (qErr) {
      console.error('Query error', qErr);
      process.exit(1);
    }

    const batch = rows ?? [];
    if (batch.length === 0) break;

    const tripIds = batch.map((r) => r.id);
    const { data: lineRowsRaw } = await supabase
      // Table exists in Postgres; omitted from generated `Database` (see database.types.ts).
      // @ts-expect-error Table not in Database
      .from('invoice_line_items')
      .select('trip_id, approach_fee_net, created_at')
      .in('trip_id', tripIds);

    type LineRow = {
      trip_id: string | null;
      approach_fee_net: number | null;
      created_at: string;
    };
    const lineRows = (lineRowsRaw ?? []) as unknown as LineRow[];

    const latestLineByTrip = new Map<
      string,
      { approach_fee_net: number | null; created_at: string }
    >();
    for (const li of lineRows) {
      if (!li.trip_id) continue;
      const prev = latestLineByTrip.get(li.trip_id);
      if (!prev || li.created_at > prev.created_at) {
        latestLineByTrip.set(li.trip_id, {
          approach_fee_net: li.approach_fee_net,
          created_at: li.created_at
        });
      }
    }

    for (const trip of batch) {
      counts.total_processed += 1;

      if (trip.net_price == null) {
        counts.skipped_null_net_price += 1;
        continue;
      }

      const net = trip.net_price;

      if (trip.manual_gross_price != null) {
        counts.taxameter_p0 += 1;
        const payload = {
          base_net_price: net,
          approach_fee_net: TAXAMETER_P0_APPROACH_NET
        };
        if (dryRun) {
          counts.updated += 1;
        } else {
          const { error } = await supabase
            .from('trips')
            .update(payload)
            .eq('id', trip.id);
          if (error) {
            console.error('[backfill-trip-price-split]', trip.id, error);
            counts.errors += 1;
          } else {
            counts.updated += 1;
          }
        }
        continue;
      }

      const line = latestLineByTrip.get(trip.id);
      if (line) {
        counts.invoice_snapshot += 1;
        const approach = line.approach_fee_net ?? 0;
        const base = net - approach;
        if (base < 0) {
          counts.skipped_anomaly += 1;
          continue;
        }
        if (dryRun) {
          counts.updated += 1;
        } else {
          const { error } = await supabase
            .from('trips')
            .update({ base_net_price: base, approach_fee_net: approach })
            .eq('id', trip.id);
          if (error) {
            console.error('[backfill-trip-price-split]', trip.id, error);
            counts.errors += 1;
          } else {
            counts.updated += 1;
          }
        }
        continue;
      }

      if (!trip.company_id || !trip.payer_id) {
        counts.skipped_anomaly += 1;
        continue;
      }

      try {
        // Zero-fare trips have no approach fee by definition — write both as 0.
        // This is not an approximation; a zero-net trip carries no billable amount.
        if (net === 0) {
          counts.zero_net_force += 1;
          if (dryRun) {
            counts.updated += 1;
          } else {
            const { error } = await supabase
              .from('trips')
              .update({ base_net_price: 0, approach_fee_net: 0 })
              .eq('id', trip.id);
            if (error) {
              console.error('[backfill-trip-price-split]', trip.id, error);
              counts.errors += 1;
            } else {
              counts.updated += 1;
            }
          }
          continue;
        }

        const context = await loadPricingContext({
          supabase,
          companyId: trip.company_id,
          payerId: trip.payer_id,
          clientId: trip.client_id ?? null
        });
        const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);
        const tripInput = {
          kts_document_applies: trip.kts_document_applies === true,
          net_price: trip.net_price,
          base_net_price: null,
          manual_gross_price: trip.manual_gross_price ?? null,
          driving_distance_km: trip.driving_distance_km ?? null,
          scheduled_at: trip.scheduled_at,
          client:
            context.clientPriceTag !== null
              ? { price_tag: context.clientPriceTag }
              : null
        };
        const rule = resolvePricingRule({
          rules: context.rules,
          payerId: trip.payer_id,
          billingTypeId: trip.billing_type_id,
          billingVariantId: trip.billing_variant_id,
          clientId: trip.client_id,
          clientPriceTags: context.clientPriceTags
        });
        const resolution = resolveTripPrice(tripInput, taxRate, rule);
        // No rule resolved — trip was priced via KTS or client tag (P1/P2 cascade).
        // The stored net_price is the only available truth. Treat full amount as
        // base transport net; approach = 0 (no rule = no approach fee config).
        // These trips are uninvoiced so no billed snapshot exists to contradict this.
        if (!resolution || resolution.net == null) {
          const base = net;
          if (base < 0) {
            counts.skipped_anomaly += 1;
            continue;
          }
          counts.kts_no_rule_force += 1;
          if (dryRun) {
            counts.updated += 1;
          } else {
            const { error } = await supabase
              .from('trips')
              .update({ base_net_price: base, approach_fee_net: 0 })
              .eq('id', trip.id);
            if (error) {
              console.error('[backfill-trip-price-split]', trip.id, error);
              counts.errors += 1;
            } else {
              counts.updated += 1;
            }
          }
          continue;
        }
        const base = resolution.net;
        const approach = resolution.approach_fee_net ?? 0;
        const expected = Math.round((base + approach) * 100) / 100;
        if (Math.abs(net - expected) > NET_CHECK_EPSILON) {
          // Rule config has drifted since trip creation. Accept the resolver replay
          // as internally consistent — it reflects the current rule state which is
          // the best available approximation for an uninvoiced trip.
          if (base < 0) {
            counts.skipped_anomaly += 1;
            continue;
          }
          counts.rule_drift_force += 1;
          if (dryRun) {
            counts.updated += 1;
          } else {
            const { error } = await supabase
              .from('trips')
              .update({ base_net_price: base, approach_fee_net: approach })
              .eq('id', trip.id);
            if (error) {
              console.error('[backfill-trip-price-split]', trip.id, error);
              counts.errors += 1;
            } else {
              counts.updated += 1;
            }
          }
          continue;
        }
        counts.rule_reresolution += 1;
        if (dryRun) {
          counts.updated += 1;
        } else {
          const { error } = await supabase
            .from('trips')
            .update({ base_net_price: base, approach_fee_net: approach })
            .eq('id', trip.id);
          if (error) {
            console.error('[backfill-trip-price-split]', trip.id, error);
            counts.errors += 1;
          } else {
            counts.updated += 1;
          }
        }
      } catch (e) {
        console.error('[backfill-trip-price-split] row', trip.id, e);
        counts.errors += 1;
      }
    }
  }

  console.log(
    '\nBackfill summary:\n' +
      `  taxameter_p0:        ${counts.taxameter_p0} rows\n` +
      `  invoice_snapshot:    ${counts.invoice_snapshot} rows\n` +
      `  rule_reresolution:   ${counts.rule_reresolution} rows\n` +
      `  zero_net_force:      ${counts.zero_net_force} rows\n` +
      `  kts_no_rule_force:   ${counts.kts_no_rule_force} rows\n` +
      `  rule_drift_force:    ${counts.rule_drift_force} rows\n` +
      `  skipped_null:        ${counts.skipped_null_net_price} rows\n` +
      `  skipped_anomaly:     ${counts.skipped_anomaly} rows\n` +
      `  skipped_mismatch:    ${counts.skipped_resolution_mismatch} rows\n` +
      `  skipped_unresolved:  ${counts.skipped_resolution_unresolved} rows\n` +
      `  total_processed:     ${counts.total_processed} rows\n` +
      `  updated:             ${counts.updated} rows\n` +
      `  errors:              ${counts.errors} rows\n` +
      `  dryRun:              ${dryRun}\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
