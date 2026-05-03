/**
 * Letters list — React Query drives data so this page stays a thin shell upstream.
 * Actions use client-side navigation + pdf() download to match other document flows.
 */

'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef
} from '@tanstack/react-table';
import { pdf } from '@react-pdf/renderer';
import { FileDown, Trash2 } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';

import { companyProfileForLetterPdf } from '../lib/company-profile-for-letter-pdf';
import { useLetters, useDeleteLetter } from '../hooks/use-letters';
import type { Letter, LetterStatus } from '../types';
import { LetterPdfDocument } from './letter-pdf/letter-pdf-document';

const STATUS_LABELS: Record<LetterStatus, string> = {
  draft: 'Entwurf',
  sent: 'Versendet'
};

const STATUS_CLASSES: Record<LetterStatus, string> = {
  draft:
    'border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  sent: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
};

function recipientLabel(row: Letter): string {
  const person = [row.recipientFirstName, row.recipientLastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return row.recipientCompany?.trim() || person || '—';
}

function formatLetterDate(ymd: string): string {
  try {
    return format(new Date(`${ymd}T12:00:00`), 'dd.MM.yyyy', { locale: de });
  } catch {
    return ymd;
  }
}

interface LetterListProps {
  companyProfile: InvoiceDetail['company_profile'] | null;
}

export function LetterList({ companyProfile }: LetterListProps) {
  const { data: letters, isLoading, isError, error } = useLetters();
  const deleteMutation = useDeleteLetter();

  const columns: ColumnDef<Letter>[] = [
    {
      id: 'letter_number',
      header: 'Brief-Nr.',
      cell: ({ row }) => (
        <span className='font-mono text-sm font-medium'>
          {row.original.letterNumber?.trim() || '—'}
        </span>
      )
    },
    {
      id: 'recipient',
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
      cell: ({ row }) => (
        <span className='text-muted-foreground line-clamp-2 block max-w-[280px] text-sm'>
          {row.original.subject?.trim() || '—'}
        </span>
      )
    },
    {
      accessorKey: 'letterDate',
      header: 'Datum',
      cell: ({ row }) => (
        <span className='text-sm'>
          {formatLetterDate(row.original.letterDate)}
        </span>
      )
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge
          variant='outline'
          className={cn('text-xs', STATUS_CLASSES[row.original.status])}
        >
          {STATUS_LABELS[row.original.status]}
        </Badge>
      )
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const letter = row.original;
        return (
          <div className='flex justify-end gap-1'>
            <Button variant='ghost' size='sm' asChild>
              <Link href={`/dashboard/letters/${letter.id}`}>Bearbeiten</Link>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8'
              title='PDF herunterladen'
              disabled={!companyProfile}
              onClick={async () => {
                if (!companyProfile) return;
                // Match builder preview/download logo resolution — docs/plans/letters-pdf-preview-vs-download-audit.md
                const resolved =
                  await companyProfileForLetterPdf(companyProfile);
                if (!resolved) return;
                const blob = await pdf(
                  <LetterPdfDocument
                    letter={letter}
                    companyProfile={resolved}
                  />
                ).toBlob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${letter.letterNumber?.trim() || 'Brief'}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <FileDown className='h-4 w-4' />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-destructive hover:text-destructive h-8 w-8'
                  title='Löschen'
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Brief löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Dieser Vorgang kann nicht rückgängig gemacht werden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      deleteMutation.mutate(letter.id);
                    }}
                  >
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        );
      }
    }
  ];

  const table = useReactTable({
    data: letters ?? [],
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
      </div>
    );
  }

  if (isError) {
    return (
      <p className='text-destructive text-sm'>
        {error?.message ?? 'Briefe konnten nicht geladen werden.'}
      </p>
    );
  }

  if (!letters?.length) {
    return (
      <div className='flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center'>
        <p className='text-muted-foreground mb-4 text-sm'>
          No letters yet. Create your first letter.
        </p>
        <Button asChild>
          <Link href='/dashboard/letters/new'>Neuer Brief</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className='w-full overflow-x-auto rounded-md border'>
      <Table className='min-w-full'>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead key={h.id}>
                  {h.isPlaceholder
                    ? null
                    : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((r) => (
            <TableRow key={r.id}>
              {r.getVisibleCells().map((cell) => (
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
