/**
 * CRUD for billing_pricing_rules — catalog admin (Kostenträger UI).
 * Validates config with Zod before write.
 */
import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { Database } from '@/types/database.types';
import {
  billingPricingRuleUpsertSchema,
  type BillingPricingRuleUpsert
} from '@/features/invoices/lib/pricing-rule-config.schema';
import { getSessionCompanyId } from '@/features/payers/lib/session-company-id';

export type BillingPricingRuleRow =
  Database['public']['Tables']['billing_pricing_rules']['Row'];
export type BillingPricingRuleInsert =
  Database['public']['Tables']['billing_pricing_rules']['Insert'];
export type BillingPricingRuleUpdate =
  Database['public']['Tables']['billing_pricing_rules']['Update'];

export type PricingRuleScope =
  | { kind: 'payer'; payerId: string }
  | { kind: 'billing_type'; payerId: string; billingTypeId: string }
  | { kind: 'billing_variant'; payerId: string; billingVariantId: string };

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === '23505';
}

export function pricingRulesErrorMessage(err: unknown): string {
  if (isUniqueViolation(err)) {
    return 'Für diese Ebene ist bereits eine aktive Preisregel vorhanden. Bitte die bestehende Regel zuerst deaktivieren.';
  }
  if (err instanceof Error) return err.message;
  return 'Preisregel konnte nicht gespeichert werden.';
}

/** Rules that belong to this payer’s catalog (payer / its families / its variants). */
export async function listPricingRulesForPayer(
  payerId: string
): Promise<BillingPricingRuleRow[]> {
  const companyId = await getSessionCompanyId();
  const supabase = createClient();

  const { data: types, error: tErr } = await supabase
    .from('billing_types')
    .select('id')
    .eq('payer_id', payerId);
  if (tErr) throw toQueryError(tErr);
  const typeIds = (types ?? []).map((r) => r.id);

  let variantIds: string[] = [];
  if (typeIds.length > 0) {
    const { data: vars, error: vErr } = await supabase
      .from('billing_variants')
      .select('id')
      .in('billing_type_id', typeIds);
    if (vErr) throw toQueryError(vErr);
    variantIds = (vars ?? []).map((r) => r.id);
  }

  const { data: allRows, error } = await supabase
    .from('billing_pricing_rules')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) throw toQueryError(error);
  const rows = allRows ?? [];

  const typeSet = new Set(typeIds);
  const varSet = new Set(variantIds);

  return rows.filter((r) => {
    if (r.payer_id === payerId) return true;
    if (r.billing_type_id && typeSet.has(r.billing_type_id)) return true;
    if (r.billing_variant_id && varSet.has(r.billing_variant_id)) return true;
    return false;
  });
}

export interface CreatePricingRulePayload {
  strategy: BillingPricingRuleUpsert['strategy'];
  config: BillingPricingRuleUpsert['config'];
  scope: PricingRuleScope;
}

export async function createPricingRule(
  payload: CreatePricingRulePayload
): Promise<BillingPricingRuleRow> {
  const parsed = billingPricingRuleUpsertSchema.parse({
    strategy: payload.strategy,
    config: payload.config
  });
  const companyId = await getSessionCompanyId();
  const supabase = createClient();

  const base = {
    company_id: companyId,
    strategy: parsed.strategy,
    config: parsed.config as BillingPricingRuleInsert['config'],
    is_active: true
  };

  let insert: BillingPricingRuleInsert;
  if (payload.scope.kind === 'payer') {
    insert = {
      ...base,
      payer_id: payload.scope.payerId,
      billing_type_id: null,
      billing_variant_id: null
    };
  } else if (payload.scope.kind === 'billing_type') {
    insert = {
      ...base,
      payer_id: null,
      billing_type_id: payload.scope.billingTypeId,
      billing_variant_id: null
    };
  } else {
    insert = {
      ...base,
      payer_id: null,
      billing_type_id: null,
      billing_variant_id: payload.scope.billingVariantId
    };
  }

  const { data, error } = await supabase
    .from('billing_pricing_rules')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return data as BillingPricingRuleRow;
}

export async function updatePricingRule(
  id: string,
  patch: {
    strategy?: BillingPricingRuleRow['strategy'];
    config?: unknown;
    is_active?: boolean;
  }
): Promise<void> {
  const supabase = createClient();

  const update: BillingPricingRuleUpdate = {
    ...(patch.is_active !== undefined ? { is_active: patch.is_active } : {}),
    updated_at: new Date().toISOString()
  };

  if (patch.strategy !== undefined && patch.config !== undefined) {
    const parsed = billingPricingRuleUpsertSchema.parse({
      strategy: patch.strategy,
      config: patch.config
    });
    update.strategy = parsed.strategy;
    update.config = parsed.config as BillingPricingRuleUpdate['config'];
  } else if (patch.config !== undefined) {
    const { data: row, error: gErr } = await supabase
      .from('billing_pricing_rules')
      .select('strategy')
      .eq('id', id)
      .single();
    if (gErr) throw toQueryError(gErr);
    const parsed = billingPricingRuleUpsertSchema.parse({
      strategy: row.strategy as BillingPricingRuleUpsert['strategy'],
      config: patch.config
    });
    update.strategy = parsed.strategy;
    update.config = parsed.config as BillingPricingRuleUpdate['config'];
  }

  const { error } = await supabase
    .from('billing_pricing_rules')
    .update(update)
    .eq('id', id);

  if (error) throw error;
}

export async function deletePricingRule(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('billing_pricing_rules')
    .delete()
    .eq('id', id);
  if (error) throw toQueryError(error);
}
