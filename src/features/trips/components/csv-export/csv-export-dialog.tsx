'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useBillingVariantsForPayerQuery,
  useBillingVariantsQuery,
  usePayersQuery
} from '@/features/trips/hooks/use-trip-reference-queries';
import { useExportFilterPrefill } from '@/features/trips/hooks/use-export-filter-prefill';
import { buildExportPreviewSearchParams } from '@/features/trips/lib/export-query';
import {
  EXPORT_ONLY_KEYS,
  TABLE_COLUMN_TO_EXPORT_KEYS
} from '@/features/trips/lib/export-columns.registry';
import { useTripsTableStore } from '@/features/trips/stores/use-trips-table-store';
import type {
  ExportMode,
  ExportStep
} from '@/features/trips/types/csv-export.types';
import {
  createDefaultExportFilters,
  type ExportFilters
} from '@/features/trips/types/csv-export.types';
import { ExportFilterStep } from './export-filter-step';
import { DateRangeStep } from './date-range-step';
import { ColumnSelectorStep } from './column-selector-step';
import { PreviewStep } from './preview-step';

/**
 * Export-only keys are always appended because they have no table visibility toggle — omitting
 * them would silently drop system-critical fields like IDs and GPS coords from every table-view export.
 */
function resolveTableViewColumns(
  columnVisibility: Record<string, boolean>
): string[] {
  // Default hidden columns per table initialState
  const DEFAULT_HIDDEN = new Set(['net_price', 'tax_rate', 'reha_schein']);

  const mappedKeys = Object.entries(TABLE_COLUMN_TO_EXPORT_KEYS).flatMap(
    ([tableColId, exportKeys]) => {
      if (exportKeys.length === 0) return [];
      const explicitValue = columnVisibility[tableColId];
      const isVisible =
        explicitValue === true
          ? true
          : explicitValue === false
            ? false
            : !DEFAULT_HIDDEN.has(tableColId);
      return isVisible ? exportKeys : [];
    }
  );

  return [...new Set([...mappedKeys, ...EXPORT_ONLY_KEYS])];
}

interface CsvExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: ExportMode;
}

/**
 * CSV Export Dialog — multi-step wizard with shared ExportFilters state.
 * Prefills from current Fahrten URL filters when opened via `useExportFilterPrefill`.
 * `mode === 'table-view'` skips filter/column steps and lands on preview with visible table columns.
 */
export function CsvExportDialog({
  open,
  onOpenChange,
  mode = 'manual'
}: CsvExportDialogProps) {
  const prefillFilters = useExportFilterPrefill();

  const [step, setStep] = React.useState<ExportStep>('payer');
  const [filters, setFilters] = React.useState<ExportFilters>(
    createDefaultExportFilters
  );
  const [selectedColumns, setSelectedColumns] = React.useState<string[]>([]);

  const [previewCount, setPreviewCount] = React.useState<number | null>(null);
  const [sampleTrips, setSampleTrips] = React.useState<
    Array<Record<string, unknown>>
  >([]);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);

  const [isExporting, setIsExporting] = React.useState(false);
  const [exportResult, setExportResult] = React.useState<{
    success: boolean;
    count?: number;
    error?: string;
  } | null>(null);

  const payersQuery = usePayersQuery();
  const singlePayerId =
    filters.payerIds.length === 1 ? filters.payerIds[0]! : null;
  const payerVariantsQuery = useBillingVariantsForPayerQuery(singlePayerId);
  const allVariantsQuery = useBillingVariantsQuery({
    enabled: filters.payerIds.length !== 1
  });

  const payers = payersQuery.data ?? [];
  const billingVariants =
    filters.payerIds.length === 1
      ? (payerVariantsQuery.data ?? [])
      : (allVariantsQuery.data ?? []);

  const loadPreviewCount = async (filtersOverride?: ExportFilters) => {
    setIsLoadingPreview(true);
    try {
      const activeFilters = filtersOverride ?? filters;
      const params = buildExportPreviewSearchParams(activeFilters);
      const response = await fetch(
        `/api/trips/export/preview?${params.toString()}`,
        { method: 'GET' }
      );

      if (response.ok) {
        const data = (await response.json()) as {
          count: number;
          sampleTrips: Array<Record<string, unknown>>;
        };
        setPreviewCount(data.count);
        setSampleTrips(data.sampleTrips);
      } else {
        setPreviewCount(null);
        setSampleTrips([]);
      }
    } catch {
      setPreviewCount(null);
      setSampleTrips([]);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  React.useEffect(() => {
    if (!open) return;

    setPreviewCount(null);
    setSampleTrips([]);
    setExportResult(null);
    setFilters(prefillFilters);

    if (mode === 'manual') {
      setStep('payer');
      setSelectedColumns([]);
      setIsLoadingPreview(false);
      return;
    }

    // table-view: admin already filtered the table — skip configuration, honour column visibility.
    // Columns + loading flag are set before preview mounts so Export stays disabled until fetch completes.
    // WHY: Spalten writes to TanStack via toggleVisibility(); the Zustand mirror can lag. Read live table state at open time.
    const storeState = useTripsTableStore.getState();
    const liveVisibility =
      storeState.table?.getState().columnVisibility ??
      storeState.columnVisibility;
    // WHY: honours the admin's column visibility configuration so table-view export matches what is visible on screen.
    setSelectedColumns(resolveTableViewColumns(liveVisibility));
    setIsLoadingPreview(true);
    setStep('preview');
    void loadPreviewCount(prefillFilters);
  }, [open, prefillFilters, mode]);

  const handleNextFromFilters = () => {
    setStep('date-range');
  };

  const handleNextFromDateRange = () => {
    setStep('column-selector');
  };

  const handleNextFromColumnSelector = () => {
    void loadPreviewCount();
    setStep('preview');
  };

  const handleBack = () => {
    if (step === 'date-range') {
      setStep('payer');
    } else if (step === 'column-selector') {
      setStep('date-range');
    } else if (step === 'preview') {
      setStep('column-selector');
      setPreviewCount(null);
      setSampleTrips([]);
    }
  };

  const handleExport = async () => {
    if (selectedColumns.length === 0) {
      toast.error('Bitte wählen Sie mindestens eine Spalte aus.');
      return;
    }

    setIsExporting(true);
    setExportResult(null);

    try {
      const response = await fetch('/api/trips/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          columns: selectedColumns,
          includeHeaders: true
        })
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: 'Export fehlgeschlagen' }));
        throw new Error(
          error.error || `Export fehlgeschlagen (${response.status})`
        );
      }

      const formatDateForFilename = (dateStr: string): string => {
        const [year, month, day] = dateStr.split('-');
        return `${day}.${month}.${year.slice(2)}`;
      };

      const datePart =
        filters.dateFrom === filters.dateTo
          ? formatDateForFilename(filters.dateFrom)
          : `${formatDateForFilename(filters.dateFrom)}-${formatDateForFilename(filters.dateTo)}`;

      const payerPart =
        filters.payerIds.length === 1
          ? (
              payers.find((p) => p.id === filters.payerIds[0])?.name ||
              'Kostenträger'
            ).replace(/[^a-zA-Z0-9äöüÄÖÜß\-]/g, '_')
          : filters.payerIds.length > 1
            ? `${filters.payerIds.length}_Kostentraeger`
            : 'Alle';

      const billingPart =
        filters.billingVariantIds.length === 1
          ? (
              billingVariants.find((v) => v.id === filters.billingVariantIds[0])
                ?.name || 'Abrechnung'
            ).replace(/[^a-zA-Z0-9äöüÄÖÜß\-]/g, '_')
          : filters.billingVariantIds.length > 1
            ? `${filters.billingVariantIds.length}_Abrechnungen`
            : 'Abrechnung';

      const filename = `${datePart}_Fahrten_${payerPart}_${billingPart}.csv`;

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setExportResult({ success: true });
      toast.success('CSV-Export erfolgreich heruntergeladen!');

      setTimeout(() => {
        onOpenChange(false);
      }, 1500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Export fehlgeschlagen';
      setExportResult({ success: false, error: message });
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  };

  const stepTitle = React.useMemo(() => {
    switch (step) {
      case 'payer':
        return 'Export-Filter';
      case 'date-range':
        return 'Zeitraum auswählen';
      case 'column-selector':
        return 'Spalten auswählen';
      case 'preview':
        return 'Export-Vorschau';
      default:
        return 'CSV Export';
    }
  }, [step]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'transition-all duration-300',
          'flex max-h-[85vh] w-full flex-col overflow-hidden',
          step === 'preview'
            ? 'sm:max-w-[90vw] lg:max-w-[1200px]'
            : 'sm:max-w-[500px]'
        )}
      >
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <FileSpreadsheet className='h-5 w-5 text-emerald-600' />
            {stepTitle}
          </DialogTitle>
          <DialogDescription>
            {step === 'payer' &&
              'Legen Sie Kostenträger, Abrechnung, Zuweisung, Status und KTS-Filter fest.'}
            {step === 'date-range' && 'Legen Sie den Zeitraum fest.'}
            {step === 'column-selector' &&
              'Wählen Sie die zu exportierenden Spalten.'}
            {step === 'preview' &&
              (mode === 'table-view'
                ? 'Export basiert auf der aktuellen Tabellenansicht.'
                : 'Überprüfen Sie die Export-Einstellungen vor dem Download.')}
          </DialogDescription>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 touch-pan-y flex-col gap-4 overflow-y-auto overscroll-contain py-4'>
          {exportResult?.success && (
            <Alert className='border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20'>
              <CheckCircle2 className='h-4 w-4 text-emerald-600' />
              <AlertTitle className='text-emerald-800 dark:text-emerald-400'>
                Export erfolgreich
              </AlertTitle>
              <AlertDescription className='text-emerald-700 dark:text-emerald-500'>
                Der CSV-Export wurde heruntergeladen.
              </AlertDescription>
            </Alert>
          )}

          {exportResult?.error && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertTitle>Export fehlgeschlagen</AlertTitle>
              <AlertDescription>{exportResult.error}</AlertDescription>
            </Alert>
          )}

          <>
            {step === 'payer' && (
              <ExportFilterStep
                filters={filters}
                onFiltersChange={setFilters}
                onNext={handleNextFromFilters}
                onCancel={() => onOpenChange(false)}
              />
            )}

            {step === 'date-range' && (
              <DateRangeStep
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                onDateRangeChange={(from, to) => {
                  setFilters((prev) => ({
                    ...prev,
                    dateFrom: from,
                    dateTo: to
                  }));
                }}
                onNext={handleNextFromDateRange}
                onBack={handleBack}
              />
            )}

            {step === 'column-selector' && (
              <ColumnSelectorStep
                selectedColumns={selectedColumns}
                onColumnsChange={setSelectedColumns}
                onNext={handleNextFromColumnSelector}
                onBack={handleBack}
              />
            )}

            {step === 'preview' && (
              <PreviewStep
                filters={filters}
                selectedColumns={selectedColumns}
                payers={payers}
                billingVariants={billingVariants}
                previewCount={previewCount}
                isLoadingPreview={isLoadingPreview}
                sampleTrips={sampleTrips}
                showBack={mode !== 'table-view'}
                onBack={handleBack}
                onExport={handleExport}
                isExporting={isExporting}
              />
            )}
          </>
        </div>
      </DialogContent>
    </Dialog>
  );
}
