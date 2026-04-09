'use client';

import { GripVertical, X, Plus } from 'lucide-react';
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

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { BuilderLineItem } from '../../hooks/use-angebot-builder';

// ─── Sortable card row ────────────────────────────────────────────────────────

interface SortableCardProps {
  index: number;
  item: BuilderLineItem;
  canDelete: boolean;
  onUpdate: (patch: Partial<BuilderLineItem>) => void;
  onDelete: () => void;
}

function SortableCard({
  index,
  item,
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
      {/* Row 1 — drag handle + position label + delete */}
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

      {/* Row 2 — Leistung (full width) */}
      <div className='space-y-1'>
        <Label className='text-xs'>Leistung</Label>
        <Input
          className='h-8 text-sm'
          placeholder='Leistungsbeschreibung'
          value={item.leistung}
          onChange={(e) => onUpdate({ leistung: e.target.value })}
        />
      </div>

      {/* Row 3 — three price inputs in a grid */}
      <div className='grid grid-cols-3 gap-2'>
        <div className='space-y-1'>
          <Label className='text-xs'>Anfahrt (€)</Label>
          <Input
            className='h-8 text-sm'
            type='number'
            step='0.01'
            min='0'
            placeholder='0,00'
            value={item.anfahrtkosten ?? ''}
            onChange={(e) =>
              onUpdate({
                anfahrtkosten: e.target.value
                  ? parseFloat(e.target.value)
                  : null
              })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label className='text-xs'>erste 5 km (€/km)</Label>
          <Input
            className='h-8 text-sm'
            type='number'
            step='0.01'
            min='0'
            placeholder='0,00'
            value={item.price_first_5km ?? ''}
            onChange={(e) =>
              onUpdate({
                price_first_5km: e.target.value
                  ? parseFloat(e.target.value)
                  : null
              })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label className='text-xs'>ab 5 km (€/km)</Label>
          <Input
            className='h-8 text-sm'
            type='number'
            step='0.01'
            min='0'
            placeholder='0,00'
            value={item.price_per_km_after_5 ?? ''}
            onChange={(e) =>
              onUpdate({
                price_per_km_after_5: e.target.value
                  ? parseFloat(e.target.value)
                  : null
              })
            }
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface Step2PositionenProps {
  items: BuilderLineItem[];
  onUpdate: (index: number, patch: Partial<BuilderLineItem>) => void;
  onDelete: (index: number) => void;
  onReorder: (reordered: BuilderLineItem[]) => void;
  onAdd: () => void;
}

export function Step2Positionen({
  items,
  onUpdate,
  onDelete,
  onReorder,
  onAdd
}: Step2PositionenProps) {
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

  return (
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
                // Cannot delete the last row — an offer must always have at least one Leistung.
                // This is a UX guard only; the DB has no min-row constraint.
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
        <Plus className='mr-1.5 h-4 w-4' />
        Zeile hinzufügen
      </Button>
    </div>
  );
}
