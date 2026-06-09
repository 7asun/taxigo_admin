import { applyEndDateShortenCleanupFilters } from '@/features/trips/lib/recurring-trip-cleanup-predicate';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/database.types';

export type RecurringRule =
  Database['public']['Tables']['recurring_rules']['Row'];
export type InsertRecurringRule =
  Database['public']['Tables']['recurring_rules']['Insert'];
export type UpdateRecurringRule =
  Database['public']['Tables']['recurring_rules']['Update'];

/** Creates/updates via [`recurring-rules.actions.ts`](./recurring-rules.actions.ts) — server geocoding (Plan C). */

/** List rows: `billing_variant` join for `formatBillingDisplayLabel` (same embed shape as trips). */
export type RecurringRuleWithBillingEmbed = RecurringRule & {
  billing_variant: {
    id: string;
    name: string;
    code: string;
    billing_type_id: string;
    billing_types: unknown;
  } | null;
  payer: {
    name: string;
  } | null;
};

export const recurringRulesService = {
  async getClientRules(clientId: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('recurring_rules')
      .select(
        `
        *,
        billing_variant:billing_variants (
          id,
          name,
          code,
          billing_type_id,
          billing_types ( name, color )
        ),
        payer:payers ( name )
      `
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as RecurringRuleWithBillingEmbed[];
  },

  async getRuleById(id: string) {
    if (!id) return null;
    const supabase = createClient();
    const { data, error } = await supabase
      .from('recurring_rules')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as RecurringRule | null;
  },

  /**
   * WHY: shown in ShortenEndDateDialog before destructive cleanup — count must match
   * `deleteFutureTripsAfterDate` exactly (see `applyEndDateShortenCleanupFilters`).
   */
  async countFutureTripsAfterDate(
    ruleId: string,
    afterYmd: string
  ): Promise<number> {
    const supabase = createClient();
    let query = supabase
      .from('trips')
      .select('id', { count: 'exact', head: true });
    query = applyEndDateShortenCleanupFilters(query, ruleId, afterYmd);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  },

  async deleteRule(id: string, deleteFutureTrips: boolean = false) {
    const supabase = createClient();

    if (deleteFutureTrips) {
      // WHY status filter differs from deleteFutureTripsAfterDate (end-date shorten):
      // Rule delete = teardown → remove all non-terminal future trips (assigned/in_progress too).
      // End-date shorten = surgical → pending only; assigned/in_progress preserved for dispatcher.
      // Do NOT change this to .eq('status', 'pending') without a product review.
      //
      // Find trips linked to this rule that are scheduled for today or the future.
      // 1. rule_id === id (authoritative recurring link — no ingestion_source filter;
      //    that column does not exist in the live DB)
      // 2. requested_date >= today (ISO format YYYY-MM-DD)
      // 3. status is not completion-like (completed, cancelled)
      // WHY: toISOString().split('T')[0] is UTC calendar date —
      // near Berlin midnight (00:00–02:00 CEST) it is "yesterday"
      // in UTC while operations are already on the next Berlin day.
      // todayYmdInBusinessTz() returns the correct Berlin civil date
      // so requested_date >= today matches dispatcher intent.
      const today = todayYmdInBusinessTz();
      const { error: tripError } = await supabase
        .from('trips')
        .delete()
        .eq('rule_id', id)
        .gte('requested_date', today)
        .not('status', 'in', '("completed","cancelled")');

      if (tripError) throw tripError;
    }

    const { error } = await supabase
      .from('recurring_rules')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
