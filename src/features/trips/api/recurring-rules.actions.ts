'use server';

import {
  assertRuleBelongsToCompany,
  requireAdminContext
} from '@/features/trips/api/recurring-rules-admin';
import { applyEndDateShortenCleanupFilters } from '@/features/trips/lib/recurring-trip-cleanup-predicate';
import {
  computeResyncScheduledAt,
  exceptionOriginalPickupTimeKey
} from '@/features/trips/lib/recurring-trip-schedule';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
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
 * Bulk-patches `scheduled_at` on all future pending trips linked to a rule when
 * schedule-relevant fields (`pickup_time`, `return_time`, `return_mode`) change.
 *
 * WHY pending-only: completed, invoiced, and assigned trips are immutable for
 * rescheduling purposes — only the dispatcher flow may touch those.
 *
 * WHY Berlin date for "today": `requested_date` is a civil Berlin calendar day;
 * comparing against raw UTC `new Date()` could match yesterday's trips near midnight.
 * `todayYmdInBusinessTz()` returns the correct Berlin civil date (same pattern as
 * `deleteRule` in recurring-rules.service.ts).
 *
 * WHY priorRule for exception skip: `recurring_rule_exceptions.original_pickup_time`
 * was stamped at materialisation time using the rule's clock at THAT moment. Passing
 * the new schedule instead of priorRule would invert the key lookup and silently
 * overwrite exception-protected trips. See rule 9 in the implementation plan.
 *
 * WHY batch by value + chunk to 500: Supabase `.in()` has a practical ~1,000 row limit.
 * Grouping by identical `scheduled_at` reduces the number of UPDATE statements, and
 * chunking each group to 500 IDs stays safely within the limit.
 */
export async function resyncFutureRecurringTrips(
  ruleId: string,
  schedule: {
    pickup_time: string | null;
    return_time: string | null;
    return_mode: string;
  },
  priorRule: RecurringRule
): Promise<{ resynced: number }> {
  const ctx = await requireAdminContext();
  await assertRuleBelongsToCompany(ctx, ruleId);

  const today = todayYmdInBusinessTz();

  // 1. All future pending trips for this rule
  const { data: trips, error: tripsError } = await ctx.supabase
    .from('trips')
    .select('id, requested_date, link_type, scheduled_at')
    .eq('rule_id', ruleId)
    .eq('status', 'pending')
    .gte('requested_date', today)
    .not('requested_date', 'is', null);

  if (tripsError) throw new Error(tripsError.message);
  if (!trips || trips.length === 0) return { resynced: 0 };

  // 2. Exceptions for this rule in the same window — used to skip exception-derived legs
  const { data: exceptions, error: exceptionsError } = await ctx.supabase
    .from('recurring_rule_exceptions')
    .select(
      'exception_date, original_pickup_time, modified_pickup_time, modified_pickup_address, modified_dropoff_address'
    )
    .eq('rule_id', ruleId)
    .gte('exception_date', today);

  if (exceptionsError) throw new Error(exceptionsError.message);

  // Build a lookup set of "(date)::(original_pickup_time)" keys for exception rows that
  // carry an actual override (as opposed to a cancelled occurrence with all nulls).
  const exceptionSet = new Set<string>(
    (exceptions ?? [])
      .filter(
        (e) =>
          e.modified_pickup_time != null ||
          e.modified_pickup_address != null ||
          e.modified_dropoff_address != null
      )
      .map((e) => `${e.exception_date}::${e.original_pickup_time}`)
  );

  // 3. Compute new scheduled_at per trip and group by value
  const grouped = new Map<string | null, string[]>();

  for (const trip of trips) {
    // Return legs with new return_mode 'none' have no applicable schedule; skip
    if (trip.link_type === 'return' && schedule.return_mode === 'none')
      continue;

    // Derive the exception key using priorRule (pre-update) times — NOT schedule.
    // WHY: original_pickup_time was stamped at generation time using the old rule clock.
    // Inverting to the new schedule would cause exception-protected legs to be overwritten.
    const exceptionKey = exceptionOriginalPickupTimeKey(trip, priorRule);
    if (exceptionKey !== null) {
      const lookupKey = `${trip.requested_date}::${exceptionKey}`;
      if (exceptionSet.has(lookupKey)) continue;
    }

    const newAt = computeResyncScheduledAt(trip, schedule);
    const currentAt = trip.scheduled_at ?? null;
    // Skip trips where scheduled_at is already correct
    if (newAt === currentAt) continue;

    const bucket = grouped.get(newAt);
    if (bucket) {
      bucket.push(trip.id);
    } else {
      grouped.set(newAt, [trip.id]);
    }
  }

  if (grouped.size === 0) return { resynced: 0 };

  // 4. Batch update: one UPDATE per unique scheduled_at value, chunked to 500 IDs per call
  const CHUNK_SIZE = 500;
  let resynced = 0;

  for (const [newAt, ids] of grouped) {
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const { error } = await ctx.supabase
        .from('trips')
        .update({ scheduled_at: newAt })
        .in('id', chunk);
      if (error) throw new Error(error.message);
      resynced += chunk.length;
    }
  }

  return { resynced };
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
