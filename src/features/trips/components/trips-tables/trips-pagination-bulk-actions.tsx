'use client';

import * as React from 'react';
import type { Table as TanstackTable } from '@tanstack/react-table';
import { useTripsRscRefresh } from '@/features/trips/providers';
import { toast } from 'sonner';
import { Copy, Trash2, X } from 'lucide-react';

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
import { DuplicateTripsDialog } from '@/features/trips/components/trips-tables/duplicate-trips-dialog';

interface TripsPaginationBulkActionsProps<TData> {
  table: TanstackTable<TData>;
}

export function TripsPaginationBulkActions<TData>({
  table
}: TripsPaginationBulkActionsProps<TData>) {
  const { refreshTripsPage } = useTripsRscRefresh();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [duplicateOpen, setDuplicateOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const selectedRows = table.getSelectedRowModel().rows;
  const count = selectedRows.length;
  const selectedTrips = selectedRows.map((r) => r.original as Trip);

  React.useEffect(() => {
    if (count === 0) {
      setConfirmOpen(false);
      setDuplicateOpen(false);
    }
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
      void refreshTripsPage();
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
          variant='outline'
          size='sm'
          className='h-8 gap-1.5'
          onClick={() => setDuplicateOpen(true)}
        >
          <Copy className='size-3.5' />
          Duplizieren
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

      <DuplicateTripsDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        selectedTrips={selectedTrips}
        onSuccess={() => {
          table.resetRowSelection();
        }}
      />

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
