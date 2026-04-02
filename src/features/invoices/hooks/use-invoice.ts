/**
 * use-invoice.ts
 *
 * React Query hooks for a single invoice — used on:
 *   - /dashboard/invoices/[id]  (detail view)
 *   - PDF generation button     (fetches full detail with joins)
 *
 * Also exposes status-update mutations (Senden, Bezahlt, Stornieren).
 *
 * Storno flow:
 *   1. User clicks "Stornieren"
 *   2. useUpdateStatus() sets status to 'cancelled' on the original
 *   3. useStornorechnung() creates the Stornorechnung + mirrors line items
 *   4. Both invoiceKeys.all and invoiceKeys.full(id) are invalidated
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invoiceKeys } from '@/query/keys';
import {
  getInvoiceDetail,
  updateInvoiceStatus,
  type InvoiceStatusTransition
} from '../api/invoices.api';
import { createStornorechnung } from '../lib/storno';
import type { InvoiceDetail } from '../types/invoice.types';

/**
 * Fetches the full invoice detail (header + line items + payer + company profile).
 * Used on the invoice detail page and PDF download trigger.
 *
 * @param id - Invoice UUID. Pass undefined to skip fetching (e.g. while routing).
 */
export function useInvoiceDetail(id: string | undefined) {
  return useQuery({
    queryKey: id ? invoiceKeys.full(id) : ['invoices', 'full', 'skip'],
    queryFn: () => getInvoiceDetail(id!),
    enabled: !!id // only fetch when ID is available
  });
}

/**
 * Mutation hook for updating an invoice's status.
 *
 * On success:
 *   - Invalidates invoiceKeys.all (refreshes list table)
 *   - Invalidates invoiceKeys.full(id) (refreshes detail cache)
 *
 * @param invoiceId - The invoice to update.
 */
export function useUpdateInvoiceStatus(invoiceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (status: InvoiceStatusTransition) =>
      updateInvoiceStatus(invoiceId, status),

    onSuccess: (updatedInvoice) => {
      // Invalidate list + this specific invoice's cache
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      queryClient.invalidateQueries({ queryKey: invoiceKeys.full(invoiceId) });

      const labels: Record<InvoiceStatusTransition, string> = {
        sent: 'als versendet markiert',
        paid: 'als bezahlt markiert',
        cancelled: 'storniert'
      };
      toast.success(
        `Rechnung ${updatedInvoice.invoice_number} wurde ${labels[updatedInvoice.status as InvoiceStatusTransition]}.`
      );
    },

    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Status konnte nicht aktualisiert werden: ' + message);
    }
  });
}

/**
 * Mutation hook for creating a Stornorechnung.
 *
 * Usage:
 *   1. First call useUpdateInvoiceStatus to set original status to 'cancelled'
 *   2. Then call this mutation to create the Storno + mirror line items
 *
 * @param originalId - ID of the invoice being cancelled.
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
