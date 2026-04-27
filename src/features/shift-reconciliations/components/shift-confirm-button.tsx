'use client';

import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useConfirmShift } from '../hooks/use-confirm-shift';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { parseYmdToLocalDate } from '@/lib/date-ymd';

type ShiftConfirmButtonProps = {
  driverId: string | null;
  driverName: string;
  dateYmd: string;
  alreadyConfirmed: boolean;
  /** Runs after a successful confirm (e.g. navigate back to list). */
  onConfirmed?: () => void;
};

export function ShiftConfirmButton({
  driverId,
  driverName,
  dateYmd,
  alreadyConfirmed,
  onConfirmed
}: ShiftConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const mutation = useConfirmShift(driverId ?? '', dateYmd);

  const onConfirm = () => {
    if (!driverId) return;
    void mutation.mutateAsync(
      { driverId, date: dateYmd, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          setOpen(false);
          setNotes('');
          onConfirmed?.();
        }
      }
    );
  };

  const dateLabel = (() => {
    try {
      const d = parseYmdToLocalDate(dateYmd);
      return d ? format(d, 'EEEE, d. MMMM yyyy', { locale: de }) : dateYmd;
    } catch {
      return dateYmd;
    }
  })();

  return (
    <>
      <Button
        className='w-full sm:w-auto'
        onClick={() => setOpen(true)}
        disabled={!driverId || alreadyConfirmed || mutation.isPending}
        size='lg'
      >
        {alreadyConfirmed ? 'Bereits bestätigt' : 'Schicht bestätigen'}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Schicht bestätigen</AlertDialogTitle>
            <AlertDialogDescription>
              Schicht für {driverName} am {dateLabel} als geprüft markieren?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='space-y-2 py-1'>
            <Label htmlFor='sr-confirm-notes'>
              Abweichungen oder Anmerkungen (optional)
            </Label>
            <Textarea
              id='sr-confirm-notes'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className='resize-none'
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              Abbrechen
            </AlertDialogCancel>
            <Button onClick={() => onConfirm()} disabled={mutation.isPending}>
              {mutation.isPending ? 'Speichert…' : 'Bestätigen'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
