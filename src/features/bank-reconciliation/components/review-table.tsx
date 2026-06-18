'use client';

import { useCallback, useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronDown } from 'lucide-react';

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
import { selectionKeyFor } from '../hooks/use-zahlungsabgleich';

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
  selectedReadyKeys: Set<string>;
  warningRows: MatchedRow[];
  ignoredCount: number;
  onToggleRow: (selectionKey: string, selected: boolean) => void;
}

/**
 * Typed display unit for the ready table.
 *
 * why: Sammelzahlung (multiInvoice) and Eigenanteil (splitPayment) share
 * the same visual pattern but inverse math. A typed kind avoids hidden
 * assumptions and makes the header arithmetic branch explicit and auditable.
 *
 * multiInvoice — one bank row, many invoices (groupKey rows expanded by hook)
 * splitPayment — many bank rows, one shared invoice (splitPaymentKey rows)
 * single       — one bank row, one invoice
 */
type ReadyDisplayGroup =
  | { kind: 'single'; key: string; rows: [MatchedRow] }
  | { kind: 'multiInvoice'; key: string; rows: MatchedRow[] }
  | { kind: 'splitPayment'; key: string; rows: MatchedRow[] };

/**
 * Builds typed display groups from a flat list of ready rows.
 * Priority: groupKey → splitPaymentKey → single.
 *
 * Split-payment groups where all rows have matchedInvoice === null are
 * treated as singles rather than rendering a misleading header.
 * This should not occur given matcher guards, but guards against future bugs.
 */
function buildReadyDisplayGroups(rows: MatchedRow[]): ReadyDisplayGroup[] {
  const groups: ReadyDisplayGroup[] = [];
  const multiIndex = new Map<
    string,
    ReadyDisplayGroup & { kind: 'multiInvoice' }
  >();
  const splitIndex = new Map<
    string,
    ReadyDisplayGroup & { kind: 'splitPayment' }
  >();

  for (const row of rows) {
    if (row.groupKey) {
      const existing = multiIndex.get(row.groupKey);
      if (existing) {
        existing.rows.push(row);
      } else {
        const g: ReadyDisplayGroup & { kind: 'multiInvoice' } = {
          kind: 'multiInvoice',
          key: row.groupKey,
          rows: [row]
        };
        multiIndex.set(row.groupKey, g);
        groups.push(g);
      }
    } else if (row.splitPaymentKey) {
      const existing = splitIndex.get(row.splitPaymentKey);
      if (existing) {
        existing.rows.push(row);
      } else {
        const g: ReadyDisplayGroup & { kind: 'splitPayment' } = {
          kind: 'splitPayment',
          key: row.splitPaymentKey,
          rows: [row]
        };
        splitIndex.set(row.splitPaymentKey, g);
        groups.push(g);
      }
    } else {
      groups.push({ kind: 'single', key: row.rowKey, rows: [row] });
    }
  }

  // Downgrade any splitPayment group where every row has matchedInvoice === null
  // to individual singles so the header never shows — and 0,00 €.
  return groups.flatMap((g) => {
    if (
      g.kind === 'splitPayment' &&
      g.rows.every((r) => r.matchedInvoice === null)
    ) {
      return g.rows.map(
        (r): ReadyDisplayGroup => ({ kind: 'single', key: r.rowKey, rows: [r] })
      );
    }
    return [g];
  });
}

export function ReviewTable({
  readyRows,
  selectedReadyKeys,
  warningRows,
  ignoredCount,
  onToggleRow
}: ReviewTableProps) {
  const manualReviewCount = countManualReviewWarnings(warningRows);
  const alreadyPaidSkipCount = warningRows.filter(
    (row) =>
      row.bucket === 'warning' && row.warningReasons.includes('already_paid')
  ).length;

  // why: split-payment groups share one invoice; deduplicate by splitPaymentKey
  // so "2 partial payments for RE-2026-04-0004" counts as 1 Rechnung, not 2
  const seenSplitKeys = new Set<string>();
  const selectedInvoiceCount = readyRows.filter((r) => {
    if (!selectedReadyKeys.has(selectionKeyFor(r))) return false;
    if (r.splitPaymentKey) {
      if (seenSplitKeys.has(r.splitPaymentKey)) return false;
      seenSplitKeys.add(r.splitPaymentKey);
    }
    return true;
  }).length;

  const groups = buildReadyDisplayGroups(readyRows);

  // why: collapsed by default keeps the ready table scannable at a glance.
  // The admin sees one summary row per group and expands only to verify detail.
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(
    () => new Set()
  );

  const toggleGroupExpand = useCallback((key: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

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
              <TableHead className='w-8' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className='text-muted-foreground h-20 text-center text-sm'
                >
                  Keine automatisch zuordbaren Zahlungen.
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => {
                if (group.kind === 'multiInvoice') {
                  // ── Sammelzahlung: one bank row → many invoices ─────────────
                  // bankAmount is from the shared bank row; invoiceSum aggregates
                  // all individual invoice totals across the expanded child rows.
                  const selKey = group.key;
                  const isSelected = selectedReadyKeys.has(selKey);
                  const isExpanded = expandedGroupKeys.has(selKey);
                  const firstRow = group.rows[0];
                  const bankAmount = firstRow.bankRow.betrag;
                  const invoiceSum = group.rows.reduce(
                    (acc, r) => acc + (r.matchedInvoice?.total ?? 0),
                    0
                  );
                  const diff = bankAmount - invoiceSum;
                  const diffNearZero = Math.abs(diff) < 0.005;
                  const groupSize = group.rows.length;

                  return [
                    // Group header row
                    <TableRow
                      key={`${selKey}-header`}
                      className='bg-muted/40 font-medium'
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) =>
                            onToggleRow(selKey, checked === true)
                          }
                          aria-label={`Sammelzahlung ${groupSize} Rechnungen als bezahlt markieren`}
                        />
                      </TableCell>
                      <TableCell className='text-sm'>
                        {formatBuchungstag(firstRow.bankRow.buchungstagISO)}
                      </TableCell>
                      <TableCell className='max-w-[180px] truncate text-sm'>
                        {firstRow.bankRow.beguenstigter || '—'}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-sm'>
                        {groupSize} Rechnungen
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatEur(invoiceSum)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatEur(bankAmount)}
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
                      <TableCell className='w-8 text-right'>
                        <button
                          onClick={() => toggleGroupExpand(selKey)}
                          aria-label={
                            isExpanded
                              ? 'Details einklappen'
                              : 'Details ausklappen'
                          }
                          aria-expanded={isExpanded}
                          className='text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors'
                        >
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform duration-200',
                              isExpanded && 'rotate-180'
                            )}
                          />
                        </button>
                      </TableCell>
                    </TableRow>,
                    // Per-invoice child rows — only rendered when expanded
                    ...(isExpanded
                      ? group.rows.map((row) => {
                          const invoiceTotal = row.matchedInvoice?.total ?? 0;
                          const pos = row.groupPosition ?? 1;
                          const size = row.groupSize ?? groupSize;
                          return (
                            <TableRow
                              key={row.rowKey}
                              className={cn(
                                'border-l-2 border-l-transparent',
                                isSelected && 'border-l-primary/30'
                              )}
                            >
                              <TableCell />
                              <TableCell />
                              <TableCell />
                              <TableCell className='font-mono text-sm'>
                                <span className='text-muted-foreground mr-2 text-xs tabular-nums'>
                                  {pos}/{size}
                                </span>
                                {row.matchedInvoice?.invoiceNumber ?? '—'}
                              </TableCell>
                              <TableCell className='text-right tabular-nums'>
                                {formatEur(invoiceTotal)}
                              </TableCell>
                              <TableCell />
                              <TableCell />
                              <TableCell />
                            </TableRow>
                          );
                        })
                      : [])
                  ];
                }

                if (group.kind === 'splitPayment') {
                  // ── Eigenanteil: many bank rows → one invoice ───────────────
                  // why: split payment is the inverse of Sammelzahlung. The header
                  // sums all partial bank amounts and compares to one invoice total.
                  // Child rows show individual bank transactions (date, beneficiary,
                  // partial amount) because that is the meaningful per-row detail —
                  // not invoice data, which is shared and shown once on the header.
                  const selKey = group.key;
                  const isSelected = selectedReadyKeys.has(selKey);
                  const isExpanded = expandedGroupKeys.has(selKey);
                  const firstRow = group.rows[0];
                  const bankAmount = group.rows.reduce(
                    (acc, r) => acc + r.bankRow.betrag,
                    0
                  );
                  const invoiceAmount = firstRow.matchedInvoice?.total ?? 0;
                  const diff = bankAmount - invoiceAmount;
                  const diffNearZero = Math.abs(diff) < 0.005;
                  const groupSize = group.rows.length;

                  return [
                    // Group header row
                    <TableRow
                      key={`${selKey}-header`}
                      className='bg-muted/40 font-medium'
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) =>
                            onToggleRow(selKey, checked === true)
                          }
                          aria-label={`Eigenanteil ${firstRow.matchedInvoice?.invoiceNumber ?? ''} als bezahlt markieren`}
                        />
                      </TableCell>
                      <TableCell className='text-sm'>
                        {firstRow.splitPaymentPaidAt
                          ? formatBuchungstag(firstRow.splitPaymentPaidAt)
                          : '—'}
                      </TableCell>
                      <TableCell className='max-w-[180px] truncate text-sm'>
                        —
                      </TableCell>
                      <TableCell className='font-mono text-sm'>
                        {firstRow.matchedInvoice?.invoiceNumber ?? '—'}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatEur(invoiceAmount)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatEur(bankAmount)}
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
                      <TableCell className='w-8 text-right'>
                        <button
                          onClick={() => toggleGroupExpand(selKey)}
                          aria-label={
                            isExpanded
                              ? 'Details einklappen'
                              : 'Details ausklappen'
                          }
                          aria-expanded={isExpanded}
                          className='text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors'
                        >
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform duration-200',
                              isExpanded && 'rotate-180'
                            )}
                          />
                        </button>
                      </TableCell>
                    </TableRow>,
                    // Per-bank-transaction child rows — only rendered when expanded
                    ...(isExpanded
                      ? group.rows.map((row) => {
                          const pos = row.splitPaymentPosition ?? 1;
                          return (
                            <TableRow
                              key={row.rowKey}
                              className={cn(
                                'border-l-2 border-l-transparent',
                                isSelected && 'border-l-primary/30'
                              )}
                            >
                              <TableCell />
                              <TableCell className='text-sm'>
                                {formatBuchungstag(row.bankRow.buchungstagISO)}
                              </TableCell>
                              <TableCell className='max-w-[180px] truncate text-sm'>
                                {row.bankRow.beguenstigter || '—'}
                              </TableCell>
                              <TableCell className='text-muted-foreground text-xs tabular-nums'>
                                {pos}/{groupSize}
                              </TableCell>
                              <TableCell />
                              <TableCell className='text-right tabular-nums'>
                                {formatEur(row.bankRow.betrag)}
                              </TableCell>
                              <TableCell />
                              <TableCell />
                            </TableRow>
                          );
                        })
                      : [])
                  ];
                }

                // ── Single-invoice row (unchanged layout) ───────────────────
                const row = group.rows[0];
                const invoiceTotal = row.matchedInvoice?.total ?? 0;
                const diff = row.bankRow.betrag - invoiceTotal;
                const diffNearZero = Math.abs(diff) < 0.005;
                const selKey = selectionKeyFor(row);

                return (
                  <TableRow key={row.rowKey}>
                    <TableCell>
                      <Checkbox
                        checked={selectedReadyKeys.has(selKey)}
                        onCheckedChange={(checked) =>
                          onToggleRow(selKey, checked === true)
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
                    <TableCell />
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className='text-muted-foreground text-sm'>
        {selectedInvoiceCount} Rechnung
        {selectedInvoiceCount === 1 ? '' : 'en'} werden als bezahlt markiert.{' '}
        {manualReviewCount} Zeile
        {manualReviewCount === 1 ? '' : 'n'} erfordern manuelle Prüfung.
        {alreadyPaidSkipCount > 0
          ? ` ${alreadyPaidSkipCount} bereits bezahlt übersprungen.`
          : ''}{' '}
        {ignoredCount} Zeile{ignoredCount === 1 ? '' : 'n'} ignoriert.
      </p>
    </div>
  );
}
