'use client';

/**
 * why: orchestrates accountant CSV import separately from status mutations — mirrors
 * useZahlungsabgleich step machine (idle → loading → reviewing → confirming → done).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';

import {
  useApplyKtsInvoiceImportMutation,
  useFetchKtsCandidateTrips
} from '@/features/kts/hooks/use-kts-invoice-import';
import { fetchKtsCompanyId } from '@/features/kts/lib/fetch-kts-company-id';
import {
  INVALID_KTS_ACCOUNTANT_CSV_MESSAGE,
  matchKtsCsvRows,
  parseKtsCsvRows,
  validateKtsAccountantCsvHeaders,
  type KtsCsvRow,
  type KtsMatchPreviewRow,
  type KtsMatchResult
} from '@/features/kts/lib/kts-csv-import-utils';

export type KtsCsvImportStep =
  | 'idle'
  | 'loading'
  | 'reviewing'
  | 'confirming'
  | 'done';

export function useKtsCsvImport() {
  const [step, setStep] = useState<KtsCsvImportStep>('idle');
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [pendingCsvRows, setPendingCsvRows] = useState<KtsCsvRow[] | null>(
    null
  );
  const [matchResult, setMatchResult] = useState<KtsMatchResult | null>(null);
  const [selectedMatchedIds, setSelectedMatchedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedLowConfidenceIds, setSelectedLowConfidenceIds] = useState<
    Set<string>
  >(() => new Set());
  const [doneCounts, setDoneCounts] = useState({
    stamped: 0,
    skipped: 0,
    unmatched: 0
  });
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const candidatesQuery = useFetchKtsCandidateTrips(fetchEnabled);
  const importMutation = useApplyKtsInvoiceImportMutation();

  useEffect(() => {
    if (step !== 'loading' || !pendingCsvRows || loadError) return;

    if (candidatesQuery.isError) {
      setLoadError(INVALID_KTS_ACCOUNTANT_CSV_MESSAGE);
      return;
    }

    if (!candidatesQuery.isSuccess) return;

    try {
      const result = matchKtsCsvRows(pendingCsvRows, candidatesQuery.data);
      setMatchResult(result);
      setSelectedMatchedIds(new Set(result.matched.map((r) => r.rowKey)));
      // why: low-confidence rows require explicit admin opt-in — never pre-check ambiguous matches.
      setSelectedLowConfidenceIds(new Set());
      setPendingCsvRows(null);
      setFetchEnabled(false);
      setStep('reviewing');
    } catch {
      setLoadError(INVALID_KTS_ACCOUNTANT_CSV_MESSAGE);
      setFetchEnabled(false);
    }
  }, [
    step,
    pendingCsvRows,
    loadError,
    candidatesQuery.isSuccess,
    candidatesQuery.isError,
    candidatesQuery.data
  ]);

  const onReset = useCallback(() => {
    setStep('idle');
    setFetchEnabled(false);
    setLoadError(null);
    setSourceFilename(null);
    setPendingCsvRows(null);
    setMatchResult(null);
    setSelectedMatchedIds(new Set());
    setSelectedLowConfidenceIds(new Set());
    setDoneCounts({ stamped: 0, skipped: 0, unmatched: 0 });
    setConfirmError(null);
  }, []);

  const onRetry = useCallback(() => {
    setLoadError(null);
    setPendingCsvRows(null);
    setFetchEnabled(false);
    setStep('idle');
  }, []);

  const onFileDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    setLoadError(null);
    setConfirmError(null);
    setSourceFilename(file.name);
    setStep('loading');
    setFetchEnabled(true);

    Papa.parse<Record<string, string>>(file, {
      delimiter: ';',
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          validateKtsAccountantCsvHeaders(results.meta.fields);
          const rows = parseKtsCsvRows(results.data);
          if (rows.length === 0) {
            setLoadError(INVALID_KTS_ACCOUNTANT_CSV_MESSAGE);
            setFetchEnabled(false);
            return;
          }
          setPendingCsvRows(rows);
        } catch {
          setLoadError(INVALID_KTS_ACCOUNTANT_CSV_MESSAGE);
          setFetchEnabled(false);
        }
      },
      error: () => {
        setLoadError(INVALID_KTS_ACCOUNTANT_CSV_MESSAGE);
        setFetchEnabled(false);
      }
    });
  }, []);

  const toggleMatchedRow = useCallback((rowKey: string, selected: boolean) => {
    setSelectedMatchedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }, []);

  const toggleLowConfidenceRow = useCallback((rowKey: string) => {
    setSelectedLowConfidenceIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  const selectedImportCount = useMemo(() => {
    if (!matchResult) return 0;
    const matched = matchResult.matched.filter((r) =>
      selectedMatchedIds.has(r.rowKey)
    ).length;
    const low = matchResult.lowConfidence.filter((r) =>
      selectedLowConfidenceIds.has(r.rowKey)
    ).length;
    return matched + low;
  }, [matchResult, selectedMatchedIds, selectedLowConfidenceIds]);

  const onConfirm = useCallback(async () => {
    if (!matchResult) return;

    const checkedRows: KtsMatchPreviewRow[] = [
      ...matchResult.matched.filter((r) => selectedMatchedIds.has(r.rowKey)),
      ...matchResult.lowConfidence.filter((r) =>
        selectedLowConfidenceIds.has(r.rowKey)
      )
    ];

    if (checkedRows.length === 0) return;

    setConfirmError(null);
    setStep('confirming');

    try {
      const companyId = await fetchKtsCompanyId();
      if (!companyId) {
        throw new Error('Unternehmen konnte nicht ermittelt werden.');
      }

      // why: only matched (exact) rows may carry a Schein-ID to the RPC — low-confidence
      // rows are ambiguous and must not backfill kts_patient_id on either trips or clients.
      // The RPC v3 enforces null-only / no-clobber server-side as defense-in-depth, but the
      // app layer must not send patientId for non-exact buckets by default.
      const matchedRowKeys = new Set(matchResult.matched.map((r) => r.rowKey));

      await importMutation.mutateAsync({
        companyId,
        rows: checkedRows.map((row) => ({
          tripId: row.tripId!,
          belegnummer: row.belegnummer,
          invoiceAmount: row.gesamtpreis,
          eigenanteil: row.eigenanteil,
          patientId: matchedRowKeys.has(row.rowKey) ? row.patientId : null
        })),
        sourceFilename
      });

      setDoneCounts({
        stamped: checkedRows.length,
        skipped: matchResult.bereitsImportiert.length,
        unmatched: matchResult.unmatched.length
      });
      setStep('done');
    } catch (err) {
      setConfirmError(
        err instanceof Error ? err.message : 'Import fehlgeschlagen.'
      );
      setStep('reviewing');
    }
  }, [
    matchResult,
    selectedMatchedIds,
    selectedLowConfidenceIds,
    sourceFilename,
    importMutation
  ]);

  return {
    step,
    loadError,
    confirmError,
    matchResult,
    selectedMatchedIds,
    selectedLowConfidenceIds,
    selectedImportCount,
    doneCounts,
    onFileDrop,
    onReset,
    onRetry,
    toggleMatchedRow,
    toggleLowConfidenceRow,
    onConfirm,
    isConfirming: step === 'confirming' || importMutation.isPending
  };
}
