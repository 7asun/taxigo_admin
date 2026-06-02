'use client';

import { FileUploader } from '@/components/file-uploader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { useZahlungsabgleich } from '../hooks/use-zahlungsabgleich';
import { countManualReviewWarnings, ReviewTable } from './review-table';
import { WarningRowsDialog } from './warning-rows-dialog';
import { useState } from 'react';

interface ZahlungsabgleichDialogProps {
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

export function ZahlungsabgleichDialog({
  open,
  onOpenChange
}: ZahlungsabgleichDialogProps) {
  const [warningOpen, setWarningOpen] = useState(false);

  const {
    step,
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
    ignoredCount,
    error,
    results,
    warningConfirmResults,
    isWarningConfirming,
    isConfirming
  } = useZahlungsabgleich(open);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      onReset();
      setWarningOpen(false);
    }
    onOpenChange(next);
  };

  const selectedReadyCount = readyRows.filter((r) =>
    selectedReadyIds.has(r.rowKey)
  ).length;

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;
  const totalAttempted = results.length;
  const hasPartialFailure = failureCount > 0;
  const manualReviewCount = countManualReviewWarnings(warningRows);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className='flex max-h-[90vh] w-[95vw] !max-w-[1400px] flex-col gap-0 p-0'>
          <DialogHeader className='shrink-0 px-6 pt-6 pb-4'>
            <DialogTitle>Zahlungsabgleich</DialogTitle>
          </DialogHeader>

          <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
            {step === 'idle' && (
              <div className='space-y-4'>
                {error && (
                  <p className='text-destructive text-sm' role='alert'>
                    {error}
                  </p>
                )}
                <FileUploader
                  accept={{ 'text/csv': ['.csv'] }}
                  maxFiles={1}
                  maxSize={1024 * 1024 * 5}
                  onUpload={onFileDrop}
                />
                <p className='text-muted-foreground text-xs'>
                  Kontoauszug hochladen (.csv) — Sparkasse/CAMT052,
                  Semikolon-getrennt
                </p>
              </div>
            )}

            {step === 'loading' && <LoadingState label='Wird analysiert…' />}

            {step === 'reviewing' && (
              <ReviewTable
                readyRows={readyRows}
                selectedReadyIds={selectedReadyIds}
                warningRows={warningRows}
                ignoredCount={ignoredCount}
                onToggleRow={toggleRow}
              />
            )}

            {step === 'confirming' && (
              <LoadingState label='Wird gespeichert…' />
            )}

            {step === 'done' && (
              <div className='space-y-4'>
                {hasPartialFailure ? (
                  <>
                    <p className='text-sm'>
                      {successCount} von {totalAttempted} erfolgreich.{' '}
                      {failureCount} Fehler — bitte manuell prüfen:
                    </p>
                    <ul className='list-inside list-disc text-sm'>
                      {results
                        .filter((r) => !r.success)
                        .map((r) => (
                          <li key={r.invoiceId} className='font-mono'>
                            {r.invoiceNumber}
                            {r.error ? (
                              <span className='text-muted-foreground font-sans'>
                                {' '}
                                — {r.error}
                              </span>
                            ) : null}
                          </li>
                        ))}
                    </ul>
                  </>
                ) : (
                  <p className='text-sm'>
                    {successCount} Rechnung{successCount === 1 ? '' : 'en'}{' '}
                    wurden als bezahlt markiert.
                  </p>
                )}
              </div>
            )}
          </div>

          {step === 'reviewing' && (
            <div className='border-border flex shrink-0 flex-wrap items-center gap-2 border-t px-6 py-4'>
              {manualReviewCount > 0 && (
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => setWarningOpen(true)}
                >
                  Manuelle Prüfung anzeigen ({manualReviewCount})
                </Button>
              )}
              <div className='ml-auto flex gap-3'>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => handleOpenChange(false)}
                >
                  Abbrechen
                </Button>
                <Button
                  type='button'
                  disabled={selectedReadyCount === 0 || isConfirming}
                  onClick={() => void onConfirm()}
                >
                  {selectedReadyCount} Rechnung
                  {selectedReadyCount === 1 ? '' : 'en'} als bezahlt markieren
                </Button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className='border-border flex shrink-0 justify-end border-t px-6 py-4'>
              <Button type='button' onClick={() => handleOpenChange(false)}>
                Schließen
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <WarningRowsDialog
        rows={warningRows}
        open={warningOpen}
        onOpenChange={setWarningOpen}
        selectedWarningIds={selectedWarningIds}
        onToggleWarningRow={toggleWarningRow}
        onConfirmWarning={() => void onConfirmWarning()}
        isConfirming={isWarningConfirming}
        confirmResults={warningConfirmResults}
      />
    </>
  );
}
