'use client';

import { createClient } from '@/lib/supabase/client';
import type {
  BillingVariantOption,
  ClientOption,
  DriverOption,
  PayerOption
} from '@/features/trips/types/trip-form-reference.types';
import {
  useBillingVariantsForPayerQuery,
  useDriversQuery,
  usePayersQuery
} from '@/features/trips/hooks/use-trip-reference-queries';

export type {
  PayerOption,
  BillingVariantOption,
  ClientOption,
  DriverOption
} from '@/features/trips/types/trip-form-reference.types';

/** @deprecated use BillingVariantOption — same shape as former billing type row for forms */
export type BillingTypeOption = BillingVariantOption;

/** Stable fallbacks so `?? []` does not allocate a new array each render (effect deps + setValue loops). */
const EMPTY_PAYERS: PayerOption[] = [];
const EMPTY_DRIVERS: DriverOption[] = [];
const EMPTY_BILLING_VARIANTS: BillingVariantOption[] = [];

/**
 * Trip create/edit form and Fahrten filter bar: payers, drivers, billing variants, client search.
 *
 * Payers and drivers are loaded via TanStack Query (`referenceKeys` in `src/query/keys/reference.ts`)
 * so every `DriverSelectCell` and the filters bar share one cache entry instead of N `useEffect` fetches.
 *
 * Billing variants depend on the selected payer UUID; never pass URL sentinels (`'all'`) into the query.
 */
export function useTripFormData(payerId?: string | null) {
  const payersQuery = usePayersQuery();
  const driversQuery = useDriversQuery();
  const billingVariantsQuery = useBillingVariantsForPayerQuery(payerId);

  const payers: PayerOption[] = payersQuery.data ?? EMPTY_PAYERS;
  const drivers: DriverOption[] = driversQuery.data ?? EMPTY_DRIVERS;
  const billingVariants: BillingVariantOption[] =
    billingVariantsQuery.data ?? EMPTY_BILLING_VARIANTS;

  const payerIsConcrete =
    typeof payerId === 'string' && payerId.length > 0 && payerId !== 'all';
  const isLoading =
    payersQuery.isPending ||
    driversQuery.isPending ||
    (payerIsConcrete && billingVariantsQuery.isPending);

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
    /** Flat variant list (includes `billing_type_name`, `code`, `behavior_profile` from `billing_types`). */
    billingVariants,
    /** @deprecated alias for billingVariants — same rows as former billing_types leaf concept */
    billingTypes: billingVariants,
    drivers,
    isLoading,
    searchClients,
    searchClientsByFirstName,
    searchClientsByLastName,
    searchClientsById
  };
}
