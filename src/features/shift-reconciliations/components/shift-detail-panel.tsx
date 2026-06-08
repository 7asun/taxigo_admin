'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdminShiftForDriverDateAction } from '@/features/driver-planning/actions';
import { AdminShiftEntryForm } from '@/features/driver-planning/components/admin-shift-entry-form';
import { SHIFT_STATUSES } from '@/features/driver-portal/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  useCompleteReconciliation,
  useReopenReconciliation,
  useShiftReconciliationRecord,
  useShiftTrips
} from '../hooks';
import { shiftReconciliationKeys } from '../lib/query-keys';
import {
  RECONCILIATION_STATUS,
  type ShiftReconciliationWithMeta,
  type ShiftTrip
} from '../types';
import { ShiftSummaryBar } from './shift-summary-bar';
import { ShiftTripsTable } from './shift-trips-table';

type ShiftDetailPanelProps = {
  driverId: string;
  dateYmd: string;
  driverName: string;
  initialTrips?: ShiftTrip[];
  initialReconciliation?: ShiftReconciliationWithMeta | null;
  /** When false, skip client fetches (inline accordion collapsed). Default true. */
  enabled?: boolean;
  onAfterComplete?: () => void;
};

function DetailPanelSkeleton() {
  return (
    <div className='space-y-4 py-2'>
      <Skeleton className='h-10 w-full' />
      <Skeleton className='h-24 w-full' />
      <Skeleton className='h-10 w-full' />
      <Skeleton className='h-10 w-full' />
      <Skeleton className='h-10 w-full' />
    </div>
  );
}

type AbschlussTabProps = {
  driverId: string;
  dateYmd: string;
  driverName: string;
  reconciliation: ShiftReconciliationWithMeta | null | undefined;
  hasShiftRow: boolean;
  shiftIncomplete: boolean;
  onAfterComplete?: () => void;
};

function AbschlussTab({
  driverId,
  dateYmd,
  driverName,
  reconciliation,
  hasShiftRow,
  shiftIncomplete,
  onAfterComplete
}: AbschlussTabProps) {
  const [notes, setNotes] = useState(reconciliation?.notes ?? '');
  const completeMutation = useCompleteReconciliation(driverId, dateYmd);
  const reopenMutation = useReopenReconciliation(driverId, dateYmd);

  const isCompleted =
    reconciliation?.status === RECONCILIATION_STATUS.COMPLETED;

  const handleComplete = () => {
    void completeMutation.mutateAsync(
      {
        driverId,
        date: dateYmd,
        notes: notes.trim() || undefined
      },
      {
        onSuccess: (result) => {
          if (!result.success) {
            toast.error(
              result.message ?? 'Schicht konnte nicht abgeschlossen werden.'
            );
            return;
          }
          toast.success('Schicht abgeschlossen.');
          onAfterComplete?.();
        }
      }
    );
  };

  const handleReopen = () => {
    void reopenMutation.mutateAsync(undefined, {
      onSuccess: (result) => {
        if (!result.success) {
          toast.error('Schicht konnte nicht wieder geöffnet werden.');
          return;
        }
        toast.success('Schicht wieder geöffnet.');
        onAfterComplete?.();
      }
    });
  };

  if (isCompleted && reconciliation) {
    const confirmed = format(
      new Date(reconciliation.confirmed_at),
      "dd.MM.yyyy 'um' HH:mm",
      { locale: de }
    );
    const byName = reconciliation.confirmer_name?.trim() || 'Kolleg:in';

    return (
      <div className='space-y-4'>
        <div className='rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/30 dark:text-green-100'>
          Abgeschlossen von {byName} am {confirmed}
        </div>
        <Button
          type='button'
          variant='outline'
          onClick={handleReopen}
          disabled={reopenMutation.isPending}
        >
          Erneut öffnen
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <ul className='space-y-2 text-sm'>
        <li className='flex items-center gap-2'>
          <span className={hasShiftRow ? 'text-green-600' : 'text-amber-600'}>
            {hasShiftRow ? '✓' : '○'}
          </span>
          Ist-Zeit erfasst
          {!hasShiftRow && (
            <span className='text-muted-foreground text-xs'>
              (optional — nicht stundenweise bezahlt)
            </span>
          )}
        </li>
        <li className='flex items-center gap-2 text-green-600'>
          <span>✓</span>
          Fahrten geprüft
        </li>
      </ul>

      <div className='space-y-2'>
        <Label htmlFor={`sr-abschluss-notes-${dateYmd}`}>
          Abweichungen oder Anmerkungen (optional)
        </Label>
        <Textarea
          id={`sr-abschluss-notes-${dateYmd}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className='resize-none'
        />
      </div>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              <Button
                type='button'
                size='lg'
                onClick={handleComplete}
                disabled={completeMutation.isPending || shiftIncomplete}
              >
                Abschließen
              </Button>
            </span>
          </TooltipTrigger>
          {shiftIncomplete && (
            <TooltipContent>Beginn oder Ende fehlt.</TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      <p className='text-muted-foreground text-xs'>
        Schicht für {driverName} am {dateYmd} als geprüft markieren.
      </p>
    </div>
  );
}

export function ShiftDetailPanel({
  driverId,
  dateYmd,
  driverName,
  initialTrips,
  initialReconciliation,
  enabled = true,
  onAfterComplete
}: ShiftDetailPanelProps) {
  const queryClient = useQueryClient();

  const {
    data: trips = [],
    isLoading: tripsLoading,
    isFetching: tripsFetching,
    isError: tripsError,
    refetch: refetchTrips
  } = useShiftTrips(driverId, dateYmd, {
    initialData: initialTrips,
    enabled
  });

  const {
    data: reconciliation,
    isLoading: recLoading,
    isError: recError,
    refetch: refetchReconciliation
  } = useShiftReconciliationRecord(driverId, dateYmd, {
    initialData: initialReconciliation,
    enabled
  });

  const { data: adminShift } = useQuery({
    queryKey: ['admin-shift', driverId, dateYmd],
    queryFn: () => getAdminShiftForDriverDateAction(driverId, dateYmd),
    enabled
  });

  const listLoading = Boolean(tripsLoading || recLoading);
  const showPlaceholders = Boolean(
    listLoading || (tripsFetching && trips.length === 0)
  );
  const hasFetchError = tripsError || recError;

  const hasShiftRow = adminShift != null;
  const shiftIncomplete =
    hasShiftRow && adminShift?.status !== SHIFT_STATUSES.ENDED;

  const handleShiftSaved = () => {
    void queryClient.invalidateQueries({
      queryKey: ['admin-shift', driverId, dateYmd]
    });
    void queryClient.invalidateQueries({
      queryKey: shiftReconciliationKeys.summaries(driverId)
    });
    void queryClient.invalidateQueries({
      queryKey: shiftReconciliationKeys.record(driverId, dateYmd)
    });
  };

  const handleRetry = () => {
    void refetchTrips();
    void refetchReconciliation();
  };

  if (!enabled) {
    return null;
  }

  if (hasFetchError) {
    return (
      <div className='border-destructive/30 bg-destructive/5 space-y-3 rounded-md border px-4 py-6 text-center'>
        <p className='text-destructive text-sm'>
          Details konnten nicht geladen werden.
        </p>
        <Button type='button' variant='outline' size='sm' onClick={handleRetry}>
          Erneut versuchen
        </Button>
      </div>
    );
  }

  if (listLoading && trips.length === 0 && initialTrips === undefined) {
    return <DetailPanelSkeleton />;
  }

  return (
    <div className='space-y-6'>
      <Tabs defaultValue='fahrten'>
        <TabsList className='grid w-full grid-cols-4'>
          <TabsTrigger value='fahrten'>Fahrten</TabsTrigger>
          <TabsTrigger value='ist-zeit'>Ist-Zeit</TabsTrigger>
          <TabsTrigger value='kilometer'>Kilometer</TabsTrigger>
          <TabsTrigger value='abschluss'>Abschluss</TabsTrigger>
        </TabsList>

        <TabsContent value='fahrten' className='mt-6 space-y-6'>
          <ShiftSummaryBar
            trips={trips}
            reconciliation={reconciliation}
            isLoading={listLoading && trips.length === 0}
          />
          <ShiftTripsTable
            trips={trips}
            driverId={driverId}
            dateYmd={dateYmd}
            isLoading={showPlaceholders}
          />
        </TabsContent>

        <TabsContent value='ist-zeit' className='mt-6'>
          <AdminShiftEntryForm
            driverId={driverId}
            date={dateYmd}
            showDateField={false}
            onSaved={handleShiftSaved}
          />
        </TabsContent>

        <TabsContent value='kilometer' className='mt-6'>
          {/* Phase B: vehicle_shift_logs tab — full form replaces this placeholder */}
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Kilometer</CardTitle>
            </CardHeader>
            <CardContent>
              <p className='text-muted-foreground text-sm'>
                Fahrtenbuch-Erfassung folgt in Phase B.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='abschluss' className='mt-6'>
          <AbschlussTab
            driverId={driverId}
            dateYmd={dateYmd}
            driverName={driverName}
            reconciliation={reconciliation}
            hasShiftRow={hasShiftRow}
            shiftIncomplete={shiftIncomplete}
            onAfterComplete={onAfterComplete}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
