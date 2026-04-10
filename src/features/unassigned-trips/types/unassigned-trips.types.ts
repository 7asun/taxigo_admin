import type { Database } from '@/types/database.types';

export type Trip = Database['public']['Tables']['trips']['Row'];
export type Payer = Database['public']['Tables']['payers']['Row'];
export type BillingVariant =
  Database['public']['Tables']['billing_variants']['Row'];
export type BillingType = Database['public']['Tables']['billing_types']['Row'];

export interface UnassignedTrip {
  id: string;
  scheduled_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  driving_distance_km: number | null;
  price: number | null;
  link_type: string | null;
  linked_trip_id: string | null;
  kts_document_applies: boolean;
  payer_id: string | null;
  payer: {
    id: string;
    name: string;
  } | null;
}

export interface BillingVariantWithType extends BillingVariant {
  billing_type: {
    name: string;
  } | null;
}

export interface UnassignedTripsByPayer {
  payerId: string;
  payerName: string;
  trips: UnassignedTrip[];
  billingVariants: BillingVariantWithType[];
}

export interface UnassignedTripsFilters {
  payerIds: string[];
  dateFrom: string | null;
  dateTo: string | null;
  onlyWithoutBillingVariant: boolean;
}

export interface BulkAssignmentPayload {
  tripIds: string[];
  billingVariantId: string;
}
