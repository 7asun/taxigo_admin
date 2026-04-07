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
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    postal_code: row.postal_code,
    country: row.country,
    email: row.email
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
  }
};
