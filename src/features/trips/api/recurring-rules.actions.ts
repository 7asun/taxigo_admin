'use server';

import {
  assertRuleBelongsToCompany,
  requireAdminContext
} from '@/features/trips/api/recurring-rules-admin';
import { applyEndDateShortenCleanupFilters } from '@/features/trips/lib/recurring-trip-cleanup-predicate';
import { geocodeRuleAddresses } from '@/lib/geocode-rule-addresses';
import { generateRecurringTrips } from '@/lib/recurring-trip-generator';
import { createClient } from '@/lib/supabase/server';
import type {
  InsertRecurringRule,
  RecurringRule,
  UpdateRecurringRule
} from '@/features/trips/api/recurring-rules.service';

/**
 * WHY: Geocoding uses server-only env; browser `recurring-rules.service`
 * cannot call Google. These actions run on the server with cookie auth.
 */
export async function createRecurringRule(
  rule: InsertRecurringRule
): Promise<{ data: RecurringRule | null; error: string | null }> {
  const supabase = await createClient();
  const coords = await geocodeRuleAddresses(
    rule.pickup_address,
    rule.dropoff_address
  );
  const { data, error } = await supabase
    .from('recurring_rules')
    .insert({ ...rule, ...coords })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data as RecurringRule, error: null };
}

export async function updateRecurringRule(
  id: string,
  payload: UpdateRecurringRule
): Promise<{ data: RecurringRule | null; error: string | null }> {
  const supabase = await createClient();

  const pickupInPayload = typeof payload.pickup_address === 'string';
  const dropoffInPayload = typeof payload.dropoff_address === 'string';

  let updates: UpdateRecurringRule = { ...payload };

  if (pickupInPayload || dropoffInPayload) {
    const { data: existing, error: fetchError } = await supabase
      .from('recurring_rules')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return {
        data: null,
        error: fetchError?.message ?? 'Rule not found'
      };
    }

    const nextPickup = pickupInPayload
      ? payload.pickup_address!
      : existing.pickup_address;
    const nextDropoff = dropoffInPayload
      ? payload.dropoff_address!
      : existing.dropoff_address;

    const addressesChanged =
      (pickupInPayload && payload.pickup_address !== existing.pickup_address) ||
      (dropoffInPayload &&
        payload.dropoff_address !== existing.dropoff_address);

    if (addressesChanged) {
      const coords = await geocodeRuleAddresses(nextPickup, nextDropoff);
      updates = { ...updates, ...coords };
    }
  }

  const { data, error } = await supabase
    .from('recurring_rules')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data as RecurringRule, error: null };
}

/**
 * WHY: isolated from `updateRecurringRule` so cleanup runs only after AlertDialog confirm.
 * Predicate matches `countFutureTripsAfterDate` via `applyEndDateShortenCleanupFilters`.
 */
export async function deleteFutureTripsAfterDate(
  ruleId: string,
  afterYmd: string
): Promise<{ deleted: number; error: string | null }> {
  try {
    const ctx = await requireAdminContext();
    await assertRuleBelongsToCompany(ctx, ruleId);

    let query = ctx.supabase.from('trips').delete().select('id');
    query = applyEndDateShortenCleanupFilters(query, ruleId, afterYmd);
    const { data, error } = await query;

    if (error) {
      return { deleted: 0, error: error.message };
    }
    return { deleted: data?.length ?? 0, error: null };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { deleted: 0, error: message };
  }
}

/**
 * WHY: server action avoids exposing CRON_SECRET; generation uses service role in-process.
 */
export async function triggerGenerationForRule(
  ruleId: string
): Promise<{ generated: number; error: string | null }> {
  try {
    const ctx = await requireAdminContext();
    await assertRuleBelongsToCompany(ctx, ruleId);

    const result = await generateRecurringTrips({ ruleId });
    return { generated: result.generated, error: null };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { generated: 0, error: message };
  }
}
