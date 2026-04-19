import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type {
  UnassignedTrip,
  BillingVariantWithType,
  UnassignedTripsByPayer
} from '../types/unassigned-trips.types';

export const unassignedTripsService = {
  /**
   * Fetch all trips with billing_variant_id = null
   */
  async getUnassignedTrips(
    payerIds: string[] = [],
    dateFrom: string | null = null,
    dateTo: string | null = null
  ): Promise<UnassignedTrip[]> {
    const supabase = createClient();
    let query = supabase
      .from('trips')
      .select(
        `
        id,
        scheduled_at,
        pickup_address,
        dropoff_address,
        driving_distance_km,
        net_price,
        link_type,
        linked_trip_id,
        kts_document_applies,
        payer_id,
        payer:payers(id, name)
      `
      )
      .is('billing_variant_id', null)
      .order('payer_id')
      .order('scheduled_at');

    if (payerIds.length > 0) {
      query = query.in('payer_id', payerIds);
    }

    if (dateFrom) {
      query = query.gte('scheduled_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('scheduled_at', dateTo);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching unassigned trips:', error);
      throw toQueryError(error);
    }

    return (data || []) as unknown as UnassignedTrip[];
  },

  /**
   * Fetch billing variants for a specific payer
   */
  async getBillingVariantsForPayer(
    payerId: string
  ): Promise<BillingVariantWithType[]> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('billing_variants')
      .select(
        `
        id,
        name,
        code,
        billing_type_id,
        sort_order,
        kts_default,
        no_invoice_required_default,
        rechnungsempfaenger_id,
        created_at,
        billing_type:billing_types!inner(name)
      `
      )
      .eq('billing_types.payer_id', payerId)
      .order('sort_order');

    if (error) {
      console.error('Error fetching billing variants:', error);
      throw toQueryError(error);
    }

    return (data || []) as unknown as BillingVariantWithType[];
  },

  /**
   * Bulk assign billing variant to trips
   */
  async assignBillingVariant(
    tripIds: string[],
    billingVariantId: string
  ): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('trips')
      .update({ billing_variant_id: billingVariantId })
      .in('id', tripIds);

    if (error) {
      console.error('Error assigning billing variant:', error);
      throw toQueryError(error);
    }
  },

  /**
   * Get grouped trips by payer with their billing variants
   */
  async getUnassignedTripsGrouped(
    payerIds: string[] = [],
    dateFrom: string | null = null,
    dateTo: string | null = null
  ): Promise<UnassignedTripsByPayer[]> {
    const trips = await this.getUnassignedTrips(payerIds, dateFrom, dateTo);

    // Group by payer
    const grouped = trips.reduce(
      (acc, trip) => {
        const payerId = trip.payer_id || 'no-payer';
        const payerName = trip.payer?.name || 'Kein Kostenträger';

        if (!acc[payerId]) {
          acc[payerId] = {
            payerId,
            payerName,
            trips: [],
            billingVariants: []
          };
        }
        acc[payerId].trips.push(trip);
        return acc;
      },
      {} as Record<string, UnassignedTripsByPayer>
    );

    // Fetch billing variants for each payer
    const result = await Promise.all(
      Object.values(grouped).map(async (group) => {
        if (group.payerId !== 'no-payer') {
          try {
            group.billingVariants = await this.getBillingVariantsForPayer(
              group.payerId
            );
          } catch (err) {
            console.error(
              `Failed to load billing variants for payer ${group.payerId}:`,
              err
            );
            group.billingVariants = [];
          }
        }
        return group;
      })
    );

    return result;
  }
};
