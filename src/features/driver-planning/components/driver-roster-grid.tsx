'use client';

/**
 * Company-wide weekly roster — drivers as rows, Berlin calendar days as columns.
 *
 * WHY one shared DayPlanEditPopover (not per cell): 50×7 cells would mount hundreds of
 * Radix popover roots; a single popover with a moving anchor keeps DOM and focus stable.
 *
 * WHY anchorRef on the active <td>: assigned in the same render that sets editTarget and
 * opens the popover. Radix PopoverAnchor re-reads the ref after React commits — usually
 * fine in one commit cycle. If positioning bugs appear, switch to PopoverAnchor asChild
 * wrapping the active <td> directly instead of an external ref — still one popover instance.
 *
 * WHY bg-background on every sticky cell: without opaque background, scrolled content
 * bleeds through under sticky headers and the driver name column.
 */

import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getTripsBusinessTimeZone,
  todayYmdInBusinessTz,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { tz } from '@date-fns/tz';
import { parseAsString, useQueryState } from 'nuqs';
import { useMemo, useRef, useState } from 'react';
import { useCompanyWeekPlan } from '../hooks/use-driver-week-plan';
import { calcWeekHours, formatHours } from '../lib/plan-hours';
import { buildWeekPlanDates, snapYmdToWeekStart } from '../lib/week-dates';
import type { DriverDayPlan, PlanningDriverListItem } from '../types';
import { DayPlanEditPopover } from './day-plan-edit-popover';
import { RosterPlanCell } from './roster-plan-cell';

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

const STICKY_HEAD =
  'bg-background sticky top-0 z-10 border-b shadow-[0_1px_0_0_hsl(var(--border))]';
const STICKY_DRIVER = 'bg-background sticky left-0 z-10 border-r border-border';
const STICKY_CORNER = 'bg-background sticky left-0 top-0 z-20';
const STICKY_HOURS = 'bg-background sticky right-0 z-10 border-l border-border';

type EditTarget = { driverId: string; planDate: string };

type DriverRosterGridProps = {
  drivers: PlanningDriverListItem[];
  initialWeekStartYmd: string;
  initialPlans?: DriverDayPlan[];
};

function buildPlanMap(
  plans: DriverDayPlan[]
): Map<string, Map<string, DriverDayPlan>> {
  const map = new Map<string, Map<string, DriverDayPlan>>();
  for (const p of plans) {
    let byDate = map.get(p.driver_id);
    if (!byDate) {
      byDate = new Map();
      map.set(p.driver_id, byDate);
    }
    byDate.set(p.plan_date, p);
  }
  return map;
}

export function DriverRosterGrid({
  drivers,
  initialWeekStartYmd,
  initialPlans
}: DriverRosterGridProps) {
  const [weekYmd] = useQueryState('week', parseAsString);
  const anchorRef = useRef<HTMLTableCellElement>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const weekStartYmd =
    weekYmd && weekYmd.length >= 10
      ? snapYmdToWeekStart(weekYmd)
      : snapYmdToWeekStart(todayYmdInBusinessTz());

  const listInitialData = useMemo(() => {
    if (!initialPlans || weekStartYmd !== initialWeekStartYmd) {
      return undefined;
    }
    return initialPlans;
  }, [initialPlans, weekStartYmd, initialWeekStartYmd]);

  const { data: plans = [], isLoading } = useCompanyWeekPlan(weekStartYmd, {
    initialData: listInitialData
  });

  const weekDates = useMemo(
    () => buildWeekPlanDates(weekStartYmd),
    [weekStartYmd]
  );

  const planMap = useMemo(() => buildPlanMap(plans), [plans]);
  const todayYmd = todayYmdInBusinessTz();
  const inTz = tz(getTripsBusinessTimeZone());

  const workingCountByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const date of weekDates) {
      counts.set(
        date,
        plans.filter((p) => p.plan_date === date && p.status === 'working')
          .length
      );
    }
    return counts;
  }, [plans, weekDates]);

  const editPlan =
    editTarget != null
      ? (planMap.get(editTarget.driverId)?.get(editTarget.planDate) ?? null)
      : null;

  const showSkeleton = isLoading && plans.length === 0 && drivers.length > 0;

  return (
    <>
      <ScrollArea className='w-full rounded-lg border'>
        <table className='w-full min-w-[48rem] border-collapse text-sm'>
          <thead>
            <tr>
              <th
                className={cn(
                  STICKY_CORNER,
                  'min-w-[8.75rem] px-3 py-2 text-left text-xs font-medium'
                )}
              >
                Fahrer
              </th>
              {weekDates.map((date, index) => {
                const isToday = date === todayYmd;
                const isWeekend = index >= 5;
                return (
                  <th
                    key={date}
                    className={cn(
                      STICKY_HEAD,
                      'min-w-[5.5rem] px-1 py-2 text-center text-xs font-medium',
                      isWeekend && 'text-muted-foreground',
                      isToday && 'text-primary border-b-primary border-b-2'
                    )}
                  >
                    <div>{WEEKDAY_LABELS[index]}</div>
                    <div className='tabular-nums'>
                      {format(ymdToPickerDate(date), 'dd.MM', {
                        locale: de,
                        in: inTz
                      })}
                    </div>
                  </th>
                );
              })}
              <th
                className={cn(
                  STICKY_HEAD,
                  STICKY_HOURS,
                  'min-w-[3.5rem] px-2 py-2 text-right text-xs font-medium'
                )}
              >
                Std
              </th>
            </tr>
          </thead>
          <tbody>
            {drivers.length === 0 ? (
              <tr>
                <td
                  colSpan={weekDates.length + 2}
                  className='text-muted-foreground px-4 py-10 text-center text-sm'
                >
                  Keine aktiven Fahrer gefunden.
                </td>
              </tr>
            ) : showSkeleton ? (
              drivers.map((driver) => (
                <tr key={driver.id}>
                  <td className={cn(STICKY_DRIVER, 'px-3 py-2')}>
                    <Skeleton className='h-4 w-24' />
                  </td>
                  {weekDates.map((date) => (
                    <td key={date} className='p-1'>
                      <Skeleton className='h-[3.25rem] w-full' />
                    </td>
                  ))}
                  <td className={cn(STICKY_HOURS, 'px-2 py-2')}>
                    <Skeleton className='ml-auto h-4 w-10' />
                  </td>
                </tr>
              ))
            ) : (
              drivers.map((driver) => {
                const driverPlans = planMap.get(driver.id);
                const weekPlans = Array.from(driverPlans?.values() ?? []);
                const weekTotal = calcWeekHours(weekPlans);

                return (
                  <tr key={driver.id} className='border-border/60 border-b'>
                    <td
                      className={cn(
                        STICKY_DRIVER,
                        'max-w-[8.75rem] truncate px-3 py-2 text-sm font-medium'
                      )}
                      title={driver.full_name}
                    >
                      {driver.full_name}
                    </td>
                    {weekDates.map((date) => {
                      const isActive =
                        editTarget?.driverId === driver.id &&
                        editTarget?.planDate === date;
                      return (
                        <td
                          key={date}
                          ref={isActive ? anchorRef : undefined}
                          className='p-1 align-top'
                        >
                          <RosterPlanCell
                            plan={driverPlans?.get(date) ?? null}
                            planDate={date}
                            driverId={driver.id}
                            isToday={date === todayYmd}
                            onClick={() =>
                              setEditTarget({
                                driverId: driver.id,
                                planDate: date
                              })
                            }
                          />
                        </td>
                      );
                    })}
                    <td
                      className={cn(
                        STICKY_HOURS,
                        'text-muted-foreground px-2 py-2 text-right text-xs tabular-nums'
                      )}
                    >
                      {formatHours(weekTotal)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {drivers.length > 0 && !showSkeleton && (
            <tfoot>
              <tr className='border-t'>
                <td
                  className={cn(
                    STICKY_DRIVER,
                    'text-muted-foreground px-3 py-2 text-xs font-medium'
                  )}
                >
                  Besetzt
                </td>
                {weekDates.map((date) => {
                  const count = workingCountByDate.get(date) ?? 0;
                  return (
                    <td
                      key={date}
                      className='text-muted-foreground px-1 py-2 text-center text-xs tabular-nums'
                    >
                      {count > 0 ? count : '–'}
                    </td>
                  );
                })}
                <td className={cn(STICKY_HOURS, 'bg-background')} />
              </tr>
            </tfoot>
          )}
        </table>
        <ScrollBar orientation='horizontal' />
      </ScrollArea>

      {editTarget && (
        <DayPlanEditPopover
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          anchorRef={anchorRef}
          driverId={editTarget.driverId}
          planDate={editTarget.planDate}
          plan={editPlan}
          weekStartYmd={weekStartYmd}
        />
      )}
    </>
  );
}
