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
        )
      `
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as RecurringRuleWithBillingEmbed[];
  },

  async getRuleById(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('recurring_rules')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as RecurringRule;
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

  async deleteRule(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from('recurring_rules')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
