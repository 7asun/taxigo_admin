import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
  resolveDrivingMetricsWithCache,
  COORD_PRECISION
} from '@/lib/google-directions';

const BATCH_SIZE = 50;
// Sleep after each batch of RATE_LIMIT_BATCH_SIZE trips that required a Google call,
// not after every individual row. Cache-hit rows are free and do not need throttling.
const RATE_LIMIT_BATCH_SIZE = 10;
const SLEEP_AFTER_GOOGLE_BATCH_MS = 200;

const DRY_RUN = process.argv.includes('--dry-run');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.'
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('[backfill] DRY RUN — no DB writes will be made.');
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

  let totalProcessed = 0;
  let totalCacheHits = 0;
  let totalGoogleCalls = 0;
  let totalErrors = 0;
  // Tracks Google calls in the current rate-limit window to know when to sleep.
  let googleCallsInWindow = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: trips, error } = await supabase
      .from('trips')
      .select(
        'id, company_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, driving_distance_km'
      )
      .is('driving_distance_km', null)
      .not('pickup_lat', 'is', null)
      .not('pickup_lng', 'is', null)
      .not('dropoff_lat', 'is', null)
      .not('dropoff_lng', 'is', null)
      .not('company_id', 'is', null)
      .limit(BATCH_SIZE);

    if (error) {
      console.error('Error fetching trips for backfill', error);
      break;
    }

    if (!trips || trips.length === 0) {
      console.log('No more trips to backfill. Done.');
      break;
    }

    console.log(`Processing batch of ${trips.length} trips...`);

    for (const trip of trips) {
      const {
        id,
        company_id,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng
      } = trip;

      if (
        pickup_lat == null ||
        pickup_lng == null ||
        dropoff_lat == null ||
        dropoff_lng == null ||
        company_id == null
      ) {
        continue;
      }

      // resolveDrivingMetricsWithCache checks route_metrics_cache first (using rounded
      // coordinates), then falls back to Google and writes back to the cache. Once the
      // first trip in a repeating route group is processed, all subsequent trips in the
      // same batch are served from the cache — no extra Google calls or cost.
      const metrics = await resolveDrivingMetricsWithCache(
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        supabase,
        company_id
      );

      if (!metrics) {
        console.warn(`Skipping trip ${id} due to missing metrics`);
        totalErrors++;
        continue;
      }

      const { distanceKm, durationSeconds, source } = metrics;
      totalProcessed++;

      if (source === 'cache') {
        totalCacheHits++;
      } else {
        totalGoogleCalls++;
        googleCallsInWindow++;
      }

      if (DRY_RUN) {
        console.log(
          `[dry-run] Would update trip ${id} (source=${source}) distance=${distanceKm.toFixed(3)} km, duration=${durationSeconds} s`
        );
      } else {
        const { error: updateError } = await supabase
          .from('trips')
          .update({
            driving_distance_km: distanceKm,
            driving_duration_seconds: durationSeconds
          })
          .eq('id', id);

        if (updateError) {
          console.error(`Failed to update trip ${id}`, updateError);
          totalErrors++;
        } else {
          console.log(
            `Updated trip ${id} (source=${source}) distance=${distanceKm.toFixed(3)} km, duration=${durationSeconds} s`
          );
        }
      }

      // Sleep after every RATE_LIMIT_BATCH_SIZE Google calls to stay within quota.
      // Cache hits are free and do not need throttling — the per-row sleep in the old
      // script penalised every row equally, wasting time on cache-hit rows.
      if (googleCallsInWindow >= RATE_LIMIT_BATCH_SIZE) {
        await sleep(SLEEP_AFTER_GOOGLE_BATCH_MS);
        googleCallsInWindow = 0;
      }
    }
  }

  console.log('\n── Backfill summary ──────────────────────────────');
  console.log(`  Trips processed : ${totalProcessed}`);
  console.log(
    `  Cache hits      : ${totalCacheHits} (${totalProcessed > 0 ? ((totalCacheHits / totalProcessed) * 100).toFixed(1) : 0}%)`
  );
  console.log(`  Google calls    : ${totalGoogleCalls}`);
  console.log(`  Errors / skipped: ${totalErrors}`);
  if (DRY_RUN) console.log('  Mode            : DRY RUN — no writes made');
  console.log('──────────────────────────────────────────────────\n');

  // Suppress "unused" lint warning — COORD_PRECISION is imported so that the script
  // fails at build time if the constant is removed from google-directions.ts.
  void COORD_PRECISION;
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
