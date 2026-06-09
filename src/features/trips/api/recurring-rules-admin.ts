/**
 * Server-only admin context for recurring-rules mutations that need tenant guards.
 */

import { createClient } from '@/lib/supabase/server';

export type RecurringRulesAdminContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  companyId: string;
  userId: string;
};

export async function requireAdminContext(): Promise<RecurringRulesAdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Unauthorized');
  }

  const { data: account, error: accError } = await supabase
    .from('accounts')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (accError) {
    throw new Error(accError.message);
  }

  if (
    account?.role !== 'admin' ||
    account.company_id == null ||
    account.company_id === ''
  ) {
    throw new Error('Forbidden');
  }

  return { supabase, companyId: account.company_id, userId: user.id };
}

/**
 * WHY: on-demand generation and end-date cleanup use service role internally;
 * session client still needs tenant guard before trusting a ruleId.
 */
export async function assertRuleBelongsToCompany(
  ctx: RecurringRulesAdminContext,
  ruleId: string
): Promise<void> {
  const { data: rule, error: ruleError } = await ctx.supabase
    .from('recurring_rules')
    .select('id, client_id')
    .eq('id', ruleId)
    .maybeSingle();

  if (ruleError) {
    throw new Error(ruleError.message);
  }

  if (!rule?.client_id) {
    throw new Error('Rule not found');
  }

  const { data: client, error: clientError } = await ctx.supabase
    .from('clients')
    .select('company_id')
    .eq('id', rule.client_id)
    .maybeSingle();

  if (clientError) {
    throw new Error(clientError.message);
  }

  if (!client || client.company_id !== ctx.companyId) {
    throw new Error('Forbidden');
  }
}
