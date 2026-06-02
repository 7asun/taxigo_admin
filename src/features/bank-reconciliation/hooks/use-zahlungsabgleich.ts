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

/** Warning rows actionable when matcher allows mark-paid (incl. resolved two-invoice rows). */
export function canMarkWarningRow(row: MatchedRow): boolean {
  if (
    row.multiInvoiceResolved === true &&
    (row.matchedInvoices?.length ?? 0) > 0
  ) {
    return true;
  }
  if (!row.matchedInvoice) return false;
  if (row.warningReasons.includes('not_found')) return false;
  if (row.warningReasons.includes('multi_invoice')) return false;
  return true;
}

export function useZahlungsabgleich(open: boolean) {
  const [step, setStep] = useState<DialogStep>('idle');
  const [matchedRows, setMatchedRows] = useState<MatchedRow[]>([]);
  const [selectedReadyIds, setSelectedReadyIds] = useState<Set<string>>(
    () => new Set()
  );
  // why: rowKey (stable CSV row index string) — same key as ready-row selection
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

  const isConfirming = step === 'confirming';

  const onReset = useCallback(() => {
    setStep('idle');
    setMatchedRows([]);
    setSelectedReadyIds(new Set());
    setSelectedWarningIds(new Set());
    setResults([]);
    setWarningConfirmResults({});
    setIsWarningConfirming(false);
    setError(null);
  }, []);

  const toggleRow = useCallback((rowKey: string, selected: boolean) => {
    setSelectedReadyIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(rowKey);
      } else {
        next.delete(rowKey);
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

        const rows = matchInvoices(bankRows, sentInvoices, invoiceLookup);
        setMatchedRows(rows);
        setSelectedReadyIds(
          new Set(rows.filter((r) => r.bucket === 'ready').map((r) => r.rowKey))
        );
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

      for (const row of rows) {
        const invoice = row.matchedInvoice;
        if (!invoice) continue;

        try {
          await updateStatus.mutateAsync({
            invoiceId: invoice.id,
            status: 'paid',
            paidAt: row.bankRow.buchungstagISO,
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

      if (row.multiInvoiceResolved && row.matchedInvoices?.length) {
        const perInvoice: BatchMarkPaidResult[] = [];

        for (const invoice of row.matchedInvoices) {
          try {
            await updateStatus.mutateAsync({
              invoiceId: invoice.id,
              status: 'paid',
              paidAt,
              suppressToast: true
            });
            perInvoice.push({
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              success: true
            });
          } catch (err) {
            perInvoice.push({
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              success: false,
              error: errorMessage(err)
            });
          }
        }

        const invoiceNumbers = row.matchedInvoices
          .map((inv) => inv.invoiceNumber)
          .join(', ');
        const allSuccess = perInvoice.every((r) => r.success);

        if (allSuccess) {
          return {
            invoiceId: row.matchedInvoices[0].id,
            invoiceNumber: invoiceNumbers,
            success: true
          };
        }

        const failedDetail = perInvoice
          .filter((r) => !r.success)
          .map((r) => `${r.invoiceNumber}${r.error ? `: ${r.error}` : ''}`)
          .join('; ');

        return {
          invoiceId: row.matchedInvoices[0].id,
          invoiceNumber: invoiceNumbers,
          success: false,
          error: `Teilweise fehlgeschlagen (${failedDetail})`
        };
      }

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
    const toMark = readyRows.filter((row) => selectedReadyIds.has(row.rowKey));
    if (toMark.length === 0) return;

    setStep('confirming');
    const batchResults = await markRowsPaid(toMark);
    setResults(batchResults);
    setStep('done');
  }, [readyRows, selectedReadyIds, markRowsPaid]);

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
    selectedReadyIds,
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
