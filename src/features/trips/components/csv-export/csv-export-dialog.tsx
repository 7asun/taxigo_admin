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
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import type { ExportStep } from '@/features/trips/types/csv-export.types';
import { PayerBillingStep } from './payer-billing-step';
import { DateRangeStep } from './date-range-step';
import { ColumnSelectorStep } from './column-selector-step';
import { PreviewStep } from './preview-step';

interface CsvExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * CSV Export Dialog
 *
 * Multi-step wizard for exporting trips to CSV:
 * 1. Payer & Billing Type selection (combined step)
 * 2. Date range selection
 * 3. Column selector
 * 4. Preview (shows summary and trip count)
 */
export function CsvExportDialog({ open, onOpenChange }: CsvExportDialogProps) {
  // Current step in the wizard
  const [step, setStep] = React.useState<ExportStep>('payer');

  // Filter state
  const [payerId, setPayerId] = React.useState<string | null>(null);
  const [billingTypeId, setBillingTypeId] = React.useState<string | null>(null);
  const [dateFrom, setDateFrom] = React.useState<string>(getDefaultDateFrom());
  const [dateTo, setDateTo] = React.useState<string>(getDefaultDateTo());
  const [selectedColumns, setSelectedColumns] = React.useState<string[]>([]);

  // Preview state - stores the count of trips matching current filters and sample data
  const [previewCount, setPreviewCount] = React.useState<number | null>(null);
  const [sampleTrips, setSampleTrips] = React.useState<
    Array<Record<string, unknown>>
  >([]);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);

  // Export state
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportResult, setExportResult] = React.useState<{
    success: boolean;
    count?: number;
    error?: string;
  } | null>(null);

  // Load payers and billing variants
  const { payers, billingVariants, isLoading } = useTripFormData(payerId);

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setStep('payer');
      setPayerId(null);
      setBillingTypeId(null);
      setDateFrom(getDefaultDateFrom());
      setDateTo(getDefaultDateTo());
      setSelectedColumns([]);
      setPreviewCount(null);
      setSampleTrips([]);
      setExportResult(null);
    }
  }, [open]);

  // Combined payer/billing step - go directly to date range
  const handleNextFromPayerBilling = () => {
    setStep('date-range');
  };

  const handleNextFromDateRange = () => {
    setStep('column-selector');
  };

  const handleNextFromColumnSelector = () => {
    // Load preview count before showing preview step
    void loadPreviewCount();
    setStep('preview');
  };

  const handleBack = () => {
    if (step === 'date-range') {
      setStep('payer');
      setBillingTypeId(null);
    } else if (step === 'column-selector') {
      setStep('date-range');
    } else if (step === 'preview') {
      setStep('column-selector');
      setPreviewCount(null);
      setSampleTrips([]);
    }
  };

  /**
   * Load preview count and sample data from API.
   * Calls the preview endpoint to get count and up to 5 sample rows.
   */
  const loadPreviewCount = async () => {
    setIsLoadingPreview(true);
    try {
      const params = new URLSearchParams();
      if (payerId) params.set('payer_id', payerId);
      if (billingTypeId) params.set('billing_variant_id', billingTypeId);
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);

      console.log('Fetching preview with params:', params.toString());

      const response = await fetch(
        `/api/trips/export/preview?${params.toString()}`,
        {
          method: 'GET'
        }
      );

      console.log('Preview API response status:', response.status);

      if (response.ok) {
        const data = (await response.json()) as {
          count: number;
          sampleTrips: Array<Record<string, unknown>>;
        };
        console.log('Preview API data:', data);
        setPreviewCount(data.count);
        setSampleTrips(data.sampleTrips);
      } else {
        const errorText = await response.text();
        console.error('Preview API error:', response.status, errorText);
        setPreviewCount(null);
        setSampleTrips([]);
      }
    } catch (err) {
      console.error('Preview fetch error:', err);
      setPreviewCount(null);
      setSampleTrips([]);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Export handler - performs the actual CSV download
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
          payerId,
          billingTypeId,
          dateFrom,
          dateTo,
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

      // Generate filename with format: dd.mm.yy-dd.mm.yy_Fahrten_Kostenträger_Abrechnungs.csv
      const formatDateForFilename = (dateStr: string): string => {
        if (!dateStr) return '';
        const [year, month, day] = dateStr.split('-');
        return `${day}.${month}.${year.slice(2)}`; // dd.mm.yy format
      };

      const datePart =
        dateFrom === dateTo
          ? formatDateForFilename(dateFrom)
          : `${formatDateForFilename(dateFrom)}-${formatDateForFilename(dateTo)}`;

      const payerPart = payerId
        ? (
            payers.find((p) => p.id === payerId)?.name || 'Kostenträger'
          ).replace(/[^a-zA-Z0-9äöüÄÖÜß\-]/g, '_')
        : 'Alle';

      const billingPart = billingTypeId
        ? (
            billingVariants.find((v) => v.id === billingTypeId)?.name ||
            'Abrechnung'
          ).replace(/[^a-zA-Z0-9äöüÄÖÜß\-]/g, '_')
        : 'Abrechnung';

      const filename = `${datePart}_Fahrten_${payerPart}_${billingPart}.csv`;

      // Download the CSV file via browser
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

      // Close dialog after short delay
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

  // Step titles for dialog header
  const stepTitle = React.useMemo(() => {
    switch (step) {
      case 'payer':
        return 'Kostenträger & Abrechnung';
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
          // Ensure wide preview tables don't resize the dialog/footer; content scrolls instead.
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
              'Wählen Sie einen Kostenträger und optional eine Abrechnungsart.'}
            {step === 'date-range' && 'Legen Sie den Zeitraum fest.'}
            {step === 'column-selector' &&
              'Wählen Sie die zu exportierenden Spalten.'}
            {step === 'preview' &&
              'Überprüfen Sie die Export-Einstellungen vor dem Download.'}
          </DialogDescription>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-4 py-4'>
          {/* Export result message */}
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

          {/* Step content */}
          {isLoading ? (
            <div className='flex flex-col items-center justify-center py-8'>
              <span className='h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent' />
              <p className='text-muted-foreground mt-4 text-sm'>
                Lade Daten...
              </p>
            </div>
          ) : (
            <>
              {step === 'payer' && (
                <PayerBillingStep
                  payers={payers}
                  billingVariants={billingVariants}
                  selectedPayerId={payerId}
                  selectedBillingTypeId={billingTypeId}
                  onPayerChange={setPayerId}
                  onBillingTypeChange={setBillingTypeId}
                  onNext={handleNextFromPayerBilling}
                  onCancel={() => onOpenChange(false)}
                />
              )}

              {step === 'date-range' && (
                <DateRangeStep
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateRangeChange={(from, to) => {
                    setDateFrom(from);
                    setDateTo(to);
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
                  payerId={payerId}
                  billingTypeId={billingTypeId}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  selectedColumns={selectedColumns}
                  payers={payers}
                  billingVariants={billingVariants}
                  previewCount={previewCount}
                  isLoadingPreview={isLoadingPreview}
                  sampleTrips={sampleTrips}
                  onBack={handleBack}
                  onExport={handleExport}
                  isExporting={isExporting}
                />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Get default start date (30 days ago) in YYYY-MM-DD format.
 */
function getDefaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return formatDate(d);
}

/**
 * Get default end date (today) in YYYY-MM-DD format.
 */
function getDefaultDateTo(): string {
  return formatDate(new Date());
}

/**
 * Format date to YYYY-MM-DD for input[type="date"].
 */
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
