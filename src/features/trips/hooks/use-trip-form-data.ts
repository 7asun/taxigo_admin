'use client';

import { createClient } from '@/lib/supabase/client';
import type {
  BillingTypeOption,
  ClientOption,
  DriverOption,
  PayerOption
} from '@/features/trips/types/trip-form-reference.types';
import {
  useBillingTypesForPayerQuery,
  useDriversQuery,
  usePayersQuery
} from '@/features/trips/hooks/use-trip-reference-queries';

export type {
  PayerOption,
  BillingTypeOption,
  ClientOption,
  DriverOption
} from '@/features/trips/types/trip-form-reference.types';

/**
 * Trip create/edit form and Fahrten filter bar: payers, drivers, billing types, client search.
 *
 * Payers and drivers are loaded via TanStack Query (`referenceKeys` in `src/query/keys/reference.ts`)
 * so every `DriverSelectCell` and the filters bar share one cache entry instead of N `useEffect` fetches.
 *
 * Billing types depend on the selected payer UUID; never pass URL sentinels (`'all'`) into the query —
 * the hook disables fetching and exposes an empty list (see `useBillingTypesForPayerQuery`).
 */
export function useTripFormData(payerId?: string | null) {
  const payersQuery = usePayersQuery();
  const driversQuery = useDriversQuery();
  const billingTypesQuery = useBillingTypesForPayerQuery(payerId);

  const payers: PayerOption[] = payersQuery.data ?? [];
  const drivers: DriverOption[] = driversQuery.data ?? [];
  const billingTypes: BillingTypeOption[] = billingTypesQuery.data ?? [];

  const isLoading = payersQuery.isPending || driversQuery.isPending;

  const searchClients = async (query: string): Promise<ClientOption[]> => {
    if (!query || query.length < 2) return [];
    const supabase = createClient();
    const { data } = await supabase
      .from('clients')
      .select(
        'id, first_name, last_name, company_name, is_company, phone, phone_secondary, email, street, street_number, zip_code, city, is_wheelchair'
      )
      .or(
        `first_name.ilike.%${query}%,last_name.ilike.%${query}%,company_name.ilike.%${query}%,email.ilike.%${query}%`
      )
      .limit(8);
    return data || [];
  };

  const searchClientsByFirstName = async (
    query: string
  ): Promise<ClientOption[]> => {
    if (!query || query.length < 2) return [];
    const supabase = createClient();
    const { data } = await supabase
      .from('clients')
      .select(
        'id, first_name, last_name, company_name, is_company, phone, phone_secondary, email, street, street_number, zip_code, city, is_wheelchair'
      )
      .or(
        `first_name.ilike.%${query}%,company_name.ilike.%${query}%,email.ilike.%${query}%`
      )
      .order('first_name')
      .limit(8);
    return data || [];
  };

  const searchClientsByLastName = async (
    query: string
  ): Promise<ClientOption[]> => {
    if (!query || query.length < 2) return [];
    const supabase = createClient();
    const { data } = await supabase
      .from('clients')
      .select(
        'id, first_name, last_name, company_name, is_company, phone, phone_secondary, email, street, street_number, zip_code, city, is_wheelchair'
      )
      .or(
        `last_name.ilike.%${query}%,company_name.ilike.%${query}%,email.ilike.%${query}%`
      )
      .order('last_name')
      .limit(8);
    return data || [];
  };

  const searchClientsById = async (
    id: string
  ): Promise<ClientOption | null> => {
    if (!id) return null;
    const supabase = createClient();
    const { data } = await supabase
      .from('clients')
      .select(
        'id, first_name, last_name, company_name, is_company, phone, phone_secondary, email, street, street_number, zip_code, city, is_wheelchair'
      )
      .eq('id', id)
      .single();
    return (data as ClientOption) || null;
  };

  return {
    payers,
    billingTypes,
    drivers,
    isLoading,
    searchClients,
    searchClientsByFirstName,
    searchClientsByLastName,
    searchClientsById
  };
}
