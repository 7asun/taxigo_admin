/**
 * use-invoices.ts
 *
 * React Query hook for the invoice list page.
 *
 * Features:
 *   - Filterable list: status, payer, date range (created_at in business TZ)
 *   - Summary stats computed client-side from the fetched data
 *   - Follows the invalidation pattern from src/query/README.md:
 *     use invalidateQueries(invoiceKeys.all) after any write
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { invoiceKeys, type InvoiceListFilter } from '@/query/keys';
import { listInvoices } from '../api/invoices.api';
import type { InvoiceWithPayer } from '../types/invoice.types';

/** Summary stats computed from the invoice list (shown as header cards). */
export interface InvoiceSummary {
  totalCount: number;
  draftCount: number;
  sentCount: number; // "Offen" (sent but not yet paid)
  paidCount: number;
  totalRevenue: number; // sum of total for paid invoices (€)
}

/**
 * Fetches the invoice list and computes summary stats.
 *
 * @param filter - Optional display filters. Changing these causes a new fetch.
 */
export function useInvoices(filter: InvoiceListFilter = {}) {
  const query = useQuery({
    queryKey: invoiceKeys.list(filter),
    queryFn: () =>
      listInvoices({
        status: filter.status as any,
        payer_id: filter.payer_id,
        from: filter.from,
        to: filter.to
      })
  });

  // ── Compute summary stats from the fetched list ──────────────────────────
  const summary: InvoiceSummary = {
    totalCount: query.data?.length ?? 0,
    draftCount: query.data?.filter((i) => i.status === 'draft').length ?? 0,
    sentCount: query.data?.filter((i) => i.status === 'sent').length ?? 0,
    paidCount: query.data?.filter((i) => i.status === 'paid').length ?? 0,
    totalRevenue:
      query.data
        ?.filter((i) => i.status === 'paid')
        .reduce((sum, i) => sum + (i.total ?? 0), 0) ?? 0
  };

  return {
    /** Fetched invoice list (undefined while loading). */
    invoices: query.data as InvoiceWithPayer[] | undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    /** Summary stats for dashboard cards. */
    summary
  };
}
