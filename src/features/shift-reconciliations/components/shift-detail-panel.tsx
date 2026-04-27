'use client';

import { useShiftReconciliationRecord } from '../hooks/use-shift-reconciliation';
import { useShiftTrips } from '../hooks/use-shift-trips';
import type { ShiftReconciliationWithMeta, ShiftTrip } from '../types';
import { ShiftConfirmButton } from './shift-confirm-button';
import { ShiftSummaryBar } from './shift-summary-bar';
import { ShiftTripsTable } from './shift-trips-table';

type ShiftDetailPanelProps = {
  driverId: string;
  dateYmd: string;
  driverName: string;
  initialTrips?: ShiftTrip[];
  initialReconciliation?: ShiftReconciliationWithMeta | null;
  /** After successful confirm: e.g. clear `date` in the URL to return to the list. */
  onAfterConfirm?: () => void;
};

export function ShiftDetailPanel({
  driverId,
  dateYmd,
  driverName,
  initialTrips,
  initialReconciliation,
  onAfterConfirm
}: ShiftDetailPanelProps) {
  const {
    data: trips = [],
    isLoading: tripsLoading,
    isFetching
  } = useShiftTrips(driverId, dateYmd, { initialData: initialTrips });

  const { data: reconciliation, isLoading: recLoading } =
    useShiftReconciliationRecord(driverId, dateYmd, {
      initialData: initialReconciliation
    });

  const listLoading = Boolean(tripsLoading || recLoading);
  const showPlaceholders = Boolean(
    listLoading || (isFetching && trips.length === 0)
  );

  return (
    <div className='space-y-6'>
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
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end'>
        <ShiftConfirmButton
          driverId={driverId}
          driverName={driverName}
          dateYmd={dateYmd}
          alreadyConfirmed={Boolean(reconciliation?.confirmed_at)}
          onConfirmed={onAfterConfirm}
        />
      </div>
    </div>
  );
}
