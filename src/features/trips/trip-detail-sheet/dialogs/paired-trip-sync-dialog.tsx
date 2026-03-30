'use client';

/**
 * Confirms whether edits should also apply to the linked Gegenfahrt row.
 *
 * **Details** variant: user may mirror Stammdaten, Rollstuhl, Abrechnung, Hinweise,
 * and the full route (Abholung/Ziel inkl. Stationen — swapped like a new Rückfahrt).
 * **Notes** variant: optional same notes on both legs.
 *
 * Shown only after `RecurringTripEditScopeDialog` when needed — never stacked with
 * it. See `docs/trip-detail-sheet-editing.md` and `lib/paired-trip-sync.ts`.
 */

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export type PairedTripSyncDialogVariant = 'details' | 'notes';

export interface PairedTripSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Short label for the partner leg, e.g. "Rückfahrt" or "Hinfahrt". */
  partnerLegLabel: string;
  variant?: PairedTripSyncDialogVariant;
  onCurrentTripOnly: () => void;
  onBothTrips: () => void;
  isLoading?: boolean;
  /** Optional hint when the partner row is cancelled — sync may still be desired. */
  partnerCancelled?: boolean;
}

export function PairedTripSyncDialog({
  open,
  onOpenChange,
  partnerLegLabel,
  variant = 'details',
  onCurrentTripOnly,
  onBothTrips,
  isLoading = false,
  partnerCancelled = false
}: PairedTripSyncDialogProps) {
  const isNotes = variant === 'notes';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isNotes
              ? 'Notizen auch auf Gegenfahrt übernehmen?'
              : 'Verknüpfte Gegenfahrt mit aktualisieren?'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className='space-y-3 text-sm'>
              {isNotes ? (
                <p>
                  Die verknüpfte <strong>{partnerLegLabel}</strong> kann
                  dieselben Hinweise erhalten — oder Sie speichern nur diese
                  Fahrt.
                </p>
              ) : (
                <>
                  <p>
                    Diese Fahrt ist mit einer <strong>{partnerLegLabel}</strong>{' '}
                    verknüpft. Änderungen an Fahrgast, Rollstuhl, Kostenträger,
                    Abrechnung, Abholung und Ziel (Adressen und Stationen),
                    sowie optional Hinweise können Sie auf{' '}
                    <strong>beide</strong> Zeilen anwenden.
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Auf der Gegenfahrt werden Abholung und Ziel wie bei einer
                    neuen Rückfahrt gespiegelt: was hier Abholung ist, wird dort
                    Ziel und umgekehrt. Datum und Uhrzeit bleiben je Fahrt
                    eigenständig.
                  </p>
                </>
              )}
              {partnerCancelled ? (
                <p className='text-muted-foreground text-xs'>
                  Hinweis: Die Gegenfahrt ist storniert; Sie können trotzdem
                  Stammdaten angleichen.
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className='flex-col gap-2 sm:flex-row sm:justify-end'>
          <AlertDialogCancel disabled={isLoading}>Abbrechen</AlertDialogCancel>
          <Button
            type='button'
            variant='secondary'
            disabled={isLoading}
            onClick={() => {
              onCurrentTripOnly();
            }}
          >
            {isLoading ? 'Speichern…' : 'Nur diese Fahrt'}
          </Button>
          <Button
            type='button'
            disabled={isLoading}
            onClick={() => {
              onBothTrips();
            }}
          >
            {isLoading ? 'Speichern…' : 'Diese Fahrt + Gegenfahrt'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
