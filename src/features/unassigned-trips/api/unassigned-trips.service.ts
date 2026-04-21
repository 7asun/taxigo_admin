import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { UpdateTrip } from '@/features/trips/api/trips.service';
import {
  computeTripPrice,
  loadPricingContext,
  resolveTripForPricing,
  shouldRecalculatePrice
} from '@/features/trips/lib/trip-price-engine';
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
   * Bulk assign billing variant to trips.
   *
   * Converted from a single batch update to a per-trip loop so that price
   * recalculation can run per-trip. The new billing_variant_id affects rule
   * resolution, and each trip may have a different payer/client context that
   * produces a different price. A batch update cannot carry per-row price fields.
   */
  async assignBillingVariant(
    tripIds: string[],
    billingVariantId: string
  ): Promise<void> {
    const supabase = createClient();
    for (const tripId of tripIds) {
      const patch: UpdateTrip = { billing_variant_id: billingVariantId };

      // Only recalculate when a pricing-relevant field is being changed.
      // billing_variant_id IS pricing-relevant, so this always fires here.
      if (shouldRecalculatePrice(patch)) {
        const tripInput = await resolveTripForPricing(supabase, tripId, patch);
        if (tripInput) {
          const context = await loadPricingContext({
            supabase,
            companyId: tripInput.company_id,
            payerId: tripInput.payer_id,
            clientId: tripInput.client_id
          }).catch((e) => {
            // A failed context load must never block a trip save.
            console.error(
              '[trip-price-engine] loadPricingContext failed on assignBillingVariant',
              tripId,
              e
            );
            return null;
          });
          if (context) {
            Object.assign(patch, computeTripPrice(tripInput, context));
          }
        }
      }

      const { error } = await supabase
        .from('trips')
        .update(patch)
        .eq('id', tripId);

      if (error) {
        console.error('Error assigning billing variant:', error);
        throw toQueryError(error);
      }
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
