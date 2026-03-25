'use client';

import * as React from 'react';
import type { Table as TanstackTable } from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { tripsService, type Trip } from '@/features/trips/api/trips.service';

interface TripsPaginationBulkActionsProps<TData> {
  table: TanstackTable<TData>;
}

export function TripsPaginationBulkActions<TData>({
  table
}: TripsPaginationBulkActionsProps<TData>) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const selectedRows = table.getSelectedRowModel().rows;
  const count = selectedRows.length;

  React.useEffect(() => {
    if (count === 0) setConfirmOpen(false);
  }, [count]);

  if (count === 0) return null;

  const handleClear = (): void => {
    table.resetRowSelection();
  };

  const handleConfirmDelete = async (): Promise<void> => {
    const ids = selectedRows.map((r) => (r.original as Trip).id);
    if (ids.length === 0) return;

    try {
      setIsDeleting(true);
      await tripsService.deleteTripsPermanently(ids);
      toast.success(
        ids.length === 1
          ? 'Fahrt wurde aus der Datenbank gelöscht.'
          : `${ids.length} Fahrten wurden aus der Datenbank gelöscht.`
      );
      table.resetRowSelection();
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unbekannter Fehler beim Löschen.';
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className='flex flex-wrap items-center justify-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-8 gap-1.5'
          onClick={handleClear}
        >
          <X className='size-3.5' />
          Auswahl aufheben
        </Button>
        <Button
          type='button'
          variant='destructive'
          size='sm'
          className='h-8 gap-1.5'
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className='size-3.5' />
          Endgültig löschen
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fahrten dauerhaft löschen?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className='space-y-2 text-sm'>
                <p>
                  Sie löschen{' '}
                  <strong>
                    {count === 1 ? 'eine Fahrt' : `${count} Fahrten`}
                  </strong>{' '}
                  unwiderruflich aus der Datenbank. Das ist keine Stornierung.
                </p>
                <p>
                  Verknüpfungen und Zuweisungen werden mitentfernt bzw. gelöst.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              Abbrechen
            </AlertDialogCancel>
            <Button
              type='button'
              variant='destructive'
              disabled={isDeleting}
              onClick={() => void handleConfirmDelete()}
            >
              {isDeleting ? 'Löschen…' : 'Endgültig löschen'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
