/**
 * use-invoice-text-blocks.ts
 *
 * React Query hooks for managing invoice text blocks (Baukasten system).
 *
 * Provides:
 *   - useInvoiceTextBlocks: List all blocks grouped by type
 *   - useAllInvoiceTextBlocks: List all blocks as flat array (for dropdowns)
 *   - useCreateInvoiceTextBlock: Create new block
 *   - useUpdateInvoiceTextBlock: Update existing block
 *   - useDeleteInvoiceTextBlock: Delete block
 *   - useSetDefaultInvoiceTextBlock: Set block as company default
 *
 * All mutations automatically invalidate the list query on success.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invoiceKeys } from '@/query/keys';
import {
  listInvoiceTextBlocks,
  listAllInvoiceTextBlocks,
  createInvoiceTextBlock,
  updateInvoiceTextBlock,
  deleteInvoiceTextBlock,
  setInvoiceTextBlockAsDefault
} from '../api/invoice-text-blocks.api';
import type {
  CreateInvoiceTextBlockInput,
  UpdateInvoiceTextBlockInput
} from '../types/invoice-text-blocks.types';

// ─── List hooks ──────────────────────────────────────────────────────────────

/**
 * Fetches all text blocks grouped by type (intro/outro).
 * Used in the settings page to display separate sections.
 */
export function useInvoiceTextBlocks() {
  return useQuery({
    queryKey: invoiceKeys.textBlocks.list(),
    queryFn: listInvoiceTextBlocks,
    staleTime: 5 * 60 * 1000 // 5 minutes
  });
}

/**
 * Fetches all text blocks as a flat array.
 * Useful for dropdowns where type is shown separately.
 */
export function useAllInvoiceTextBlocks() {
  return useQuery({
    queryKey: invoiceKeys.textBlocks.list(),
    queryFn: listAllInvoiceTextBlocks,
    staleTime: 5 * 60 * 1000
  });
}

// ─── Create hook ─────────────────────────────────────────────────────────────

/**
 * Creates a new text block.
 * Invalidates the list query on success and shows success toast.
 */
export function useCreateInvoiceTextBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createInvoiceTextBlock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.textBlocks.all });
      toast.success('Vorlage wurde erstellt.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Vorlage konnte nicht erstellt werden: ' + message);
    }
  });
}

// ─── Update hook ─────────────────────────────────────────────────────────────

/**
 * Updates an existing text block.
 * Invalidates the list query on success.
 */
export function useUpdateInvoiceTextBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      input
    }: {
      id: string;
      input: UpdateInvoiceTextBlockInput;
    }) => updateInvoiceTextBlock(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.textBlocks.all });
      toast.success('Vorlage wurde aktualisiert.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Vorlage konnte nicht aktualisiert werden: ' + message);
    }
  });
}

// ─── Delete hook ─────────────────────────────────────────────────────────────

/**
 * Deletes a text block.
 * Warns if the block is linked to any payers (they'll fall back to default).
 */
export function useDeleteInvoiceTextBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteInvoiceTextBlock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.textBlocks.all });
      toast.success('Vorlage wurde gelöscht.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Vorlage konnte nicht gelöscht werden: ' + message);
    }
  });
}

// ─── Set default hook ────────────────────────────────────────────────────────

/**
 * Sets a text block as the company default for its type.
 * Removes default status from any other block of the same type.
 */
export function useSetDefaultInvoiceTextBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setInvoiceTextBlockAsDefault,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.textBlocks.all });
      toast.success('Standardvorlage wurde aktualisiert.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Standard konnte nicht gesetzt werden: ' + message);
    }
  });
}
