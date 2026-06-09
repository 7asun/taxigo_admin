'use client';

import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';

export interface ShortenEndDateDialogProps {
  newEndDate: string;
  tripCount: number;
  isOpen: boolean;
  isConfirming: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatEndDateForDisplay(ymd: string): string {
  try {
    return format(parseISO(ymd), 'dd.MM.yyyy');
  } catch {
    return ymd;
  }
}

/**
 * WHY parent skips opening when tripCount === 0: no destructive action means no
 * confirmation friction — dialog only appears when trips will actually be deleted.
 */
export function ShortenEndDateDialog({
  newEndDate,
  tripCount,
  isOpen,
  isConfirming,
  onOpenChange,
  onConfirm,
  onCancel
}: ShortenEndDateDialogProps) {
  const displayDate = formatEndDateForDisplay(newEndDate);

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isConfirming) {
          onCancel();
        }
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Enddatum verkürzen?</AlertDialogTitle>
          <AlertDialogDescription className='space-y-3 pt-2'>
            <p>
              Du verkürzt diese Regelfahrt auf{' '}
              <span className='font-medium'>{displayDate}</span>.{' '}
              <span className='font-medium'>{tripCount}</span> zukünftige
              Fahrten, die danach liegen, werden unwiderruflich gelöscht.
            </p>
            <p className='text-muted-foreground text-xs italic'>
              Bereits abgeschlossene oder stornierte Fahrten bleiben erhalten.
              Zugewiesene oder laufende Fahrten werden nicht gelöscht.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming} onClick={onCancel}>
            Abbrechen
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            disabled={isConfirming}
          >
            {isConfirming ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Wird gespeichert...
              </>
            ) : (
              'Fahrten löschen und speichern'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
