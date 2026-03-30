'use client';

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

export interface RecurringTripEditScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Apply changes only to this materialized trip row. */
  onConfirmThisTripOnly: () => void;
  /**
   * Serie-wide edit — product may defer to Stammdaten / rule UI until backend exists.
   */
  onConfirmSeries?: () => void;
  isLoading?: boolean;
}

/**
 * Before persisting edits on a recurring (`rule_id`) trip, confirm scope — mirrors
 * cancellation branching (single vs series) from `RecurringTripCancelDialog`.
 */
export function RecurringTripEditScopeDialog({
  open,
  onOpenChange,
  onConfirmThisTripOnly,
  onConfirmSeries,
  isLoading = false
}: RecurringTripEditScopeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Änderungen speichern?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className='space-y-3 text-sm'>
              <p>
                Diese Fahrt gehört zu einer{' '}
                <strong>wiederkehrenden Serie</strong>. Wie sollen Ihre
                Änderungen angewendet werden?
              </p>
              <div className='bg-muted/50 rounded-md border border-amber-200/40 p-3 text-amber-800 dark:text-amber-200'>
                <span className='mb-1 block font-semibold'>
                  Nur diese Fahrt
                </span>
                Aktualisiert nur den Termin an diesem Datum (eine Zeile in der
                Datenbank).
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className='flex-col gap-2 sm:flex-row sm:justify-end'>
          <AlertDialogCancel disabled={isLoading}>Abbrechen</AlertDialogCancel>
          {onConfirmSeries && (
            <Button
              type='button'
              variant='secondary'
              disabled={isLoading}
              onClick={() => {
                onConfirmSeries();
              }}
            >
              Gesamte Serie
            </Button>
          )}
          <Button
            type='button'
            disabled={isLoading}
            onClick={() => {
              onConfirmThisTripOnly();
            }}
          >
            {isLoading ? 'Speichern…' : 'Nur diese Fahrt'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
