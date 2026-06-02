'use client';

import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { CheckCircle2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type {
  BatchMarkPaidResult,
  MatchedInvoice,
  MatchedRow,
  WarningReason
} from '../types/reconciliation.types';
import { canMarkWarningRow } from '../hooks/use-zahlungsabgleich';

const WARNING_LABELS: Record<
  WarningReason,
  { label: string; explanation: string }
> = {
  multi_invoice: {
    label: 'Mehrere Rechnungen',
    explanation:
      'Dieser Bankumsatz enthält mehrere Rechnungsnummern. Bitte prüfen und manuell als bezahlt markieren.'
  },
  amount_mismatch: {
    label: 'Betrag stimmt nicht überein',
    explanation:
      'Der Überweisungsbetrag weicht vom Rechnungsbetrag ab. Bitte manuell prüfen.'
  },
  already_paid: {
    label: 'Bereits bezahlt',
    explanation: 'Diese Rechnung ist bereits als bezahlt markiert.'
  },
  not_found: {
    label: 'Rechnung nicht gefunden',
    explanation:
      'Die Rechnungsnummer wurde im System nicht gefunden (offene Rechnung).'
  }
};

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

function formatMultiInvoiceSummary(invoices: MatchedInvoice[]): string {
  const parts = invoices.map(
    (inv) => `${inv.invoiceNumber} (${formatEur(inv.total)})`
  );
  const sum = invoices.reduce((acc, inv) => acc + inv.total, 0);
  return `${parts.join(' + ')} = ${formatEur(sum)}`;
}

interface WarningRowsDialogProps {
  rows: MatchedRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedWarningIds: Set<string>;
  onToggleWarningRow: (rowKey: string) => void;
  onConfirmWarning: () => void;
  isConfirming: boolean;
  confirmResults: Record<string, BatchMarkPaidResult>;
}

export function WarningRowsDialog({
  rows,
  open,
  onOpenChange,
  selectedWarningIds,
  onToggleWarningRow,
  onConfirmWarning,
  isConfirming,
  confirmResults
}: WarningRowsDialogProps) {
  const alreadyPaidCount = rows.filter((row) =>
    row.warningReasons.includes('already_paid')
  ).length;

  const visibleRows = rows.filter(
    (row) => !row.warningReasons.includes('already_paid')
  );

  const actionableSelectedCount = visibleRows.filter(
    (row) => selectedWarningIds.has(row.rowKey) && canMarkWarningRow(row)
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[90vh] w-[95vw] !max-w-[1400px] flex-col gap-0 p-0'>
        <DialogHeader className='shrink-0 px-6 pt-6 pb-4'>
          <DialogTitle>Manuelle Prüfung erforderlich</DialogTitle>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
          {alreadyPaidCount > 0 && (
            <p className='text-muted-foreground text-sm'>
              {alreadyPaidCount} Überweisung
              {alreadyPaidCount > 1 ? 'en' : ''}{' '}
              {alreadyPaidCount > 1 ? 'wurden' : 'wurde'} bereits als bezahlt
              markiert und {alreadyPaidCount > 1 ? 'werden' : 'wird'}{' '}
              übersprungen.
            </p>
          )}

          {visibleRows.length > 0 && (
            <Table className='w-full'>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>Grund</TableHead>
                  <TableHead>Verwendungszweck</TableHead>
                  <TableHead className='text-right'>Bankbetrag</TableHead>
                  <TableHead>Rechnung</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => {
                  const markable = canMarkWarningRow(row);
                  const result = confirmResults[row.rowKey];
                  const invoice = row.matchedInvoice;
                  const multiInvoices = row.matchedInvoices;
                  const isMultiInvoice =
                    row.warningReasons.includes('multi_invoice');
                  const markLabel =
                    multiInvoices && multiInvoices.length > 0
                      ? multiInvoices.map((inv) => inv.invoiceNumber).join(', ')
                      : (invoice?.invoiceNumber ?? '');

                  return (
                    <TableRow key={row.rowKey}>
                      <TableCell className='align-top'>
                        {markable ? (
                          <>
                            <Checkbox
                              checked={selectedWarningIds.has(row.rowKey)}
                              onCheckedChange={() =>
                                onToggleWarningRow(row.rowKey)
                              }
                              disabled={isConfirming}
                              aria-label={`Rechnung ${markLabel} als bezahlt markieren`}
                            />
                            <span className='sr-only'>
                              Rechnung {markLabel} als bezahlt markieren
                            </span>
                          </>
                        ) : isMultiInvoice && row.multiInvoiceBlockReason ? (
                          <span className='text-muted-foreground text-xs break-words whitespace-normal'>
                            {row.multiInvoiceBlockReason}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className='align-top break-words whitespace-normal'>
                        <ul className='space-y-2 text-sm'>
                          {row.warningReasons.map((reason) => {
                            const cfg = WARNING_LABELS[reason];
                            const amountHint =
                              reason === 'amount_mismatch' && invoice
                                ? ` (Bank: ${formatEur(row.bankRow.betrag)}, Rechnung: ${formatEur(invoice.total)})`
                                : reason === 'not_found' &&
                                    row.extractedNumbers[0]
                                  ? ` (${row.extractedNumbers[0]})`
                                  : '';
                            return (
                              <li key={reason}>
                                <span className='font-medium'>{cfg.label}</span>
                                <p className='text-muted-foreground text-xs'>
                                  {cfg.explanation}
                                  {amountHint}
                                </p>
                              </li>
                            );
                          })}
                        </ul>
                      </TableCell>
                      <TableCell className='align-top break-words whitespace-normal'>
                        <p>{row.bankRow.verwendungszweck || '—'}</p>
                        {row.multiInvoiceResolved &&
                          multiInvoices &&
                          multiInvoices.length > 0 && (
                            <div className='mt-2 space-y-1'>
                              <p className='font-mono text-sm tabular-nums'>
                                {formatMultiInvoiceSummary(multiInvoices)}
                              </p>
                              <p className='text-xs text-emerald-600 dark:text-emerald-400'>
                                Beträge stimmen überein — beide Rechnungen
                                können als bezahlt markiert werden.
                              </p>
                            </div>
                          )}
                      </TableCell>
                      <TableCell className='text-right align-top whitespace-nowrap tabular-nums'>
                        {formatEur(row.bankRow.betrag)}
                      </TableCell>
                      <TableCell className='align-top break-words whitespace-normal'>
                        {multiInvoices && multiInvoices.length > 0 ? (
                          <div className='space-y-2'>
                            {multiInvoices.map((inv) => (
                              <div key={inv.id} className='space-y-0.5'>
                                <p className='font-mono text-sm'>
                                  {inv.invoiceNumber}
                                </p>
                                <p className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
                                  Rechnungsbetrag: {formatEur(inv.total)}
                                </p>
                              </div>
                            ))}
                            <p className='text-muted-foreground text-xs'>
                              {formatBuchungstag(row.bankRow.buchungstagISO)}
                            </p>
                          </div>
                        ) : invoice ? (
                          <div className='space-y-0.5'>
                            <p className='font-mono text-sm'>
                              {invoice.invoiceNumber}
                            </p>
                            <p className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
                              Rechnungsbetrag: {formatEur(invoice.total)}
                            </p>
                            <p className='text-muted-foreground text-xs'>
                              {formatBuchungstag(row.bankRow.buchungstagISO)}
                            </p>
                          </div>
                        ) : (
                          <span className='font-mono text-sm'>
                            {row.extractedNumbers.join(', ') || '—'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className='align-top'>
                        {result?.success && (
                          <CheckCircle2
                            className='h-5 w-5 text-emerald-600'
                            aria-label='Erfolgreich markiert'
                          />
                        )}
                        {result && !result.success && (
                          <span title={result.error}>
                            <XCircle
                              className='text-destructive h-5 w-5'
                              aria-label='Fehler beim Markieren'
                            />
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className='border-border shrink-0 border-t px-6 py-4 sm:justify-between'>
          {visibleRows.length > 0 && (
            <Button
              type='button'
              disabled={actionableSelectedCount === 0 || isConfirming}
              onClick={onConfirmWarning}
            >
              {isConfirming ? (
                <>
                  <span className='mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
                  Wird gespeichert…
                </>
              ) : (
                <>
                  {actionableSelectedCount} ausgewählte Rechnung
                  {actionableSelectedCount === 1 ? '' : 'en'} als bezahlt
                  markieren
                </>
              )}
            </Button>
          )}
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
