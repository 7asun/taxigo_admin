'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Lock,
  Plus,
  X
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { AngebotPositionTextField } from './angebot-position-text-field';
import { plainTextFromPossibleHtml } from '@/features/angebote/lib/angebot-rich-text';
import { useAngebotVorlagenList } from '../../hooks/use-angebot-vorlagen';
import { ANGEBOT_POSITION_COLUMN_ID } from '../../lib/angebot-auto-columns';
import { isComputedColumn } from '../../lib/angebot-formula-engine';
import {
  COLUMN_PRESET_UI,
  resolveColumnLayout,
  type AngebotColumnPreset
} from '../../lib/angebot-column-presets';
import type { AngebotColumnDef } from '../../types/angebot.types';
import type { BuilderLineItem } from '../../hooks/use-angebot-builder';

function hasTaxRateValue(
  data: Record<string, string | number | null>,
  columns: AngebotColumnDef[]
): boolean {
  const taxRateCol = columns.find((c) => c.role === 'tax_rate');
  if (!taxRateCol) return false;
  const raw = data[taxRateCol.id];
  if (raw === null || raw === undefined || raw === '') return false;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  // WHY: tax_rate=0 is valid; only empty/non-numeric blocks gross reinterpretation.
  return isFinite(n) && n >= 0;
}

function formatEur(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

function formatEurPerKm(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)} €/km`;
}

/** de-DE km / Stückzahlen mit Dezimalen (z. B. 12,5) — parity mit PDF-Zelle. */
function formatDecimalDe(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

function renderComputedDisplay(col: AngebotColumnDef, raw: unknown): string {
  const layout = resolveColumnLayout(col);
  switch (layout.pdfRenderType) {
    case 'text': {
      if (raw == null || raw === '') return '—';
      return plainTextFromPossibleHtml(String(raw));
    }
    case 'integer': {
      if (raw == null || raw === '') return '—';
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      return Number.isFinite(n) ? String(n) : '—';
    }
    case 'decimal': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return Number.isFinite(n) ? formatDecimalDe(n) : '—';
    }
    case 'currency': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return formatEur(Number.isFinite(n) ? n : null);
    }
    case 'currency_per_km': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return formatEurPerKm(Number.isFinite(n) ? n : null);
    }
    case 'percent': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(n)) return '—';
      return `${n} %`;
    }
    default:
      return '—';
  }
}

// ─── Sortable card row ────────────────────────────────────────────────────────

interface SortableCardProps {
  index: number;
  item: BuilderLineItem;
  columnSchema: AngebotColumnDef[];
  inputMode: 'net' | 'gross';
  canDelete: boolean;
  onUpdate: (patch: Partial<BuilderLineItem>) => void;
  onDelete: () => void;
}

function SortableCard({
  index,
  item,
  columnSchema,
  inputMode,
  canDelete,
  onUpdate,
  onDelete
}: SortableCardProps) {
  /**
   * Holds the raw gross values typed by the dispatcher while gross mode
   * is active. Kept local — never written to row data. Row data always
   * receives engine-converted net values via onUpdate.
   */
  const [grossInputs, setGrossInputs] = useState<Record<string, string>>({});
  const prevInputModeRef = useRef<'net' | 'gross'>(inputMode);
  useEffect(() => {
    const prev = prevInputModeRef.current;
    prevInputModeRef.current = inputMode;
    // WHY: gross inputs are display-only; once leaving gross mode, clear them so net mode shows canonical values.
    if (prev === 'gross' && inputMode !== 'gross') {
      setGrossInputs({});
    }
  }, [inputMode]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: `row-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-card border-border space-y-2 rounded-md border p-3',
        isDragging && 'shadow-lg'
      )}
    >
      <div className='flex items-center justify-between gap-2'>
        <button
          type='button'
          {...attributes}
          {...listeners}
          className='text-muted-foreground hover:text-foreground cursor-grab touch-none p-0.5 active:cursor-grabbing'
          aria-label='Zeile verschieben'
        >
          <GripVertical className='h-3.5 w-3.5' />
        </button>
        <span className='text-muted-foreground flex-1 text-xs font-semibold'>
          Position {index + 1}
        </span>
        <button
          type='button'
          onClick={onDelete}
          disabled={!canDelete}
          aria-label='Zeile löschen'
          className={cn(
            'text-muted-foreground hover:text-destructive p-0.5 transition-colors',
            !canDelete && 'cursor-not-allowed opacity-30'
          )}
        >
          <X className='h-3.5 w-3.5' />
        </button>
      </div>

      {columnSchema.length > 0 ? (
        <div className='space-y-3'>
          {/* Pos. is always first and auto-numbered from row index. Never stored in data — injected at render time only. */}
          <div className='flex items-center gap-2'>
            <Label className='text-muted-foreground w-8 text-xs'>Pos.</Label>
            <span className='text-sm font-medium tabular-nums'>
              {index + 1}
            </span>
          </div>
          {columnSchema
            .filter((col) => col.id !== ANGEBOT_POSITION_COLUMN_ID)
            .map((col) => {
              const raw = item.data[col.id];
              const key = `${col.id}-${index}`;
              const layout = resolveColumnLayout(col);
              const computed = isComputedColumn(col);
              const showGrossWarning =
                inputMode === 'gross' &&
                (col.role === 'unit_price' ||
                  col.role === 'flat_rate' ||
                  col.role === 'surcharge') &&
                !hasTaxRateValue(item.data, columnSchema);
              const isGrossPriceInput =
                inputMode === 'gross' &&
                (col.role === 'unit_price' ||
                  col.role === 'flat_rate' ||
                  col.role === 'surcharge');
              return (
                <div key={key} className='space-y-1'>
                  <Label className='text-xs'>{col.header}</Label>
                  {computed ? (
                    <div
                      className='bg-muted/30 border-border flex h-8 items-center justify-between gap-2 rounded-md border px-2 text-sm'
                      title='Wird automatisch berechnet'
                    >
                      <span className='text-muted-foreground truncate'>
                        {renderComputedDisplay(col, raw)}
                      </span>
                      <span className='text-muted-foreground text-xs'>⚙</span>
                    </div>
                  ) : (
                    <>
                      {layout.pdfRenderType === 'text' ? (
                        <AngebotPositionTextField
                          key={`${col.id}-${index}`}
                          value={raw != null ? String(raw) : ''}
                          onChange={(html) =>
                            onUpdate({
                              data: {
                                ...item.data,
                                [col.id]: html
                              }
                            })
                          }
                          aria-label={col.header}
                        />
                      ) : null}
                      {layout.pdfRenderType === 'integer' ? (
                        <Input
                          className='h-8 text-sm'
                          // Whole numbers only — step=1 prevents decimal input.
                          type='number'
                          step={layout.inputStep ?? 1}
                          min={layout.inputMin}
                          value={raw != null && raw !== '' ? String(raw) : ''}
                          onChange={(e) => {
                            const t = e.target.value;
                            onUpdate({
                              data: {
                                ...item.data,
                                [col.id]: t === '' ? null : parseInt(t, 10)
                              }
                            });
                          }}
                        />
                      ) : null}
                      {layout.pdfRenderType === 'decimal' ? (
                        <Input
                          className='h-8 text-sm'
                          type='number'
                          step={layout.inputStep ?? 0.01}
                          min={layout.inputMin}
                          value={
                            raw != null &&
                            raw !== '' &&
                            !Number.isNaN(Number(raw))
                              ? String(raw)
                              : ''
                          }
                          onChange={(e) => {
                            const t = e.target.value;
                            onUpdate({
                              data: {
                                ...item.data,
                                [col.id]: t === '' ? null : parseFloat(t)
                              }
                            });
                          }}
                        />
                      ) : null}
                      {layout.pdfRenderType === 'currency' ||
                      layout.pdfRenderType === 'currency_per_km' ? (
                        isGrossPriceInput ? (
                          <div className='flex items-center gap-1.5'>
                            {/* Left — editable gross input */}
                            <div className='flex w-1/2 items-center gap-2'>
                              <Input
                                className='h-8 w-full text-sm'
                                placeholder='Brutto'
                                value={grossInputs[col.id] ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const parsed =
                                    raw === ''
                                      ? null
                                      : parseFloat(raw.replace(',', '.'));
                                  const safeParsed =
                                    parsed === null || isNaN(parsed)
                                      ? null
                                      : parsed;

                                  // Update local gross state for this column
                                  const nextGrossInputs = {
                                    ...grossInputs,
                                    [col.id]: raw
                                  };
                                  setGrossInputs(nextGrossInputs);

                                  // Build a patch that includes gross values for ALL price columns
                                  // that have been typed into — so the engine converts the full set
                                  // and never re-converts a net value from a previous update.
                                  const grossPatch: Record<
                                    string,
                                    number | null
                                  > = {};
                                  for (const c of columnSchema) {
                                    if (
                                      c.role === 'unit_price' ||
                                      c.role === 'flat_rate' ||
                                      c.role === 'surcharge'
                                    ) {
                                      if (c.id === col.id) {
                                        grossPatch[c.id] = safeParsed;
                                      } else if (
                                        nextGrossInputs[c.id] !== undefined
                                      ) {
                                        const other = parseFloat(
                                          nextGrossInputs[c.id].replace(
                                            ',',
                                            '.'
                                          )
                                        );
                                        grossPatch[c.id] = isNaN(other)
                                          ? null
                                          : other;
                                      }
                                    }
                                  }

                                  onUpdate({ data: grossPatch });
                                }}
                              />
                              {showGrossWarning ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className='text-warning h-3.5 w-3.5 shrink-0' />
                                  </TooltipTrigger>
                                  <TooltipContent side='top'>
                                    <p className='text-xs'>
                                      Steuersatz fehlt – Brutto-Rückrechnung
                                      nicht möglich.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>

                            {/* Right — read-only net value derived by engine */}
                            <div className='bg-muted/30 border-border text-muted-foreground flex h-8 w-1/2 items-center rounded-md border px-2 text-sm'>
                              {item.data[col.id] != null ? (
                                renderComputedDisplay(col, item.data[col.id])
                              ) : (
                                <span className='text-muted-foreground/40 text-xs'>
                                  Netto
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className='flex items-center gap-2'>
                            <Input
                              className='h-8 text-sm'
                              // Currency — step=0.01 aligns with cent precision; min=0 prevents negative prices.
                              type='number'
                              step={layout.inputStep ?? 0.01}
                              min={layout.inputMin}
                              value={
                                raw != null &&
                                raw !== '' &&
                                !Number.isNaN(Number(raw))
                                  ? String(raw)
                                  : ''
                              }
                              onChange={(e) => {
                                const t = e.target.value;
                                onUpdate({
                                  data: {
                                    ...item.data,
                                    [col.id]: t === '' ? null : parseFloat(t)
                                  }
                                });
                              }}
                            />
                            {showGrossWarning ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className='text-warning h-3.5 w-3.5 shrink-0' />
                                </TooltipTrigger>
                                <TooltipContent side='top'>
                                  <p className='text-xs'>
                                    Steuersatz fehlt – Brutto-Rückrechnung nicht
                                    möglich.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                        )
                      ) : null}
                      {layout.pdfRenderType === 'percent' ? (
                        <Input
                          className='h-8 text-sm'
                          // Stored as 0–100.
                          type='number'
                          step={layout.inputStep ?? 0.1}
                          min={layout.inputMin}
                          max={layout.inputMax}
                          value={
                            raw != null &&
                            raw !== '' &&
                            !Number.isNaN(Number(raw))
                              ? String(raw)
                              : ''
                          }
                          onChange={(e) => {
                            const t = e.target.value;
                            onUpdate({
                              data: {
                                ...item.data,
                                [col.id]: t === '' ? null : parseFloat(t)
                              }
                            });
                          }}
                        />
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
        </div>
      ) : null}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface Step2PositionenProps {
  /** Template picker (moved from Step 3). */
  companyId: string;
  selectedVorlageId: string | null;
  onVorlageChange: (id: string, columns: AngebotColumnDef[]) => void;
  onColumnPresetChange: (columnId: string, preset: AngebotColumnPreset) => void;
  isEditMode: boolean;
  columnSchema: AngebotColumnDef[];
  items: BuilderLineItem[];
  onUpdate: (index: number, patch: Partial<BuilderLineItem>) => void;
  onDelete: (index: number) => void;
  onReorder: (reordered: BuilderLineItem[]) => void;
  onAdd: () => void;
  inputMode: 'net' | 'gross';
  onInputModeChange: (mode: 'net' | 'gross') => void;
  showTotalsBlock: boolean;
  onShowTotalsBlockChange: (value: boolean) => void;
  totalsLabelNet: string;
  totalsLabelTax: string;
  totalsLabelGross: string;
  onTotalsLabelNetChange: (value: string) => void;
  onTotalsLabelTaxChange: (value: string) => void;
  onTotalsLabelGrossChange: (value: string) => void;
  /** Quote-level default MwSt (percent). UI only when Summenblock is on — persisted as `angebote.default_tax_rate`. */
  defaultTaxRate: number | null;
  onDefaultTaxRateChange: (value: number | null) => void;
}

export function Step2Positionen({
  companyId,
  selectedVorlageId,
  onVorlageChange,
  onColumnPresetChange,
  isEditMode,
  columnSchema,
  items,
  onUpdate,
  onDelete,
  onReorder,
  onAdd,
  inputMode,
  onInputModeChange,
  showTotalsBlock,
  onShowTotalsBlockChange,
  totalsLabelNet,
  totalsLabelTax,
  totalsLabelGross,
  onTotalsLabelNetChange,
  onTotalsLabelTaxChange,
  onTotalsLabelGrossChange,
  defaultTaxRate,
  onDefaultTaxRateChange
}: Step2PositionenProps) {
  const { data: vorlagen = [], isLoading: vorlagenLoading } =
    useAngebotVorlagenList(companyId);
  const [spaltenVorschauOpen, setSpaltenVorschauOpen] = useState(false);

  const selectValue = selectedVorlageId ?? '';
  const lockedVorlageLabel =
    vorlagen.find((x) => x.id === selectedVorlageId)?.name ??
    'Gespeicherte Vorlage';

  // Create mode: auto-pick default (or first) template when the list loads late — still runs while selectedVorlageId is null.
  useEffect(() => {
    if (isEditMode) return;
    if (selectedVorlageId != null) return;
    if (vorlagen.length === 0) return;
    const def = vorlagen.find((v) => v.is_default) ?? vorlagen[0];
    if (!def) return;
    const cols = def.columns;
    const safeCols = (Array.isArray(cols) ? cols : []).filter(
      (c) => c.id !== ANGEBOT_POSITION_COLUMN_ID
    );
    onVorlageChange(def.id, safeCols);
  }, [isEditMode, selectedVorlageId, vorlagen, onVorlageChange]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((_, i) => `row-${i}` === active.id);
    const newIndex = items.findIndex((_, i) => `row-${i}` === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  function handleSelectTemplate(id: string) {
    const v = vorlagen.find((x) => x.id === id);
    const cols = v?.columns;
    const safeCols = (Array.isArray(cols) ? cols : []).filter(
      (c) => c.id !== ANGEBOT_POSITION_COLUMN_ID
    );
    onVorlageChange(id, safeCols);
  }

  // WHY: when the schema already has a tax_rate role column, per-row values
  // always drive MwSt — the quote-level default has no effect and must not
  // be shown to avoid confusing dispatchers.
  const hasTaxRateColumn = columnSchema.some((c) => c.role === 'tax_rate');

  return (
    <div className='space-y-4'>
      {/* Template picker moved from Step 3 — must be the first element so the user selects column structure before filling rows. */}
      <div className='bg-muted/40 space-y-2 rounded-lg border p-4'>
        <Label>Angebotsvorlage</Label>
        <Collapsible
          open={spaltenVorschauOpen}
          onOpenChange={setSpaltenVorschauOpen}
        >
          <div className='flex items-center gap-2'>
            <div className='min-w-0 flex-1'>
              {isEditMode ? (
                // Phase 2a: template locked after create — read-only field + tooltip (Resolved decision 4).
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Input
                        readOnly
                        value={lockedVorlageLabel}
                        className='bg-muted pointer-events-none'
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      Die Vorlage kann nach dem Erstellen nicht mehr geändert
                      werden.
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Select
                  value={selectValue || undefined}
                  onValueChange={handleSelectTemplate}
                  disabled={
                    !companyId || vorlagenLoading || vorlagen.length === 0
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Vorlage wählen…' />
                  </SelectTrigger>
                  <SelectContent>
                    {vorlagen.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                        {v.is_default ? ' (Standard)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <CollapsibleTrigger asChild>
              <button
                type='button'
                className='text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-2 text-sm'
              >
                {spaltenVorschauOpen ? (
                  <ChevronDown className='h-4 w-4' />
                ) : (
                  <ChevronRight className='h-4 w-4' />
                )}
                <span>Spaltenvorschau</span>
              </button>
            </CollapsibleTrigger>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Button variant='link' className='h-auto px-0 text-sm' asChild>
              <Link href='/dashboard/abrechnung/angebot-vorlagen'>
                Vorlagen verwalten →
              </Link>
            </Button>
          </div>

          <CollapsibleContent>
            {columnSchema.length > 0 ? (
              <div className='flex flex-wrap gap-1.5 pt-2'>
                {/* Pos. is always first and locked — shown here so admin knows it is always present in the table. */}
                <Badge
                  variant='secondary'
                  className='flex items-center gap-1 text-xs font-normal'
                >
                  <Lock className='h-3 w-3' />
                  Pos.
                </Badge>
                {/* Read-only preview of active column headers — helps user understand what fields each row will have before typing. */}
                {columnSchema
                  .filter((col) => col.id !== ANGEBOT_POSITION_COLUMN_ID)
                  .map((col) => (
                    <div key={col.id} className='flex items-center gap-1.5'>
                      <Badge
                        variant='outline'
                        className='flex items-center gap-1 text-xs font-normal'
                      >
                        {COLUMN_PRESET_UI[col.preset].emoji} {col.header}
                      </Badge>
                      {!isEditMode ? (
                        // Per-offer preset override — updates draft columnSchema only. Does NOT mutate the saved Vorlage template.
                        <Select
                          value={col.preset}
                          onValueChange={(v) =>
                            onColumnPresetChange(
                              col.id,
                              v as AngebotColumnPreset
                            )
                          }
                        >
                          <SelectTrigger className='h-6 w-[140px] text-xs'>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.keys(
                                COLUMN_PRESET_UI
                              ) as AngebotColumnPreset[]
                            )
                              .filter(
                                (p) => COLUMN_PRESET_UI[p].adminSelectable
                              )
                              .map((p) => (
                                <SelectItem key={p} value={p}>
                                  {COLUMN_PRESET_UI[p].emoji}{' '}
                                  {COLUMN_PRESET_UI[p].label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                  ))}
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {columnSchema.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Keine Spalten definiert — bitte zuerst eine Angebotsvorlage auswählen.
        </p>
      ) : null}

      <div className='space-y-2'>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((_, i) => `row-${i}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className='space-y-2'>
              {items.map((item, idx) => (
                <SortableCard
                  key={`row-${idx}`}
                  index={idx}
                  item={item}
                  columnSchema={columnSchema}
                  inputMode={inputMode}
                  canDelete={items.length > 1}
                  onUpdate={(patch) => onUpdate(idx, patch)}
                  onDelete={() => onDelete(idx)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className='flex items-center gap-3 pt-4 pb-2'>
          <Switch
            id='input-mode-toggle'
            checked={inputMode === 'gross'}
            onCheckedChange={(checked) =>
              onInputModeChange(checked ? 'gross' : 'net')
            }
          />
          <label
            htmlFor='input-mode-toggle'
            className='text-muted-foreground cursor-pointer text-sm select-none'
          >
            Brutto-Eingabe
            {inputMode === 'gross' ? (
              <span className='text-muted-foreground/60 ml-1.5 text-xs'>
                (Rückrechnung auf Netto)
              </span>
            ) : null}
          </label>
        </div>

        <div className='flex items-center gap-3 pt-4'>
          <Switch
            id='show-totals-block'
            checked={showTotalsBlock}
            onCheckedChange={(checked) => onShowTotalsBlockChange(checked)}
          />
          <label
            htmlFor='show-totals-block'
            className='text-muted-foreground cursor-pointer text-sm select-none'
          >
            Summenblock im Angebot anzeigen (Netto / MwSt / Brutto)
          </label>
        </div>

        {showTotalsBlock ? (
          <div className='mt-3 flex flex-col gap-2 pl-1'>
            <p className='text-muted-foreground text-xs font-medium'>
              Beschriftung der Summenzeilen
            </p>
            {[
              {
                label: 'Netto-Zeile',
                value: totalsLabelNet,
                onChange: onTotalsLabelNetChange
              },
              {
                label: 'MwSt-Zeile',
                value: totalsLabelTax,
                onChange: onTotalsLabelTaxChange
              },
              {
                label: 'Brutto-Zeile',
                value: totalsLabelGross,
                onChange: onTotalsLabelGrossChange
              }
            ].map(({ label, value, onChange }) => (
              <div key={label} className='flex items-center gap-2'>
                <span className='text-muted-foreground w-24 shrink-0 text-xs'>
                  {label}
                </span>
                <Input
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className='h-7 text-xs'
                  maxLength={60}
                />
              </div>
            ))}
            {showTotalsBlock && !hasTaxRateColumn ? (
              <div className='flex flex-col gap-1 pt-3'>
                {/* WHY: quote-level default rate is Summenblock-only — never visible when the toggle is off (product rule). */}
                <p className='text-muted-foreground text-xs font-medium'>
                  Standard-MwSt für Summenblock (%)
                </p>
                <Input
                  value={defaultTaxRate === null ? '' : String(defaultTaxRate)}
                  onChange={(e) => {
                    const s = e.target.value.trim();
                    if (s === '') {
                      onDefaultTaxRateChange(null);
                      return;
                    }
                    const n = parseFloat(s.replace(',', '.'));
                    onDefaultTaxRateChange(isFinite(n) ? n : null);
                  }}
                  className='h-7 max-w-[120px] text-xs'
                  inputMode='decimal'
                  placeholder='Optional'
                />
                <p className='text-muted-foreground max-w-md text-[11px] leading-snug'>
                  Gilt wenn die Vorlage keine MwSt-Spalte hat oder eine Zeile
                  keinen Satz eingetragen hat. Werte in der Tabelle haben immer
                  Vorrang.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='w-full'
          onClick={onAdd}
        >
          <Plus className='mr-1.5 h-3.5 w-3.5' />
          Zeile hinzufügen
        </Button>
      </div>
    </div>
  );
}
