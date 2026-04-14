'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
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
import { cn } from '@/lib/utils';

import { useAngebotVorlagenList } from '../../hooks/use-angebot-vorlagen';
import { ANGEBOT_POSITION_COLUMN_ID } from '../../lib/angebot-auto-columns';
import {
  COLUMN_PRESET_UI,
  resolveColumnLayout,
  type AngebotColumnPreset
} from '../../lib/angebot-column-presets';
import type { AngebotColumnDef } from '../../types/angebot.types';
import type { BuilderLineItem } from '../../hooks/use-angebot-builder';

// ─── Sortable card row ────────────────────────────────────────────────────────

interface SortableCardProps {
  index: number;
  item: BuilderLineItem;
  columnSchema: AngebotColumnDef[];
  canDelete: boolean;
  onUpdate: (patch: Partial<BuilderLineItem>) => void;
  onDelete: () => void;
}

function SortableCard({
  index,
  item,
  columnSchema,
  canDelete,
  onUpdate,
  onDelete
}: SortableCardProps) {
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
              return (
                <div key={key} className='space-y-1'>
                  <Label className='text-xs'>{col.header}</Label>
                  {layout.pdfRenderType === 'text' ? (
                    <Input
                      className='h-8 text-sm'
                      // Free text — no step or min constraints.
                      type='text'
                      value={raw != null ? String(raw) : ''}
                      onChange={(e) =>
                        onUpdate({
                          data: {
                            ...item.data,
                            [col.id]: e.target.value || null
                          }
                        })
                      }
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
                  {layout.pdfRenderType === 'currency' ||
                  layout.pdfRenderType === 'currency_per_km' ? (
                    <Input
                      className='h-8 text-sm'
                      // Currency — step=0.01 aligns with cent precision; min=0 prevents negative prices.
                      type='number'
                      step={layout.inputStep ?? 0.01}
                      min={layout.inputMin}
                      value={
                        raw != null && raw !== '' && !Number.isNaN(Number(raw))
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
                  {layout.pdfRenderType === 'percent' ? (
                    <Input
                      className='h-8 text-sm'
                      // Stored as 0–100.
                      type='number'
                      step={layout.inputStep ?? 0.1}
                      min={layout.inputMin}
                      max={layout.inputMax}
                      value={
                        raw != null && raw !== '' && !Number.isNaN(Number(raw))
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
  onAdd
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
                  canDelete={items.length > 1}
                  onUpdate={(patch) => onUpdate(idx, patch)}
                  onDelete={() => onDelete(idx)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

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
