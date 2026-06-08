'use client';

/**
 * Week navigation for the roster — ?week= and ?driver= in URL (nuqs).
 * WHY snap picked dates to Monday: roster columns are always ISO week Mo–So in Berlin TZ.
 */

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-time-picker';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
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
import { ChevronLeft, ChevronRight, Clock, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { parseAsString, useQueryState } from 'nuqs';
import { useEffect, useState } from 'react';
import {
  DRIVER_FILTER_ALL,
  DRIVER_PLANNING_URL_PARAMS
} from '../lib/planning-url-params';
import { snapYmdToWeekStart } from '../lib/week-dates';
import type { PlanningDriverListItem } from '../types';
import { AdminShiftEntrySheet } from './admin-shift-entry-sheet';
import { DayPlanCreateDialog } from './day-plan-create-dialog';

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
  drivers: PlanningDriverListItem[];
};

export function DriverPlanningFilters({
  defaultWeekYmd,
  drivers
}: DriverPlanningFiltersProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [shiftSheetOpen, setShiftSheetOpen] = useState(false);
  const [weekYmd, setWeekYmd] = useQueryState(
    DRIVER_PLANNING_URL_PARAMS.week,
    parseAsString
  );
  // WHY client-side filter only: reuses RSC getPlanningDrivers() — no extra Supabase query.
  const [driverParam, setDriverParam] = useQueryState(
    DRIVER_PLANNING_URL_PARAMS.driver,
    parseAsString
  );

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
        <div className='min-w-0 flex-1 space-y-2'>
          <Label htmlFor='dp-driver'>Fahrer</Label>
          <Select
            value={driverParam ?? DRIVER_FILTER_ALL}
            onValueChange={(v) => {
              void setDriverParam(v === DRIVER_FILTER_ALL ? null : v);
            }}
          >
            <SelectTrigger id='dp-driver' className='w-full sm:max-w-md'>
              <SelectValue placeholder='Alle Fahrer' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DRIVER_FILTER_ALL}>Alle Fahrer</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='default'
            aria-label='Planung hinzufügen'
            onClick={() => setCreateOpen(true)}
          >
            <Plus className='h-4 w-4 shrink-0' />
            <span className='hidden md:ml-2 md:inline'>Planung hinzufügen</span>
          </Button>
          <Button
            type='button'
            variant='outline'
            aria-label='Schicht erfassen'
            onClick={() => setShiftSheetOpen(true)}
          >
            <Clock className='h-4 w-4 shrink-0' />
            <span className='hidden md:ml-2 md:inline'>Schicht erfassen</span>
          </Button>
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

      <DayPlanCreateDialog
        drivers={drivers}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <AdminShiftEntrySheet
        drivers={drivers}
        open={shiftSheetOpen}
        onOpenChange={setShiftSheetOpen}
        defaultDriverId={driverParam}
      />
    </div>
  );
}
