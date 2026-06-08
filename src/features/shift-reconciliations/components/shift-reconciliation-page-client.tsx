'use client';

/**
 * URL: State A = no driver. State B = driver list (two-row inline days).
 * State C = `?driver&date&mode=detail` — full-page detail (RSC prefetches bundle).
 */

import { useMemo } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import type { DriverListItem } from '../api/shift-reconciliations.service';
import type {
  ShiftDaySummary,
  ShiftReconciliationWithMeta,
  ShiftTrip
} from '../types';
import { ShiftDayList } from './shift-day-list';
import { ShiftDetailPanel } from './shift-detail-panel';
import { ShiftReconciliationFilters } from './shift-reconciliation-filters';

export type InitialShiftBundle = {
  driverId: string;
  dateYmd: string;
  trips: ShiftTrip[];
  reconciliation: ShiftReconciliationWithMeta | null;
};

export type InitialSummariesBundle = {
  driverId: string;
  summaries: ShiftDaySummary[];
};

type ShiftReconciliationPageClientProps = {
  drivers: DriverListItem[];
  initialBundle: InitialShiftBundle | null;
  initialSummaries: InitialSummariesBundle | null;
};

export function ShiftReconciliationPageClient({
  drivers,
  initialBundle,
  initialSummaries
}: ShiftReconciliationPageClientProps) {
  const [driverId] = useQueryState('driver', parseAsString);
  const [dateYmd, setDateYmd] = useQueryState('date', parseAsString);
  const [mode, setViewMode] = useQueryState('mode', parseAsString);
  const [ansicht, setAnsicht] = useQueryState('ansicht', parseAsString);

  const showAllDays = ansicht === 'alle';
  const setShowAllDays = (value: boolean) => {
    void setAnsicht(value ? 'alle' : null);
  };

  const selectedDriver = drivers.find((d) => d.id === driverId);
  const isFullDetail = Boolean(
    driverId && dateYmd && dateYmd.length >= 10 && mode === 'detail'
  );

  const listInitialData = useMemo((): ShiftDaySummary[] | undefined => {
    if (!initialSummaries || !driverId) {
      return undefined;
    }
    if (initialSummaries.driverId !== driverId) {
      return undefined;
    }
    if (isFullDetail) {
      return undefined;
    }
    return initialSummaries.summaries;
  }, [initialSummaries, driverId, isFullDetail]);

  const detailInitial = useMemo(() => {
    if (!initialBundle || !isFullDetail || !dateYmd) {
      return undefined;
    }
    if (
      initialBundle.driverId !== driverId ||
      initialBundle.dateYmd !== dateYmd
    ) {
      return undefined;
    }
    return {
      trips: initialBundle.trips,
      reconciliation: initialBundle.reconciliation
    };
  }, [initialBundle, driverId, dateYmd, isFullDetail]);

  return (
    <div className='space-y-6'>
      <ShiftReconciliationFilters
        drivers={drivers}
        showAllDays={showAllDays}
        onShowAllDaysChange={setShowAllDays}
      />
      {!driverId && (
        <p className='text-muted-foreground text-sm'>
          Bitte einen Fahrer auswählen.
        </p>
      )}
      {driverId && !isFullDetail && (
        <ShiftDayList
          driverId={driverId}
          driverName={selectedDriver?.full_name ?? 'Fahrer'}
          initialData={listInitialData}
          showAllDays={showAllDays}
          onShowAllDaysChange={setShowAllDays}
        />
      )}
      {isFullDetail && dateYmd && (
        <ShiftDetailPanel
          driverId={driverId!}
          dateYmd={dateYmd}
          driverName={selectedDriver?.full_name ?? 'Fahrer'}
          initialTrips={detailInitial?.trips}
          initialReconciliation={detailInitial?.reconciliation}
          onAfterComplete={() => {
            void setDateYmd(null);
            void setViewMode(null);
          }}
        />
      )}
    </div>
  );
}
