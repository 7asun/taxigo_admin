import { createClient } from '@/lib/supabase/client';
import type {
  BillingTypeOption,
  DriverOption,
  PayerOption
} from '@/features/trips/types/trip-form-reference.types';

/**
 * Supabase fetchers for trip UI reference lists. Used only as TanStack Query `queryFn`
 * targets (see `use-trip-reference-queries.ts`); keep queries aligned with RLS expectations.
 */

export async function fetchActiveDrivers(): Promise<DriverOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name')
    .eq('role', 'driver')
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export async function fetchPayers(): Promise<PayerOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('payers')
    .select('id, name')
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export async function fetchBillingTypesForPayer(
  payerId: string
): Promise<BillingTypeOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('billing_types')
    .select('id, name, color, payer_id, behavior_profile')
    .eq('payer_id', payerId)
    .order('name');

  if (error) throw error;
  return data ?? [];
}
