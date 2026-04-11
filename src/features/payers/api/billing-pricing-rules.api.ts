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

export type PricingRuleScopeLevel =
  | 'payer'
  | 'billing_type'
  | 'billing_variant';

/** One pricing rule plus UI context from joins (single-company list). */
export type BillingPricingRuleWithContext = BillingPricingRuleRow & {
  scope_level: PricingRuleScopeLevel;
  breadcrumb: string;
  /** Owning Kostenträger id for API scope payloads (always set). */
  payer_id_for_scope: string;
};

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

interface PayerNameEmbed {
  id: string;
  name: string;
}

interface BillingTypeJoinedEmbed {
  id: string;
  name: string;
  payer_id: string;
  payer: PayerNameEmbed | null;
}

interface BillingVariantJoinedEmbed {
  id: string;
  name: string;
  billing_type_id: string;
  billing_type: BillingTypeJoinedEmbed | null;
}

type BillingPricingRuleJoined = BillingPricingRuleRow & {
  payer: PayerNameEmbed | null;
  billing_type: BillingTypeJoinedEmbed | null;
  billing_variant: BillingVariantJoinedEmbed | null;
};

function mapJoinedRowToContext(
  row: BillingPricingRuleJoined
): BillingPricingRuleWithContext {
  const base: BillingPricingRuleRow = {
    id: row.id,
    company_id: row.company_id,
    payer_id: row.payer_id,
    billing_type_id: row.billing_type_id,
    billing_variant_id: row.billing_variant_id,
    strategy: row.strategy,
    config: row.config,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at
  };

  if (row.payer_id) {
    const payerName = row.payer?.name ?? '—';
    return {
      ...base,
      scope_level: 'payer',
      breadcrumb: payerName,
      payer_id_for_scope: row.payer_id
    };
  }

  if (row.billing_type_id && row.billing_type) {
    const t = row.billing_type;
    const payerName = t.payer?.name ?? '—';
    const typeName = t.name ?? '—';
    const payerIdForScope = t.payer_id || t.payer?.id || '';
    return {
      ...base,
      scope_level: 'billing_type',
      breadcrumb: `${payerName} › ${typeName}`,
      payer_id_for_scope: payerIdForScope
    };
  }

  if (row.billing_variant_id && row.billing_variant) {
    const v = row.billing_variant;
    const t = v.billing_type;
    const payerName = t?.payer?.name ?? '—';
    const typeName = t?.name ?? '—';
    const variantName = v.name ?? '—';
    const payerIdForScope = t?.payer_id || t?.payer?.id || '';
    return {
      ...base,
      scope_level: 'billing_variant',
      breadcrumb: `${payerName} › ${typeName} › ${variantName}`,
      payer_id_for_scope: payerIdForScope
    };
  }

  return {
    ...base,
    scope_level: 'payer',
    breadcrumb: '—',
    payer_id_for_scope: ''
  };
}

/**
 * Loads every `billing_pricing_rules` row for the session company in **one** PostgREST round-trip,
 * using **nested embeds** so payer / Abrechnungsfamilie / Unterart names resolve without N+1 queries.
 *
 * **FK aliases** in the `select` string (`payers!billing_pricing_rules_payer_id_fkey`, …) disambiguate
 * relationships when PostgREST would otherwise be unclear and keep the embed path stable across codegen.
 *
 * **`scope_level`**, **`breadcrumb`**, and **`payer_id_for_scope`** are computed in the mapper — they are
 * not database columns.
 *
 * The table constraint ensures **exactly one** of `payer_id`, `billing_type_id`, `billing_variant_id` is
 * set per row, so `payer_id_for_scope` can always be derived (direct payer row or via joined `billing_types.payer_id`).
 */
export async function listAllPricingRules(): Promise<
  BillingPricingRuleWithContext[]
> {
  const companyId = await getSessionCompanyId();
  const supabase = createClient();

  const select = `
    *,
    payer:payers!billing_pricing_rules_payer_id_fkey ( id, name ),
    billing_type:billing_types!billing_pricing_rules_billing_type_id_fkey (
      id, name, payer_id,
      payer:payers!billing_types_payer_id_fkey ( id, name )
    ),
    billing_variant:billing_variants!billing_pricing_rules_billing_variant_id_fkey (
      id, name, billing_type_id,
      billing_type:billing_types!billing_variants_billing_type_id_fkey (
        id, name, payer_id,
        payer:payers!billing_types_payer_id_fkey ( id, name )
      )
    )
  `;

  const { data, error } = await supabase
    .from('billing_pricing_rules')
    .select(select)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) throw toQueryError(error);

  const rows = (data ?? []) as BillingPricingRuleJoined[];
  return rows.map(mapJoinedRowToContext);
}

export function pricingRuleRowToScope(
  row: BillingPricingRuleWithContext
): PricingRuleScope {
  // Kostenträger-wide rule
  if (row.scope_level === 'payer') {
    return { kind: 'payer', payerId: row.payer_id! };
  }
  // Abrechnungsfamilie rule
  if (row.scope_level === 'billing_type') {
    return {
      kind: 'billing_type',
      payerId: row.payer_id_for_scope,
      billingTypeId: row.billing_type_id!
    };
  }
  // Unterart rule
  return {
    kind: 'billing_variant',
    payerId: row.payer_id_for_scope,
    billingVariantId: row.billing_variant_id!
  };
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
