'use client';

/**
 * use-angebot-builder.ts
 *
 * State manager for the Angebot builder. Owns:
 *   - line items array (add / delete / reorder / update)
 *   - createAngebot mutation (new offers)
 *   - updateAngebot + replaceAngebotLineItems (edit flow)
 *
 * Recipient fields and offer meta (subject, dates, texts) are managed by the
 * step components in the parent — this hook only owns line items and mutations.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { angebotKeys } from '@/query/keys';
import {
  createAngebot,
  replaceAngebotLineItems,
  updateAngebot
} from '../api/angebote.api';
import type {
  CreateAngebotPayload,
  AngebotLineItemRow,
  UpdateAngebotPayload
} from '../types/angebot.types';

export type BuilderLineItem = Omit<
  AngebotLineItemRow,
  'id' | 'angebot_id' | 'created_at'
>;

export function newEmptyLineItem(position: number): BuilderLineItem {
  return {
    position,
    leistung: '',
    anfahrtkosten: null,
    price_first_5km: null,
    price_per_km_after_5: null,
    notes: null
  };
}

/** Maps persisted line items to builder state (edit pre-fill). */
export function lineItemsFromAngebotRows(
  rows: AngebotLineItemRow[]
): BuilderLineItem[] {
  if (!rows.length) {
    return [newEmptyLineItem(1)];
  }
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return sorted.map((li, i) => ({
    position: i + 1,
    leistung: li.leistung,
    anfahrtkosten: li.anfahrtkosten,
    price_first_5km: li.price_first_5km,
    price_per_km_after_5: li.price_per_km_after_5,
    notes: li.notes
  }));
}

export interface UseAngebotBuilderOptions {
  mode?: 'create' | 'edit';
  /** Required when mode === 'edit' */
  angebotId?: string;
  /** Pre-filled rows when mode === 'edit' */
  initialLineItems?: BuilderLineItem[];
  onSuccess: (id: string) => void;
}

export function useAngebotBuilder({
  mode = 'create',
  angebotId,
  initialLineItems,
  onSuccess
}: UseAngebotBuilderOptions) {
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit';

  const [lineItems, setLineItems] = useState<BuilderLineItem[]>(() =>
    initialLineItems && initialLineItems.length > 0
      ? initialLineItems.map((item, i) => ({ ...item, position: i + 1 }))
      : [newEmptyLineItem(1)]
  );

  // ─── Line item operations ──────────────────────────────────────────────────

  const addLineItem = useCallback(() => {
    setLineItems((prev) => [...prev, newEmptyLineItem(prev.length + 1)]);
  }, []);

  const deleteLineItem = useCallback((index: number) => {
    setLineItems((prev) => {
      // Cannot delete the last row — an offer must always have at least one Leistung.
      // This is a UX guard only; the DB has no min-row constraint.
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next.map((item, i) => ({ ...item, position: i + 1 }));
    });
  }, []);

  const updateLineItem = useCallback(
    (index: number, patch: Partial<BuilderLineItem>) => {
      setLineItems((prev) =>
        prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
      );
    },
    []
  );

  const reorderLineItems = useCallback((reordered: BuilderLineItem[]) => {
    setLineItems(reordered.map((item, i) => ({ ...item, position: i + 1 })));
  }, []);

  // ─── Create mutation ───────────────────────────────────────────────────────

  const { mutate: createAngebotMutation, isPending: isCreating } = useMutation({
    mutationFn: (payload: CreateAngebotPayload) => createAngebot(payload),
    onSuccess: (angebot) => {
      queryClient.invalidateQueries({ queryKey: angebotKeys.all });
      toast.success(`Angebot ${angebot.angebot_number} wurde erstellt.`);
      onSuccess(angebot.id);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error(`Angebot konnte nicht erstellt werden: ${message}`);
    }
  });

  // ─── Update mutation (header + replace line items) ───────────────────────

  const { mutate: saveEditMutation, isPending: isSavingEdit } = useMutation({
    mutationFn: async ({
      header,
      rows
    }: {
      header: UpdateAngebotPayload;
      rows: CreateAngebotPayload['line_items'];
    }) => {
      if (!angebotId) {
        throw new Error('angebotId fehlt.');
      }
      await updateAngebot(angebotId, header);
      await replaceAngebotLineItems(angebotId, rows);
    },
    onSuccess: async () => {
      if (!angebotId) return;
      await queryClient.invalidateQueries({ queryKey: angebotKeys.all });
      await queryClient.invalidateQueries({
        queryKey: angebotKeys.detail(angebotId)
      });
      toast.success('Angebot wurde gespeichert.');
      onSuccess(angebotId);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error(`Speichern fehlgeschlagen: ${message}`);
    }
  });

  return {
    lineItems,
    addLineItem,
    deleteLineItem,
    updateLineItem,
    reorderLineItems,
    createAngebotMutation,
    saveEditMutation,
    isCreating,
    isSavingEdit,
    isPending: isEdit ? isSavingEdit : isCreating
  };
}
