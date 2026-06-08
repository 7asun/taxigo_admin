'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import { useShiftDaySummaries } from '../hooks/use-shift-day-summaries';
import { shiftReconciliationKeys } from '../lib/query-keys';
import { groupByMonth } from '../lib/group-by-month';
import type { ShiftDaySummary } from '../types';
import { ShiftDayRow } from './shift-day-row';

type ShiftDayListProps = {
  driverId: string;
  driverName: string;
  initialData?: ShiftDaySummary[];
  showAllDays: boolean;
  onShowAllDaysChange: (showAll: boolean) => void;
};

export function ShiftDayList({
  driverId,
  driverName,
  initialData,
  showAllDays,
  onShowAllDaysChange
}: ShiftDayListProps) {
  const queryClient = useQueryClient();
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const { data: summaries = [], isLoading } = useShiftDaySummaries(driverId, {
    initialData
  });

  useEffect(() => {
    setExpandedDate(null);
  }, [driverId]);

  // WHY filter here not in parent: ShiftDayList owns grouping; filter before
  // groupByMonth so empty month sections do not appear in trips-only view.
  const visibleDays = useMemo(
    () =>
      showAllDays ? summaries : summaries.filter((day) => day.total_trips > 0),
    [summaries, showAllDays]
  );

  const grouped = groupByMonth(visibleDays);

  const handleIstZeitSaved = () => {
    void queryClient.invalidateQueries({
      queryKey: shiftReconciliationKeys.summaries(driverId)
    });
  };

  if (isLoading && summaries.length === 0) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-32 w-full' />
        <Skeleton className='h-32 w-full' />
        <Skeleton className='h-32 w-full' />
      </div>
    );
  }

  if (!isLoading && visibleDays.length === 0) {
    if (!showAllDays) {
      return (
        <div className='text-muted-foreground space-y-3 border border-dashed py-10 text-center text-sm'>
          <p>Keine Fahrten für diesen Zeitraum gefunden.</p>
          <p>
            Tage ohne Fahrten einblenden?{' '}
            <Button
              type='button'
              variant='link'
              className='text-foreground h-auto p-0 underline underline-offset-2'
              onClick={() => onShowAllDaysChange(true)}
            >
              Alle Tage anzeigen
            </Button>
          </p>
        </div>
      );
    }

    return (
      <p className='text-muted-foreground border border-dashed py-10 text-center text-sm'>
        Keine Schichten gefunden
      </p>
    );
  }

  return (
    <div className='space-y-8'>
      {grouped.map((section) => (
        <div key={section.monthLabel} className='space-y-2'>
          <h3 className='text-muted-foreground text-sm font-semibold tracking-wide uppercase'>
            {section.monthLabel}
          </h3>
          <div className='space-y-2'>
            {/* WHY showIstZeit hardcoded true: Option B; Option A from page props */}
            {section.days.map((day) => (
              <ShiftDayRow
                key={day.date}
                summary={day}
                driverId={driverId}
                driverName={driverName}
                showIstZeit={true}
                isExpanded={expandedDate === day.date}
                onToggleExpand={() =>
                  setExpandedDate((prev) =>
                    prev === day.date ? null : day.date
                  )
                }
                onIstZeitSaved={handleIstZeitSaved}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
