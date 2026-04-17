/**
 * Server-only reads for recurring rules (cross-client overview).
 *
 * Browser callers keep using `recurringRulesService` + `@/lib/supabase/client`;
 * this module uses `createClient` from `@/lib/supabase/server` so RSC pages never
 * import the `'use client'` Supabase client. `RecurringRuleWithClientEmbed` lives
 * here with the query because it describes only the PostgREST embed shape returned
 * by `getAllRules`.
 */

import { createClient } from '@/lib/supabase/server';
import type { RecurringRule } from './recurring-rules.service';

export type RecurringRuleWithClientEmbed = RecurringRule & {
  billing_variant: {
    id: string;
    name: string;
    code: string;
    billing_type_id: string;
    billing_types: { name: string; color: string | null } | null;
  } | null;
  clients: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
  /** Embedded payer for rules where only payer_id is set (no billing_variant). */
  payer: {
    id: string;
    name: string;
  } | null;
};

/**
 * All recurring rules for the authenticated org, with billing variant + client
 * embeds for the overview table. No `client_id` filter — cross-client by design.
 */
export async function getAllRules(): Promise<RecurringRuleWithClientEmbed[]> {
  const supabase = await createClient();
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
        clients (
          id,
          first_name,
          last_name
        ),
        payer:payers (
          id,
          name
        )
      `
    )
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as RecurringRuleWithClientEmbed[];
}
