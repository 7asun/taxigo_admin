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

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { angebotKeys } from '@/query/keys';
import {
  createAngebot,
  replaceAngebotLineItems,
  updateDraftAngebotSchema,
  updateAngebot
} from '../api/angebote.api';
import { ANGEBOT_LEGACY_COLUMN_IDS } from '../lib/angebot-legacy-column-ids';
import type {
  AngebotColumnDef,
  CreateAngebotPayload,
  AngebotLineItemRow,
  UpdateAngebotPayload
} from '../types/angebot.types';

export const DEFAULT_TOTALS_LABEL_NET = 'Summe Netto';
export const DEFAULT_TOTALS_LABEL_TAX = 'zzgl. MwSt';
export const DEFAULT_TOTALS_LABEL_GROSS = 'Gesamtbetrag (Brutto)';

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
  initialShowTotalsBlock?: boolean;
  initialInputMode?: 'net' | 'gross';
  initialTotalsLabelNet?: string | null;
  initialTotalsLabelTax?: string | null;
  initialTotalsLabelGross?: string | null;
  /** DB `default_tax_rate` — nullable quote-level MwSt fallback for `computeRow`. */
  initialDefaultTaxRate?: number | null;
  /** Resolved template / snapshot columns — returned unchanged for Step 2 + payload builders. */
  columnSchema: AngebotColumnDef[];
  /**
   * Optional: live Vorlage columns to persist back to table_schema_snapshot on edit-save.
   * Only pass this for draft edit flows; the API write path has a DB guard (`status='draft'`).
   */
  liveColumnSchema?: AngebotColumnDef[];
  onSuccess: (id: string) => void;
}

export function useAngebotBuilder({
  mode = 'create',
  angebotId,
  initialLineItems,
  initialShowTotalsBlock,
  initialInputMode,
  initialTotalsLabelNet,
  initialTotalsLabelTax,
  initialTotalsLabelGross,
  initialDefaultTaxRate,
  columnSchema,
  liveColumnSchema,
  onSuccess
}: UseAngebotBuilderOptions) {
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit';

  // WHY: input mode is a per-quote setting; gross mode reinterprets entered prices (but does not change editability).
  const initialInputModeRef = useRef<'net' | 'gross'>(
    initialInputMode ?? 'net'
  );
  const [inputMode, setInputMode] = useState<'net' | 'gross'>(
    initialInputModeRef.current
  );

  // WHY: totals-block visibility is a per-quote setting, independent from schema/rows.
  const initialShowTotalsBlockRef = useRef(initialShowTotalsBlock ?? false);
  const [showTotalsBlock, setShowTotalsBlock] = useState(
    initialShowTotalsBlockRef.current
  );

  // WHY: labels are stored nullable in DB (null → app default), but the builder always edits strings.
  const initialTotalsLabelNetRef = useRef<string | null>(
    initialTotalsLabelNet ?? null
  );
  const initialTotalsLabelTaxRef = useRef<string | null>(
    initialTotalsLabelTax ?? null
  );
  const initialTotalsLabelGrossRef = useRef<string | null>(
    initialTotalsLabelGross ?? null
  );

  const [totalsLabelNet, setTotalsLabelNet] = useState(
    initialTotalsLabelNetRef.current ?? DEFAULT_TOTALS_LABEL_NET
  );
  const [totalsLabelTax, setTotalsLabelTax] = useState(
    initialTotalsLabelTaxRef.current ?? DEFAULT_TOTALS_LABEL_TAX
  );
  const [totalsLabelGross, setTotalsLabelGross] = useState(
    initialTotalsLabelGrossRef.current ?? DEFAULT_TOTALS_LABEL_GROSS
  );

  // WHY: quote-level Summenblock fallback — persisted as `angebote.default_tax_rate`; never hardcoded in the UI.
  const initialDefaultTaxRateRef = useRef<number | null>(
    initialDefaultTaxRate === undefined || initialDefaultTaxRate === null
      ? null
      : isFinite(initialDefaultTaxRate)
        ? initialDefaultTaxRate
        : null
  );
  const [defaultTaxRate, setDefaultTaxRate] = useState<number | null>(
    initialDefaultTaxRateRef.current
  );

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
      // WHY: avoid accidentally resetting the input mode on edits that didn't touch it.
      const inputModeDirty = inputMode !== initialInputModeRef.current;
      // WHY: avoid accidentally resetting the flag on edits that didn't touch it.
      const dirty = showTotalsBlock !== initialShowTotalsBlockRef.current;
      const defaultTaxRateDirty =
        (defaultTaxRate ?? null) !== (initialDefaultTaxRateRef.current ?? null);
      await updateAngebot(
        angebotId,
        dirty || inputModeDirty || defaultTaxRateDirty
          ? {
              ...header,
              ...(dirty && { showTotalsBlock }),
              ...(inputModeDirty && { inputMode }),
              ...(defaultTaxRateDirty && { defaultTaxRate })
            }
          : header
      );
      await replaceAngebotLineItems(angebotId, rows);
      // Draft-only: keep snapshot schema in sync with the live Vorlage once the user saved edits.
      // Non-draft edits must never overwrite snapshots; the API enforces this via a status='draft' guard.
      if (liveColumnSchema && liveColumnSchema.length > 0) {
        await updateDraftAngebotSchema(angebotId, liveColumnSchema);
      }
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
    inputMode,
    setInputMode,
    showTotalsBlock,
    setShowTotalsBlock,
    totalsLabelNet,
    setTotalsLabelNet,
    totalsLabelTax,
    setTotalsLabelTax,
    totalsLabelGross,
    setTotalsLabelGross,
    defaultTaxRate,
    setDefaultTaxRate,
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
