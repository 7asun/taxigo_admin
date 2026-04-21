import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/database.types';

export type RecurringRule =
  Database['public']['Tables']['recurring_rules']['Row'];
export type InsertRecurringRule =
  Database['public']['Tables']['recurring_rules']['Insert'];
export type UpdateRecurringRule =
  Database['public']['Tables']['recurring_rules']['Update'];

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

  async createRule(rule: InsertRecurringRule) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('recurring_rules')
      .insert(rule)
      .select()
      .single();

    if (error) throw error;
    return data as RecurringRule;
  },

  async updateRule(id: string, rule: UpdateRecurringRule) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('recurring_rules')
      .update(rule)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as RecurringRule;
  },

  async deleteRule(id: string, deleteFutureTrips: boolean = false) {
    const supabase = createClient();

    if (deleteFutureTrips) {
      // Find trips linked to this rule that are scheduled for today or the future.
      // 1. rule_id === id
      // 2. requested_date >= today (ISO format YYYY-MM-DD)
      // 3. status is not completion-like (completed, cancelled)
      // 4. ingestion_source is either 'recurring_rule' (new ones) or NULL (old ones)
      const today = new Date().toISOString().split('T')[0];
      const { error: tripError } = await supabase
        .from('trips')
        .delete()
        .eq('rule_id', id)
        .gte('requested_date', today)
        .not('status', 'in', '("completed","cancelled")')
        .or('ingestion_source.eq.recurring_rule,ingestion_source.is.null');

      if (tripError) throw tripError;
    }

    const { error } = await supabase
      .from('recurring_rules')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
