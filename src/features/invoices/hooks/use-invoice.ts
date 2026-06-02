/**
 * use-invoice.ts
 *
 * React Query hooks for a single invoice — used on:
 *   - /dashboard/invoices/[id]  (detail view)
 *   - PDF generation button     (fetches full detail with joins)
 *
 * Also exposes status-update mutations (Senden, Bezahlt) and Storno creation.
 *
 * Storno: useCreateStornorechnung calls createStornorechnung (atomic Postgres RPC).
 * The original invoice is marked corrected inside that RPC; no prior cancelled step.
 * On success, invoiceKeys.all and invoiceKeys.full(id) are invalidated.
 */

'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { invoiceKeys } from '@/query/keys';
import { useBreadcrumbStore } from '@/hooks/use-breadcrumb-store';
import {
  getInvoiceDetail,
  updateInvoiceStatus,
  type InvoiceStatusTransition
} from '../api/invoices.api';
import { enrichInvoiceDetailWithColumnProfile } from '../lib/enrich-invoice-detail-column-profile';
import { createStornorechnung } from '../lib/storno';
import type {
  InvoiceDetail,
  InvoiceStatus,
  InvoiceWithPayer
} from '../types/invoice.types';

export type UpdateInvoiceStatusInput =
  | InvoiceStatusTransition
  | {
      status: InvoiceStatusTransition;
      paidAt?: string;
      invoiceId?: string;
      suppressToast?: boolean;
    };

type ResolvedUpdateVars = {
  id: string;
  status: InvoiceStatusTransition;
  paidAt?: string;
  suppressToast?: boolean;
};

function resolveUpdateInvoiceStatusVars(
  boundInvoiceId: string | undefined,
  input: UpdateInvoiceStatusInput
): ResolvedUpdateVars {
  if (typeof input === 'string') {
    if (!boundInvoiceId) {
      throw new Error('invoiceId ist erforderlich');
    }
    return { id: boundInvoiceId, status: input };
  }
  const id = input.invoiceId ?? boundInvoiceId;
  if (!id) {
    throw new Error('invoiceId ist erforderlich');
  }
  return {
    id,
    status: input.status,
    paidAt: input.paidAt,
    suppressToast: input.suppressToast
  };
}

/**
 * Fetches the full invoice detail (header + line items + payer + company profile).
 * After `getInvoiceDetail`, attaches **`column_profile`** via {@link enrichInvoiceDetailWithColumnProfile}
 * for PDF preview/print (Vorlage resolution stays out of `invoices.api.ts`).
 *
 * @param id - Invoice UUID. Pass undefined to skip fetching (e.g. while routing).
 */
export function useInvoiceDetail(id: string | undefined) {
  const { setCustomTitle, clearCustomTitle } = useBreadcrumbStore();

  const query = useQuery({
    queryKey: id ? invoiceKeys.full(id) : ['invoices', 'full', 'skip'],
    queryFn: async () => {
      const detail = await getInvoiceDetail(id!);
      // PDF column profile is enriched outside invoices.api (frozen) — see enrichInvoiceDetailWithColumnProfile.
      return enrichInvoiceDetailWithColumnProfile(detail);
    },
    enabled: !!id // only fetch when ID is available
  });

  useEffect(() => {
    const invoice = query.data;
    if (!invoice || !id) return;

    // Use a fixed path for breadcrumb override so it works for all sub-pages
    const invoicePath = `/dashboard/invoices/${id}`;
    const period = `${format(new Date(invoice.period_from), 'dd.MM.yy', {
      locale: de
    })} – ${format(new Date(invoice.period_to), 'dd.MM.yy', { locale: de })}`;

    setCustomTitle(invoicePath, `${invoice.invoice_number} (${period})`);

    return () => {
      // Small delay on cleanup to avoid flicker during fast transitions
      // between the same root resource (e.g. Detail -> Preview)
      clearCustomTitle(invoicePath);
    };
  }, [query.data, id, setCustomTitle, clearCustomTitle]);

  return query;
}

/**
 * Mutation hook for updating an invoice's status.
 *
 * On success:
 *   - Invalidates invoiceKeys.all (refreshes list table)
 *   - Invalidates invoiceKeys.full(id) (refreshes detail cache)
 *
 * @param invoiceId - Optional bound invoice (single-invoice UI). Omit for batch Zahlungsabgleich.
 */
export function useUpdateInvoiceStatus(invoiceId?: string) {
  const queryClient = useQueryClient();

  const listPredicate = {
    predicate: (q: { queryKey: readonly unknown[] }) =>
      q.queryKey[0] === 'invoices' && q.queryKey[1] === 'list'
  };

  return useMutation({
    mutationFn: (input: UpdateInvoiceStatusInput) => {
      const { id, status, paidAt } = resolveUpdateInvoiceStatusVars(
        invoiceId,
        input
      );
      return updateInvoiceStatus(id, status, paidAt);
    },

    onMutate: async (input) => {
      const { id, status } = resolveUpdateInvoiceStatusVars(invoiceId, input);
      await queryClient.cancelQueries({ queryKey: ['invoices'] });
      const previousLists =
        queryClient.getQueriesData<InvoiceWithPayer[]>(listPredicate);
      queryClient.setQueriesData<InvoiceWithPayer[]>(listPredicate, (old) => {
        if (!old) return old;
        return old.map((inv) =>
          inv.id === id ? { ...inv, status: status as InvoiceStatus } : inv
        );
      });
      return { previousLists };
    },

    onError: (err: unknown, _input, context) => {
      const previousLists = (
        context as {
          previousLists?: [
            readonly unknown[],
            InvoiceWithPayer[] | undefined
          ][];
        }
      )?.previousLists;
      previousLists?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Status konnte nicht aktualisiert werden: ' + message);
    },

    onSuccess: (updatedInvoice, input) => {
      const { suppressToast } = resolveUpdateInvoiceStatusVars(
        invoiceId,
        input
      );
      // why: batch Zahlungsabgleich shows one summary on the done screen, not N toasts
      if (suppressToast) return;

      const labels: Record<InvoiceStatusTransition, string> = {
        sent: 'als versendet markiert',
        paid: 'als bezahlt markiert',
        cancelled: 'storniert'
      };
      toast.success(
        `Rechnung ${updatedInvoice.invoice_number} wurde ${labels[updatedInvoice.status as InvoiceStatusTransition]}.`
      );
    },

    onSettled: async (_data, _err, input) => {
      const { id } = resolveUpdateInvoiceStatusVars(invoiceId, input);
      await queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.full(id) });
      // Invalidate revenue total to refresh "Rechnungsumsatz" stat on dashboard
      void queryClient.invalidateQueries({
        queryKey: invoiceKeys.revenueTotal
      });
    }
  });
}

/**
 * Mutation hook for creating a Stornorechnung (atomic RPC: Storno + original corrected).
 *
 * @param originalId - ID of the invoice being cancelled (for cache invalidation).
 */
export function useCreateStornorechnung(originalId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      originalInvoice,
      originalLineItems
    }: {
      originalInvoice: InvoiceDetail;
      originalLineItems: InvoiceDetail['line_items'];
    }) => createStornorechnung(originalInvoice, originalLineItems),

    onSuccess: (stornoId) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      queryClient.invalidateQueries({ queryKey: invoiceKeys.full(originalId) });
      toast.success(
        `Stornorechnung wurde erstellt (ID: ${stornoId.slice(0, 8)}…)`
      );
    },

    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Stornorechnung konnte nicht erstellt werden: ' + message);
    }
  });
}
