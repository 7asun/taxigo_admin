'use client';

/**
 * Inline cell edit popover — one instance per roster grid, anchored to the active cell.
 * WHY SelectContent position="popper" (default in select.tsx): nested Radix Select inside
 * Popover avoids z-index / portal conflicts when the dropdown opens upward.
 */

import {
  Popover,
  PopoverAnchor,
  PopoverContent
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getTripsBusinessTimeZone,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import Link from 'next/link';
import { tz } from '@date-fns/tz';
import type { RefObject } from 'react';
import type { DriverDayPlan } from '../types';
import { AdminShiftEntryForm } from './admin-shift-entry-form';
import { DayPlanEditForm } from './day-plan-edit-form';

type DayPlanEditPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLTableCellElement | null>;
  driverId: string;
  planDate: string;
  plan: DriverDayPlan | null;
  weekStartYmd: string;
};

/**
 * WHY: Radix Popover dismisses on pointer-down outside PopoverContent. SelectContent
 * portals to document.body, so Status/Fahrzeug clicks look "outside" and unmount the
 * form before onValueChange persists — guard those interactions here.
 */
function isPortaledSelectInteraction(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[data-slot="select-content"]') ||
      target.closest('[data-radix-popper-content-wrapper]') ||
      target.closest('[role="listbox"]') ||
      target.closest('[role="option"]')
  );
}

function preventPopoverDismissIfPortaledSelect(event: {
  target: EventTarget | null;
  preventDefault: () => void;
}): void {
  if (isPortaledSelectInteraction(event.target)) {
    event.preventDefault();
  }
}

function formatPlanDateLabel(planDate: string): string {
  if (!planDate || !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    return '';
  }
  const inTz = tz(getTripsBusinessTimeZone());
  return format(ymdToPickerDate(planDate), 'EEEE, dd.MM.yyyy', {
    locale: de,
    in: inTz
  });
}

export function DayPlanEditPopover({
  open,
  onOpenChange,
  anchorRef,
  driverId,
  planDate,
  plan,
  weekStartYmd
}: DayPlanEditPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor
        virtualRef={
          anchorRef as RefObject<{ getBoundingClientRect(): DOMRect }>
        }
      />
      <PopoverContent
        className='z-[100] max-h-[80vh] w-80 overflow-y-auto'
        align='start'
        side='bottom'
        onInteractOutside={preventPopoverDismissIfPortaledSelect}
        onPointerDownOutside={preventPopoverDismissIfPortaledSelect}
      >
        <p className='mb-3 text-sm font-semibold capitalize'>
          {formatPlanDateLabel(planDate)}
        </p>
        {/* WHY Tabs: Dienstplan vs Ist-Zeit are separate write targets (driver_day_plans
            vs shifts) — avoids conditional save-path confusion in one form. */}
        <Tabs defaultValue='dienstplan'>
          <TabsList className='mb-3 grid w-full grid-cols-2'>
            <TabsTrigger value='dienstplan'>Dienstplan</TabsTrigger>
            <TabsTrigger value='ist-zeit'>Ist-Zeit</TabsTrigger>
          </TabsList>
          <TabsContent value='dienstplan'>
            <DayPlanEditForm
              driverId={driverId}
              planDate={planDate}
              plan={plan}
              weekStartYmd={weekStartYmd}
              onSaved={() => onOpenChange(false)}
              onDeleted={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          </TabsContent>
          <TabsContent value='ist-zeit'>
            <AdminShiftEntryForm
              key={`${driverId}-${planDate}`}
              driverId={driverId}
              date={planDate}
              showDateField={false}
              onSaved={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
            <Link
              href={`/dashboard/shift-reconciliations?driver=${driverId}&date=${planDate}&mode=detail`}
              className='text-muted-foreground mt-4 inline-block text-sm underline underline-offset-2'
            >
              Vollständigen Abgleich öffnen →
            </Link>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
