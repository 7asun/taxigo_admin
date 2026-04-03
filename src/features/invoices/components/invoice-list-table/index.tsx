'use client';

/**
 * index.tsx  (invoice-list-table)
 *
 * Invoice list table shell — wraps TanStack Table with filter controls.
 *
 * Filter bar includes:
 *   - Status filter (Select)
 *   - Payer filter (Select, populated from props)
 *   - Date range (`DateRangePicker`, `created_at` in business TZ)
 *   - "Neue Rechnung" button → /dashboard/invoices/new
 *
 * The table itself uses the column definitions from ./columns.tsx.
 */

import { useRouter } from 'next/navigation';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnFiltersState,
  getFilteredRowModel
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { Eye, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-time-picker';
import { invoiceDateRangePresets } from '../../lib/invoice-date-range-presets';
import { Skeleton } from '@/components/ui/skeleton';
import { formatLocalDateToYmd, parseYmdToLocalDate } from '@/lib/date-ymd';
import type { DateRange } from 'react-day-picker';

import { useInvoices } from '../../hooks/use-invoices';
import { createInvoiceColumns } from './columns';
import type { InvoiceListFilter } from '@/query/keys/invoices';
import type { InvoiceWithPayer } from '../../types/invoice.types';

interface Payer {
  id: string;
  name: string;
}

interface InvoiceListTableProps {
  /** Available payers for the filter dropdown. */
  payers: Payer[];
}

/**
 * Self-contained invoice list table with filter bar and data fetching.
 * Navigates to detail page on row/action click.
 */
export function InvoiceListTable({ payers }: InvoiceListTableProps) {
  const router = useRouter();

  // ── Filter state ─────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<InvoiceListFilter>({});
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // ── Data ─────────────────────────────────────────────────────────────────
  const { invoices, isLoading } = useInvoices(filter);
  const previewInvoice = invoices?.[0];

  // ── Table ─────────────────────────────────────────────────────────────────
  const columns = createInvoiceColumns({
    onView: (id) => router.push(`/dashboard/invoices/${id}`),
    onDownload: (id) => router.push(`/dashboard/invoices/${id}?download=true`)
  });

  const table = useReactTable<InvoiceWithPayer>({
    data: invoices ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters
  });

  const invoiceListDateRange = useMemo((): DateRange | undefined => {
    if (!filter.from && !filter.to) return undefined;
    const fromD = filter.from ? parseYmdToLocalDate(filter.from) : undefined;
    const toD = filter.to ? parseYmdToLocalDate(filter.to) : undefined;
    const start = fromD ?? toD;
    const end = toD ?? fromD;
    if (!start || !end) return undefined;
    return {
      from: new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
        0,
        0,
        0,
        0
      ),
      to: new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate(),
        23,
        59,
        59,
        999
      )
    };
  }, [filter.from, filter.to]);

  const handleInvoiceListDateRangeChange = (range: DateRange | undefined) => {
    if (!range?.from) {
      setFilter((f) => ({ ...f, from: undefined, to: undefined }));
      return;
    }
    const fromYmd = formatLocalDateToYmd(range.from);
    const toYmd = formatLocalDateToYmd(range.to ?? range.from);
    setFilter((f) => ({ ...f, from: fromYmd, to: toYmd }));
  };

  return (
    <div className='space-y-4'>
      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className='flex flex-wrap items-center gap-3'>
        {/* Status filter */}
        <Select
          onValueChange={(val) =>
            setFilter((f) => ({
              ...f,
              status: val === 'all' ? undefined : val
            }))
          }
        >
          <SelectTrigger className='w-40'>
            <SelectValue placeholder='Alle Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Alle Status</SelectItem>
            <SelectItem value='draft'>Entwurf</SelectItem>
            <SelectItem value='sent'>Versendet</SelectItem>
            <SelectItem value='paid'>Bezahlt</SelectItem>
            <SelectItem value='cancelled'>Storniert</SelectItem>
          </SelectContent>
        </Select>

        {/* Payer filter */}
        <Select
          onValueChange={(val) =>
            setFilter((f) => ({
              ...f,
              payer_id: val === 'all' ? undefined : val
            }))
          }
        >
          <SelectTrigger className='w-48'>
            <SelectValue placeholder='Alle Kostenträger' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Alle Kostenträger</SelectItem>
            {payers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangePicker
          value={invoiceListDateRange}
          onChange={handleInvoiceListDateRangeChange}
          presets={invoiceDateRangePresets}
          triggerClassName='h-10 min-h-10 w-full min-w-[11rem] sm:w-auto sm:max-w-[16rem] md:h-9 md:min-h-0'
          placeholder='Erstellt im Zeitraum…'
        />

        <div className='ml-auto flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            className='gap-2'
            disabled={!previewInvoice}
            onClick={() => {
              if (!previewInvoice) return;
              window.open(
                `/dashboard/invoices/${previewInvoice.id}/preview`,
                '_blank',
                'noopener,noreferrer'
              );
            }}
          >
            <Eye className='h-4 w-4' />
            PDF-Vorschau
          </Button>
          <Button
            onClick={() => router.push('/dashboard/invoices/new')}
            className='gap-2'
          >
            <Plus className='h-4 w-4' />
            Neue Rechnung
          </Button>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // Loading skeleton rows
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className='h-4 w-full' />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='text-muted-foreground h-24 text-center text-sm'
                >
                  Keine Rechnungen gefunden.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className='cursor-pointer'
                  onClick={() =>
                    router.push(`/dashboard/invoices/${row.original.id}`)
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
