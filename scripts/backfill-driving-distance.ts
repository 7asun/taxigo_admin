import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
  resolveDrivingMetricsWithCache,
  COORD_PRECISION
} from '@/lib/google-directions';
import {
  computeTripPrice,
  loadPricingContext,
  resolveTripForPricing,
  shouldRecalculatePrice,
  type ComputeTripPriceInput,
  type PricingContext
} from '@/features/trips/lib/trip-price-engine';

const BATCH_SIZE = 50;
// Sleep after each batch of RATE_LIMIT_BATCH_SIZE trips that required a Google call,
// not after every individual row. Cache-hit rows are free and do not need throttling.
const RATE_LIMIT_BATCH_SIZE = 10;
const SLEEP_AFTER_GOOGLE_BATCH_MS = 200;

const DRY_RUN = process.argv.includes('--dry-run');
const RUN_PASS_A =
  !process.argv.includes('--pass-b') && !process.argv.includes('--pass-c');
const RUN_PASS_B =
  !process.argv.includes('--pass-a') && !process.argv.includes('--pass-c');
const RUN_PASS_C =
  !process.argv.includes('--pass-a') && !process.argv.includes('--pass-b');
const COMPANY_ID = (() => {
  const idx = process.argv.indexOf('--company-id');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── runPriceForTripIds ────────────────────────────────────────────────────────
// Selective price recalculation engine used by Pass C after it corrects
// billing_type_id. Processing only the corrected IDs — rather than re-running
// Pass B in full — ensures we touch exactly the trips that changed and avoids
// re-evaluating company-wide trips that are already correctly priced.
// Overwrites net_price / gross_price / tax_rate unconditionally (no null-price
// guard): these trips already have prices, but those prices were computed with a
// missing billing_type_id and may have fallen through to the wrong STEP 3 rule.
async function runPriceForTripIds(
  tripIds: string[],
  supabase: SupabaseClient<Database>,
  emptyCtx: PricingContext
): Promise<{ written: number; unresolved: number; errors: number }> {
  let written = 0;
  let unresolved = 0;
  let errors = 0;

  for (let offset = 0; offset < tripIds.length; offset += BATCH_SIZE) {
    const batchSlice = tripIds.slice(offset, offset + BATCH_SIZE);

    const { data: trips, error } = await supabase
      .from('trips')
      .select(
        'id, company_id, payer_id, client_id, billing_type_id, billing_variant_id, driving_distance_km, scheduled_at, kts_document_applies'
      )
      .in('id', batchSlice);

    if (error) {
      console.error('[Pass C / re-run] Error fetching trip batch', error);
      errors += batchSlice.length;
      continue;
    }

    for (const trip of trips ?? []) {
      if (!trip.company_id || !trip.payer_id) continue;

      const priceInput: ComputeTripPriceInput = {
        payer_id: trip.payer_id,
        billing_type_id: trip.billing_type_id ?? null,
        billing_variant_id: trip.billing_variant_id ?? null,
        client_id: trip.client_id ?? null,
        driving_distance_km: trip.driving_distance_km ?? null,
        scheduled_at: trip.scheduled_at ?? null,
        kts_document_applies: trip.kts_document_applies ?? false,
        net_price: null // never inherit stored value
      };

      const context = await loadPricingContext({
        supabase,
        companyId: trip.company_id,
        payerId: trip.payer_id,
        clientId: trip.client_id ?? null
      }).catch((e) => {
        console.error(
          '[trip-price-engine] loadPricingContext failed on Pass C re-run',
          trip.id,
          e
        );
        return null;
      });

      const priceFields = computeTripPrice(priceInput, context ?? emptyCtx);

      if (priceFields.net_price === null) {
        unresolved++;
        continue;
      }

      if (DRY_RUN) {
        console.log(
          `[dry-run / Pass C re-run] Would set trip ${trip.id} ` +
            `net_price=${priceFields.net_price} ` +
            `gross_price=${priceFields.gross_price} ` +
            `tax_rate=${priceFields.tax_rate}`
        );
        written++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('trips')
        .update({
          net_price: priceFields.net_price,
          gross_price: priceFields.gross_price,
          tax_rate: priceFields.tax_rate
        })
        .eq('id', trip.id);

      if (updateError) {
        console.error(
          `[Pass C / re-run] Failed to update trip ${trip.id}`,
          updateError
        );
        errors++;
      } else {
        console.log(
          `[Pass C / re-run] Repriced trip ${trip.id} ` +
            `net=${priceFields.net_price} gross=${priceFields.gross_price} ` +
            `tax_rate=${priceFields.tax_rate}`
        );
        written++;
      }
    }
  }

  return { written, unresolved, errors };
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

  if (!COMPANY_ID) {
    console.error(
      'ERROR: --company-id is required. ' +
        'Usage: bun scripts/backfill-driving-distance.ts ' +
        '--company-id <uuid> [--dry-run] [--pass-a] [--pass-b] [--pass-c]'
    );
    process.exit(1);
  }

  console.log('── Backfill mode ─────────────────────────────────');
  console.log(`  Company                 : ${COMPANY_ID}`);
  console.log(`  Pass A (distance+price) : ${RUN_PASS_A ? 'YES' : 'SKIP'}`);
  console.log(`  Pass B (price only)     : ${RUN_PASS_B ? 'YES' : 'SKIP'}`);
  console.log(`  Pass C (billing_type_id): ${RUN_PASS_C ? 'YES' : 'SKIP'}`);
  console.log(
    `  Dry run                 : ${DRY_RUN ? 'YES — no writes' : 'NO'}`
  );
  console.log('──────────────────────────────────────────────────\n');

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

  // ── Pass A counters ──────────────────────────────────────────────────────────
  let totalProcessed = 0;
  let totalCacheHits = 0;
  let totalGoogleCalls = 0;
  let totalErrors = 0;
  // Tracks Google calls in the current rate-limit window to know when to sleep.
  let googleCallsInWindow = 0;

  // ── Pass B counters ──────────────────────────────────────────────────────────
  let totalPriceWritten = 0; // trips where net_price was written (Pass A + B)
  let totalPriceUnresolved = 0; // computeTripPrice returned null — skip write
  let totalFixWindowCorrected = 0; // fix-window sub-pass corrections
  let totalPriceBErrors = 0; // Pass B write errors

  // ── Pass C counters ──────────────────────────────────────────────────────────
  let totalTypeCorrected = 0; // trips where billing_type_id was written
  let totalTypeCErrors = 0; // Pass C write errors
  let totalCRerunWritten = 0; // prices written in selective re-run after Pass C
  let totalCRerunUnresolved = 0; // price unresolved in selective re-run
  let totalCRerunErrors = 0; // selective re-run write errors

  const emptyCtx: PricingContext = {
    rules: [],
    clientPriceTags: [],
    clientPriceTag: null
  };

  // ── Pass A — Distance + price backfill ──────────────────────────────────────
  // Selects trips missing driving_distance_km (but with coordinates).
  // Resolves distance via resolveDrivingMetricsWithCache, then recalculates price.

  if (RUN_PASS_A) {
    const processedIds: string[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let query = supabase
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
        .eq('company_id', COMPANY_ID);
      if (processedIds.length > 0) {
        query = query.not('id', 'in', `(${processedIds.join(',')})`);
      }
      const { data: trips, error } = await query
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (error) {
        console.error('Error fetching trips for Pass A backfill', error);
        break;
      }

      if (!trips || trips.length === 0) {
        console.log('[Pass A] No more trips to backfill. Done.');
        break;
      }

      console.log(`[Pass A] Processing batch of ${trips.length} trips...`);

      for (const trip of trips) {
        processedIds.push(trip.id);
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
          console.warn(`[Pass A] Skipping trip ${id} due to missing metrics`);
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
          // Extract to a named variable so price recalculation can extend it
          // via Object.assign before the write.
          const updatePayload: Database['public']['Tables']['trips']['Update'] =
            {
              driving_distance_km: distanceKm,
              driving_duration_seconds: durationSeconds
            };

          // Only recalculate when a pricing-relevant field is being changed.
          // driving_distance_km IS pricing-relevant, so this always fires here.
          if (shouldRecalculatePrice(updatePayload)) {
            const tripInput = await resolveTripForPricing(
              supabase,
              id,
              updatePayload
            );
            if (tripInput) {
              const context = await loadPricingContext({
                supabase,
                companyId: tripInput.company_id,
                payerId: tripInput.payer_id,
                clientId: tripInput.client_id
              }).catch((e) => {
                // A failed context load must never block a trip save.
                console.error(
                  '[trip-price-engine] loadPricingContext failed on backfill',
                  id,
                  e
                );
                return null;
              });
              if (context) {
                const priceResult = computeTripPrice(tripInput, context);
                Object.assign(updatePayload, priceResult);
                if (priceResult.net_price !== null) {
                  totalPriceWritten++;
                }
              }
            }
          }

          const { error: updateError } = await supabase
            .from('trips')
            .update(updatePayload)
            .eq('id', id);

          if (updateError) {
            console.error(`[Pass A] Failed to update trip ${id}`, updateError);
            totalErrors++;
          } else {
            console.log(
              `[Pass A] Updated trip ${id} (source=${source}) distance=${distanceKm.toFixed(3)} km, duration=${durationSeconds} s`
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
  }

  // ── Pass B — Price-only backfill (main) ─────────────────────────────────────
  // Selects trips that already have a driving distance but are missing one or more
  // price fields. Skips distance resolution entirely — writes only the three price
  // fields (net_price, gross_price, tax_rate).

  if (RUN_PASS_B) {
    console.log('\n[Pass B] Starting price-only backfill...');

    const processedIdsB: string[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let queryB = supabase
        .from('trips')
        .select(
          'id, company_id, payer_id, client_id, billing_type_id, billing_variant_id, driving_distance_km, scheduled_at, kts_document_applies'
        )
        .not('driving_distance_km', 'is', null)
        .not('payer_id', 'is', null)
        .not('company_id', 'is', null)
        .eq('company_id', COMPANY_ID)
        .or('net_price.is.null,gross_price.is.null,tax_rate.is.null');
      if (processedIdsB.length > 0) {
        queryB = queryB.not('id', 'in', `(${processedIdsB.join(',')})`);
      }
      const { data: trips, error } = await queryB
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (error) {
        console.error('[Pass B] Error fetching trips', error);
        break;
      }

      if (!trips || trips.length === 0) {
        console.log('[Pass B] No more trips to backfill. Done.');
        break;
      }

      console.log(`[Pass B] Processing batch of ${trips.length} trips...`);

      for (const trip of trips) {
        processedIdsB.push(trip.id);
        if (!trip.company_id || !trip.payer_id) continue;

        const priceInput: ComputeTripPriceInput = {
          payer_id: trip.payer_id,
          billing_type_id: trip.billing_type_id ?? null,
          billing_variant_id: trip.billing_variant_id ?? null,
          client_id: trip.client_id ?? null,
          driving_distance_km: trip.driving_distance_km ?? null,
          scheduled_at: trip.scheduled_at ?? null,
          kts_document_applies: trip.kts_document_applies ?? false,
          net_price: null // never inherit stored value
        };

        const context = await loadPricingContext({
          supabase,
          companyId: trip.company_id,
          payerId: trip.payer_id,
          clientId: trip.client_id ?? null
        }).catch((e) => {
          console.error(
            '[trip-price-engine] loadPricingContext failed on Pass B',
            trip.id,
            e
          );
          return null;
        });

        const priceFields = computeTripPrice(priceInput, context ?? emptyCtx);

        // Skip write when price cannot be resolved — do not overwrite with null.
        if (priceFields.net_price === null) {
          totalPriceUnresolved++;
          continue;
        }

        if (DRY_RUN) {
          // Log computed values, not stored values (stored values are not in SELECT).
          console.log(
            `[dry-run] Would set trip ${trip.id} ` +
              `net_price=${priceFields.net_price} ` +
              `gross_price=${priceFields.gross_price} ` +
              `tax_rate=${priceFields.tax_rate}`
          );
          totalPriceWritten++;
          continue;
        }

        const { error: updateError } = await supabase
          .from('trips')
          .update({
            net_price: priceFields.net_price,
            gross_price: priceFields.gross_price,
            tax_rate: priceFields.tax_rate
          })
          .eq('id', trip.id);

        if (updateError) {
          console.error(
            `[Pass B] Failed to update trip ${trip.id}`,
            updateError
          );
          totalPriceBErrors++;
        } else {
          console.log(
            `[Pass B] Set prices on trip ${trip.id} ` +
              `net=${priceFields.net_price} gross=${priceFields.gross_price} ` +
              `tax_rate=${priceFields.tax_rate}`
          );
          totalPriceWritten++;
        }
      }
    }

    // ── Pass B fix-window sub-pass ─────────────────────────────────────────────
    // Trips created on Phase 1 go-live day (2026-04-19) may have net_price/gross_price
    // set but incorrect because approach_fee_net was missing from the engine at that
    // time. Overwrite prices regardless of their current value.

    console.log(
      '\n[Pass B / fix-window] Starting fix-window correction (2026-04-19)...'
    );

    const processedIdsFW: string[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let queryFW = supabase
        .from('trips')
        .select(
          'id, company_id, payer_id, client_id, billing_type_id, billing_variant_id, driving_distance_km, scheduled_at, kts_document_applies'
        )
        .not('driving_distance_km', 'is', null)
        .not('payer_id', 'is', null)
        .not('company_id', 'is', null)
        .eq('company_id', COMPANY_ID)
        .gte('created_at', '2026-04-19T00:00:00Z')
        .lte('created_at', '2026-04-19T23:59:59Z');
      if (processedIdsFW.length > 0) {
        queryFW = queryFW.not('id', 'in', `(${processedIdsFW.join(',')})`);
      }
      const { data: trips, error } = await queryFW
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (error) {
        console.error('[Pass B / fix-window] Error fetching trips', error);
        break;
      }

      if (!trips || trips.length === 0) {
        console.log('[Pass B / fix-window] No more trips in fix window. Done.');
        break;
      }

      console.log(
        `[Pass B / fix-window] Processing batch of ${trips.length} trips...`
      );

      for (const trip of trips) {
        processedIdsFW.push(trip.id);
        if (!trip.company_id || !trip.payer_id) continue;

        const priceInput: ComputeTripPriceInput = {
          payer_id: trip.payer_id,
          billing_type_id: trip.billing_type_id ?? null,
          billing_variant_id: trip.billing_variant_id ?? null,
          client_id: trip.client_id ?? null,
          driving_distance_km: trip.driving_distance_km ?? null,
          scheduled_at: trip.scheduled_at ?? null,
          kts_document_applies: trip.kts_document_applies ?? false,
          net_price: null // never inherit stored value
        };

        const context = await loadPricingContext({
          supabase,
          companyId: trip.company_id,
          payerId: trip.payer_id,
          clientId: trip.client_id ?? null
        }).catch((e) => {
          console.error(
            '[trip-price-engine] loadPricingContext failed on fix-window',
            trip.id,
            e
          );
          return null;
        });

        const priceFields = computeTripPrice(priceInput, context ?? emptyCtx);

        if (priceFields.net_price === null) {
          totalPriceUnresolved++;
          continue;
        }

        if (DRY_RUN) {
          console.log(
            `[dry-run / fix-window] Would set trip ${trip.id} ` +
              `net_price=${priceFields.net_price} ` +
              `gross_price=${priceFields.gross_price} ` +
              `tax_rate=${priceFields.tax_rate}`
          );
          totalFixWindowCorrected++;
          continue;
        }

        const { error: updateError } = await supabase
          .from('trips')
          .update({
            net_price: priceFields.net_price,
            gross_price: priceFields.gross_price,
            tax_rate: priceFields.tax_rate
          })
          .eq('id', trip.id);

        if (updateError) {
          console.error(
            `[Pass B / fix-window] Failed to update trip ${trip.id}`,
            updateError
          );
          totalPriceBErrors++;
        } else {
          console.log(
            `[Pass B / fix-window] Corrected trip ${trip.id} ` +
              `net=${priceFields.net_price} gross=${priceFields.gross_price} ` +
              `tax_rate=${priceFields.tax_rate}`
          );
          totalFixWindowCorrected++;
        }
      }
    }
  }

  // ── Pass C — billing_type_id backfill ────────────────────────────────────────
  // Selects trips that have billing_variant_id set but billing_type_id null.
  // Derives billing_type_id via a two-query pattern (trips batch → variants
  // lookup → in-memory map) to avoid PostgREST join type-inference issues.
  //
  // Runs AFTER Pass B intentionally: Pass B may have priced some of these trips
  // using the STEP 3 payer-wide fallback (the only rule reachable when
  // billing_type_id is null). After Pass C sets the correct billing_type_id,
  // the selective re-run overwrites those prices with the correct STEP 2
  // type-level rule in a single pass over the corrected IDs.

  if (RUN_PASS_C) {
    console.log('\n[Pass C] Starting billing_type_id backfill...');

    const processedIdsC: string[] = [];
    const correctedTripIds: string[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Query 1 — trips with a variant but no type
      let queryC = supabase
        .from('trips')
        .select('id, billing_variant_id')
        .not('billing_variant_id', 'is', null)
        .is('billing_type_id', null)
        .not('company_id', 'is', null)
        .eq('company_id', COMPANY_ID);
      if (processedIdsC.length > 0) {
        queryC = queryC.not('id', 'in', `(${processedIdsC.join(',')})`);
      }
      const { data: tripRows, error: tripError } = await queryC
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (tripError) {
        console.error('[Pass C] Error fetching trips', tripError);
        break;
      }

      if (!tripRows || tripRows.length === 0) {
        console.log('[Pass C] No more trips to backfill. Done.');
        break;
      }

      console.log(`[Pass C] Processing batch of ${tripRows.length} trips...`);

      // Query 2 — resolve billing_type_id for the variants in this batch.
      // billing_variants.billing_type_id is NOT NULL (enforced by DB schema), so
      // every variant maps to exactly one type — no null-check needed on lookup.
      const variantIds = [
        ...new Set(tripRows.map((r) => r.billing_variant_id as string))
      ];
      const { data: variantRows, error: variantError } = await supabase
        .from('billing_variants')
        .select('id, billing_type_id')
        .in('id', variantIds);

      if (variantError) {
        console.error('[Pass C] Error fetching billing_variants', variantError);
        // Track all rows in this batch as processed so the loop advances.
        for (const r of tripRows) processedIdsC.push(r.id);
        totalTypeCErrors += tripRows.length;
        continue;
      }

      const variantTypeMap = new Map(
        (variantRows ?? []).map((r) => [r.id, r.billing_type_id])
      );

      for (const trip of tripRows) {
        processedIdsC.push(trip.id);

        const billingTypeId = variantTypeMap.get(
          trip.billing_variant_id as string
        );
        if (!billingTypeId) {
          // Variant row not found — should not happen given the DB constraint,
          // but guard defensively rather than writing null.
          console.warn(
            `[Pass C] No billing_type_id found for variant ${String(trip.billing_variant_id)} on trip ${trip.id} — skipping`
          );
          totalTypeCErrors++;
          continue;
        }

        if (DRY_RUN) {
          console.log(
            `[dry-run] Would set trip ${trip.id} billing_type_id=${billingTypeId}`
          );
          correctedTripIds.push(trip.id);
          totalTypeCorrected++;
          continue;
        }

        const { error: updateError } = await supabase
          .from('trips')
          .update({ billing_type_id: billingTypeId })
          .eq('id', trip.id);

        if (updateError) {
          console.error(
            `[Pass C] Failed to update trip ${trip.id}`,
            updateError
          );
          totalTypeCErrors++;
        } else {
          console.log(
            `[Pass C] Set billing_type_id=${billingTypeId} on trip ${trip.id}`
          );
          correctedTripIds.push(trip.id);
          totalTypeCorrected++;
        }
      }
    }

    // ── Selective Pass B re-run for corrected trips ────────────────────────────
    // Re-price only the trips whose billing_type_id was just corrected. This
    // is selective rather than a full Pass B re-run because the vast majority
    // of trips are already correctly priced; touching only the corrected IDs
    // avoids redundant context loads and spurious price overwrites.
    if (correctedTripIds.length > 0) {
      console.log(
        `\n[Pass C / re-run] Repricing ${correctedTripIds.length} corrected trips...`
      );
      const rerun = await runPriceForTripIds(
        correctedTripIds,
        supabase,
        emptyCtx
      );
      totalCRerunWritten += rerun.written;
      totalCRerunUnresolved += rerun.unresolved;
      totalCRerunErrors += rerun.errors;
    } else {
      console.log('[Pass C / re-run] No trips corrected — skipping re-price.');
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log('\n── Backfill summary ──────────────────────────────');
  if (RUN_PASS_A) {
    console.log('  Pass A — distance backfill');
    console.log(`    Trips processed : ${totalProcessed}`);
    console.log(
      `    Cache hits      : ${totalCacheHits} (${totalProcessed > 0 ? ((totalCacheHits / totalProcessed) * 100).toFixed(1) : 0}%)`
    );
    console.log(`    Google calls    : ${totalGoogleCalls}`);
    console.log(`    Errors / skipped: ${totalErrors}`);
  }
  if (RUN_PASS_B) {
    console.log('  Pass B — price backfill');
    console.log(`    Prices written  : ${totalPriceWritten}`);
    console.log(`    Unresolved      : ${totalPriceUnresolved}`);
    console.log(`    Fix-window fixes: ${totalFixWindowCorrected}`);
    console.log(`    Errors          : ${totalPriceBErrors}`);
  }
  if (RUN_PASS_C) {
    console.log('  Pass C — billing_type_id backfill');
    console.log(`    Trips corrected : ${totalTypeCorrected}`);
    console.log(`    Errors          : ${totalTypeCErrors}`);
    console.log(
      '  Pass C → Pass B re-run — price recalculation for corrected trips'
    );
    console.log(`    Prices written  : ${totalCRerunWritten}`);
    console.log(`    Unresolved      : ${totalCRerunUnresolved}`);
    console.log(`    Errors          : ${totalCRerunErrors}`);
  }
  if (DRY_RUN) console.log('  Mode            : DRY RUN — no writes made');
  console.log('──────────────────────────────────────────────────\n');

  // Suppress "unused" lint warning — COORD_PRECISION is imported so that the script
  // fails at build time if the constant is removed from google-directions.ts.
  void COORD_PRECISION;
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
