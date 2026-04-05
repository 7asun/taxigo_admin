'use client';

/**
 * step-4-vorlage.tsx
 *
 * Invoice builder **Section 4 (PDF-Vorlage)** — appears before **Bestätigung** so dispatchers can
 * confirm how the PDF table will look. Chooses a Vorlage and optionally customizes column keys for
 * **this invoice only** (`pdf_column_override` on create).
 *
 * **Shared UI:** `ColumnPicker` and `SortablePdfColumnList` are the same components as in settings
 * (`vorlage-editor-panel`); only layout and callbacks differ.
 *
 * **`onColumnProfileChange`** emits the resolved {@link PdfColumnProfile} upward on every relevant
 * change. **`invoice-builder/index.tsx`** holds **`builderColumnProfile`** state and passes it to
 * **`useInvoiceBuilderPdfPreview`** so the sticky preview updates without persisting to the DB.
 *
 * Related: `resolvePdfColumnProfile`, `pdf-vorlagen.api.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

import { getDefaultVorlageForCompany } from '@/features/invoices/api/pdf-vorlagen.api';
import { invoiceKeys } from '@/query/keys';
import { usePdfVorlagenList } from '@/features/invoices/hooks/use-pdf-vorlagen';
import { resolvePdfColumnProfile } from '@/features/invoices/lib/resolve-pdf-column-profile';
import type { PdfColumnProfile } from '@/features/invoices/types/pdf-vorlage.types';
import type { PdfColumnKey } from '@/features/invoices/lib/pdf-column-catalog';
import { cn } from '@/lib/utils';

import { ColumnPicker } from '@/features/invoices/components/pdf-vorlagen/column-picker';
import { SortablePdfColumnList } from '@/features/invoices/components/pdf-vorlagen/sortable-pdf-column-list';
import {
  APPENDIX_COLUMNS,
  APPENDIX_LANDSCAPE_THRESHOLD,
  MAIN_FLAT_COLUMNS,
  MAIN_GROUPED_COLUMNS,
  PDF_COLUMN_MAP
} from '@/features/invoices/lib/pdf-column-catalog';
import type { PdfColumnOverridePayload } from '@/features/invoices/types/pdf-vorlage.types';

interface Step4VorlageProps {
  companyId: string;
  payerPdfVorlageId: string | null | undefined;
  /** Section 4 unlocks after Positionen (Section 3) is complete. */
  unlocked: boolean;
  /**
   * Called whenever the resolved column profile changes (Vorlage or customize).
   * Parent feeds this into the live PDF preview hook — must stay synchronous.
   *
   * @param profile — result of {@link resolvePdfColumnProfile}
   */
  onColumnProfileChange: (profile: PdfColumnProfile) => void;
  /**
   * Persists the JSON override payload for createInvoice (null = use Vorlage only).
   *
   * @param override — columns to store in pdf_column_override, or null
   */
  onPdfOverrideChange: (override: PdfColumnOverridePayload | null) => void;
}

/**
 * PDF-Vorlage step: Vorlage dropdown, optional column customization, and upward sync
 * of resolved profile + override payload.
 *
 * @param props — company scope, payer default, unlock flag, parent callbacks
 * @returns Vorlage UI block (no outer card — shell provides BuilderSectionCard)
 */
export function Step4Vorlage({
  companyId,
  payerPdfVorlageId,
  unlocked,
  onColumnProfileChange,
  onPdfOverrideChange
}: Step4VorlageProps) {
  const { data: vorlagen = [] } = usePdfVorlagenList(companyId);
  const { data: companyDefaultVorlage = null } = useQuery({
    queryKey: [...invoiceKeys.pdfVorlagen.list(companyId), 'default-row'],
    queryFn: () => getDefaultVorlageForCompany(companyId),
    enabled: Boolean(companyId),
    staleTime: 60_000
  });

  const [selectedVorlageId, setSelectedVorlageId] = useState<string | null>(
    null
  );
  const [customizeEnabled, setCustomizeEnabled] = useState(false);
  const [customColumns, setCustomColumns] = useState<{
    main_columns: PdfColumnKey[];
    appendix_columns: PdfColumnKey[];
  } | null>(null);
  const [colsOpen, setColsOpen] = useState(true);

  // Reacts to payer’s pdf_vorlage_id or company default Vorlage id: sync dropdown selection.
  useEffect(() => {
    const next = payerPdfVorlageId ?? companyDefaultVorlage?.id ?? null;
    setSelectedVorlageId(next);
  }, [payerPdfVorlageId, companyDefaultVorlage?.id]);

  /** Explicit Vorlage row from the dropdown, or null → company / system resolution tier. */
  const selectedVorlage = useMemo(() => {
    if (!selectedVorlageId) return null;
    return vorlagen.find((v) => v.id === selectedVorlageId) ?? null;
  }, [vorlagen, selectedVorlageId]);

  const inheritedMainLayout =
    selectedVorlage?.main_layout ??
    companyDefaultVorlage?.main_layout ??
    'grouped';

  const mainColumnPool =
    inheritedMainLayout === 'grouped'
      ? MAIN_GROUPED_COLUMNS
      : MAIN_FLAT_COLUMNS;

  // Emit the resolved column profile to the parent (index.tsx) on every change.
  // index.tsx feeds this into useInvoiceBuilderPdfPreview so the live preview
  // updates whenever the dispatcher changes Vorlage or custom column settings.
  // Priority chain: custom override → selected Vorlage → company default → system fallback.
  useEffect(() => {
    const resolved = resolvePdfColumnProfile(
      customizeEnabled && customColumns
        ? {
            main_columns: customColumns.main_columns,
            appendix_columns: customColumns.appendix_columns,
            main_layout: inheritedMainLayout
          }
        : null,
      selectedVorlage,
      companyDefaultVorlage
    );
    onColumnProfileChange(resolved);
  }, [
    selectedVorlageId,
    customizeEnabled,
    customColumns,
    selectedVorlage,
    companyDefaultVorlage,
    inheritedMainLayout,
    onColumnProfileChange
  ]);

  // Reacts to customize toggle and column edits: pushes pdf_column_override payload for createInvoice
  // (null when not customizing — server uses Vorlage chain only).
  useEffect(() => {
    onPdfOverrideChange(
      customizeEnabled && customColumns
        ? {
            main_columns: customColumns.main_columns,
            appendix_columns: customColumns.appendix_columns,
            main_layout: inheritedMainLayout
          }
        : null
    );
  }, [
    customizeEnabled,
    customColumns,
    inheritedMainLayout,
    onPdfOverrideChange
  ]);

  const initCustomFromProfile = useCallback(() => {
    const p = resolvePdfColumnProfile(
      null,
      selectedVorlage,
      companyDefaultVorlage
    );
    setCustomColumns({
      main_columns: [...p.main_columns],
      appendix_columns: [...p.appendix_columns]
    });
  }, [selectedVorlage, companyDefaultVorlage]);

  const handleCustomizeChecked = (checked: boolean) => {
    setCustomizeEnabled(checked);
    if (checked) {
      initCustomFromProfile();
    } else {
      setCustomColumns(null);
    }
  };

  const getLabel = (key: string) => PDF_COLUMN_MAP[key]?.uiLabel ?? key;

  const availableMain = useMemo(() => {
    if (!customColumns) return [];
    return mainColumnPool.filter(
      (c) => !customColumns.main_columns.includes(c.key as PdfColumnKey)
    );
  }, [customColumns, mainColumnPool]);

  const availableAppendix = useMemo(() => {
    if (!customColumns) return [];
    return APPENDIX_COLUMNS.filter(
      (c) => !customColumns.appendix_columns.includes(c.key as PdfColumnKey)
    );
  }, [customColumns]);

  const appendixLandscape =
    customColumns &&
    customColumns.appendix_columns.length > APPENDIX_LANDSCAPE_THRESHOLD;

  const matchesPayerAssignment =
    selectedVorlageId === (payerPdfVorlageId ?? null);

  return (
    <div
      className={cn('space-y-4', !unlocked && 'pointer-events-none opacity-50')}
    >
      <div className='space-y-2'>
        <Label>PDF-Vorlage</Label>
        <Select
          value={selectedVorlageId ?? '__none__'}
          onValueChange={(v) =>
            setSelectedVorlageId(v === '__none__' ? null : v)
          }
          disabled={!unlocked}
        >
          <SelectTrigger className='w-full max-w-md'>
            <SelectValue placeholder='Vorlage wählen' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='__none__'>
              Unternehmens- / System-Standard
            </SelectItem>
            {vorlagen.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
                {v.is_default ? ' (Standard)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className='text-muted-foreground text-xs'>
          {payerPdfVorlageId && matchesPayerAssignment
            ? 'Vorausgewählt vom Kostenträger'
            : !payerPdfVorlageId &&
                selectedVorlageId === companyDefaultVorlage?.id
              ? 'Unternehmens-Standard-Vorlage'
              : selectedVorlageId === null
                ? 'Unternehmens-Standard oder System-Fallback'
                : 'Gewählte Vorlage (Vorschau)'}
        </p>
      </div>

      <div className='flex items-center gap-2'>
        <Checkbox
          id='pdf-customize'
          checked={customizeEnabled}
          disabled={!unlocked}
          onCheckedChange={(v) => handleCustomizeChecked(v === true)}
        />
        <Label htmlFor='pdf-customize' className='font-normal'>
          Spalten für diese Rechnung anpassen
        </Label>
      </div>

      {customizeEnabled && customColumns ? (
        <Collapsible open={colsOpen} onOpenChange={setColsOpen}>
          <CollapsibleTrigger className='flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-medium'>
            Spalten bearbeiten
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform',
                colsOpen && 'rotate-180'
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className='space-y-6 pt-4'>
            <div className='space-y-2'>
              <p className='text-sm font-medium'>Hauptrechnung</p>
              <ColumnPicker
                available={availableMain}
                disabled={!unlocked}
                onAdd={(key) =>
                  setCustomColumns((prev) =>
                    prev
                      ? {
                          ...prev,
                          main_columns: [
                            ...prev.main_columns,
                            key as PdfColumnKey
                          ]
                        }
                      : prev
                  )
                }
              />
              <SortablePdfColumnList
                columnKeys={customColumns.main_columns}
                getLabel={getLabel}
                disabled={!unlocked}
                onReorder={(next) =>
                  setCustomColumns((prev) =>
                    prev
                      ? { ...prev, main_columns: next as PdfColumnKey[] }
                      : prev
                  )
                }
                onRemove={(key) =>
                  setCustomColumns((prev) =>
                    prev
                      ? {
                          ...prev,
                          main_columns: prev.main_columns.filter(
                            (k) => k !== key
                          )
                        }
                      : prev
                  )
                }
              />
            </div>
            <div className='space-y-2'>
              <p className='text-sm font-medium'>Anhang</p>
              {appendixLandscape ? (
                <p className='text-muted-foreground text-xs'>
                  Querformat wird automatisch aktiviert (
                  {customColumns.appendix_columns.length} Spalten)
                </p>
              ) : null}
              <ColumnPicker
                available={availableAppendix}
                disabled={!unlocked}
                onAdd={(key) =>
                  setCustomColumns((prev) =>
                    prev
                      ? {
                          ...prev,
                          appendix_columns: [
                            ...prev.appendix_columns,
                            key as PdfColumnKey
                          ]
                        }
                      : prev
                  )
                }
              />
              <SortablePdfColumnList
                columnKeys={customColumns.appendix_columns}
                getLabel={getLabel}
                disabled={!unlocked}
                onReorder={(next) =>
                  setCustomColumns((prev) =>
                    prev
                      ? { ...prev, appendix_columns: next as PdfColumnKey[] }
                      : prev
                  )
                }
                onRemove={(key) =>
                  setCustomColumns((prev) =>
                    prev
                      ? {
                          ...prev,
                          appendix_columns: prev.appendix_columns.filter(
                            (k) => k !== key
                          )
                        }
                      : prev
                  )
                }
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
