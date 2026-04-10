import type { SupabaseClient } from '@supabase/supabase-js';

import { toQueryError } from '@/lib/supabase/to-query-error';

import {
  resolveEffectiveTripInvoiceStatus,
  type EffectiveTripInvoiceStatus,
  type InvoiceStatusLite,
  type TripInvoiceLineForStatus
} from './effective-trip-invoice-status';

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

/** PostgREST may return embedded `invoices` as one object or a one-element array. */
function normalizeEmbeddedInvoiceStatus(
  inv: unknown
): { status: InvoiceStatusLite } | null {
  if (inv == null) return null;
  const raw =
    Array.isArray(inv) && inv[0] && typeof inv[0] === 'object'
      ? (inv[0] as { status?: unknown })
      : typeof inv === 'object' && inv !== null
        ? (inv as { status?: unknown })
        : null;
  const s = raw?.status;
  if (typeof s !== 'string') return null;
  if (
    s === 'draft' ||
    s === 'sent' ||
    s === 'paid' ||
    s === 'cancelled' ||
    s === 'corrected'
  ) {
    return { status: s };
  }
  return null;
}

async function buildInvoiceStatusTripFilterFallback(
  supabase: SupabaseClient,
  effective: EffectiveTripInvoiceStatus
): Promise<InvoiceStatusTripFilter> {
  const pageSize = 1000;
  const byTrip = new Map<string, TripInvoiceLineForStatus[]>();

  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from('invoice_line_items')
      .select('trip_id, invoices(status)')
      .not('trip_id', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) throw toQueryError(error);
    if (!page?.length) break;

    for (const row of page) {
      const tid = row.trip_id as string;
      if (!byTrip.has(tid)) byTrip.set(tid, []);
      byTrip.get(tid)!.push({
        invoices: normalizeEmbeddedInvoiceStatus(row.invoices)
      });
    }

    if (page.length < pageSize) break;
  }

  const effectiveByTrip = new Map<string, EffectiveTripInvoiceStatus>();
  for (const [tid, items] of byTrip) {
    effectiveByTrip.set(tid, resolveEffectiveTripInvoiceStatus(items));
  }

  if (effective === 'uninvoiced') {
    const busyTripIds = [...effectiveByTrip.entries()]
      .filter(([, e]) => e === 'draft' || e === 'sent' || e === 'paid')
      .map(([id]) => id);
    return { kind: 'not_in', tripIds: busyTripIds };
  }

  const matching = [...effectiveByTrip.entries()]
    .filter(([, e]) => e === effective)
    .map(([id]) => id);
  return { kind: 'in', tripIds: matching };
}

/**
 * Resolves which trips match the Rechnungsstatus URL filter.
 * Uses RPC when deployed; otherwise scans `invoice_line_items` (paginated) — same rules as the badge.
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

  return buildInvoiceStatusTripFilterFallback(supabase, effective);
}
