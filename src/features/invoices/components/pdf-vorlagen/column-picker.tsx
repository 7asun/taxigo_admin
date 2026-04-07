'use client';

/**
 * column-picker.tsx
 *
 * Searchable popover for adding a column to a Vorlage list. The caller passes
 * `available` defs (already filtered); this component never hardcodes catalog entries.
 */

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { PdfColumnDef } from '@/features/invoices/lib/pdf-column-catalog';

interface ColumnPickerProps {
  available: PdfColumnDef[];
  onAdd: (key: string) => void;
  disabled?: boolean;
}

export function ColumnPicker({
  available,
  onAdd,
  disabled = false
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return available;
    return available.filter(
      (c) =>
        c.uiLabel.toLowerCase().includes(t) ||
        c.description.toLowerCase().includes(t)
    );
  }, [available, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='gap-1'
          disabled={disabled || available.length === 0}
        >
          <Plus className='h-4 w-4' />
          Spalte hinzufügen
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-80 p-0' align='start'>
        <div className='p-2'>
          <Input
            placeholder='Suchen…'
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className='h-8'
          />
        </div>
        <ScrollArea className='h-[220px]'>
          <ul className='p-1'>
            {filtered.map((col) => (
              <li key={col.key}>
                <button
                  type='button'
                  className='hover:bg-muted flex w-full flex-col items-start rounded-md px-2 py-2 text-left text-sm'
                  onClick={() => {
                    onAdd(col.key);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <span className='font-medium'>{col.uiLabel}</span>
                  <span className='text-muted-foreground text-xs leading-snug'>
                    {col.description}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className='text-muted-foreground px-2 py-4 text-center text-sm'>
                Keine Spalten verfügbar
              </li>
            ) : null}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
