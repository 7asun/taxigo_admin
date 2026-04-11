'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef
} from '@tanstack/react-table';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useAngeboteList } from '../hooks/use-angebote';
import type { AngebotRow, AngebotStatus } from '../types/angebot.types';

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AngebotStatus, string> = {
  draft: 'Entwurf',
  sent: 'Gesendet',
  accepted: 'Angenommen',
  declined: 'Abgelehnt'
};

const STATUS_CLASSES: Record<AngebotStatus, string> = {
  draft:
    'border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  sent: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  accepted:
    'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300',
  declined:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300'
};

function AngebotStatusBadge({ status }: { status: AngebotStatus }) {
  return (
    <Badge variant='outline' className={cn('text-xs', STATUS_CLASSES[status])}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  try {
    return format(new Date(isoDate), 'dd.MM.yyyy', { locale: de });
  } catch {
    return isoDate;
  }
}

function recipientLabel(row: AngebotRow): string {
  const contactDisplayName = row.recipient_last_name
    ? [row.recipient_anrede, row.recipient_first_name, row.recipient_last_name]
        .filter(Boolean)
        .join(' ')
        .trim()
    : (row.recipient_name ?? '').trim();

  return row.recipient_company || contactDisplayName || '—';
}

// ─── Column definitions ───────────────────────────────────────────────────────

const columns: ColumnDef<AngebotRow>[] = [
  {
    accessorKey: 'angebot_number',
    header: 'Angebotsnr.',
    cell: ({ row }) => (
      <span className='font-mono text-sm font-medium'>
        {row.original.angebot_number}
      </span>
    )
  },
  {
    id: 'empfaenger',
    header: 'Empfänger',
    cell: ({ row }) => (
      <span className='max-w-[200px] truncate text-sm'>
        {recipientLabel(row.original)}
      </span>
    )
  },
  {
    accessorKey: 'subject',
    header: 'Betreff',
    size: 280,
    maxSize: 280,
    cell: ({ row }) => {
      const value = row.original.subject || '—';
      return (
        <span
          className='text-muted-foreground line-clamp-2 block max-w-[280px] text-sm'
          title={value}
        >
          {value}
        </span>
      );
    }
  },
  {
    accessorKey: 'offer_date',
    header: 'Datum',
    cell: ({ row }) => (
      <span className='text-sm'>{formatDate(row.original.offer_date)}</span>
    )
  },
  {
    accessorKey: 'valid_until',
    header: 'Gültig bis',
    cell: ({ row }) => (
      <span className='text-sm'>{formatDate(row.original.valid_until)}</span>
    )
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <AngebotStatusBadge status={row.original.status} />
  }
];

// ─── Component ────────────────────────────────────────────────────────────────

export function AngeboteListView() {
  const router = useRouter();
  const { data: angebote, isLoading, isError } = useAngeboteList();

  const table = useReactTable({
    data: angebote ?? [],
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  if (isLoading) {
    return (
      <div className='space-y-3'>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className='h-12 w-full rounded-lg' />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className='text-destructive text-sm'>
        Angebote konnten nicht geladen werden.
      </p>
    );
  }

  if (!angebote?.length) {
    return (
      <div className='border-border rounded-xl border p-12 text-center'>
        <p className='text-muted-foreground text-sm'>
          Noch keine Angebote vorhanden.{' '}
          <Link
            href='/dashboard/angebote/new'
            className='text-primary underline-offset-4 hover:underline'
          >
            Erstes Angebot erstellen →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className='border-border w-full overflow-hidden overflow-x-auto rounded-xl border'>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => (
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
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className='cursor-pointer'
              onClick={() =>
                router.push(`/dashboard/angebote/${row.original.id}`)
              }
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
