import type { SupabaseClient } from '@supabase/supabase-js';

import type { DuplicateTripsPayload } from '@/features/trips/lib/duplicate-trip-schedule';
import {
  computeTripPrice,
  loadPricingContext,
  resolveTripForPricing,
  shouldRecalculatePrice
} from '@/features/trips/lib/trip-price-engine';
import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { Database } from '@/types/database.types';

export type Trip = Database['public']['Tables']['trips']['Row'];
export type InsertTrip = Database['public']['Tables']['trips']['Insert'];
export type UpdateTrip = Database['public']['Tables']['trips']['Update'];

/** Payer embed shape for trips list + kanban (`payers(name, reha_schein_enabled)`). */
export type TripListPayerEmbed = {
  name: string;
  reha_schein_enabled: boolean;
};

export type TripListRow = Trip & { payer: TripListPayerEmbed | null };

/** Row from `fetchTripInvoiceStatuses` — matches former list embed, for badge resolution. */
export type TripInvoiceStatusLineRow = {
  trip_id: string;
  invoice_id: string;
  invoices:
    | {
        status: string;
        paid_at: string | null;
        sent_at: string | null;
      }
    | {
        status: string;
        paid_at: string | null;
        sent_at: string | null;
      }[]
    | null;
};

// Fetches invoice status data for a specific set of trip IDs only.
// Separated from the main list query to avoid an expensive join on every
// page load — invoice status is secondary UI, not required for row rendering.
export async function fetchTripInvoiceStatuses(
  tripIds: string[],
  supabase: SupabaseClient
): Promise<TripInvoiceStatusLineRow[]> {
  if (tripIds.length === 0) return [];
  const { data, error } = await supabase
    .from('invoice_line_items')
    .select('trip_id, invoice_id, invoices(status, paid_at, sent_at)')
    .in('trip_id', tripIds)
    .not('trip_id', 'is', null);

  if (error) throw toQueryError(error);
  return (data ?? []) as TripInvoiceStatusLineRow[];
}

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
        '*, billing_variant:billing_variants(*, billing_types(name, color, behavior_profile)), clients(*), payers(*), driver:accounts!trips_driver_id_fkey(name), fremdfirma:fremdfirmen(id, name, default_payment_mode)'
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

    // Only recalculate when a pricing-relevant field is being changed.
    // Skipping for non-pricing updates (driver assignment, status, notes, etc.)
    // avoids unnecessary DB reads and context loads on high-frequency operations.
    if (shouldRecalculatePrice(trip)) {
      const tripInput = await resolveTripForPricing(supabase, id, trip);
      if (tripInput) {
        const context = await loadPricingContext({
          supabase,
          companyId: tripInput.company_id,
          payerId: tripInput.payer_id,
          clientId: tripInput.client_id
        }).catch((e) => {
          // A failed context load must never block a trip save.
          // Price fields are derived data; the trip record is the source of truth.
          console.error(
            '[trip-price-engine] loadPricingContext failed on edit',
            id,
            e
          );
          return null;
        });
        if (context) {
          Object.assign(trip, computeTripPrice(tripInput, context));
        }
      }
    }

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

  /**
   * POST body matches `parseDuplicateTripsPayload` — optional `includeLinkedLeg` (omitted ⇒ true),
   * optional `explicitPerLegUnifiedTimes` + per-leg ISOs for detail-sheet pair duplicates.
   */
  async duplicateTrips(
    payload: DuplicateTripsPayload
  ): Promise<{ created: number; ids: string[] }> {
    const res = await fetch('/api/trips/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      created?: number;
      ids?: string[];
    };

    if (!res.ok) {
      throw new Error(
        data.error || `Duplizieren fehlgeschlagen (${res.status})`
      );
    }

    return {
      created: data.created ?? 0,
      ids: data.ids ?? []
    };
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
  },

  /**
   * Get trips with billing_variant data for analytics (pie chart distribution)
   * Includes date range filtering support
   */
  async getTripsForAnalytics(dateRange?: { from: Date; to: Date }) {
    const supabase = createClient();
    let query = supabase
      .from('trips')
      .select(
        '*, billing_variant:billing_variants!trips_billing_variant_id_fkey(name, code, billing_types!billing_variants_billing_type_id_fkey(name, color))'
      )
      .order('scheduled_at', { ascending: false })
      .limit(1000000);

    if (dateRange?.from) {
      query = query.gte('scheduled_at', dateRange.from.toISOString());
    }
    if (dateRange?.to) {
      query = query.lte('scheduled_at', dateRange.to.toISOString());
    }

    const { data, error } = await query;

    if (error) throw toQueryError(error);
    return data;
  }
};
