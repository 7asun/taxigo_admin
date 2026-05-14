import type { SupabaseClient } from '@supabase/supabase-js';

import { toQueryError } from '@/lib/supabase/to-query-error';

import type { EffectiveTripInvoiceStatus } from './effective-trip-invoice-status';

/** PostgREST: function not in schema (migration not applied yet). */
export function isTripInvoiceStatusRpcMissingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const o = err as { code?: string; message?: string };
  if (o.code === 'PGRST202') return true;
  const msg = o.message ?? '';
  return (
    msg.includes('PGRST202') ||
    msg.includes('trip_ids_matching_invoice_effective_status')
  );
}

export type InvoiceStatusTripFilter =
  | { kind: 'in'; tripIds: string[] }
  | { kind: 'not_in'; tripIds: string[] };

/**
 * Resolves which trips match the Rechnungsstatus URL filter via
 * `trip_ids_matching_invoice_effective_status`.
 */
export async function resolveInvoiceStatusTripFilter(
  supabase: SupabaseClient,
  effective: EffectiveTripInvoiceStatus
): Promise<InvoiceStatusTripFilter> {
  const { data: ids, error: rpcError } = await supabase.rpc(
    'trip_ids_matching_invoice_effective_status',
    { p_effective: effective }
  );

  if (!rpcError) {
    return { kind: 'in', tripIds: ids ?? [] };
  }

  if (!isTripInvoiceStatusRpcMissingError(rpcError)) {
    throw toQueryError(rpcError);
  }

  // The fallback full-scan was removed intentionally — it is too expensive
  // for production data volumes and masks a missing RPC deployment.
  // If this error is thrown, the RPC migration must be re-applied.
  throw new Error(
    '[resolveInvoiceStatusTripFilter] RPC trip_ids_matching_invoice_effective_status ' +
      'not found. Re-apply the RPC migration before deploying.'
  );
}
