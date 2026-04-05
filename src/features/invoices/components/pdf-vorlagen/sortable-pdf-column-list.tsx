'use client';

/**
 * Vertical drag-and-drop list of column keys for Vorlage editing.
 * Uses @dnd-kit/sortable; order is an array of PdfColumnKey strings.
 */

import { GripVertical, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
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

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function SortableChip({
  id,
  label,
  onRemove,
  disabled
}: {
  id: string;
  label: string;
  onRemove: () => void;
  disabled?: boolean;
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
        'bg-card border-border flex items-center gap-2 rounded-md border px-2 py-1.5',
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
      <span className='min-w-0 flex-1 truncate text-sm'>{label}</span>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-7 w-7 shrink-0'
        disabled={disabled}
        onClick={onRemove}
        aria-label='Spalte entfernen'
      >
        <X className='h-4 w-4' />
      </Button>
    </div>
  );
}

interface SortablePdfColumnListProps {
  columnKeys: string[];
  getLabel: (key: string) => string;
  onReorder: (next: string[]) => void;
  onRemove: (key: string) => void;
  disabled?: boolean;
}

export function SortablePdfColumnList({
  columnKeys,
  getLabel,
  onReorder,
  onRemove,
  disabled = false
}: SortablePdfColumnListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = columnKeys.indexOf(String(active.id));
    const newIndex = columnKeys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(columnKeys, oldIndex, newIndex));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={columnKeys}
        strategy={verticalListSortingStrategy}
      >
        <div className='flex flex-col gap-2'>
          {columnKeys.map((k) => (
            <SortableChip
              key={k}
              id={k}
              label={getLabel(k)}
              disabled={disabled}
              onRemove={() => onRemove(k)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
