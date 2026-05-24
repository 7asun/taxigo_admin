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
import {
  getTripsBusinessTimeZone,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { tz } from '@date-fns/tz';
import type { RefObject } from 'react';
import type { DriverDayPlan } from '../types';
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
      <PopoverContent className='z-[100] w-80' align='start' side='bottom'>
        <p className='mb-3 text-sm font-semibold capitalize'>
          {formatPlanDateLabel(planDate)}
        </p>
        <DayPlanEditForm
          driverId={driverId}
          planDate={planDate}
          plan={plan}
          weekStartYmd={weekStartYmd}
          onSaved={() => onOpenChange(false)}
          onDeleted={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
