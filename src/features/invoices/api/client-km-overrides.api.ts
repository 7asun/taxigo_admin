/**
 * CRUD for `client_km_overrides` — scoped km per Fahrgast (global / Kostenträger / Unterart).
 * Mirrors `client-price-tags.service.ts`; resolver consumes {@link ClientKmOverrideLike}.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { Database } from '@/types/database.types';
import { getSessionCompanyId } from '@/features/payers/lib/session-company-id';
import { type ClientKmOverrideLike } from '@/features/invoices/lib/resolve-effective-distance';

export type { ClientKmOverrideLike };

export type ClientKmOverrideRow =
  Database['public']['Tables']['client_km_overrides']['Row'];
export type ClientKmOverrideInsert =
  Database['public']['Tables']['client_km_overrides']['Insert'];
export type ClientKmOverrideUpdate =
  Database['public']['Tables']['client_km_overrides']['Update'];

function mapRowToLike(row: ClientKmOverrideRow): ClientKmOverrideLike {
  return {
    client_id: row.client_id,
    payer_id: row.payer_id,
    billing_variant_id: row.billing_variant_id,
    distance_km: row.distance_km,
    is_active: row.is_active === true
  };
}

export type ClientKmOverrideManagerRow = ClientKmOverrideRow & {
  payer: { name: string } | null;
  billing_variant: {
    name: string;
    code: string;
    billing_type: { name: string | null } | null;
  } | null;
};

export async function listClientKmOverridesForManager(
  clientId: string,
  supabaseClient?: SupabaseClient<Database>
): Promise<ClientKmOverrideManagerRow[]> {
  await getSessionCompanyId();
  const supabase = supabaseClient ?? createClient();

  const { data, error } = await supabase
    .from('client_km_overrides')
    .select(
      `
      *,
      payer:payers(name),
      billing_variant:billing_variants(name, code, billing_type:billing_types(name))
    `
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) throw toQueryError(error);
  return (data ?? []) as unknown as ClientKmOverrideManagerRow[];
}

export async function listClientKmOverridesForClientIds(
  clientIds: string[]
): Promise<ClientKmOverrideLike[]> {
  if (clientIds.length === 0) return [];
  await getSessionCompanyId();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('client_km_overrides')
    .select('*')
    .in('client_id', clientIds)
    .eq('is_active', true);

  if (error) throw toQueryError(error);
  return (data ?? []).map((r) => mapRowToLike(r as ClientKmOverrideRow));
}

export interface InsertClientKmOverridePayload {
  client_id: string;
  payer_id: string | null;
  billing_variant_id: string | null;
  distance_km: number;
}

export async function insertClientKmOverride(
  payload: InsertClientKmOverridePayload
): Promise<ClientKmOverrideRow> {
  const companyId = await getSessionCompanyId();
  const supabase = createClient();

  const row: ClientKmOverrideInsert = {
    company_id: companyId,
    client_id: payload.client_id,
    payer_id: payload.billing_variant_id ? null : payload.payer_id,
    billing_variant_id: payload.billing_variant_id,
    distance_km: payload.distance_km,
    is_active: true
  };

  const { data, error } = await supabase
    .from('client_km_overrides')
    .insert(row)
    .select('*')
    .single();

  if (error) throw toQueryError(error);
  return data as ClientKmOverrideRow;
}

export async function updateClientKmOverride(
  id: string,
  distance_km: number
): Promise<void> {
  await getSessionCompanyId();
  const supabase = createClient();

  const update: ClientKmOverrideUpdate = {
    distance_km,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('client_km_overrides')
    .update(update)
    .eq('id', id);

  if (error) throw toQueryError(error);
}

export async function deleteClientKmOverride(
  id: string,
  supabaseClient?: SupabaseClient<Database>
): Promise<void> {
  const supabase = supabaseClient ?? createClient();
  const { error } = await supabase
    .from('client_km_overrides')
    .delete()
    .eq('id', id);
  if (error) throw toQueryError(error);
}
