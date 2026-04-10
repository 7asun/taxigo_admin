import PageContainer from '@/components/layout/page-container';
import { createClient } from '@/lib/supabase/server';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { UnassignedTripsClient } from '@/features/unassigned-trips/components/unassigned-trips-client';
import type {
  UnassignedTrip,
  UnassignedTripsByPayer,
  BillingVariantWithType
} from '@/features/unassigned-trips/types/unassigned-trips.types';

export const metadata = {
  title: 'Unzugeordnete Fahrten'
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    payer_ids?: string;
    date_from?: string;
    date_to?: string;
  }>;
}

async function getUnassignedTripsGrouped(
  payerIds: string[] = [],
  dateFrom: string | null = null,
  dateTo: string | null = null
): Promise<UnassignedTripsByPayer[]> {
  const supabase = await createClient();
  let query = supabase
    .from('trips')
    .select(
      `
      id,
      scheduled_at,
      pickup_address,
      dropoff_address,
      driving_distance_km,
      price,
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

  const trips = (data || []) as unknown as UnassignedTrip[];

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
          const { data: variants, error: variantsError } = await supabase
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
            .eq('billing_types.payer_id', group.payerId)
            .order('sort_order');

          if (variantsError) throw variantsError;
          group.billingVariants = (variants ||
            []) as unknown as BillingVariantWithType[];
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

export default async function UnzugeordneteFahrtenPage({
  searchParams
}: PageProps) {
  const params = await searchParams;

  // Parse filters from URL
  const payerIds = params.payer_ids
    ? params.payer_ids.split(',').filter(Boolean)
    : [];
  const dateFrom = params.date_from || null;
  const dateTo = params.date_to || null;

  // Fetch initial data
  const groupedTrips = await getUnassignedTripsGrouped(
    payerIds,
    dateFrom,
    dateTo
  );

  const totalTrips = groupedTrips.reduce(
    (sum, group) => sum + group.trips.length,
    0
  );
  const totalPayers = groupedTrips.length;

  return (
    <PageContainer
      scrollable={false}
      pageTitle='Unzugeordnete Fahrten'
      pageDescription='Fahrten ohne Abrechnungsart — bitte vor der nächsten Rechnungsstellung zuweisen.'
    >
      <UnassignedTripsClient
        initialGroupedTrips={groupedTrips}
        initialTotalTrips={totalTrips}
        initialTotalPayers={totalPayers}
      />
    </PageContainer>
  );
}
