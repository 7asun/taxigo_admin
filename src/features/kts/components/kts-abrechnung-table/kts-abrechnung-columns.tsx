'use client';

import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import type { KtsAbrechnungGroup } from '@/features/kts/types/kts-abrechnung-group';
import { KTS_STATUS_LABELS, ktsStatusBadge } from '@/lib/kts-status';
import { cn } from '@/lib/utils';

function formatKtsInvoiceAmount(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

export type AbrechnungExpandState = string | null;

export interface KtsAbrechnungColumnsContext {
  expandedGroup: AbrechnungExpandState;
  setExpandedGroup: (val: AbrechnungExpandState) => void;
}

export function createKtsAbrechnungColumns(
  ctx: KtsAbrechnungColumnsContext
): ColumnDef<KtsAbrechnungGroup>[] {
  return [
    {
      id: 'expand',
      header: () => null,
      cell: ({ row }) => {
        const belegnummer = row.original.kts_belegnummer;
        const isOpen = ctx.expandedGroup === belegnummer;
        return (
          <div className='flex w-full items-center justify-center'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              aria-label={isOpen ? 'Zeile einklappen' : 'Zeile ausklappen'}
              onClick={() => ctx.setExpandedGroup(isOpen ? null : belegnummer)}
            >
              {isOpen ? (
                <ChevronDown className='h-4 w-4' />
              ) : (
                <ChevronRight className='h-4 w-4' />
              )}
            </Button>
          </div>
        );
      },
      size: 40,
      maxSize: 40,
      enableResizing: false,
      enableSorting: false
    },
    {
      id: 'kts_belegnummer',
      accessorKey: 'kts_belegnummer',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Beleg-Nr.'
          className='text-center'
        />
      ),
      cell: ({ row }) => (
        <div className='flex w-full items-center justify-center'>
          <div className='flex min-w-0 flex-col items-center gap-1 text-center'>
            <span className='font-mono text-sm tabular-nums'>
              {row.original.kts_belegnummer}
            </span>
            {row.original.has_multiple_imports ? (
              <span className='text-xs text-orange-600 dark:text-orange-400'>
                {row.original.import_count} Importe — prüfen
              </span>
            ) : null}
          </div>
        </div>
      ),
      size: 140,
      enableSorting: false
    },
    {
      id: 'trip_count',
      accessorKey: 'trip_count',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Fahrten'
          className='text-center'
        />
      ),
      cell: ({ row }) => (
        <div className='flex w-full items-center justify-center'>
          <span className='block text-center text-sm tabular-nums'>
            {row.original.trip_count}
          </span>
        </div>
      ),
      size: 80,
      enableSorting: false
    },
    {
      id: 'gesamtbetrag',
      accessorKey: 'gesamtbetrag',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Betrag'
          className='text-center'
        />
      ),
      cell: ({ row }) => (
        <div className='flex w-full items-center justify-center'>
          <span className='block text-center text-sm tabular-nums'>
            {formatKtsInvoiceAmount(row.original.gesamtbetrag)}
          </span>
        </div>
      ),
      size: 100,
      enableSorting: false
    },
    {
      id: 'eigenanteil_gesamt',
      accessorKey: 'eigenanteil_gesamt',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Eigenanteil'
          className='text-center'
        />
      ),
      cell: ({ row }) => (
        <div className='flex w-full items-center justify-center'>
          <span className='block text-center text-sm tabular-nums'>
            {formatKtsInvoiceAmount(row.original.eigenanteil_gesamt)}
          </span>
        </div>
      ),
      size: 110,
      enableSorting: false
    },
    {
      id: 'imported_at',
      accessorKey: 'imported_at',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Importiert'
          className='text-center'
        />
      ),
      cell: ({ row }) => {
        const value = row.original.imported_at;
        if (!value) return null;
        return (
          <div className='flex w-full items-center justify-center'>
            <span className='text-center text-sm tabular-nums'>
              {format(new Date(value), 'dd.MM.yyyy', { locale: de })}
            </span>
          </div>
        );
      },
      size: 110,
      enableSorting: false
    },
    {
      id: 'group_status',
      accessorKey: 'group_status',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Status'
          className='text-center'
        />
      ),
      cell: ({ row }) => (
        <div className='flex w-full items-center justify-center'>
          <Badge
            variant='outline'
            className={cn(
              ktsStatusBadge({ status: row.original.group_status })
            )}
          >
            {KTS_STATUS_LABELS[row.original.group_status]}
          </Badge>
        </div>
      ),
      size: 120,
      enableSorting: false
    }
  ];
}
