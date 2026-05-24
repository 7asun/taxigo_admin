'use client';

/**
 * Week navigation for the roster — only ?week= lives in URL (nuqs).
 * WHY snap picked dates to Monday: roster columns are always ISO week Mo–So in Berlin TZ.
 */

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-time-picker';
import { Label } from '@/components/ui/label';
import {
  getTripsBusinessTimeZone,
  instantToYmdInBusinessTz,
  todayYmdInBusinessTz,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { cn } from '@/lib/utils';
import { addDays, format } from 'date-fns';
import { de } from 'date-fns/locale';
import { tz } from '@date-fns/tz';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { parseAsString, useQueryState } from 'nuqs';
import { useEffect } from 'react';
import { snapYmdToWeekStart } from '../lib/week-dates';

function formatWeekRangeLabel(weekStartYmd: string): string {
  const inTz = tz(getTripsBusinessTimeZone());
  const monday = ymdToPickerDate(weekStartYmd);
  const sunday = addDays(monday, 6, { in: inTz });
  const mo = format(monday, 'dd.MM', { locale: de, in: inTz });
  const so = format(sunday, 'dd.MM.yyyy', { locale: de, in: inTz });
  return `Mo ${mo} – So ${so}`;
}

type DriverPlanningFiltersProps = {
  defaultWeekYmd?: string | null;
};

export function DriverPlanningFilters({
  defaultWeekYmd
}: DriverPlanningFiltersProps) {
  const router = useRouter();
  const [weekYmd, setWeekYmd] = useQueryState('week', parseAsString);

  useEffect(() => {
    if (!weekYmd && defaultWeekYmd) {
      void setWeekYmd(defaultWeekYmd);
    }
  }, [weekYmd, defaultWeekYmd, setWeekYmd]);

  const effectiveWeek =
    weekYmd && weekYmd.length >= 10
      ? snapYmdToWeekStart(weekYmd)
      : snapYmdToWeekStart(todayYmdInBusinessTz());

  const shiftWeek = (deltaWeeks: number) => {
    const inTz = tz(getTripsBusinessTimeZone());
    const monday = ymdToPickerDate(effectiveWeek);
    const next = addDays(monday, deltaWeeks * 7, { in: inTz });
    void setWeekYmd(instantToYmdInBusinessTz(next.getTime()));
    router.refresh();
  };

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-end'>
        <div className='w-full min-w-0 space-y-2 sm:w-56 sm:shrink-0'>
          <Label htmlFor='dp-week'>Woche</Label>
          <DatePicker
            id='dp-week'
            value={effectiveWeek}
            onChange={(v) => {
              if (v) {
                void setWeekYmd(snapYmdToWeekStart(v));
                router.refresh();
              }
            }}
          />
        </div>
      </div>
      <div className='flex items-center justify-between gap-2'>
        <Button
          type='button'
          variant='outline'
          size='icon'
          aria-label='Vorherige Woche'
          onClick={() => shiftWeek(-1)}
        >
          <ChevronLeft className='h-4 w-4' />
        </Button>
        <p
          className={cn(
            'text-muted-foreground text-center text-sm tabular-nums'
          )}
        >
          {formatWeekRangeLabel(effectiveWeek)}
        </p>
        <Button
          type='button'
          variant='outline'
          size='icon'
          aria-label='Nächste Woche'
          onClick={() => shiftWeek(1)}
        >
          <ChevronRight className='h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
