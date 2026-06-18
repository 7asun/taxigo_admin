'use client';

/**
 * Orchestrates Zahlungsabgleich: parse CSV → match → batch mark paid via useUpdateInvoiceStatus.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getInvoicesByNumbers,
  listInvoices
} from '@/features/invoices/api/invoices.api';
import { useUpdateInvoiceStatus } from '@/features/invoices/hooks/use-invoice';
import { invoiceKeys } from '@/query/keys';
import { collectExtractedNumbers, parseBankCsv } from '../lib/parse-bank-csv';
import {
  mapInvoiceWithPayerToMatched,
  matchInvoices
} from '../lib/match-invoices';
import type {
  BatchMarkPaidResult,
  DialogStep,
  MatchedInvoice,
  MatchedRow
} from '../types/reconciliation.types';
import { InvalidBankCsvFormatError } from '../types/reconciliation.types';

function errorMessage(err: unknown): string {
  if (err instanceof InvalidBankCsvFormatError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Unbekannter Fehler';
}

/**
 * Expands a resolved multi-invoice ready row (matchedInvoices, groupKey set)
 * into N individual ready rows — one per invoice. Each row shares the same
 * bankRow, groupKey, and extractedNumbers but carries its own matchedInvoice,
 * rowKey, groupPosition, and groupSize.
 */
function expandGroupRow(row: MatchedRow): MatchedRow[] {
  if (!row.groupKey || !row.matchedInvoices || row.matchedInvoices.length < 2) {
    return [row];
  }
  const { matchedInvoices, groupKey } = row;
  return matchedInvoices.map((invoice, i) => ({
    ...row,
    rowKey: `${groupKey}:${invoice.id}`,
    matchedInvoice: invoice,
    groupPosition: i + 1,
    groupSize: matchedInvoices.length
  }));
}

/**
 * Returns the selection key for a ready row.
 * Sammelzahlung group rows share a groupKey so one checkbox selects the whole group.
 * Split-payment rows share a splitPaymentKey so all partial-payment rows for one
 * invoice are selected together — confirming half a split group would leave the
 * invoice in an inconsistent state.
 * Single rows use their rowKey directly.
 */
export function selectionKeyFor(row: MatchedRow): string {
  return row.groupKey ?? row.splitPaymentKey ?? row.rowKey;
}

/**
 * Counts the number of invoices that will be marked paid for a given set of
 * selected ready rows.
 * - Sammelzahlung groups (groupKey): contribute groupSize invoices.
 * - Split-payment groups (splitPaymentKey): contribute 1 invoice regardless of
 *   how many bank rows are in the group — all rows settle one shared invoice.
 * - Single rows: contribute 1.
 */
export function countSelectedInvoices(
  readyRows: MatchedRow[],
  selectedKeys: Set<string>
): number {
  let count = 0;
  const seenGroupKeys = new Set<string>();
  // why: split-payment rows all reference one invoice; only one should be counted
  const seenSplitKeys = new Set<string>();

  for (const row of readyRows) {
    const key = selectionKeyFor(row);
    if (!selectedKeys.has(key)) continue;
    if (row.groupKey) {
      if (seenGroupKeys.has(row.groupKey)) continue;
      seenGroupKeys.add(row.groupKey);
      count += row.groupSize ?? 1;
    } else if (row.splitPaymentKey) {
      if (seenSplitKeys.has(row.splitPaymentKey)) continue;
      seenSplitKeys.add(row.splitPaymentKey);
      count += 1;
    } else {
      count += 1;
    }
  }

  return count;
}

/** Warning rows actionable when a single invoice is matched (not multi-invoice resolved rows — those are in the ready bucket now). */
export function canMarkWarningRow(row: MatchedRow): boolean {
  if (!row.matchedInvoice) return false;
  if (row.warningReasons.includes('not_found')) return false;
  // why: allow manual confirm when invoices were found and loaded even if auto-resolution
  // failed (e.g. Guard 2 spurious failure due to sentByNumber pagination, or a genuine
  // Guard 4 amount mismatch the admin wants to override). The admin is the final human
  // check. Block only when matchedInvoices is empty — meaning the invoices could not
  // be identified at all, and confirming an unidentifiable transaction is unsafe.
  if (row.warningReasons.includes('multi_invoice')) {
    return (row.matchedInvoices?.length ?? 0) > 0;
  }
  return true;
}

export function useZahlungsabgleich(open: boolean) {
  const [step, setStep] = useState<DialogStep>('idle');
  const [matchedRows, setMatchedRows] = useState<MatchedRow[]>([]);
  // why: selection keys — groupKey for group rows, rowKey for singles
  const [selectedReadyKeys, setSelectedReadyKeys] = useState<Set<string>>(
    () => new Set()
  );
  // why: rowKey (stable CSV row index string)
  const [selectedWarningIds, setSelectedWarningIds] = useState<Set<string>>(
    () => new Set()
  );
  const [results, setResults] = useState<BatchMarkPaidResult[]>([]);
  const [warningConfirmResults, setWarningConfirmResults] = useState<
    Record<string, BatchMarkPaidResult>
  >({});
  const [isWarningConfirming, setIsWarningConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // why: reuse mutation hook so list gets optimistic updates + invoiceKeys.all invalidation
  const updateStatus = useUpdateInvoiceStatus();

  const sentQuery = useQuery({
    queryKey: [...invoiceKeys.list({ status: 'sent' }), 'zahlungsabgleich'],
    queryFn: () => listInvoices({ status: 'sent' }),
    enabled: open,
    staleTime: 60_000
  });

  const readyCount = useMemo(
    () => matchedRows.filter((r) => r.bucket === 'ready').length,
    [matchedRows]
  );

  const warningCount = useMemo(
    () => matchedRows.filter((r) => r.bucket === 'warning').length,
    [matchedRows]
  );

  const ignoredCount = useMemo(
    () => matchedRows.filter((r) => r.bucket === 'ignored').length,
    [matchedRows]
  );

  const readyRows = useMemo(
    () => matchedRows.filter((r) => r.bucket === 'ready'),
    [matchedRows]
  );

  const warningRows = useMemo(
    () => matchedRows.filter((r) => r.bucket === 'warning'),
    [matchedRows]
  );

  // Number of individual invoices covered by the current selection.
  const selectedReadyCount = useMemo(
    () => countSelectedInvoices(readyRows, selectedReadyKeys),
    [readyRows, selectedReadyKeys]
  );

  const isConfirming = step === 'confirming';

  const onReset = useCallback(() => {
    setStep('idle');
    setMatchedRows([]);
    setSelectedReadyKeys(new Set());
    setSelectedWarningIds(new Set());
    setResults([]);
    setWarningConfirmResults({});
    setIsWarningConfirming(false);
    setError(null);
  }, []);

  const toggleRow = useCallback((selectionKey: string, selected: boolean) => {
    setSelectedReadyKeys((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(selectionKey);
      } else {
        next.delete(selectionKey);
      }
      return next;
    });
  }, []);

  const toggleWarningRow = useCallback((rowKey: string) => {
    setSelectedWarningIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }, []);

  const onFileDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      setError(null);
      setStep('loading');

      try {
        const bankRows = await parseBankCsv(file);
        const sentInvoices = mapInvoiceWithPayerToMatched(
          (await sentQuery.refetch()).data ?? sentQuery.data ?? []
        );

        const extractedNumbers = collectExtractedNumbers(bankRows);
        const lookupRows = await getInvoicesByNumbers(extractedNumbers);
        const invoiceLookup = new Map(
          lookupRows.map((inv) => [inv.invoiceNumber, inv])
        );

        const rawRows = matchInvoices(bankRows, sentInvoices, invoiceLookup);

        // Expand resolved multi-invoice ready rows into per-invoice rows
        const expandedRows = rawRows.flatMap((row) => {
          if (row.bucket === 'ready' && row.groupKey) {
            return expandGroupRow(row);
          }
          return [row];
        });

        setMatchedRows(expandedRows);

        // Select all ready rows by their selection key (de-duplicated for groups)
        const allReadyKeys = new Set(
          expandedRows.filter((r) => r.bucket === 'ready').map(selectionKeyFor)
        );
        setSelectedReadyKeys(allReadyKeys);
        setSelectedWarningIds(new Set());
        setWarningConfirmResults({});
        setStep('reviewing');
      } catch (err) {
        setError(errorMessage(err));
        setStep('idle');
      }
    },
    [sentQuery]
  );

  const markRowsPaid = useCallback(
    async (rows: MatchedRow[]): Promise<BatchMarkPaidResult[]> => {
      const batchResults: BatchMarkPaidResult[] = [];

      // Deduplicate by invoice ID: split-payment rows all reference the same
      // invoice so only one DB update should fire. Use splitPaymentPaidAt (the
      // latest partial-payment booking date) when available; fall back to the
      // row's own buchungstagISO for all other row types.
      const seenInvoiceIds = new Map<
        string,
        { invoice: MatchedInvoice; paidAt: string }
      >();
      for (const row of rows) {
        const invoice = row.matchedInvoice;
        if (!invoice) continue;
        if (seenInvoiceIds.has(invoice.id)) continue;
        const paidAt = row.splitPaymentPaidAt ?? row.bankRow.buchungstagISO;
        seenInvoiceIds.set(invoice.id, { invoice, paidAt });
      }

      for (const { invoice, paidAt } of seenInvoiceIds.values()) {
        try {
          await updateStatus.mutateAsync({
            invoiceId: invoice.id,
            status: 'paid',
            paidAt,
            suppressToast: true
          });
          batchResults.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            success: true
          });
        } catch (err) {
          batchResults.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            success: false,
            error: errorMessage(err)
          });
        }
      }

      return batchResults;
    },
    [updateStatus]
  );

  const markWarningRowPaid = useCallback(
    async (row: MatchedRow): Promise<BatchMarkPaidResult> => {
      const paidAt = row.bankRow.buchungstagISO;

      // why: when the admin manually confirms an unresolved multi-invoice warning row
      // (e.g. after a spurious Guard 2 failure or a deliberate amount-mismatch override),
      // all invoices in the group must be marked paid with the same Buchungstag — they
      // were settled together in one bank transfer. The loop mirrors markRowsPaid() for
      // the ready bucket but returns an aggregated BatchMarkPaidResult so the warning
      // dialog can surface per-row inline success/failure icons unchanged.
      if ((row.matchedInvoices?.length ?? 0) > 0) {
        const perInvoice: BatchMarkPaidResult[] = [];

        for (const inv of row.matchedInvoices!) {
          try {
            await updateStatus.mutateAsync({
              invoiceId: inv.id,
              status: 'paid',
              paidAt,
              suppressToast: true
            });
            perInvoice.push({
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              success: true
            });
          } catch (err) {
            perInvoice.push({
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              success: false,
              error: errorMessage(err)
            });
          }
        }

        const invoiceNumbers = row
          .matchedInvoices!.map((inv) => inv.invoiceNumber)
          .join(', ');
        const allSuccess = perInvoice.every((r) => r.success);

        if (allSuccess) {
          return {
            invoiceId: row.matchedInvoices![0].id,
            invoiceNumber: invoiceNumbers,
            success: true
          };
        }

        const failedDetail = perInvoice
          .filter((r) => !r.success)
          .map((r) => `${r.invoiceNumber}${r.error ? `: ${r.error}` : ''}`)
          .join('; ');

        return {
          invoiceId: row.matchedInvoices![0].id,
          invoiceNumber: invoiceNumbers,
          success: false,
          error: `Teilweise fehlgeschlagen (${failedDetail})`
        };
      }

      // Single-invoice fallback (amount_mismatch / already_paid warning rows).
      const invoice = row.matchedInvoice;
      if (!invoice) {
        return {
          invoiceId: '',
          invoiceNumber: '—',
          success: false,
          error: 'Keine Rechnung zugeordnet'
        };
      }

      try {
        await updateStatus.mutateAsync({
          invoiceId: invoice.id,
          status: 'paid',
          paidAt,
          suppressToast: true
        });
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          success: true
        };
      } catch (err) {
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          success: false,
          error: errorMessage(err)
        };
      }
    },
    [updateStatus]
  );

  const onConfirm = useCallback(async () => {
    // Collect one row per invoice from the selection.
    // For group rows we deduplicate by groupKey: take all expanded rows whose
    // groupKey (or rowKey for singles) is in selectedReadyKeys.
    const toMark = readyRows.filter((row) =>
      selectedReadyKeys.has(selectionKeyFor(row))
    );
    if (toMark.length === 0) return;

    setStep('confirming');
    const batchResults = await markRowsPaid(toMark);
    setResults(batchResults);
    setStep('done');
  }, [readyRows, selectedReadyKeys, markRowsPaid]);

  const onConfirmWarning = useCallback(async () => {
    const toMark = warningRows.filter(
      (row) => selectedWarningIds.has(row.rowKey) && canMarkWarningRow(row)
    );
    if (toMark.length === 0) return;

    setIsWarningConfirming(true);
    const batchResults: BatchMarkPaidResult[] = [];
    for (const row of toMark) {
      batchResults.push(await markWarningRowPaid(row));
    }

    const resultsByRowKey: Record<string, BatchMarkPaidResult> = {};
    const successfulRowKeys = new Set<string>();

    toMark.forEach((row, index) => {
      const result = batchResults[index];
      if (result) {
        resultsByRowKey[row.rowKey] = result;
        if (result.success) {
          successfulRowKeys.add(row.rowKey);
        }
      }
    });

    setWarningConfirmResults((prev) => ({ ...prev, ...resultsByRowKey }));

    // why: remove paid rows from warning list so counts update and duplicates cannot be re-confirmed
    if (successfulRowKeys.size > 0) {
      setMatchedRows((prev) =>
        prev.filter((r) => !successfulRowKeys.has(r.rowKey))
      );
      setSelectedWarningIds((prev) => {
        const next = new Set(prev);
        successfulRowKeys.forEach((key) => next.delete(key));
        return next;
      });
    }

    setIsWarningConfirming(false);
  }, [warningRows, selectedWarningIds, markWarningRowPaid]);

  return {
    step,
    matchedRows,
    readyRows,
    warningRows,
    selectedReadyKeys,
    selectedReadyCount,
    selectedWarningIds,
    toggleRow,
    toggleWarningRow,
    onFileDrop,
    onConfirm,
    onConfirmWarning,
    onReset,
    readyCount,
    warningCount,
    ignoredCount,
    error,
    results,
    warningConfirmResults,
    isWarningConfirming,
    isConfirming,
    isSentLoading: sentQuery.isLoading
  };
}
