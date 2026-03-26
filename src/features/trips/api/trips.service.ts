import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { Database } from '@/types/database.types';

export type Trip = Database['public']['Tables']['trips']['Row'];
export type InsertTrip = Database['public']['Tables']['trips']['Insert'];
export type UpdateTrip = Database['public']['Tables']['trips']['Update'];

export const tripsService = {
  async getTrips() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .order('scheduled_at', { ascending: false });

    if (error) throw toQueryError(error);
    return data;
  },

  async getTripById(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('trips')
      .select(
        '*, billing_variant:billing_variants(*, billing_types(name, color, behavior_profile)), clients(*), payers(*), driver:accounts!trips_driver_id_fkey(name)'
      )
      .eq('id', id)
      .single();

    if (error) throw toQueryError(error);
    return data;
  },

  async createTrip(trip: InsertTrip) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('trips')
      .insert(trip)
      .select()
      .single();

    if (error) throw toQueryError(error);
    return data;
  },

  async bulkCreateTrips(trips: InsertTrip[]) {
    const supabase = createClient();
    const { data, error } = await supabase.from('trips').insert(trips).select();

    if (error) throw toQueryError(error);
    return data;
  },

  async updateTrip(id: string, trip: UpdateTrip) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('trips')
      .update(trip)
      .eq('id', id)
      .select()
      .single();

    if (error) throw toQueryError(error);
    return data;
  },

  async deleteTrip(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from('trips').delete().eq('id', id);

    if (error) throw toQueryError(error);
  },

  /**
   * Hard-delete trips via server API (service role + company check). Browser Supabase
   * clients often cannot DELETE under RLS even when SELECT/UPDATE work.
   */
  async deleteTripsPermanently(ids: string[]): Promise<void> {
    const res = await fetch('/api/trips/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });

    const payload = (await res.json().catch(() => ({}))) as { error?: string };

    if (!res.ok) {
      throw new Error(
        payload.error || `Löschen fehlgeschlagen (${res.status})`
      );
    }
  },

  async getUpcomingTrips(startDate: string, endDate: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('trips')
      .select(
        '*, driver:accounts!trips_driver_id_fkey(name), payer:payers(name), billing_variant:billing_variants!trips_billing_variant_id_fkey(name, code, billing_types!billing_variants_billing_type_id_fkey(name, color))'
      )
      .gte('scheduled_at', startDate)
      .lte('scheduled_at', endDate)
      .order('scheduled_at', { ascending: true });

    if (error) throw toQueryError(error);
    return data;
  }
};
