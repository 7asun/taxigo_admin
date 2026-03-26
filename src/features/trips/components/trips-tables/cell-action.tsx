'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Ban,
  CalendarRange,
  Edit,
  MoreHorizontal,
  Eye,
  Share2,
  Trash2
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { TripDetailSheet } from '@/features/overview/components/trip-detail-sheet';
import { useTripsRscRefresh } from '@/features/trips/providers';
import type { Trip } from '@/features/trips/api/trips.service';
import { tripsService } from '@/features/trips/api/trips.service';
import { useTripCancellation } from '@/features/trips/hooks/use-trip-cancellation';
import { hasPairedLeg } from '@/features/trips/api/recurring-exceptions.actions';
import { RecurringTripCancelDialog } from '@/features/trips/components/recurring-trip-cancel-dialog';
import { copyTripToClipboard } from '@/features/trips/lib/share-utils';
import {
  TripRescheduleDialog,
  canRescheduleTrip,
  getRescheduleDisabledReason
} from '@/features/trips/trip-reschedule';
import { toast } from 'sonner';

interface CellActionProps {
  data: Trip;
}

export const CellAction: React.FC<CellActionProps> = ({ data }) => {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailTripId, setDetailTripId] = useState(data.id);

  useEffect(() => {
    if (isDetailOpen) setDetailTripId(data.id);
  }, [isDetailOpen, data.id]);
  const [isStornoDialogOpen, setIsStornoDialogOpen] = useState(false);
  const [isPermanentDeleteOpen, setIsPermanentDeleteOpen] = useState(false);
  const [isPermanentDeleting, setIsPermanentDeleting] = useState(false);
  const [hasPair, setHasPair] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const { refreshTripsPage } = useTripsRscRefresh();
  const { cancelTrip, isLoading } = useTripCancellation();

  const isRecurring = !!data.rule_id;

  const handleOpenStornoDialog = async () => {
    setIsStornoDialogOpen(true);

    try {
      const pairExists = await hasPairedLeg(data);
      setHasPair(pairExists);
    } catch {
      setHasPair(false);
    }
  };

  const handleConfirmPermanentDelete = async (): Promise<void> => {
    try {
      setIsPermanentDeleting(true);
      await tripsService.deleteTripsPermanently([data.id]);
      toast.success('Fahrt wurde aus der Datenbank gelöscht.');
      setIsPermanentDeleteOpen(false);
      void refreshTripsPage();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unbekannter Fehler beim Löschen.';
      toast.error(message);
    } finally {
      setIsPermanentDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className='h-8 w-8 p-0'>
            <span className='sr-only'>Menü öffnen</span>
            <MoreHorizontal className='h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>Aktionen</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setIsDetailOpen(true)}>
            <Eye className='mr-2 h-4 w-4' /> Details anzeigen
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Edit className='mr-2 h-4 w-4' /> Bearbeiten
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              const success = await copyTripToClipboard(data);
              if (success) {
                toast.success('Details in die Zwischenablage kopiert');
              } else {
                toast.error('Kopieren fehlgeschlagen');
              }
            }}
          >
            <Share2 className='mr-2 h-4 w-4' /> QuickShare (WhatsApp)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canRescheduleTrip(data)}
            title={getRescheduleDisabledReason(data)}
            onClick={() => setIsRescheduleOpen(true)}
          >
            <CalendarRange className='mr-2 h-4 w-4' /> Verschieben
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              handleOpenStornoDialog();
            }}
            className='text-destructive focus:text-destructive'
          >
            <Ban className='mr-2 h-4 w-4' /> Stornieren
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setIsPermanentDeleteOpen(true)}
            className='text-destructive focus:text-destructive'
          >
            <Trash2 className='mr-2 h-4 w-4' /> Endgültig löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TripDetailSheet
        isOpen={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        tripId={detailTripId}
        onNavigateToTrip={setDetailTripId}
      />

      <TripRescheduleDialog
        trip={data}
        open={isRescheduleOpen}
        onOpenChange={setIsRescheduleOpen}
      />

      <RecurringTripCancelDialog
        trip={data}
        hasPair={hasPair}
        isOpen={isStornoDialogOpen}
        isLoading={isLoading}
        title='Fahrt stornieren?'
        description='Möchten Sie diese Fahrt wirklich stornieren?'
        onOpenChange={setIsStornoDialogOpen}
        onConfirmSingle={(reason) => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          cancelTrip(
            data,
            isRecurring ? 'skip-occurrence' : 'single-nonrecurring',
            {
              source: 'Manually cancelled via Trips Table',
              reason
            }
          ).finally(() => setIsStornoDialogOpen(false));
        }}
        onConfirmWithPair={
          hasPair
            ? (reason) => {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                cancelTrip(
                  data,
                  isRecurring
                    ? 'skip-occurrence-and-paired'
                    : 'cancel-nonrecurring-and-paired',
                  {
                    source: 'Manually cancelled (Hin/Rück) via Trips Table',
                    reason
                  }
                ).finally(() => setIsStornoDialogOpen(false));
              }
            : undefined
        }
        onConfirmSeries={
          isRecurring
            ? (reason) => {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                cancelTrip(data, 'cancel-series', {
                  source: 'Recurring series cancelled via Trips Table',
                  reason
                }).finally(() => setIsStornoDialogOpen(false));
              }
            : undefined
        }
        singleLabel={
          isRecurring
            ? 'Nur diese Fahrt stornieren (Aussetzen)'
            : hasPair
              ? 'Nur diese Fahrt stornieren'
              : 'Stornieren'
        }
        pairLabel='Diese Fahrt & Rückfahrt stornieren'
        seriesLabel='Gesamte Serie beenden'
      />

      <AlertDialog
        open={isPermanentDeleteOpen}
        onOpenChange={setIsPermanentDeleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fahrt endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className='space-y-2 text-sm'>
                <p>
                  Sie löschen diese Fahrt <strong>unwiderruflich</strong> aus
                  der Datenbank. Das ist keine Stornierung: der Eintrag
                  verschwindet vollständig.
                </p>
                <p>
                  Verknüpfungen und Zuweisungen zu dieser Fahrt werden
                  mitentfernt bzw. gelöst.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPermanentDeleting}>
              Abbrechen
            </AlertDialogCancel>
            <Button
              type='button'
              variant='destructive'
              disabled={isPermanentDeleting}
              onClick={() => void handleConfirmPermanentDelete()}
            >
              {isPermanentDeleting ? 'Löschen…' : 'Endgültig löschen'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
