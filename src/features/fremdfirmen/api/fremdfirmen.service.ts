import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { Database } from '@/types/database.types';

export type FremdfirmaRow = Database['public']['Tables']['fremdfirmen']['Row'];
export type FremdfirmaInsert =
  Database['public']['Tables']['fremdfirmen']['Insert'];
export type FremdfirmaUpdate =
  Database['public']['Tables']['fremdfirmen']['Update'];

export const FremdfirmenService = {
  async listAll(): Promise<FremdfirmaRow[]> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('fremdfirmen')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name');

    if (error) throw toQueryError(error);
    return data ?? [];
  },

  async create(row: FremdfirmaInsert): Promise<FremdfirmaRow> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('fremdfirmen')
      .insert(row)
      .select()
      .single();

    if (error) throw toQueryError(error);
    return data;
  },

  async update(id: string, patch: FremdfirmaUpdate): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('fremdfirmen')
      .update(patch)
      .eq('id', id);

    if (error) throw toQueryError(error);
  }
};
