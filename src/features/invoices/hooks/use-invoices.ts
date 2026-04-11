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

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  isBefore,
  isSameMonth,
  parseISO,
  startOfToday
} from 'date-fns';
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
  const apiStatus =
    filter.kpi_bucket === 'this_month' ? undefined : (filter.status as any);

  const query = useQuery({
    queryKey: invoiceKeys.list(filter),
    queryFn: () =>
      listInvoices({
        status: apiStatus,
        payer_id: filter.payer_id,
        from: filter.from,
        to: filter.to,
        limit: filter.limit
      })
  });

  const invoices = useMemo((): InvoiceWithPayer[] | undefined => {
    const raw = query.data;
    if (!raw) return undefined;
    const bucket = filter.kpi_bucket;
    if (!bucket) return raw;
    const today = startOfToday();
    if (bucket === 'this_month') {
      const now = new Date();
      return raw.filter((inv) => {
        const ref = inv.sent_at ?? inv.created_at;
        return isSameMonth(parseISO(ref), now);
      });
    }
    return raw.filter((inv) => {
      if (inv.status !== 'sent') return false;
      const due = addDays(parseISO(inv.created_at), inv.payment_due_days ?? 14);
      const overdue = isBefore(due, today);
      if (bucket === 'open') return !overdue;
      if (bucket === 'overdue') return overdue;
      return true;
    });
  }, [query.data, filter.kpi_bucket]);

  // ── Compute summary stats from the fetched list ──────────────────────────
  const summary: InvoiceSummary = {
    totalCount: invoices?.length ?? 0,
    draftCount: invoices?.filter((i) => i.status === 'draft').length ?? 0,
    sentCount: invoices?.filter((i) => i.status === 'sent').length ?? 0,
    paidCount: invoices?.filter((i) => i.status === 'paid').length ?? 0,
    totalRevenue:
      invoices
        ?.filter((i) => i.status === 'paid')
        .reduce((sum, i) => sum + (i.total ?? 0), 0) ?? 0
  };

  return {
    /** Fetched invoice list (undefined while loading). */
    invoices: invoices as InvoiceWithPayer[] | undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    /** Summary stats for dashboard cards. */
    summary
  };
}
