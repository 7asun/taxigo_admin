'use client';

/**
 * React Query hooks for angebot_vorlagen (offer table templates).
 * Invalidates angebotKeys.vorlagen.list(companyId) on mutations — see src/query/keys/angebote.ts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { angebotKeys } from '@/query/keys';
import {
  createAngebotVorlage,
  deleteAngebotVorlage,
  listAngebotVorlagen,
  setDefaultAngebotVorlage,
  updateAngebotVorlage
} from '@/features/angebote/api/angebot-vorlagen.api';
import type {
  AngebotVorlageCreatePayload,
  AngebotVorlageUpdatePayload
} from '@/features/angebote/types/angebot.types';

export function useAngebotVorlagenList(companyId: string) {
  // Query key from angebotKeys.vorlagen — see src/query/keys/angebote.ts
  return useQuery({
    queryKey: angebotKeys.vorlagen.list(companyId),
    queryFn: () => listAngebotVorlagen(companyId),
    enabled: Boolean(companyId),
    staleTime: 60_000
  });
}

export function useAngebotVorlagenMutations(companyId: string) {
  const queryClient = useQueryClient();
  // Query key from angebotKeys.vorlagen — see src/query/keys/angebote.ts
  const key = angebotKeys.vorlagen.list(companyId);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
  };

  const createMutation = useMutation({
    mutationFn: (payload: AngebotVorlageCreatePayload) =>
      createAngebotVorlage(payload),
    onSuccess: () => {
      invalidate();
      toast.success('Angebotsvorlage wurde erstellt.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Angebotsvorlage konnte nicht erstellt werden: ' + message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload
    }: {
      id: string;
      payload: AngebotVorlageUpdatePayload;
    }) => updateAngebotVorlage(id, payload),
    onSuccess: () => {
      invalidate();
      toast.success('Angebotsvorlage gespeichert.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Speichern fehlgeschlagen: ' + message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAngebotVorlage(id),
    onSuccess: () => {
      invalidate();
      toast.success('Angebotsvorlage gelöscht.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Löschen fehlgeschlagen: ' + message);
    }
  });

  const setDefaultMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      setDefaultAngebotVorlage(id, companyId),
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
