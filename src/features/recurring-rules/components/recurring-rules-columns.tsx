'use client';

/**
 * TanStack column defs for the Regelfahrten overview — kept separate from the
 * overview shell so the table stays declarative and easy to scan. The Fahrgast
 * column uses Next.js `Link` (not `<a>`) for client-side navigation to Stammdaten.
 */

import Link from 'next/link';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { Badge } from '@/components/ui/badge';
import type { RecurringRuleWithClientEmbed } from '@/features/trips/api/recurring-rules.server';
import { formatBillingDisplayLabel } from '@/features/trips/lib/format-billing-display-label';
import { recurringReturnModeFromRow } from '@/features/trips/lib/recurring-return-mode';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { parseTripAddressForDisplay } from '@/features/trips/lib/format-trip-address-display-line';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

/** Max visible chars for Von/Nach; full text in `title`. */
export const RECURRING_RULE_ADDRESS_PREVIEW_MAX_LEN = 40;

const DAY_MAP: Record<string, string> = {
  MO: 'Mo',
  TU: 'Di',
  WE: 'Mi',
  TH: 'Do',
  FR: 'Fr',
  SA: 'Sa',
  SU: 'So'
};

export function formatRecurringRuleGuestLabel(
  row: RecurringRuleWithClientEmbed
): string {
  const c = row.clients;
  const last = c?.last_name?.trim() ?? '';
  const first = c?.first_name?.trim() ?? '';
  if (!last && !first) return '—';
  return `${last}, ${first}`;
}

export function formatRecurringRuleByDayAbbrev(rruleString: string): string {
  const match = rruleString.match(/BYDAY=([^;]+)/);
  if (!match) return '';
  const days = match[1].split(',');
  return days.map((d) => DAY_MAP[d] ?? d).join(', ');
}

function truncateWithTitle(
  text: string,
  maxLen: number
): {
  display: string;
  title: string;
} {
  const t = text ?? '';
  if (t.length <= maxLen) return { display: t, title: t };
  return { display: `${t.slice(0, maxLen)}…`, title: t };
}

export const recurringRulesColumns: ColumnDef<RecurringRuleWithClientEmbed>[] =
  [
    {
      id: 'client_name',
      accessorFn: (row) => formatRecurringRuleGuestLabel(row),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Fahrgast' />
      ),
      cell: ({ row }) => {
        const id = row.original.clients?.id ?? row.original.client_id;
        const label = formatRecurringRuleGuestLabel(row.original);
        return (
          <Link
            href={`/dashboard/clients?clientId=${id}`}
            className='text-primary font-medium underline-offset-4 hover:underline'
          >
            {label}
          </Link>
        );
      },
      meta: {
        label: 'Fahrgast',
        variant: 'text' as const,
        placeholder: 'Fahrgast suchen…'
      },
      enableColumnFilter: true
    },
    {
      id: 'days',
      accessorFn: (row) => formatRecurringRuleByDayAbbrev(row.rrule_string),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Wochentage' />
      ),
      cell: ({ row }) => (
        <span className='text-sm'>
          {formatRecurringRuleByDayAbbrev(row.original.rrule_string) || '—'}
        </span>
      )
    },
    {
      id: 'pickup_time',
      accessorKey: 'pickup_time',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Abholzeit' />
      ),
      cell: ({ row }) => (
        <span className='font-mono text-sm'>
          {/* Daily-agreement rules have `pickup_time = null` (no fixed clock time). */}
          {(row.original.pickup_time ?? '').substring(0, 5) || '—'}
        </span>
      )
    },
    {
      id: 'pickup_address',
      accessorKey: 'pickup_address',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Von' />
      ),
      cell: ({ row }) => {
        const { street, cityLine } = parseTripAddressForDisplay(
          row.original.pickup_address,
          { alwaysShowZipCity: true }
        );
        return (
          <div
            className='flex max-w-[200px] flex-col'
            title={row.original.pickup_address ?? ''}
          >
            <span className='truncate text-sm font-medium'>
              {street || '—'}
            </span>
            {cityLine && (
              <span className='text-muted-foreground truncate text-xs'>
                {cityLine}
              </span>
            )}
          </div>
        );
      }
    },
    {
      id: 'dropoff_address',
      accessorKey: 'dropoff_address',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Nach' />
      ),
      cell: ({ row }) => {
        const { street, cityLine } = parseTripAddressForDisplay(
          row.original.dropoff_address,
          { alwaysShowZipCity: true }
        );
        return (
          <div
            className='flex max-w-[200px] flex-col'
            title={row.original.dropoff_address ?? ''}
          >
            <span className='truncate text-sm font-medium'>
              {street || '—'}
            </span>
            {cityLine && (
              <span className='text-muted-foreground truncate text-xs'>
                {cityLine}
              </span>
            )}
          </div>
        );
      }
    },
    {
      id: 'return_mode',
      accessorFn: (row) => {
        const rm = recurringReturnModeFromRow(row);
        if (rm === 'none') return '';
        if (rm === 'time_tbd') return 'Zeitabsprache';
        const t = row.return_time?.substring(0, 5);
        return t ?? '';
      },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Rückfahrt' />
      ),
      cell: ({ row }) => {
        const rm = recurringReturnModeFromRow(row.original);
        if (rm === 'none') {
          return <span className='text-muted-foreground'>–</span>;
        }
        if (rm === 'time_tbd') {
          return <span className='text-sm'>Zeitabsprache</span>;
        }
        const t = row.original.return_time?.substring(0, 5);
        return (
          <span className='font-mono text-sm'>
            {t && t.length > 0 ? t : '–'}
          </span>
        );
      }
    },
    {
      id: 'billing',
      accessorFn: (row) => {
        const label = formatBillingDisplayLabel(row.billing_variant).trim();
        if (label) return label;
        return row.payer?.name?.trim() ?? '';
      },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Abrechnung' />
      ),
      cell: ({ row }) => {
        const label = formatBillingDisplayLabel(
          row.original.billing_variant
        ).trim();
        const display = label || row.original.payer?.name?.trim() || '';
        return (
          <span className='text-sm'>{display.length > 0 ? display : '–'}</span>
        );
      }
    },
    {
      id: 'is_active',
      accessorKey: 'is_active',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Status' />
      ),
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge className='border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'>
            Aktiv
          </Badge>
        ) : (
          <Badge variant='secondary' className='text-muted-foreground'>
            Inaktiv
          </Badge>
        )
    },
    {
      id: 'start_date',
      accessorKey: 'start_date',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Gültig ab' />
      ),
      cell: ({ row }) => {
        const d = new Date(row.original.start_date);
        if (Number.isNaN(d.getTime())) {
          return <span className='text-muted-foreground'>—</span>;
        }
        return (
          <span className='text-sm'>
            {format(d, 'dd.MM.yyyy', { locale: de })}
          </span>
        );
      }
    },
    {
      id: 'end_date',
      accessorKey: 'end_date',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Gültig bis' />
      ),
      cell: ({ row }) => {
        const end = row.original.end_date;
        if (!end) {
          return <span className='text-muted-foreground'>—</span>;
        }
        const d = new Date(end);
        if (Number.isNaN(d.getTime())) {
          return <span className='text-muted-foreground'>—</span>;
        }
        return (
          <span className='text-sm'>
            {format(d, 'dd.MM.yyyy', { locale: de })}
          </span>
        );
      }
    },
    {
      id: 'actions',
      cell: ({ row, table }) => {
        const rule = row.original;
        const meta = table.options.meta as any;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' className='h-8 w-8 p-0'>
                <span className='sr-only'>Menü öffnen</span>
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuLabel>Aktionen</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  window.location.href = `/dashboard/clients?clientId=${
                    rule.clients?.id || rule.client_id
                  }&ruleId=${rule.id}`;
                }}
              >
                Bearbeiten
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className='text-destructive focus:text-destructive'
                onClick={() => meta?.onDelete?.(rule.id)}
              >
                <Trash2 className='mr-2 h-4 w-4' />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      }
    }
  ];
