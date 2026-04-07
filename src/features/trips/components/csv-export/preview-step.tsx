'use client';

import { ChevronLeft, Download, FileSpreadsheet, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { EXPORT_COLUMNS } from './csv-export-constants';
import type {
  PayerOption,
  BillingVariantOption
} from '@/features/trips/types/trip-form-reference.types';

interface PreviewStepProps {
  payerId: string | null;
  billingTypeId: string | null;
  dateFrom: string;
  dateTo: string;
  selectedColumns: string[];
  payers: PayerOption[];
  billingVariants: BillingVariantOption[];
  previewCount: number | null;
  isLoadingPreview: boolean;
  sampleTrips: Array<Record<string, unknown>>;
  onBack: () => void;
  onExport: () => void;
  isExporting: boolean;
}

/**
 * Step 4: Export Preview - Data Table View
 *
 * Shows actual sample data rows in a table format with selected columns.
 * Displays up to 5 sample rows so users can verify the export data before downloading.
 */
export function PreviewStep({
  payerId,
  billingTypeId,
  dateFrom,
  dateTo,
  selectedColumns,
  payers,
  billingVariants,
  previewCount,
  isLoadingPreview,
  sampleTrips,
  onBack,
  onExport,
  isExporting
}: PreviewStepProps) {
  const selectedPayer = payers.find((p) => p.id === payerId);
  const selectedBillingVariant = billingVariants.find(
    (v) => v.id === billingTypeId
  );

  // Get column definitions for selected columns
  const selectedColumnDefs = selectedColumns
    .map((key) => EXPORT_COLUMNS.find((c) => c.key === key))
    .filter(Boolean);

  // Format date for display (YYYY-MM-DD -> DD.MM.YYYY)
  const formatDisplayDate = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-');
    return `${day}.${month}.${year}`;
  };

  // Helper to format cell value for display
  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
    if (typeof value === 'object') {
      // Handle joined data objects
      if (Array.isArray(value)) return JSON.stringify(value);
      return JSON.stringify(value);
    }
    return String(value);
  };

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* Export Summary Header */}
      <div className='bg-muted shrink-0 space-y-2 rounded-lg p-3'>
        <div className='flex items-center justify-between'>
          <h3 className='flex items-center gap-2 text-sm font-medium'>
            <FileSpreadsheet className='h-4 w-4 text-emerald-600' />
            Export-Vorschau
          </h3>
          <Badge
            variant={
              previewCount !== null && previewCount > 0
                ? 'default'
                : 'destructive'
            }
          >
            {isLoadingPreview ? (
              <span className='flex items-center gap-1'>
                <span className='h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent' />
                Lade...
              </span>
            ) : previewCount !== null ? (
              `${previewCount} ${previewCount === 1 ? 'Fahrt' : 'Fahrten'}`
            ) : (
              'Unbekannt'
            )}
          </Badge>
        </div>

        {/* Selected filters summary */}
        <p className='text-muted-foreground text-xs'>
          {selectedPayer ? selectedPayer.name : 'Alle Kostenträger'}
          {billingTypeId &&
            selectedBillingVariant &&
            ` · ${selectedBillingVariant.billing_type_name} · ${selectedBillingVariant.name}`}
          {` · ${formatDisplayDate(dateFrom)} - ${formatDisplayDate(dateTo)}`}
        </p>
      </div>

      {/* Scrollable Content Area */}
      <div className='my-4 min-h-0 flex-1'>
        {/* Data Table Preview */}
        {isLoadingPreview ? (
          <div className='flex h-full flex-col items-center justify-center rounded-md border py-8'>
            <span className='h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent' />
            <p className='text-muted-foreground mt-4 text-sm'>
              Lade Vorschau-Daten...
            </p>
          </div>
        ) : sampleTrips.length > 0 ? (
          <div className='flex h-full flex-col space-y-2'>
            <div className='flex shrink-0 items-center gap-2'>
              <Table2 className='text-muted-foreground h-4 w-4' />
              <span className='text-sm font-medium'>
                Vorschau (erste 5 Zeilen)
              </span>
            </div>

            <ScrollArea className='max-w-full flex-1 overflow-hidden rounded-md border'>
              <div className='w-max'>
                <Table>
                  <TableHeader className='bg-background sticky top-0 z-10'>
                    <TableRow>
                      {selectedColumnDefs.map((col) => (
                        <TableHead
                          key={col!.key}
                          className='px-3 text-xs whitespace-nowrap'
                        >
                          {col!.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sampleTrips.map((trip, index) => (
                      <TableRow key={index}>
                        {selectedColumnDefs.map((col) => {
                          const value = trip[col!.key];
                          return (
                            <TableCell
                              key={col!.key}
                              className='px-3 py-2 text-xs'
                            >
                              <div
                                className='max-w-[200px] truncate'
                                title={formatCellValue(value)}
                              >
                                {formatCellValue(value)}
                              </div>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ScrollBar orientation='horizontal' />
            </ScrollArea>

            {previewCount !== null && previewCount > 5 && (
              <p className='text-muted-foreground shrink-0 text-center text-xs'>
                ... und {previewCount - 5} weitere Zeilen
              </p>
            )}
          </div>
        ) : (
          <div className='flex h-full flex-col items-center justify-center rounded-md border bg-amber-50 py-8'>
            <p className='text-sm text-amber-800'>
              Keine Fahrten gefunden für die ausgewählten Filter.
            </p>
            <p className='mt-1 text-xs text-amber-700'>
              Bitte passen Sie den Zeitraum oder die Filter an.
            </p>
          </div>
        )}
      </div>

      {/* Navigation buttons - Fixed at bottom */}
      <div className='flex shrink-0 gap-2'>
        <Button
          type='button'
          variant='outline'
          className='min-w-0 flex-1'
          onClick={onBack}
          disabled={isExporting}
        >
          <ChevronLeft className='mr-1 h-4 w-4' />
          Zurück
        </Button>
        <Button
          type='button'
          className='min-w-0 flex-1'
          onClick={onExport}
          disabled={isExporting || previewCount === 0 || previewCount === null}
        >
          {isExporting ? (
            <>
              <span className='mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
              Wird exportiert...
            </>
          ) : (
            <>
              <Download className='mr-1 h-4 w-4' />
              Exportieren
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
