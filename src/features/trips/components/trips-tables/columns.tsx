'use client';

import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { ColumnDef } from '@tanstack/react-table';
import { CellAction } from './cell-action';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Accessibility, RepeatIcon } from 'lucide-react';
import { DriverSelectCell } from './driver-select-cell';
import { cn } from '@/lib/utils';
import {
  tripStatusBadge,
  tripStatusLabels,
  type TripStatus
} from '@/lib/trip-status';
import { UrgencyIndicator } from '../urgency-indicator';
import { parseTripAddressForDataTable } from '@/features/trips/lib/format-trip-address-display-line';
import {
  billingFamilyFromEmbed,
  formatBillingDisplayLabel
} from '@/features/trips/lib/format-billing-display-label';

const statusFilterOptions: { label: string; value: string }[] = [
  { label: 'Offen', value: 'pending' },
  { label: 'Zugewiesen', value: 'assigned' },
  { label: 'In Fahrt', value: 'in_progress' },
  { label: 'Abgeschlossen', value: 'completed' },
  { label: 'Storniert', value: 'cancelled' }
];

export const columns: ColumnDef<any>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label='Alle auf dieser Seite auswählen'
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label='Zeile auswählen'
      />
    ),
    enableSorting: false,
    enableHiding: false
  },
  {
    id: 'scheduled_at',
    accessorKey: 'scheduled_at',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Datum' />
    ),
    cell: ({ cell }) => {
      const raw = cell.getValue<string>();
      if (raw == null || raw === '')
        return <span className='text-muted-foreground'>—</span>;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
        return <span className='text-muted-foreground'>—</span>;
      }
      return (
        <span className='font-medium'>
          {format(date, 'dd.MM.yyyy', { locale: de })}
        </span>
      );
    },
    meta: {
      label: 'Datum',
      variant: 'date'
    },
    enableColumnFilter: false
  },
  {
    id: 'time',
    accessorKey: 'scheduled_at',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Zeit' />
    ),
    cell: ({ cell, row }) => {
      const raw = cell.getValue<string>();
      if (raw == null || raw === '')
        return <span className='text-muted-foreground'>—</span>;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
        return <span className='text-muted-foreground'>—</span>;
      }
      const isRecurring = !!row.original.rule_id;

      return (
        <div className='flex items-center'>
          <div className='flex w-4 shrink-0 items-center justify-center'>
            <UrgencyIndicator
              scheduledAt={raw}
              status={row.original.status}
              variant='dot'
            />
          </div>
          <span className='font-medium'>{format(date, 'HH:mm')}</span>
          {isRecurring && (
            <RepeatIcon className='ml-2 h-3 w-3 text-blue-500 dark:text-blue-400' />
          )}
        </div>
      );
    },
    meta: {
      label: 'Zeit',
      variant: 'text'
    },
    enableColumnFilter: false
  },
  {
    id: 'name',
    accessorKey: 'client_name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Fahrgast' />
    ),
    cell: ({ row }) => (
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{row.original.client_name || '-'}</span>
        {row.original.is_wheelchair && (
          <Badge
            variant='outline'
            title='Rollstuhl'
            aria-label='Rollstuhl'
            className={cn(
              'shrink-0 border-rose-200 bg-rose-50 px-1 py-0 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400',
              'inline-flex size-5 items-center justify-center p-0 [&>svg]:size-3'
            )}
          >
            <Accessibility aria-hidden />
          </Badge>
        )}
      </div>
    ),
    meta: {
      label: 'Fahrgast',
      variant: 'text'
    },
    enableColumnFilter: false
  },
  {
    accessorKey: 'pickup_address',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Abholung' />
    ),
    cell: ({ row }) => {
      const { street, cityLine } = parseTripAddressForDataTable(
        row.original,
        'pickup'
      );
      const station = row.original.pickup_station as string | undefined;
      return (
        <div
          className='flex max-w-[200px] flex-col'
          title={row.original.pickup_address ?? ''}
        >
          <span className='flex min-w-0 items-center gap-1.5'>
            <span className='truncate text-sm font-medium'>{street}</span>
            {station && (
              <span className='bg-muted text-foreground shrink-0 rounded px-1.5 py-0 text-[10px] font-medium'>
                {station}
              </span>
            )}
          </span>
          {cityLine && (
            <span className='text-muted-foreground truncate text-xs'>
              {cityLine}
            </span>
          )}
        </div>
      );
    },
    meta: { label: 'Abholung' }
  },
  {
    accessorKey: 'dropoff_address',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Ziel' />
    ),
    cell: ({ row }) => {
      const { street, cityLine } = parseTripAddressForDataTable(
        row.original,
        'dropoff'
      );
      const station = row.original.dropoff_station as string | undefined;
      return (
        <div
          className='flex max-w-[200px] flex-col'
          title={row.original.dropoff_address ?? ''}
        >
          <span className='flex min-w-0 items-center gap-1.5'>
            <span className='truncate text-sm font-medium'>{street}</span>
            {station && (
              <span className='bg-muted text-foreground shrink-0 rounded px-1.5 py-0 text-[10px] font-medium'>
                {station}
              </span>
            )}
          </span>
          {cityLine && (
            <span className='text-muted-foreground truncate text-xs'>
              {cityLine}
            </span>
          )}
        </div>
      );
    },
    meta: { label: 'Ziel' }
  },
  {
    id: 'driver_id',
    accessorKey: 'driver.name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Fahrer' />
    ),
    cell: ({ row }) => <DriverSelectCell trip={row.original} />,
    enableColumnFilter: false,
    meta: { label: 'Fahrer' }
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Status' />
    ),
    cell: ({ cell }) => {
      const status = cell.getValue<string>() as TripStatus;
      return (
        <Badge className={tripStatusBadge({ status })}>
          {tripStatusLabels[status] ?? status}
        </Badge>
      );
    },
    meta: {
      label: 'Status',
      variant: 'select',
      options: statusFilterOptions
    },
    enableColumnFilter: false
  },
  {
    id: 'payer_name',
    accessorKey: 'payer.name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Kostenträger' />
    ),
    cell: ({ row }) => <div>{row.original.payer?.name || '-'}</div>,
    meta: { label: 'Kostenträger' }
  },
  // Abrechnung: use formatBillingDisplayLabel (hides Unterart „Standard“); do not concatenate names here.
  {
    id: 'billing_type',
    accessorKey: 'billing_variant.name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Abrechnung' />
    ),
    cell: ({ row }) => {
      const bv = row.original.billing_variant as
        | {
            name?: string | null;
            billing_types?: unknown;
          }
        | null
        | undefined;
      const label = formatBillingDisplayLabel(bv).trim() || '-';
      if (label === '-') return '-';
      const fam = billingFamilyFromEmbed(bv?.billing_types);
      const color = fam?.color ?? '#64748b';
      return (
        <Badge
          variant='outline'
          className='w-fit max-w-full truncate font-normal'
          style={{
            borderColor: color,
            color,
            backgroundColor: `color-mix(in srgb, ${color}, var(--background) 90%)`
          }}
        >
          {label}
        </Badge>
      );
    }
  },
  {
    id: 'actions',
    cell: ({ row }) => <CellAction data={row.original} />
  }
];
