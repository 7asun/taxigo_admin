'use client';

import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import {
  KtsActionsCell,
  type KtsExpandState
} from '@/features/kts/components/kts-table/kts-actions-cell';
import { KtsPatientIdCell } from '@/features/kts/components/kts-table/kts-patient-id-cell';
import type { KtsTripRow } from '@/features/kts/types/kts-trip-row';
import {
  getOpenKtsCorrection,
  ktsCorrectionAgeDays
} from '@/features/kts/types/kts-trip-row';
import { parseTripAddressForDataTable } from '@/features/trips/lib/format-trip-address-display-line';
import { KTS_STATUS_LABELS, ktsStatusBadge } from '@/lib/kts-status';
import { KTS_STATUS_KORREKT, type KtsStatus } from '@/features/kts/kts.service';

function formatKtsInvoiceAmount(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

export interface KtsColumnsContext {
  expandedRow: KtsExpandState;
  setExpandedRow: (val: KtsExpandState) => void;
}

export function createKtsColumns(
  ctx: KtsColumnsContext
): ColumnDef<KtsTripRow>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => {
        const korrektRows = table
          .getRowModel()
          .rows.filter((r) => r.original.kts_status === KTS_STATUS_KORREKT);
        const allKorrektSelected =
          korrektRows.length > 0 && korrektRows.every((r) => r.getIsSelected());
        const someKorrektSelected = korrektRows.some((r) => r.getIsSelected());

        return (
          <Checkbox
            checked={
              allKorrektSelected ||
              (someKorrektSelected && !allKorrektSelected && 'indeterminate')
            }
            disabled={korrektRows.length === 0}
            onCheckedChange={(value) => {
              const select = !!value;
              for (const row of korrektRows) {
                row.toggleSelected(select);
              }
            }}
            aria-label='Alle auswählen'
          />
        );
      },
      cell: ({ row }) => {
        const isKorrekt = row.original.kts_status === KTS_STATUS_KORREKT;
        return (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!isKorrekt}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label='Zeile auswählen'
          />
        );
      },
      enableSorting: false,
      enableHiding: false
    },
    {
      id: 'scheduled_at',
      accessorKey: 'scheduled_at',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Termin' />
      ),
      cell: ({ row }) => {
        const raw = row.original.scheduled_at;
        if (!raw) {
          return <span className='text-muted-foreground'>—</span>;
        }
        const date = new Date(raw);
        if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
          return <span className='text-muted-foreground'>—</span>;
        }
        return (
          <div className='flex flex-col text-sm'>
            <span className='font-medium'>
              {format(date, 'dd.MM.yyyy', { locale: de })}
            </span>
            <span className='text-muted-foreground text-xs'>
              {format(date, 'HH:mm', { locale: de })}
            </span>
          </div>
        );
      },
      meta: { label: 'Termin', variant: 'date' },
      enableColumnFilter: false
    },
    {
      id: 'client_name',
      accessorKey: 'client_name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Fahrgast' />
      ),
      cell: ({ row }) => {
        const name = row.original.client_name?.trim();
        const fallback = row.original.kts_patient_id?.trim();
        if (name) {
          return <span className='font-medium'>{name}</span>;
        }
        if (fallback) {
          return (
            <span className='text-muted-foreground font-medium'>
              {fallback}
            </span>
          );
        }
        return <span className='text-muted-foreground'>—</span>;
      },
      meta: { label: 'Fahrgast', variant: 'text' },
      enableColumnFilter: false
    },
    {
      id: 'kts_patient_id',
      accessorKey: 'kts_patient_id',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='KTS-Patient-ID' />
      ),
      cell: ({ row }) => <KtsPatientIdCell trip={row.original} />,
      meta: { label: 'KTS-Patient-ID', variant: 'text' },
      enableColumnFilter: false
    },
    {
      id: 'route',
      accessorFn: (row) =>
        `${row.pickup_address ?? ''} → ${row.dropoff_address ?? ''}`,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Route' />
      ),
      cell: ({ row }) => {
        const pickup = parseTripAddressForDataTable(row.original, 'pickup');
        const dropoff = parseTripAddressForDataTable(row.original, 'dropoff');
        return (
          <div className='max-w-[220px] text-sm'>
            <span className='block truncate font-medium'>{pickup.street}</span>
            <span className='text-muted-foreground block truncate text-xs'>
              → {dropoff.street}
            </span>
          </div>
        );
      },
      meta: { label: 'Route', variant: 'text' },
      enableColumnFilter: false
    },
    {
      id: 'kts_status',
      accessorKey: 'kts_status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Status' />
      ),
      cell: ({ row }) => {
        const status = row.original.kts_status as KtsStatus | null;
        if (!status) {
          return <span className='text-muted-foreground'>—</span>;
        }
        const openRound = getOpenKtsCorrection(row.original);
        const agingDays =
          status === 'in_korrektur' && openRound
            ? ktsCorrectionAgeDays(openRound.sent_at)
            : null;

        return (
          <div className='flex flex-col gap-0.5'>
            <Badge className={ktsStatusBadge({ status })}>
              {KTS_STATUS_LABELS[status]}
            </Badge>
            {agingDays != null ? (
              <span className='text-muted-foreground text-[11px]'>
                {agingDays} Tage
              </span>
            ) : null}
          </div>
        );
      },
      meta: { label: 'Status', variant: 'text' },
      enableColumnFilter: false
    },
    {
      id: 'kts_belegnummer',
      accessorKey: 'kts_belegnummer',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Beleg-Nr.' />
      ),
      cell: ({ row }) => {
        const value = row.original.kts_belegnummer?.trim();
        if (!value) return null;
        return <span className='font-mono text-sm tabular-nums'>{value}</span>;
      },
      size: 100,
      maxSize: 100,
      meta: { label: 'Beleg-Nr.', variant: 'text' },
      enableColumnFilter: false,
      enableSorting: false
    },
    {
      id: 'kts_invoice_amount',
      accessorKey: 'kts_invoice_amount',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Betrag' />
      ),
      cell: ({ row }) => {
        const amount = row.original.kts_invoice_amount;
        if (amount == null) return null;
        return (
          <span className='text-sm tabular-nums'>
            {formatKtsInvoiceAmount(amount)}
          </span>
        );
      },
      size: 90,
      maxSize: 90,
      meta: { label: 'Betrag', variant: 'text' },
      enableColumnFilter: false,
      enableSorting: false
    },
    {
      id: 'actions',
      header: () => <span className='sr-only'>Aktionen</span>,
      cell: ({ row }) => (
        <KtsActionsCell
          trip={row.original}
          expandedRow={ctx.expandedRow}
          setExpandedRow={ctx.setExpandedRow}
        />
      ),
      enableSorting: false,
      enableHiding: false
    }
  ];
}
