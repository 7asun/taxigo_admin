/**
 * CRUD for `client_price_tags` — scoped gross prices per Fahrgast (global / Kostenträger / Unterart).
 * Used by Preisregeln dialog and invoice line-item resolution (loaded next to trips).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { Database } from '@/types/database.types';
import { getSessionCompanyId } from '@/features/payers/lib/session-company-id';
import type { ClientPriceTagLike } from '@/features/invoices/types/pricing.types';

export type ClientPriceTagRow =
  Database['public']['Tables']['client_price_tags']['Row'];
export type ClientPriceTagInsert =
  Database['public']['Tables']['client_price_tags']['Insert'];
export type ClientPriceTagUpdate =
  Database['public']['Tables']['client_price_tags']['Update'];

function toNumberGross(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return Number.NaN;
}

/** Map DB row to resolver shape (Supabase may return numeric as string). */
export function mapClientPriceTagRowToLike(
  row: ClientPriceTagRow
): ClientPriceTagLike {
  return {
    id: row.id,
    client_id: row.client_id,
    payer_id: row.payer_id,
    billing_variant_id: row.billing_variant_id,
    price_gross: toNumberGross(row.price_gross),
    is_active: row.is_active === true
  };
}

/**
 * All active tags for one client (admin Preisregeln manager).
 */
export async function listClientPriceTags(
  clientId: string
): Promise<ClientPriceTagLike[]> {
  await getSessionCompanyId();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('client_price_tags')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) throw toQueryError(error);
  return (data ?? []).map((r) =>
    mapClientPriceTagRowToLike(r as ClientPriceTagRow)
  );
}

export type ClientPriceTagManagerRow = ClientPriceTagRow & {
  payer: { name: string } | null;
  billing_variant: {
    name: string;
    code: string;
    billing_type: { name: string } | null;
  } | null;
};

/**
 * Tags for one client with payer/variant labels (Preisregeln dialog + Fahrgast panel).
 * Rows include base `client_price_tags` columns (aligned with `ClientPriceTagLike`) plus
 * `payer` / `billing_variant` embeds for scope labels.
 * Pass `supabaseClient` from a stable `useMemo(() => createClient(), [])` in React Query `queryFn`.
 */
export async function listClientPriceTagsForManager(
  clientId: string,
  supabaseClient?: SupabaseClient<Database>
): Promise<ClientPriceTagManagerRow[]> {
  await getSessionCompanyId();
  const supabase = supabaseClient ?? createClient();

  const { data, error } = await supabase
    .from('client_price_tags')
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
  return (data ?? []) as unknown as ClientPriceTagManagerRow[];
}

/**
 * Active tags for many clients in one round-trip (invoice builder after trip fetch).
 */
export async function listClientPriceTagsForClientIds(
  clientIds: string[]
): Promise<ClientPriceTagLike[]> {
  if (clientIds.length === 0) return [];
  await getSessionCompanyId();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('client_price_tags')
    .select('*')
    .in('client_id', clientIds)
    .eq('is_active', true);

  if (error) throw toQueryError(error);
  return (data ?? []).map((r) =>
    mapClientPriceTagRowToLike(r as ClientPriceTagRow)
  );
}

export type ClientPriceTagWithContext = ClientPriceTagRow & {
  client: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    is_company: boolean;
  } | null;
  payer: { id: string; name: string } | null;
  billing_variant: {
    id: string;
    name: string;
    code: string;
    billing_type: { name: string } | null;
  } | null;
};

/**
 * Company-wide list for Abrechnung → Preisregeln table (all tags; include inactive like billing rules).
 */
export async function listAllClientPriceTagsForCompany(): Promise<
  ClientPriceTagWithContext[]
> {
  const companyId = await getSessionCompanyId();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('client_price_tags')
    .select(
      `
      *,
      client:clients(id, first_name, last_name, company_name, is_company),
      payer:payers(id, name),
      billing_variant:billing_variants(id, name, code, billing_type:billing_types(name))
    `
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) throw toQueryError(error);
  return (data ?? []) as unknown as ClientPriceTagWithContext[];
}

export interface InsertClientPriceTagPayload {
  client_id: string;
  payer_id: string | null;
  billing_variant_id: string | null;
  price_gross: number;
}

export async function insertClientPriceTag(
  payload: InsertClientPriceTagPayload
): Promise<ClientPriceTagRow> {
  const companyId = await getSessionCompanyId();
  const supabase = createClient();

  const row: ClientPriceTagInsert = {
    company_id: companyId,
    client_id: payload.client_id,
    payer_id: payload.billing_variant_id ? null : payload.payer_id,
    billing_variant_id: payload.billing_variant_id,
    price_gross: payload.price_gross,
    is_active: true
  };

  const { data, error } = await supabase
    .from('client_price_tags')
    .insert(row)
    .select('*')
    .single();

  if (error) throw toQueryError(error);
  return data as ClientPriceTagRow;
}

export async function updateClientPriceTag(
  id: string,
  patch: { price_gross?: number; is_active?: boolean }
): Promise<void> {
  await getSessionCompanyId();
  const supabase = createClient();

  const update: ClientPriceTagUpdate = {
    ...patch,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('client_price_tags')
    .update(update)
    .eq('id', id);

  if (error) throw toQueryError(error);
}

/** Removes a scoped `client_price_tags` row from the database (hard delete). */
export async function deleteClientPriceTag(
  id: string,
  supabaseClient?: SupabaseClient<Database>
): Promise<void> {
  const supabase = supabaseClient ?? createClient();
  const { error } = await supabase
    .from('client_price_tags')
    .delete()
    .eq('id', id);
  if (error) throw toQueryError(error);
}
