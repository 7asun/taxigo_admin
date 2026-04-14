'use client';

import type { ReactNode } from 'react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AngebotColumnDef } from '@/features/angebote/types/angebot.types';
import { COLUMN_PRESET_UI } from '@/features/angebote/lib/angebot-column-presets';

function SortableChip({
  id,
  children,
  onRemove,
  disabledRemove
}: {
  id: string;
  children: ReactNode;
  onRemove: () => void;
  disabledRemove?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

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
        {...attributes}
        {...listeners}
        aria-label='Reihenfolge ändern'
      >
        <GripVertical className='h-4 w-4' />
      </button>
      <div className='min-w-0 flex-1'>{children}</div>
      {disabledRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Disabled buttons don't trigger tooltips reliably — wrap in a span. */}
            <span className='inline-flex'>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='h-7 w-7 shrink-0'
                disabled
                aria-label='Spalte entfernen'
              >
                <X className='h-4 w-4' />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Mindestens eine Spalte erforderlich.</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='h-7 w-7 shrink-0'
          onClick={onRemove}
          aria-label='Spalte entfernen'
        >
          <X className='h-4 w-4' />
        </Button>
      )}
    </div>
  );
}

interface SortableAngebotColumnListProps {
  columns: AngebotColumnDef[];
  onReorder: (next: AngebotColumnDef[]) => void;
  onRemove: (id: string) => void;
  renderItem?: (col: AngebotColumnDef) => ReactNode;
}

export function SortableAngebotColumnList({
  columns,
  onReorder,
  onRemove,
  renderItem
}: SortableAngebotColumnListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = columns.map((c) => c.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(columns, oldIndex, newIndex));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={columns.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className='space-y-2'>
          {columns.map((col) => (
            <SortableChip
              key={col.id}
              id={col.id}
              // Cannot delete last column — every template needs at least one column.
              disabledRemove={columns.length <= 1}
              onRemove={() => {
                if (columns.length <= 1) return;
                onRemove(col.id);
              }}
            >
              {renderItem ? (
                renderItem(col)
              ) : (
                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate text-sm'>
                    {COLUMN_PRESET_UI[col.preset].emoji} {col.header}
                  </span>
                  {col.preset === 'percent' ? (
                    <span className='bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]'>
                      Legacy
                    </span>
                  ) : null}
                </div>
              )}
            </SortableChip>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
