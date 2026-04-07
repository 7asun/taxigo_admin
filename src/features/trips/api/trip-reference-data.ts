import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type {
  BillingVariantOption,
  DriverOption,
  FremdfirmaOption,
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

  if (error) throw toQueryError(error);
  return data ?? [];
}

export async function fetchPayers(): Promise<PayerOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('payers')
    .select('id, name, kts_default, no_invoice_required_default')
    .order('name');

  if (error) throw toQueryError(error);
  return data ?? [];
}

/**
 * All variants for a payer (flattened), each carrying its parent `billing_types` row's
 * behavior_profile + color so trip creation can apply defaults without a second round-trip.
 */
export async function fetchBillingVariantsForPayer(
  payerId: string
): Promise<BillingVariantOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('billing_types')
    .select(
      `
      id,
      name,
      color,
      behavior_profile,
      payer_id,
      billing_variants (
        id,
        name,
        code,
        sort_order,
        kts_default,
        no_invoice_required_default
      )
    `
    )
    .eq('payer_id', payerId)
    .order('name');

  if (error) throw toQueryError(error);

  type TypeRow = {
    id: string;
    name: string;
    color: string;
    behavior_profile: unknown;
    payer_id: string;
    billing_variants: {
      id: string;
      name: string;
      code: string;
      sort_order: number;
      kts_default: boolean | null;
      no_invoice_required_default: boolean | null;
    }[];
  };

  const out: BillingVariantOption[] = [];
  for (const bt of (data || []) as TypeRow[]) {
    const variants = [...(bt.billing_variants || [])].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    });
    for (const v of variants) {
      out.push({
        id: v.id,
        name: v.name,
        code: v.code,
        sort_order: v.sort_order,
        billing_type_id: bt.id,
        billing_type_name: bt.name,
        color: bt.color,
        behavior_profile: bt.behavior_profile,
        kts_default: v.kts_default,
        no_invoice_required_default: v.no_invoice_required_default ?? null
      });
    }
  }
  return out;
}

export async function fetchActiveFremdfirmen(): Promise<FremdfirmaOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('fremdfirmen')
    .select('id, name, number, default_payment_mode')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name');

  if (error) throw toQueryError(error);
  return (data ?? []) as FremdfirmaOption[];
}
