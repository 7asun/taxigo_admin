/**
 * One-off data repair: set net_price / gross_price / tax_rate for trips where
 * net_price IS NULL AND payer_id IS NOT NULL (unpriced-with-payer rows).
 *
 * Run with: `bun run scripts/backfill-null-trip-net-prices.ts` (requires .env with
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 *
 * Dev/staging first. Logs: updated, unresolved (engine all-null), errors with ids.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
  computeTripPrice,
  loadPricingContext,
  type ComputeTripPriceInput
} from '@/features/trips/lib/trip-price-engine';

const BATCH = 100;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main(): Promise<void> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const dryRun = process.argv.includes('--dry-run');

  let updated = 0;
  let unresolved = 0;
  const errorIds: string[] = [];

  for (let offset = 0; ; offset += BATCH) {
    const { data: rows, error: qErr } = await supabase
      .from('trips')
      .select(
        'id, company_id, payer_id, billing_type_id, billing_variant_id, client_id, driving_distance_km, scheduled_at, kts_document_applies, manual_gross_price, net_price'
      )
      .is('net_price', null)
      .not('payer_id', 'is', null)
      .order('id')
      .range(offset, offset + BATCH - 1);

    if (qErr) {
      console.error('Query error', qErr);
      process.exit(1);
    }

    const batch = rows ?? [];
    if (batch.length === 0) break;

    for (const trip of batch) {
      if (!trip.company_id || !trip.payer_id) {
        continue;
      }

      const priceInput: ComputeTripPriceInput = {
        payer_id: trip.payer_id,
        billing_type_id: trip.billing_type_id ?? null,
        billing_variant_id: trip.billing_variant_id ?? null,
        client_id: trip.client_id ?? null,
        driving_distance_km: trip.driving_distance_km ?? null,
        scheduled_at: trip.scheduled_at ?? null,
        kts_document_applies: trip.kts_document_applies ?? false,
        net_price: null,
        manual_gross_price: trip.manual_gross_price ?? null
      };

      try {
        const context = await loadPricingContext({
          supabase,
          companyId: trip.company_id,
          payerId: trip.payer_id,
          clientId: trip.client_id ?? null
        });
        const priceFields = computeTripPrice(priceInput, context);
        if (
          priceFields.net_price == null &&
          priceFields.gross_price == null &&
          priceFields.tax_rate == null
        ) {
          unresolved += 1;
          continue;
        }
        if (dryRun) {
          updated += 1;
          continue;
        }
        const { error: uErr } = await supabase
          .from('trips')
          .update({
            net_price: priceFields.net_price,
            gross_price: priceFields.gross_price,
            tax_rate: priceFields.tax_rate
          })
          .eq('id', trip.id);
        if (uErr) {
          console.error('[backfill] update failed', trip.id, uErr);
          errorIds.push(trip.id);
        } else {
          updated += 1;
        }
      } catch (e) {
        console.error('[backfill] row error', trip.id, e);
        errorIds.push(trip.id);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        updatedWithPrice: updated,
        unresolvedEngineNull: unresolved,
        errorCount: errorIds.length,
        errorIds: errorIds.length ? errorIds : undefined
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
