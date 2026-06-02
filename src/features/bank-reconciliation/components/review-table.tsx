'use client';

import { format } from 'date-fns';
import { de } from 'date-fns/locale';

import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { MatchedRow } from '../types/reconciliation.types';

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

function formatBuchungstag(iso: string): string {
  try {
    return format(new Date(iso), 'dd.MM.yyyy', { locale: de });
  } catch {
    return iso;
  }
}

/** Rows shown in the warning dialog (excludes already_paid). */
export function countManualReviewWarnings(rows: MatchedRow[]): number {
  return rows.filter(
    (row) =>
      row.bucket === 'warning' && !row.warningReasons.includes('already_paid')
  ).length;
}

interface ReviewTableProps {
  readyRows: MatchedRow[];
  selectedReadyIds: Set<string>;
  warningRows: MatchedRow[];
  ignoredCount: number;
  onToggleRow: (rowKey: string, selected: boolean) => void;
}

export function ReviewTable({
  readyRows,
  selectedReadyIds,
  warningRows,
  ignoredCount,
  onToggleRow
}: ReviewTableProps) {
  const manualReviewCount = countManualReviewWarnings(warningRows);
  const alreadyPaidSkipCount = warningRows.filter(
    (row) =>
      row.bucket === 'warning' && row.warningReasons.includes('already_paid')
  ).length;

  const selectedCount = readyRows.filter((r) =>
    selectedReadyIds.has(r.rowKey)
  ).length;

  return (
    <div className='space-y-4'>
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-10' />
              <TableHead>Buchungsdatum</TableHead>
              <TableHead>Begünstigter</TableHead>
              <TableHead>Rechnungsnr.</TableHead>
              <TableHead className='text-right'>Rechnungsbetrag</TableHead>
              <TableHead className='text-right'>Bankbetrag</TableHead>
              <TableHead className='text-right'>Differenz</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {readyRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className='text-muted-foreground h-20 text-center text-sm'
                >
                  Keine automatisch zuordbaren Zahlungen.
                </TableCell>
              </TableRow>
            ) : (
              readyRows.map((row) => {
                const invoiceTotal = row.matchedInvoice?.total ?? 0;
                const diff = row.bankRow.betrag - invoiceTotal;
                const diffNearZero = Math.abs(diff) < 0.005;
                return (
                  <TableRow key={row.rowKey}>
                    <TableCell>
                      <Checkbox
                        checked={selectedReadyIds.has(row.rowKey)}
                        onCheckedChange={(checked) =>
                          onToggleRow(row.rowKey, checked === true)
                        }
                      />
                    </TableCell>
                    <TableCell className='text-sm'>
                      {formatBuchungstag(row.bankRow.buchungstagISO)}
                    </TableCell>
                    <TableCell className='max-w-[180px] truncate text-sm'>
                      {row.bankRow.beguenstigter || '—'}
                    </TableCell>
                    <TableCell className='font-mono text-sm'>
                      {row.matchedInvoice?.invoiceNumber ?? '—'}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatEur(invoiceTotal)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatEur(row.bankRow.betrag)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        diffNearZero
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {formatEur(diff)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className='text-muted-foreground text-sm'>
        {selectedCount} Rechnung{selectedCount === 1 ? '' : 'en'} werden als
        bezahlt markiert. {manualReviewCount} Zeile
        {manualReviewCount === 1 ? '' : 'n'} erfordern manuelle Prüfung.
        {alreadyPaidSkipCount > 0
          ? ` ${alreadyPaidSkipCount} bereits bezahlt übersprungen.`
          : ''}{' '}
        {ignoredCount} Zeile{ignoredCount === 1 ? '' : 'n'} ignoriert.
      </p>
    </div>
  );
}
