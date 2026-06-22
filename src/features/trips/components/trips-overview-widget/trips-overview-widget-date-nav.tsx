'use client';

import { addDays, format } from 'date-fns';
import { tz } from '@date-fns/tz';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-time-picker';
import {
  getTripsBusinessTimeZone,
  isYmdString,
  todayYmdInBusinessTz,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { cn } from '@/lib/utils';

interface TripsOverviewWidgetDateNavProps {
  dateYmd: string;
  onDateChange: (ymd: string) => void;
}

/**
 * Compact prev/next + calendar day picker for the widget dialog.
 * Uses Berlin business-day YMD strings — same contract as Fahrten date filters.
 */
export function TripsOverviewWidgetDateNav({
  dateYmd,
  onDateChange
}: TripsOverviewWidgetDateNavProps) {
  const isToday = dateYmd === todayYmdInBusinessTz();
  const inTz = tz(getTripsBusinessTimeZone());

  const shiftDay = (delta: number) => {
    if (!isYmdString(dateYmd)) return;
    const next = addDays(ymdToPickerDate(dateYmd), delta, { in: inTz });
    onDateChange(format(next, 'yyyy-MM-dd', { in: inTz }));
  };

  return (
    <div className='flex h-9 shrink-0 flex-nowrap items-center gap-1'>
      <Button
        type='button'
        variant='outline'
        size='icon'
        className='h-9 w-9 shrink-0'
        onClick={() => shiftDay(-1)}
        aria-label='Vorheriger Tag'
      >
        <ChevronLeft className='h-4 w-4' />
      </Button>

      <DatePicker
        value={dateYmd}
        onChange={(next) => {
          if (next) onDateChange(next);
        }}
        triggerClassName={cn(
          'h-9 w-auto min-w-0 shrink-0 justify-start border-0 bg-transparent px-2 text-sm font-medium shadow-none hover:bg-accent hover:text-accent-foreground',
          '[&_span]:text-sm [&_span]:font-medium'
        )}
      />

      <Button
        type='button'
        variant='outline'
        size='icon'
        className='h-9 w-9 shrink-0'
        onClick={() => shiftDay(1)}
        aria-label='Nächster Tag'
      >
        <ChevronRight className='h-4 w-4' />
      </Button>

      <Button
        type='button'
        variant={isToday ? 'default' : 'outline'}
        size='sm'
        className='h-9 shrink-0 px-3'
        onClick={() => onDateChange(todayYmdInBusinessTz())}
      >
        Heute
      </Button>
    </div>
  );
}
