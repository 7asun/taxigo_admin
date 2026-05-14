'use client';

import type { VisibilityState } from '@tanstack/react-table';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronUp,
  Columns3,
  GripVertical,
  Pencil,
  Trash2
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  jsonToColumnOrder,
  jsonToVisibilityState
} from '@/features/trips/hooks/use-apply-trip-preset';
import {
  useDeleteTripPreset,
  useReorderTripPresets,
  useTripPresets,
  useUpdateTripPreset
} from '@/features/trips/hooks/use-trip-presets';
import type {
  TripPreset,
  TripPresetParams
} from '@/features/trips/types/trip-preset.types';

// Source of truth for the column editor.
// id: TanStack column id.
// label: display name shown in the editor.
// hidable: false = always visible, cannot be toggled (select, actions).
// fixed: true = always first/last, cannot be reordered.
const EDITOR_COLUMNS: {
  id: string;
  label: string;
  hidable: boolean;
  fixed: boolean;
}[] = [
  { id: 'select', label: 'Auswahl', hidable: false, fixed: true },
  { id: 'scheduled_at', label: 'Datum', hidable: true, fixed: false },
  { id: 'time', label: 'Zeit', hidable: true, fixed: false },
  { id: 'name', label: 'Fahrgast', hidable: true, fixed: false },
  { id: 'pickup_address', label: 'Abholung', hidable: true, fixed: false },
  { id: 'dropoff_address', label: 'Ziel', hidable: true, fixed: false },
  { id: 'driver_id', label: 'Fahrer', hidable: true, fixed: false },
  { id: 'status', label: 'Status', hidable: true, fixed: false },
  { id: 'gross_price', label: 'Brutto', hidable: true, fixed: false },
  {
    id: 'invoice_status',
    label: 'Rechnungsstatus',
    hidable: true,
    fixed: false
  },
  { id: 'payer_name', label: 'Kostenträger', hidable: true, fixed: false },
  { id: 'fremdfirma', label: 'Fremdfirma', hidable: true, fixed: false },
  {
    id: 'fremdfirma_abrechnung',
    label: 'Abrechnung Fremdfirma',
    hidable: true,
    fixed: false
  },
  { id: 'billing_type', label: 'Abrechnung', hidable: true, fixed: false },
  {
    id: 'billing_calling_station',
    label: 'Anrufstation',
    hidable: true,
    fixed: false
  },
  { id: 'billing_betreuer', label: 'Betreuer', hidable: true, fixed: false },
  { id: 'kts_document_applies', label: 'KTS', hidable: true, fixed: false },
  { id: 'kts_fehler', label: 'KTS-Fehler', hidable: true, fixed: false },
  {
    id: 'kts_fehler_beschreibung',
    label: 'KTS-Fehler (Text)',
    hidable: true,
    fixed: false
  },
  { id: 'reha_schein', label: 'Reha-Schein', hidable: true, fixed: false },
  { id: 'net_price', label: 'Netto', hidable: true, fixed: false },
  { id: 'tax_rate', label: 'MwSt.', hidable: true, fixed: false },
  { id: 'actions', label: 'Aktionen', hidable: false, fixed: true }
];

const EDITOR_BY_ID = new Map(EDITOR_COLUMNS.map((c) => [c.id, c]));

function buildInitialDraftOrder(preset: TripPreset): string[] {
  const stored = jsonToColumnOrder(preset.column_order);
  const middleIds = EDITOR_COLUMNS.filter((c) => !c.fixed).map((c) => c.id);

  if (stored.length === 0) {
    return EDITOR_COLUMNS.map((c) => c.id);
  }

  const seen = new Set<string>();
  const middleFromStored = stored.filter((id) => {
    if (!middleIds.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const missingMiddle = middleIds.filter(
    (id) => !middleFromStored.includes(id)
  );
  return ['select', ...middleFromStored, ...missingMiddle, 'actions'];
}

function buildInitialDraftVisibility(
  preset: TripPreset
): Record<string, boolean> {
  const vis = jsonToVisibilityState(preset.column_visibility);
  const out: Record<string, boolean> = {};
  for (const col of EDITOR_COLUMNS) {
    out[col.id] = col.hidable ? vis[col.id] !== false : true;
  }
  return out;
}

function toStoredVisibility(draft: Record<string, boolean>): VisibilityState {
  const out: VisibilityState = {};
  for (const col of EDITOR_COLUMNS) {
    if (col.hidable && draft[col.id] === false) {
      out[col.id] = false;
    }
  }
  return out;
}

function PresetColumnEditorSortableRow({
  id,
  label,
  visible,
  hidable,
  disabled,
  onVisibleChange
}: {
  id: string;
  label: string;
  visible: boolean;
  hidable: boolean;
  disabled?: boolean;
  onVisibleChange: (v: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-muted/30 border-border flex items-center gap-2 rounded-md border px-2 py-1.5',
        isDragging && 'opacity-60'
      )}
    >
      <button
        type='button'
        className='text-muted-foreground hover:text-foreground touch-none p-0.5'
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label='Reihenfolge ändern'
      >
        <GripVertical className='h-4 w-4' />
      </button>
      <span className='min-w-0 flex-1 truncate text-xs'>{label}</span>
      <div className='flex shrink-0 items-center px-1'>
        <Checkbox
          checked={visible}
          disabled={!hidable || disabled}
          onCheckedChange={(v) => {
            if (!hidable) return;
            onVisibleChange(v === true);
          }}
          aria-label={`Sichtbar: ${label}`}
        />
      </div>
    </div>
  );
}

function FixedEditorRow({
  label,
  checked
}: {
  label: string;
  checked: boolean;
}) {
  return (
    <div className='bg-muted/20 border-border flex items-center gap-2 rounded-md border px-2 py-1.5 pl-9'>
      <span className='text-muted-foreground min-w-0 flex-1 truncate text-xs'>
        {label}
      </span>
      <div className='flex shrink-0 items-center px-1'>
        <Checkbox checked={checked} disabled aria-label={label} />
      </div>
    </div>
  );
}

function PresetColumnEditor({
  preset,
  onSave,
  onCancel
}: {
  preset: TripPreset;
  onSave: (
    visibility: VisibilityState,
    order: string[]
  ) => void | Promise<void>;
  onCancel: () => void;
}) {
  const updateMutation = useUpdateTripPreset();
  const [draftOrder, setDraftOrder] = React.useState<string[]>(() =>
    buildInitialDraftOrder(preset)
  );
  const [draftVisibility, setDraftVisibility] = React.useState<
    Record<string, boolean>
  >(() => buildInitialDraftVisibility(preset));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const middleIds = React.useMemo(
    () =>
      draftOrder.filter((colId) => colId !== 'select' && colId !== 'actions'),
    [draftOrder]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = middleIds.indexOf(String(active.id));
    const newIndex = middleIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const newMiddle = arrayMove(middleIds, oldIndex, newIndex);
    setDraftOrder(['select', ...newMiddle, 'actions']);
  };

  const setColVisible = (colId: string, v: boolean) => {
    const col = EDITOR_BY_ID.get(colId);
    if (!col?.hidable) return;
    setDraftVisibility((prev) => ({ ...prev, [colId]: v }));
  };

  return (
    <div className='border-border space-y-3 border-t pt-3'>
      <p className='text-muted-foreground text-xs'>
        Spalten-Reihenfolge und Sichtbarkeit
      </p>
      <div className='flex flex-col gap-1.5'>
        <FixedEditorRow
          label={EDITOR_BY_ID.get('select')?.label ?? 'Auswahl'}
          checked
        />
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={middleIds}
            strategy={verticalListSortingStrategy}
          >
            {middleIds.map((colId) => {
              const meta = EDITOR_BY_ID.get(colId);
              if (!meta) return null;
              return (
                <PresetColumnEditorSortableRow
                  key={colId}
                  id={colId}
                  label={meta.label}
                  visible={draftVisibility[colId] !== false}
                  hidable={meta.hidable}
                  disabled={updateMutation.isPending}
                  onVisibleChange={(v) => setColVisible(colId, v)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
        <FixedEditorRow
          label={EDITOR_BY_ID.get('actions')?.label ?? 'Aktionen'}
          checked
        />
      </div>
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 text-xs'
          disabled={updateMutation.isPending}
          onClick={onCancel}
        >
          Abbrechen
        </Button>
        <Button
          type='button'
          size='sm'
          className='h-7 text-xs'
          disabled={updateMutation.isPending}
          onClick={() => {
            void onSave(toStoredVisibility(draftVisibility), draftOrder);
          }}
        >
          Speichern
        </Button>
      </div>
    </div>
  );
}

interface AnsichtenSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getSnapshot: () => {
    params: TripPresetParams;
    column_visibility: VisibilityState;
    column_order: string[];
  };
}

export function AnsichtenSheet({
  open,
  onOpenChange,
  getSnapshot
}: AnsichtenSheetProps) {
  const { data: presets = [], isLoading } = useTripPresets();
  const updateMutation = useUpdateTripPreset();
  const deleteMutation = useDeleteTripPreset();
  const reorderMutation = useReorderTripPresets();

  const sorted = React.useMemo(
    () =>
      [...presets].sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [presets]
  );

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState('');
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null
  );
  const [editingColumnsId, setEditingColumnsId] = React.useState<string | null>(
    null
  );

  React.useEffect(() => {
    if (!open) {
      setEditingId(null);
      setConfirmDeleteId(null);
      setEditingColumnsId(null);
    }
  }, [open]);

  const startEdit = (p: TripPreset) => {
    setEditingId(p.id);
    setDraftName(p.name);
  };

  const commitRename = async (id: string) => {
    const name = draftName.trim();
    if (!name || name.length > 60) return;
    await updateMutation.mutateAsync({ id, patch: { name } });
    setEditingId(null);
  };

  const move = async (id: string, dir: -1 | 1) => {
    const idx = sorted.findIndex((p) => p.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= sorted.length) return;
    const next = sorted.map((p) => p.id);
    const t = next[idx];
    next[idx] = next[j];
    next[j] = t;
    await reorderMutation.mutateAsync(next);
  };

  const handleOverwrite = React.useCallback(
    async (p: TripPreset) => {
      const snapshot = getSnapshot();
      await updateMutation.mutateAsync({
        id: p.id,
        patch: {
          params: snapshot.params,
          column_visibility: snapshot.column_visibility,
          column_order: snapshot.column_order
        }
      });
    },
    [getSnapshot, updateMutation]
  );

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync(id);
    setConfirmDeleteId(null);
  };

  const toggleColumnEditor = (presetId: string) => {
    setEditingColumnsId((prev) => (prev === presetId ? null : presetId));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className='flex w-full max-w-md flex-col sm:max-w-md'
      >
        <SheetHeader>
          <SheetTitle>Ansichten verwalten</SheetTitle>
          <SheetDescription>
            Gespeicherte Kombinationen aus Filtern und sichtbaren Spalten.
          </SheetDescription>
        </SheetHeader>

        <div className='flex min-h-0 flex-1 flex-col px-4 pt-2'>
          {isLoading ? (
            <p className='text-muted-foreground text-sm'>Laden…</p>
          ) : sorted.length === 0 ? (
            <p className='text-muted-foreground text-sm leading-relaxed'>
              Noch keine Ansichten gespeichert. Richte Filter und Spalten nach
              deinen Wünschen ein und speichere deine erste Ansicht.
            </p>
          ) : (
            <ScrollArea className='min-h-0 flex-1'>
              <div className='pr-3 pb-4'>
                <ul className='space-y-2'>
                  {sorted.map((p, i) => (
                    <li
                      key={p.id}
                      className='border-border flex flex-col gap-2 rounded-md border p-2'
                    >
                      {confirmDeleteId === p.id ? (
                        <div className='space-y-2'>
                          <p className='text-sm'>Wirklich löschen?</p>
                          <div className='flex justify-end gap-2'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              className='h-7 text-xs'
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Abbrechen
                            </Button>
                            <Button
                              type='button'
                              variant='destructive'
                              size='sm'
                              className='h-7 text-xs'
                              disabled={deleteMutation.isPending}
                              onClick={() => void handleDelete(p.id)}
                            >
                              Löschen
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className='flex items-center gap-2'>
                            <div className='text-muted-foreground flex shrink-0 flex-col gap-0.5'>
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='size-6'
                                disabled={i === 0 || reorderMutation.isPending}
                                aria-label='Nach oben'
                                onClick={() => void move(p.id, -1)}
                              >
                                <ChevronUp className='size-3.5' />
                              </Button>
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='size-6'
                                disabled={
                                  i === sorted.length - 1 ||
                                  reorderMutation.isPending
                                }
                                aria-label='Nach unten'
                                onClick={() => void move(p.id, 1)}
                              >
                                <ChevronDown className='size-3.5' />
                              </Button>
                            </div>
                            <div className='min-w-0 flex-1'>
                              {editingId === p.id ? (
                                <Input
                                  value={draftName}
                                  maxLength={60}
                                  className='h-8 text-xs'
                                  autoFocus
                                  onChange={(e) => setDraftName(e.target.value)}
                                  onBlur={() => void commitRename(p.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void commitRename(p.id);
                                    }
                                    if (e.key === 'Escape') {
                                      setEditingId(null);
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  type='button'
                                  className='hover:text-foreground text-muted-foreground w-full truncate text-left text-sm font-medium'
                                  onClick={() => toggleColumnEditor(p.id)}
                                >
                                  {p.name}
                                </button>
                              )}
                            </div>
                            <div className='flex shrink-0 items-center gap-1'>
                              <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                className='text-muted-foreground h-7 px-2 text-xs'
                                title='Aktuelle Ansicht in diesem Preset speichern'
                                onClick={() => void handleOverwrite(p)}
                              >
                                Überschreiben
                              </Button>
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='size-7'
                                aria-label='Spalten bearbeiten'
                                title='Spalten bearbeiten'
                                onClick={() => toggleColumnEditor(p.id)}
                              >
                                <Columns3 className='size-3.5' />
                              </Button>
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='size-7'
                                aria-label='Umbenennen'
                                onClick={() => startEdit(p)}
                              >
                                <Pencil className='size-3.5' />
                              </Button>
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='text-destructive size-7'
                                aria-label='Löschen'
                                onClick={() => setConfirmDeleteId(p.id)}
                              >
                                <Trash2 className='size-3.5' />
                              </Button>
                            </div>
                          </div>
                          {editingColumnsId === p.id && (
                            <PresetColumnEditor
                              key={p.id}
                              preset={p}
                              onSave={async (visibility, order) => {
                                await updateMutation.mutateAsync({
                                  id: p.id,
                                  patch: {
                                    column_visibility: visibility,
                                    column_order: order
                                  }
                                });
                                setEditingColumnsId(null);
                              }}
                              onCancel={() => setEditingColumnsId(null)}
                            />
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
