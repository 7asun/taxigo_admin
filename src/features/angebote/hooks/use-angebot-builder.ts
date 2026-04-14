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
import { ANGEBOT_LEGACY_COLUMN_IDS } from '../lib/angebot-legacy-column-ids';
import type {
  AngebotColumnDef,
  CreateAngebotPayload,
  AngebotLineItemRow,
  UpdateAngebotPayload
} from '../types/angebot.types';

export interface BuilderLineItem {
  position: number;
  data: Record<string, string | number | null>;
}

export function newEmptyLineItem(position: number): BuilderLineItem {
  return {
    position,
    data: {}
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
  return sorted.map((li, i) => {
    let data = { ...li.data };
    if (Object.keys(data).length === 0) {
      data = {
        [ANGEBOT_LEGACY_COLUMN_IDS.leistung]: li.leistung || null,
        [ANGEBOT_LEGACY_COLUMN_IDS.anfahrtkosten]: li.anfahrtkosten,
        [ANGEBOT_LEGACY_COLUMN_IDS.price_first_5km]: li.price_first_5km,
        [ANGEBOT_LEGACY_COLUMN_IDS.price_per_km_after_5]:
          li.price_per_km_after_5,
        [ANGEBOT_LEGACY_COLUMN_IDS.notes]: li.notes
      };
    }
    return {
      position: i + 1,
      data
    };
  });
}

export interface UseAngebotBuilderOptions {
  mode?: 'create' | 'edit';
  angebotId?: string;
  initialLineItems?: BuilderLineItem[];
  /** Resolved template / snapshot columns — returned unchanged for Step 2 + payload builders. */
  columnSchema: AngebotColumnDef[];
  onSuccess: (id: string) => void;
}

export function useAngebotBuilder({
  mode = 'create',
  angebotId,
  initialLineItems,
  columnSchema,
  onSuccess
}: UseAngebotBuilderOptions) {
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit';

  const [lineItems, setLineItems] = useState<BuilderLineItem[]>(() =>
    initialLineItems && initialLineItems.length > 0
      ? initialLineItems.map((item, i) => ({ ...item, position: i + 1 }))
      : [newEmptyLineItem(1)]
  );

  const addLineItem = useCallback(() => {
    setLineItems((prev) => [...prev, newEmptyLineItem(prev.length + 1)]);
  }, []);

  const deleteLineItem = useCallback((index: number) => {
    setLineItems((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next.map((item, i) => ({ ...item, position: i + 1 }));
    });
  }, []);

  const updateLineItem = useCallback(
    (index: number, patch: Partial<BuilderLineItem>) => {
      setLineItems((prev) =>
        prev.map((item, i) => {
          if (i !== index) return item;
          if (patch.data) {
            return {
              ...item,
              ...patch,
              data: { ...item.data, ...patch.data }
            };
          }
          return { ...item, ...patch };
        })
      );
    },
    []
  );

  const reorderLineItems = useCallback((reordered: BuilderLineItem[]) => {
    setLineItems(reordered.map((item, i) => ({ ...item, position: i + 1 })));
  }, []);

  const resetLineItems = useCallback(() => {
    setLineItems([newEmptyLineItem(1)]);
  }, []);

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
    columnSchema,
    addLineItem,
    deleteLineItem,
    updateLineItem,
    reorderLineItems,
    resetLineItems,
    createAngebotMutation,
    saveEditMutation,
    isCreating,
    isSavingEdit,
    isPending: isEdit ? isSavingEdit : isCreating
  };
}
