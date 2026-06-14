'use client';

import * as React from 'react';
import type { Table as TanstackTable } from '@tanstack/react-table';
import { toast } from 'sonner';

import { Icons } from '@/components/icons';
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
import { useCreateKtsHandoverMutation } from '@/features/kts/hooks/use-kts-status';
import { KTS_STATUS_KORREKT } from '@/features/kts/kts.service';
import type { KtsTripRow } from '@/features/kts/types/kts-trip-row';

interface KtsHandoverBulkBarProps {
  table: TanstackTable<KtsTripRow>;
}

export function KtsHandoverBulkBar({ table }: KtsHandoverBulkBarProps) {
  const handoverMutation = useCreateKtsHandoverMutation();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const selectedRows = table.getSelectedRowModel().rows;
  const count = selectedRows.length;
  const korrektTripIds = selectedRows
    .filter((r) => r.original.kts_status === KTS_STATUS_KORREKT)
    .map((r) => r.original.id);

  React.useEffect(() => {
    if (count === 0) {
      setConfirmOpen(false);
      setErrorMessage(null);
    }
  }, [count]);

  if (count === 0) return null;

  const handleClear = (): void => {
    table.resetRowSelection();
  };

  const handleOpenConfirm = (): void => {
    setErrorMessage(null);
    setConfirmOpen(true);
  };

  const handleConfirmHandover = async (): Promise<void> => {
    if (korrektTripIds.length === 0) return;

    try {
      setErrorMessage(null);
      await handoverMutation.mutateAsync({ tripIds: korrektTripIds });
      toast.success(
        korrektTripIds.length === 1
          ? 'KTS-Beleg wurde an die Buchhaltung übergeben.'
          : `${korrektTripIds.length} KTS-Belege wurden an die Buchhaltung übergeben.`
      );
      table.resetRowSelection();
      setConfirmOpen(false);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Übergabe konnte nicht erstellt werden.';
      setErrorMessage(message);
    }
  };

  const isPending = handoverMutation.isPending;

  return (
    <>
      <div className='flex flex-wrap items-center justify-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-8 gap-1.5'
          disabled={isPending}
          onClick={handleClear}
        >
          <Icons.close className='size-3.5' />
          Auswahl aufheben
        </Button>
        <Button
          type='button'
          variant='default'
          size='sm'
          className='h-8 gap-1.5'
          disabled={isPending || korrektTripIds.length === 0}
          onClick={handleOpenConfirm}
        >
          <Icons.post className='size-3.5' />
          Übergabe erstellen
        </Button>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (open) setErrorMessage(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Übergabe an Buchhaltung</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className='space-y-2 text-sm'>
                <p>
                  {korrektTripIds.length === 1
                    ? 'Einen KTS-Beleg an die Buchhaltung übergeben?'
                    : `${korrektTripIds.length} KTS-Belege an die Buchhaltung übergeben?`}
                </p>
                <p className='text-muted-foreground'>
                  Nur Belege mit Status „Korrekt“ auf der aktuellen Seite werden
                  übergeben.
                </p>
                {errorMessage ? (
                  <p className='text-destructive text-sm'>{errorMessage}</p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              Abbrechen
            </AlertDialogCancel>
            <Button
              type='button'
              disabled={isPending || korrektTripIds.length === 0}
              onClick={() => void handleConfirmHandover()}
            >
              {isPending ? (
                <>
                  <Icons.spinner className='size-3.5 animate-spin' />
                  Übergabe…
                </>
              ) : (
                'Übergabe bestätigen'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
