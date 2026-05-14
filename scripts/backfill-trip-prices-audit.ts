/**
 * Read-only audit: recomputes trip prices with the current engine (incl. pricing_basis /
 * normalizeRuleConfigToNet) and inserts rows into trip_price_backfill_audit for review.
 * Never updates trips.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Run: bun run backfill:audit
 */
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

import type { Database, TablesInsert } from '@/types/database.types';
import { resolvePricingRule } from '@/features/invoices/lib/resolve-pricing-rule';
import { resolveTripPrice } from '@/features/invoices/lib/resolve-trip-price';
import { resolveTaxRate } from '@/features/invoices/lib/tax-calculator';
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

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cutoffIsoThreeMonthsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString();
}

type AuditInsert = TablesInsert<'trip_price_backfill_audit'>;

async function main(): Promise<void> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const cutoff = cutoffIsoThreeMonthsAgo();

  let totalAudited = 0;
  let unchanged = 0;
  let changed = 0;
  let unresolved = 0;
  let skippedNoCompany = 0;
  let rowErrors = 0;

  let largestAbsDelta = 0;
  let largestDeltaTripId: string | null = null;

  try {
    for (let offset = 0; ; offset += BATCH) {
      const { data: rows, error: qErr } = await supabase
        .from('trips')
        .select(
          'id, company_id, payer_id, billing_type_id, billing_variant_id, client_id, driving_distance_km, scheduled_at, kts_document_applies, base_net_price, approach_fee_net, manual_gross_price, gross_price, tax_rate, net_price, created_at'
        )
        .gte('created_at', cutoff)
        .not('gross_price', 'is', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + BATCH - 1);

      if (qErr) {
        console.error('[backfill-trip-prices-audit] batch query failed', qErr);
        process.exit(1);
      }

      const batch = rows ?? [];
      if (batch.length === 0) break;

      for (const row of batch) {
        try {
          const tripId = row.id;
          const companyId = row.company_id;
          if (!companyId) {
            skippedNoCompany += 1;
            console.warn(
              `[backfill-trip-prices-audit] skip trip ${tripId}: missing company_id`
            );
            continue;
          }

          const computeInput: ComputeTripPriceInput = {
            payer_id: row.payer_id ?? null,
            billing_type_id: row.billing_type_id ?? null,
            billing_variant_id: row.billing_variant_id ?? null,
            client_id: row.client_id ?? null,
            driving_distance_km: row.driving_distance_km ?? null,
            scheduled_at: row.scheduled_at ?? null,
            kts_document_applies: row.kts_document_applies === true,
            net_price: null,
            base_net_price: row.base_net_price ?? null,
            manual_gross_price: row.manual_gross_price ?? null
          };

          const context = await loadPricingContext({
            supabase,
            companyId,
            payerId: row.payer_id ?? null,
            clientId: row.client_id ?? null
          });

          const { rate: taxRate } = resolveTaxRate(
            computeInput.driving_distance_km
          );

          const tripInput = {
            kts_document_applies: computeInput.kts_document_applies,
            net_price: computeInput.net_price,
            base_net_price: computeInput.base_net_price,
            manual_gross_price: computeInput.manual_gross_price ?? null,
            driving_distance_km: computeInput.driving_distance_km,
            scheduled_at: computeInput.scheduled_at,
            client:
              context.clientPriceTag !== null
                ? { price_tag: context.clientPriceTag }
                : null
          };

          const rule = resolvePricingRule({
            rules: context.rules,
            payerId: row.payer_id ?? '',
            billingTypeId: computeInput.billing_type_id,
            billingVariantId: computeInput.billing_variant_id,
            clientId: computeInput.client_id,
            clientPriceTags: context.clientPriceTags
          });

          const resolution = resolveTripPrice(tripInput, taxRate, rule);
          const fields = computeTripPrice(computeInput, context);

          const currentGross = num(row.gross_price);
          const currentNet = num(row.net_price);
          const currentBase = num(row.base_net_price);
          const currentApproach = num(row.approach_fee_net);
          const currentTax = num(row.tax_rate);

          let recalcGross: number | null = fields.gross_price;
          let recalcBase: number | null = fields.base_net_price;
          let recalcApproach: number | null = fields.approach_fee_net;
          let recalcTax: number | null = fields.tax_rate;

          let recalcNet: number | null = null;
          if (recalcGross !== null) {
            recalcNet = (recalcBase ?? 0) + (recalcApproach ?? 0);
          }

          const pricingBasisUsed = rule?.pricing_basis ?? null;
          const strategyUsed = resolution.strategy_used ?? null;
          const ruleId = rule?.id ?? null;

          if (fields.gross_price === null) {
            unresolved += 1;
            console.log(`${tripId} unresolved — skipped`);
            recalcGross = null;
            recalcNet = null;
            recalcBase = null;
            recalcApproach = null;
            recalcTax = null;
          }

          const payload: AuditInsert = {
            trip_id: tripId,
            company_id: companyId,
            current_gross_price: currentGross,
            current_net_price: currentNet,
            current_base_net_price: currentBase,
            current_approach_fee_net: currentApproach,
            current_tax_rate: currentTax,
            recalc_gross_price: recalcGross,
            recalc_net_price: recalcNet,
            recalc_base_net_price: recalcBase,
            recalc_approach_fee_net: recalcApproach,
            recalc_tax_rate: recalcTax,
            pricing_basis_used: pricingBasisUsed,
            strategy_used: strategyUsed,
            rule_id: ruleId
          };

          const { error: insErr } = await supabase
            .from('trip_price_backfill_audit')
            .insert(payload);

          if (insErr) {
            rowErrors += 1;
            console.error(
              `[backfill-trip-prices-audit] insert failed trip ${tripId}`,
              insErr
            );
            continue;
          }

          totalAudited += 1;

          if (fields.gross_price === null) {
            continue;
          }

          const cg = currentGross ?? 0;
          const rg = recalcGross ?? 0;
          const delta = round2(rg) - round2(cg);
          const abs = Math.abs(delta);
          if (abs > largestAbsDelta) {
            largestAbsDelta = abs;
            largestDeltaTripId = tripId;
          }

          if (round2(rg) === round2(cg)) {
            unchanged += 1;
          } else {
            changed += 1;
          }
        } catch (e) {
          rowErrors += 1;
          console.error(`[backfill-trip-prices-audit] trip ${row.id}`, e);
        }
      }
    }
  } catch (e) {
    console.error('[backfill-trip-prices-audit] fatal', e);
    process.exit(1);
  }

  const largestLabel =
    largestDeltaTripId !== null
      ? `${largestAbsDelta.toFixed(2)} € (trip_id: ${largestDeltaTripId})`
      : `0.00 € (trip_id: n/a)`;

  console.log(`Total trips audited: ${totalAudited}`);
  console.log(`Trips with no change (delta = 0.00): ${unchanged}`);
  console.log(`Trips with price change (needs_update = true): ${changed}`);
  console.log(`Largest gross delta: ${largestLabel}`);
  if (unresolved > 0 || skippedNoCompany > 0 || rowErrors > 0) {
    console.log(
      `(detail: unresolved=${unresolved}, skipped_no_company=${skippedNoCompany}, errors=${rowErrors})`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
