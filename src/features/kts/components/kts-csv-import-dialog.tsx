'use client';

import { useCallback, useState } from 'react';
import Papa from 'papaparse';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

import { FileUploader } from '@/components/file-uploader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
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
import { useKtsCsvImport } from '@/features/kts/hooks/use-kts-csv-import';
import type { KtsMatchPreviewRow } from '@/features/kts/lib/kts-csv-import-utils';
import {
  INVALID_KTS_ACCOUNTANT_CSV_MESSAGE,
  parseKtsCsvRows,
  validateKtsAccountantCsvHeaders
} from '@/features/kts/lib/kts-csv-import-utils';
import { KTS_STATUS_LABELS, ktsStatusBadge } from '@/lib/kts-status';
import { parseScheduledAtOrFallback } from '@/features/trips/lib/trip-time';
import type { KtsStatus } from '@/features/kts/kts.service';

interface KtsCsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className='flex flex-col items-center justify-center py-12'>
      <span className='border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent' />
      <p className='text-muted-foreground mt-4 text-sm'>{label}</p>
    </div>
  );
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

function formatTripDate(iso: string | null): string {
  if (!iso) return '—';
  const parsed = parseScheduledAtOrFallback(iso);
  if (!parsed) return '—';
  try {
    return format(new Date(`${parsed.ymd}T12:00:00`), 'dd.MM.yyyy', {
      locale: de
    });
  } catch {
    return parsed.ymd;
  }
}

function StatusBadge({ status }: { status: KtsStatus | null }) {
  if (!status) return <span className='text-muted-foreground'>—</span>;
  return (
    <Badge className={ktsStatusBadge({ status })}>
      {KTS_STATUS_LABELS[status]}
    </Badge>
  );
}

interface PreviewSectionProps {
  title: string;
  description?: string;
  rows: KtsMatchPreviewRow[];
  selectable?: 'matched' | 'lowConfidence' | false;
  selectedIds?: Set<string>;
  onToggleMatched?: (rowKey: string, selected: boolean) => void;
  onToggleLowConfidence?: (rowKey: string) => void;
  showReason?: boolean;
  showExistingBeleg?: boolean;
}

function PreviewSection({
  title,
  description,
  rows,
  selectable = false,
  selectedIds,
  onToggleMatched,
  onToggleLowConfidence,
  showReason = false,
  showExistingBeleg = false
}: PreviewSectionProps) {
  if (rows.length === 0) return null;

  return (
    <div className='space-y-2'>
      <div>
        <h3 className='text-sm font-medium'>{title}</h3>
        {description ? (
          <p className='text-muted-foreground text-xs'>{description}</p>
        ) : null}
      </div>
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              {selectable ? <TableHead className='w-10' /> : null}
              <TableHead>Datum</TableHead>
              <TableHead>Fahrgast</TableHead>
              <TableHead>Belegnummer</TableHead>
              <TableHead className='text-right'>Gesamtpreis</TableHead>
              <TableHead className='text-right'>Eigenanteil</TableHead>
              <TableHead>Status</TableHead>
              {showReason ? <TableHead>Grund</TableHead> : null}
              {showExistingBeleg ? <TableHead>Vorhanden</TableHead> : null}
              <TableHead>Hinweis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const checked = selectedIds?.has(row.rowKey) ?? false;
              return (
                <TableRow key={row.rowKey}>
                  {selectable === 'matched' ? (
                    <TableCell>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          onToggleMatched?.(row.rowKey, v === true)
                        }
                        aria-label='Fahrt importieren'
                      />
                    </TableCell>
                  ) : selectable === 'lowConfidence' ? (
                    <TableCell>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          onToggleLowConfidence?.(row.rowKey)
                        }
                        aria-label='Fahrt importieren'
                      />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {row.tripScheduledAt
                      ? formatTripDate(row.tripScheduledAt)
                      : row.transportdatum}
                  </TableCell>
                  <TableCell>{row.tripPassengerName ?? row.patient}</TableCell>
                  <TableCell className='font-mono text-xs'>
                    {row.belegnummer}
                  </TableCell>
                  <TableCell className='text-right'>
                    {formatEur(row.gesamtpreis)}
                  </TableCell>
                  <TableCell className='text-right'>
                    {formatEur(row.eigenanteil)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.ktsStatus} />
                  </TableCell>
                  {showReason ? (
                    <TableCell className='text-muted-foreground text-xs'>
                      {row.lowConfidenceReason ?? '—'}
                    </TableCell>
                  ) : null}
                  {showExistingBeleg ? (
                    <TableCell className='font-mono text-xs'>
                      {row.existingBelegnummer ?? '—'}
                    </TableCell>
                  ) : null}
                  <TableCell className='text-muted-foreground max-w-[220px] text-xs'>
                    {row.notUebergebenHint
                      ? 'Diese Fahrt ist nicht als übergeben markiert — bitte manuell prüfen'
                      : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function KtsCsvImportDialog({
  open,
  onOpenChange
}: KtsCsvImportDialogProps) {
  const {
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
    isConfirming
  } = useKtsCsvImport();
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setUploadError(null);
      onReset();
    }
    onOpenChange(next);
  };

  const handleCsvUpload = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      setUploadError(null);

      await new Promise<void>((resolve) => {
        Papa.parse<Record<string, string>>(file, {
          delimiter: ';',
          header: true,
          skipEmptyLines: true,
          // Windows-1252 encoding is standard for German KV billing software
          // (Dampsoft, etc.) — without this, Umlaute (ä/ö/ü/Ä/Ö/Ü/ß) are corrupted
          // to "?" on UTF-8 parse.
          encoding: 'windows-1252',
          complete: (results) => {
            try {
              validateKtsAccountantCsvHeaders(results.meta.fields);
              const rows = parseKtsCsvRows(results.data);
              if (rows.length === 0) {
                throw new Error(INVALID_KTS_ACCOUNTANT_CSV_MESSAGE);
              }
              const utf8Csv = new File(
                [Papa.unparse(results.data, { delimiter: ';' })],
                file.name,
                { type: 'text/csv;charset=utf-8' }
              );
              onFileDrop([utf8Csv]);
            } catch {
              setUploadError(INVALID_KTS_ACCOUNTANT_CSV_MESSAGE);
            }
            resolve();
          },
          error: () => {
            setUploadError(INVALID_KTS_ACCOUNTANT_CSV_MESSAGE);
            resolve();
          }
        });
      });
    },
    [onFileDrop]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='flex max-h-[90vh] w-[95vw] !max-w-[1400px] flex-col gap-0 p-0'>
        <DialogHeader className='shrink-0 px-6 pt-6 pb-4'>
          <DialogTitle>KTS-Abrechnung importieren</DialogTitle>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
          {step === 'idle' && (
            <div className='space-y-4'>
              {uploadError ? (
                <p className='text-destructive text-sm' role='alert'>
                  {uploadError}
                </p>
              ) : null}
              <FileUploader
                accept={{ 'text/csv': ['.csv'] }}
                maxFiles={1}
                maxSize={1024 * 1024 * 10}
                onUpload={handleCsvUpload}
              />
              <p className='text-muted-foreground text-xs'>
                Steuerberater-CSV hochladen (.csv, Semikolon-getrennt)
              </p>
            </div>
          )}

          {step === 'loading' && loadError ? (
            <div className='space-y-4 py-8 text-center'>
              <p className='text-destructive text-sm' role='alert'>
                {loadError}
              </p>
              <Button type='button' variant='outline' onClick={onRetry}>
                Erneut versuchen
              </Button>
            </div>
          ) : null}

          {step === 'loading' && !loadError ? (
            <LoadingState label='Fahrten werden geladen und abgeglichen…' />
          ) : null}

          {step === 'reviewing' && matchResult ? (
            <div className='space-y-6'>
              {confirmError ? (
                <p className='text-destructive text-sm' role='alert'>
                  {confirmError}
                </p>
              ) : null}

              <PreviewSection
                title={`Zugeordnet (${matchResult.matched.length})`}
                rows={matchResult.matched}
                selectable='matched'
                selectedIds={selectedMatchedIds}
                onToggleMatched={toggleMatchedRow}
              />

              <PreviewSection
                title={`Niedrige Konfidenz (${matchResult.lowConfidence.length})`}
                rows={matchResult.lowConfidence}
                selectable='lowConfidence'
                selectedIds={selectedLowConfidenceIds}
                onToggleLowConfidence={toggleLowConfidenceRow}
                showReason
              />

              <PreviewSection
                title={`Nicht zugeordnet (${matchResult.unmatched.length})`}
                description='Diese Zeilen konnten keiner Fahrt zugeordnet werden. Manuelle Zuordnung folgt in einem späteren Update.'
                rows={matchResult.unmatched}
                selectable={false}
              />

              <PreviewSection
                title={`Bereits importiert (${matchResult.bereitsImportiert.length})`}
                description='Diese Fahrten wurden bereits importiert und werden übersprungen.'
                rows={matchResult.bereitsImportiert}
                selectable={false}
                showExistingBeleg
              />
            </div>
          ) : null}

          {step === 'confirming' ? (
            <LoadingState label='Import wird durchgeführt…' />
          ) : null}

          {step === 'done' ? (
            <div className='space-y-3 py-4'>
              <p className='text-sm'>
                {doneCounts.stamped} Fahrt
                {doneCounts.stamped === 1 ? '' : 'en'} erfolgreich importiert
              </p>
              <p className='text-muted-foreground text-sm'>
                {doneCounts.skipped} Fahrt
                {doneCounts.skipped === 1 ? '' : 'en'} übersprungen (bereits
                importiert)
              </p>
              <p className='text-muted-foreground text-sm'>
                {doneCounts.unmatched} Fahrt
                {doneCounts.unmatched === 1 ? '' : 'en'} nicht zugeordnet
              </p>
            </div>
          ) : null}
        </div>

        {step === 'reviewing' ? (
          <div className='border-border flex shrink-0 justify-end gap-3 border-t px-6 py-4'>
            <Button
              type='button'
              variant='ghost'
              onClick={() => handleOpenChange(false)}
            >
              Abbrechen
            </Button>
            <Button
              type='button'
              disabled={selectedImportCount === 0 || isConfirming}
              onClick={() => void onConfirm()}
            >
              Importieren ({selectedImportCount} Fahrten)
            </Button>
          </div>
        ) : null}

        {step === 'done' ? (
          <div className='border-border flex shrink-0 justify-end border-t px-6 py-4'>
            <Button type='button' onClick={() => handleOpenChange(false)}>
              Schließen
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
