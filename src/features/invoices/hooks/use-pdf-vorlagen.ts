/**
 * React Query hooks for pdf_vorlagen (PDF column profile templates).
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { invoiceKeys } from '@/query/keys';
import {
  createPdfVorlage,
  deletePdfVorlage,
  listPdfVorlagen,
  updatePdfVorlage,
  setDefaultVorlage
} from '@/features/invoices/api/pdf-vorlagen.api';
import type {
  PdfVorlageCreatePayload,
  PdfVorlageUpdatePayload
} from '@/features/invoices/types/pdf-vorlage.types';

export function usePdfVorlagenList(companyId: string) {
  return useQuery({
    queryKey: invoiceKeys.pdfVorlagen.list(companyId),
    queryFn: () => listPdfVorlagen(companyId),
    enabled: Boolean(companyId),
    staleTime: 60_000
  });
}

export function usePdfVorlagenMutations(companyId: string) {
  const queryClient = useQueryClient();
  const key = invoiceKeys.pdfVorlagen.list(companyId);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
  };

  const createMutation = useMutation({
    mutationFn: (payload: PdfVorlageCreatePayload) => createPdfVorlage(payload),
    onSuccess: () => {
      invalidate();
      toast.success('PDF-Vorlage wurde erstellt.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('PDF-Vorlage konnte nicht erstellt werden: ' + message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload
    }: {
      id: string;
      payload: PdfVorlageUpdatePayload;
    }) => updatePdfVorlage(id, payload),
    onSuccess: () => {
      invalidate();
      toast.success('PDF-Vorlage gespeichert.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Speichern fehlgeschlagen: ' + message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePdfVorlage(id),
    onSuccess: () => {
      invalidate();
      toast.success('PDF-Vorlage gelöscht.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Löschen fehlgeschlagen: ' + message);
    }
  });

  const setDefaultMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => setDefaultVorlage(id, companyId),
    onSuccess: () => {
      invalidate();
      toast.success('Standard-Vorlage aktualisiert.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Standard konnte nicht gesetzt werden: ' + message);
    }
  });

  return {
    createVorlage: createMutation.mutateAsync,
    updateVorlage: updateMutation.mutateAsync,
    deleteVorlage: deleteMutation.mutateAsync,
    setDefaultVorlage: setDefaultMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSettingDefault: setDefaultMutation.isPending
  };
}
