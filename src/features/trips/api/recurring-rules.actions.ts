'use server';

import { geocodeRuleAddresses } from '@/lib/geocode-rule-addresses';
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
