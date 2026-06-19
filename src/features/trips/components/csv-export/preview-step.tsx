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
import { EXPORT_COLUMN_DEFS } from '@/features/trips/lib/export-columns.registry';
import { KTS_FILTER_OPTION_ROWS } from '@/features/trips/lib/kts-filter';
import type { ExportFilters } from '@/features/trips/types/csv-export.types';
import type {
  PayerOption,
  BillingVariantOption
} from '@/features/trips/types/trip-form-reference.types';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Offen',
  assigned: 'Zugewiesen',
  in_progress: 'In Fahrt',
  completed: 'Abgeschlossen',
  cancelled: 'Storniert'
};

interface PreviewStepProps {
  filters: ExportFilters;
  selectedColumns: string[];
  payers: PayerOption[];
  billingVariants: BillingVariantOption[];
  previewCount: number | null;
  isLoadingPreview: boolean;
  sampleTrips: Array<Record<string, unknown>>;
  showBack?: boolean;
  onBack: () => void;
  onExport: () => void;
  isExporting: boolean;
}

function formatDisplayDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}.${month}.${year}`;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return JSON.stringify(value);
    return JSON.stringify(value);
  }
  return String(value);
}

function buildFilterSummary(
  filters: ExportFilters,
  payers: PayerOption[],
  billingVariants: BillingVariantOption[]
): string {
  const parts: string[] = [];

  if (filters.payerIds.length === 0) {
    parts.push('Alle Kostenträger');
  } else if (filters.payerIds.length === 1) {
    parts.push(
      payers.find((p) => p.id === filters.payerIds[0])?.name ?? '1 Kostenträger'
    );
  } else {
    parts.push(`${filters.payerIds.length} Kostenträger`);
  }

  if (filters.billingVariantIds.length === 1) {
    const variant = billingVariants.find(
      (v) => v.id === filters.billingVariantIds[0]
    );
    if (variant) {
      parts.push(`${variant.billing_type_name} · ${variant.name}`);
    }
  } else if (filters.billingVariantIds.length > 1) {
    parts.push(`${filters.billingVariantIds.length} Abrechnungsarten`);
  }

  if (filters.assigneeFilter?.type === 'unassigned') {
    parts.push('Nicht zugewiesen');
  } else if (filters.assigneeFilter?.type === 'driver') {
    parts.push('Fahrer gefiltert');
  } else if (filters.assigneeFilter?.type === 'fremdfirma') {
    parts.push('Fremdfirma gefiltert');
  }

  if (filters.statusFilter.length > 0) {
    parts.push(
      filters.statusFilter.map((s) => STATUS_LABELS[s] ?? s).join(', ')
    );
  }

  if (filters.ktsFilter.length > 0) {
    parts.push(
      filters.ktsFilter
        .map(
          (token) =>
            KTS_FILTER_OPTION_ROWS.find((row) => row.value === token)?.label ??
            token
        )
        .join(', ')
    );
  }

  parts.push(
    `${formatDisplayDate(filters.dateFrom)} - ${formatDisplayDate(filters.dateTo)}`
  );

  return parts.join(' · ');
}

export function PreviewStep({
  filters,
  selectedColumns,
  payers,
  billingVariants,
  previewCount,
  isLoadingPreview,
  sampleTrips,
  showBack = true,
  onBack,
  onExport,
  isExporting
}: PreviewStepProps) {
  const selectedColumnDefs = selectedColumns
    .map((key) => EXPORT_COLUMN_DEFS.find((c) => c.key === key))
    .filter(Boolean);

  const filterSummary = buildFilterSummary(filters, payers, billingVariants);

  return (
    <div className='flex h-full min-h-0 flex-col'>
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

        <p className='text-muted-foreground text-xs'>{filterSummary}</p>
      </div>

      <div className='my-4 min-h-0 flex-1'>
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

      <div className='flex shrink-0 gap-2'>
        {showBack ? (
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
        ) : null}
        <Button
          type='button'
          className='min-w-0 flex-1'
          onClick={onExport}
          disabled={
            // Guard export until preview fetch completes (table-view cold-open lands here while loading).
            isLoadingPreview ||
            isExporting ||
            previewCount === 0 ||
            previewCount === null
          }
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
