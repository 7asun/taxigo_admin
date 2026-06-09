import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { Database } from '@/types/database.types';
import { getSessionCompanyId } from '@/features/payers/lib/session-company-id';

export type RechnungsempfaengerRow =
  Database['public']['Tables']['rechnungsempfaenger']['Row'];
export type RechnungsempfaengerInsert =
  Database['public']['Tables']['rechnungsempfaenger']['Insert'];
export type RechnungsempfaengerUpdate =
  Database['public']['Tables']['rechnungsempfaenger']['Update'];

export function rechnungsempfaengerRowToSnapshot(
  row: RechnungsempfaengerRow
): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    anrede: row.anrede,
    first_name: row.first_name,
    last_name: row.last_name,
    company_name: row.company_name,
    abteilung: row.abteilung,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    postal_code: row.postal_code,
    country: row.country,
    email: row.email,
    phone: row.phone
  };
}

export interface AdhocRecipientFormValues {
  anrede?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  abteilung?: string | null;
  address_line1: string;
  address_line2?: string | null;
  postal_code: string;
  city: string;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Builds the same JSON shape as catalog snapshots — for one-time Step 4 entry. */
export function adhocRecipientFormToSnapshot(
  form: AdhocRecipientFormValues
): Record<string, unknown> {
  // why: recipientFromRechnungsempfaengerSnapshot checks snap.name before structured
  // fields — synthesise a display name so legacy PDF parsing never returns null.
  const name =
    form.company_name?.trim() ||
    [form.first_name, form.last_name].filter(Boolean).join(' ') ||
    form.city;

  return {
    // why: explicit null — no catalog row; consumers must not FK-resolve this id.
    id: null,
    name,
    anrede: form.anrede ?? null,
    first_name: form.first_name ?? null,
    last_name: form.last_name ?? null,
    company_name: form.company_name ?? null,
    abteilung: form.abteilung ?? null,
    address_line1: form.address_line1,
    address_line2: form.address_line2 ?? null,
    postal_code: form.postal_code,
    city: form.city,
    country: form.country ?? null,
    phone: form.phone ?? null,
    email: form.email ?? null
  };
}

export const RechnungsempfaengerService = {
  async getById(id: string): Promise<RechnungsempfaengerRow | null> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('rechnungsempfaenger')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw toQueryError(error);
    return data;
  },

  async listAll(): Promise<RechnungsempfaengerRow[]> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('rechnungsempfaenger')
      .select('*')
      .order('name');
    if (error) throw toQueryError(error);
    return data ?? [];
  },

  async listActive(): Promise<RechnungsempfaengerRow[]> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('rechnungsempfaenger')
      .select('*')
      .eq('is_active', true)
      .order('name');
    if (error) throw toQueryError(error);
    return data ?? [];
  },

  async create(
    row: Omit<RechnungsempfaengerInsert, 'company_id'>
  ): Promise<RechnungsempfaengerRow> {
    const companyId = await getSessionCompanyId();
    const supabase = createClient();
    const { data, error } = await supabase
      .from('rechnungsempfaenger')
      .insert({ ...row, company_id: companyId })
      .select()
      .single();
    if (error) throw toQueryError(error);
    return data;
  },

  async update(id: string, patch: RechnungsempfaengerUpdate): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('rechnungsempfaenger')
      .update(patch)
      .eq('id', id);
    if (error) throw toQueryError(error);
  },

  async delete(id: string): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('rechnungsempfaenger')
      .delete()
      .eq('id', id);
    if (error) throw toQueryError(error);
  }
};
