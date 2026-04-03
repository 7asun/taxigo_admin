'use client';

/**
 * @fileoverview Admin UI for choosing calendar days (and optionally clock times) for trips.
 *
 * **Module:** `src/components/ui/date-time-picker.tsx` — exports both components from one file
 * so they always share styling and behaviour.
 *
 * | Export | Use when |
 * |--------|----------|
 * | `DateTimePicker` | One `Date` = full instant (e.g. create-trip `scheduled_at`). |
 * | `DatePicker` | Day as `yyyy-MM-dd` string; time comes from elsewhere (e.g. `<input type="time">`, Verschieben / Zeitabsprache). |
 *
 * **Shared:** `dateTimePickerCalendarClassNames` (touch-friendly `Calendar` cells, works inside nested `Dialog`s).
 * **Narrow screens:** both use `useIsNarrowScreen(768)` and `MobileDateTimeSheet` for the date (and `DateTimePicker` also for time).
 *
 * **Calendar clearing:** `DatePicker` sets `required={false}` so the user can deselect the day (tap again). `DateTimePicker`
 * uses the default single-day behaviour and clears via clearing the whole value from the parent.
 *
 * @see `docs/date-picker.md` — product-level “when to use which” and examples.
 */

import * as React from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarIcon, ChevronDownIcon, ClockIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsNarrowScreen } from '@/hooks/use-is-narrow-screen';
import { MobileDateTimeSheet } from '@/features/trips/components/create-trip/mobile-datetime-sheet';

/**
 * Passed to `Calendar`’s `classNames` for both pickers so date popovers look identical
 * (larger hit targets on small screens, consistent with trip create flows).
 */
const dateTimePickerCalendarClassNames = {
  day: cn(
    buttonVariants({ variant: 'ghost' }),
    'min-h-11 min-w-[2.75rem] touch-manipulation p-0 text-base font-normal aria-selected:opacity-100 sm:min-h-9 sm:min-w-9 sm:text-sm md:size-8 md:min-h-8 md:min-w-8'
  ),
  head_cell:
    'text-muted-foreground w-[2.75rem] rounded-md text-[0.85rem] font-normal sm:w-9 sm:text-[0.8rem] md:w-8',
  nav_button: cn(
    buttonVariants({ variant: 'outline' }),
    'min-h-11 min-w-11 touch-manipulation bg-transparent p-0 opacity-70 hover:opacity-100 sm:min-h-9 sm:min-w-9 md:size-7'
  )
};

export interface DateTimePickerProps {
  /** Full instant; `undefined` clears both date and time in the UI. */
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  /** Optional label; when set, desktop shows one label spanning the date column (time column uses a spacer label). */
  label?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * Single control for **both** calendar day and clock time as one `Date` (`undefined` clears).
 * For split “Datum + optional Uhrzeit” (same file): use **`DatePicker`** + your own time input.
 */
export function DateTimePicker({
  value,
  onChange,
  label,
  disabled,
  id = 'date-time-picker'
}: DateTimePickerProps) {
  const narrow = useIsNarrowScreen(768); // matches trip forms: sheet pickers below `md`
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [dateSheetOpen, setDateSheetOpen] = React.useState(false);
  const [timeSheetOpen, setTimeSheetOpen] = React.useState(false);
  const [timeValue, setTimeValue] = React.useState<string>(() => {
    if (value) {
      return format(value, 'HH:mm');
    }
    return '';
  });

  React.useEffect(() => {
    if (value) {
      setTimeValue(format(value, 'HH:mm'));
    } else {
      setTimeValue('');
    }
  }, [value]);

  const selectedDate = value;

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) {
      onChange?.(undefined);
      return;
    }
    // Preserve current time (or midnight) when only the calendar day changes.
    const [hours, minutes] = timeValue
      ? timeValue.split(':').map(Number)
      : [0, 0];
    const newDate = new Date(day);
    newDate.setHours(hours, minutes, 0, 0);
    onChange?.(newDate);
    setPopoverOpen(false);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = e.target.value;
    setTimeValue(time);
    // Clearing time does not clear the parent `Date` — only typing a time with a selected day updates.
    if (selectedDate && time) {
      const [hours, minutes] = time.split(':').map(Number);
      const newDate = new Date(selectedDate);
      newDate.setHours(hours, minutes, 0, 0);
      onChange?.(newDate);
    }
  };

  const displayDate = selectedDate
    ? format(selectedDate, 'dd. MMMM yyyy', { locale: de })
    : 'Datum wählen';

  const displayTime = selectedDate
    ? format(selectedDate, 'HH:mm')
    : timeValue || '—';

  const timeId = `${id}-time`;

  if (narrow) {
    return (
      <div className='flex w-full flex-col gap-2'>
        {label ? <span className='text-xs font-medium'>{label}</span> : null}
        <div className='flex w-full flex-row items-end gap-2'>
          <div className='min-w-0 flex-1'>
            <Label
              htmlFor={id}
              className='text-muted-foreground mb-1 block text-xs'
            >
              Datum
            </Label>
            <Button
              type='button'
              id={id}
              variant='outline'
              disabled={disabled}
              onClick={() => setDateSheetOpen(true)}
              className={cn(
                'h-10 min-h-10 w-full touch-manipulation justify-between text-left text-base font-normal md:h-9 md:min-h-0',
                !selectedDate && 'text-muted-foreground'
              )}
            >
              <span className='flex min-w-0 items-center gap-2'>
                <CalendarIcon className='h-4 w-4 shrink-0 opacity-60' />
                <span className='min-w-0 truncate'>{displayDate}</span>
              </span>
              <ChevronDownIcon className='h-4 w-4 shrink-0 opacity-50' />
            </Button>
            <MobileDateTimeSheet
              open={dateSheetOpen}
              onOpenChange={setDateSheetOpen}
              value={selectedDate}
              title='Datum wählen'
              mode='date'
              onConfirm={(d) => {
                onChange?.(d);
                setTimeValue(format(d, 'HH:mm'));
              }}
            />
          </div>
          <div className='w-[8.25rem] shrink-0 sm:w-[9.5rem]'>
            <Label
              htmlFor={timeId}
              className='text-muted-foreground mb-1 block text-xs'
            >
              Uhrzeit
            </Label>
            <Button
              type='button'
              id={timeId}
              variant='outline'
              disabled={disabled || !selectedDate}
              onClick={() => setTimeSheetOpen(true)}
              className={cn(
                'h-10 min-h-10 w-full touch-manipulation justify-between text-left font-mono text-base font-normal md:h-9 md:min-h-0',
                !selectedDate && 'text-muted-foreground'
              )}
            >
              <span className='flex min-w-0 items-center gap-2'>
                <ClockIcon className='h-4 w-4 shrink-0 opacity-60' />
                <span className='min-w-0 truncate'>{displayTime}</span>
              </span>
              <ChevronDownIcon className='h-4 w-4 shrink-0 opacity-50' />
            </Button>
            <MobileDateTimeSheet
              open={timeSheetOpen}
              onOpenChange={setTimeSheetOpen}
              value={selectedDate}
              title='Uhrzeit wählen'
              mode='time'
              onConfirm={(d) => {
                onChange?.(d);
                setTimeValue(format(d, 'HH:mm'));
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex items-end gap-2'>
      <div className='min-w-0 flex-1'>
        {label && (
          <Label htmlFor={id} className='mb-2 block'>
            {label}
          </Label>
        )}
        {/* modal={false}: allow interaction with parent Dialog / other layers */}
        <Popover modal={false} open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type='button'
              id={id}
              variant='outline'
              disabled={disabled}
              className={cn(
                'h-10 min-h-10 w-full touch-manipulation justify-between text-left font-normal md:h-9 md:min-h-0',
                !selectedDate && 'text-muted-foreground'
              )}
            >
              <span className='flex min-w-0 items-center gap-2'>
                <CalendarIcon className='h-4 w-4 shrink-0 opacity-60' />
                <span className='truncate'>{displayDate}</span>
              </span>
              <ChevronDownIcon className='h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align='start'
            side='bottom'
            sideOffset={4}
            collisionPadding={16}
            // Keep focus on the trigger so nested modals don’t trap focus awkwardly.
            onOpenAutoFocus={(event) => event.preventDefault()}
            className={cn(
              'z-[100] w-[min(100vw-1rem,20rem)] max-w-[calc(100vw-1rem)] touch-manipulation overflow-y-auto overscroll-contain p-0 sm:w-auto sm:max-w-none',
              'pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]'
            )}
          >
            <Calendar
              mode='single'
              selected={selectedDate}
              onSelect={handleDaySelect}
              defaultMonth={selectedDate}
              initialFocus={false}
              className='w-full max-w-full'
              classNames={dateTimePickerCalendarClassNames}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className='w-32 shrink-0'>
        {label && <Label className='mb-2 block opacity-0'>Zeit</Label>}
        <div className='relative'>
          <ClockIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            type='time'
            step='60'
            value={timeValue}
            onChange={handleTimeChange}
            disabled={disabled}
            className={cn(
              'h-10 min-h-10 touch-manipulation pl-9 md:h-9 md:min-h-0',
              'appearance-none md:[&::-webkit-calendar-picker-indicator]:hidden md:[&::-webkit-calendar-picker-indicator]:appearance-none'
            )}
          />
        </div>
      </div>
    </div>
  );
}

// --- Date-only picker (import as `DatePicker`; used when time is not part of the same `Date`)

/** Parses `yyyy-MM-dd` to a local calendar `Date` (no UTC shift) for `Calendar`’s `selected`. */
function parseYmdToLocalDate(ymd: string): Date | undefined {
  const t = ymd.trim();
  if (!t) return undefined;
  const [y, m, d] = t.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return undefined;
  return new Date(y, m - 1, d);
}

export interface DatePickerProps {
  /** Calendar day as `yyyy-MM-dd`, or `''` when no day is chosen. */
  value: string;
  /** Emits `yyyy-MM-dd` or `''` when the user clears the selection. */
  onChange: (ymd: string) => void;
  disabled?: boolean;
  /** Forwarded to the trigger `Button` (`htmlFor` on the external `Label`). */
  id?: string;
  /** Merged into the trigger `Button` (e.g. compact toolbar: `h-8 text-xs`). */
  triggerClassName?: string;
}

/**
 * Date-only: German label (`dd. MMMM yyyy`), same Popover + `Calendar` + mobile sheet as the
 * **date column** of `DateTimePicker`. Value is a string so the parent can pair it with an
 * empty time (Zeitabsprache) without fighting a single `Date` object.
 *
 * @see `docs/date-picker.md`
 */
export function DatePicker({
  value,
  onChange,
  disabled,
  id = 'date-picker',
  triggerClassName
}: DatePickerProps) {
  const narrow = useIsNarrowScreen(768);
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [dateSheetOpen, setDateSheetOpen] = React.useState(false);

  const selectedDate = React.useMemo(() => parseYmdToLocalDate(value), [value]);

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) {
      onChange('');
      return;
    }
    // Strip time so we never emit timezone-shifted strings vs. `yyyy-MM-dd`.
    const normalized = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate()
    );
    onChange(format(normalized, 'yyyy-MM-dd'));
    setPopoverOpen(false);
  };

  const displayDate = selectedDate
    ? format(selectedDate, 'dd. MMMM yyyy', { locale: de })
    : 'Datum wählen';

  // Sheet must be a sibling of the Button, not a child — invalid HTML and Radix focus.
  if (narrow) {
    return (
      <>
        <Button
          type='button'
          id={id}
          variant='outline'
          disabled={disabled}
          onClick={() => setDateSheetOpen(true)}
          className={cn(
            'h-10 min-h-10 w-full touch-manipulation justify-between text-left text-base font-normal md:h-9 md:min-h-0',
            !selectedDate && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className='flex min-w-0 items-center gap-1.5'>
            <CalendarIcon className='h-3.5 w-3.5 shrink-0 opacity-60' />
            <span className='min-w-0 truncate'>{displayDate}</span>
          </span>
          <ChevronDownIcon className='h-3.5 w-3.5 shrink-0 opacity-50' />
        </Button>
        <MobileDateTimeSheet
          open={dateSheetOpen}
          onOpenChange={setDateSheetOpen}
          value={selectedDate}
          title='Datum wählen'
          mode='date'
          onConfirm={(d) => {
            const normalized = new Date(
              d.getFullYear(),
              d.getMonth(),
              d.getDate()
            );
            onChange(format(normalized, 'yyyy-MM-dd'));
          }}
        />
      </>
    );
  }

  // `modal={false}` lets nested Dialogs/Drawers receive pointer events; matches DateTimePicker.
  return (
    <Popover modal={false} open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          id={id}
          variant='outline'
          disabled={disabled}
          className={cn(
            'h-10 min-h-10 w-full touch-manipulation justify-between text-left font-normal md:h-9 md:min-h-0',
            !selectedDate && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className='flex min-w-0 items-center gap-1.5'>
            <CalendarIcon className='h-3.5 w-3.5 shrink-0 opacity-60' />
            <span className='truncate'>{displayDate}</span>
          </span>
          <ChevronDownIcon className='h-3.5 w-3.5 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        side='bottom'
        sideOffset={4}
        collisionPadding={16}
        // Avoid stealing focus on open (calendar still works; matches DateTimePicker).
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          'z-[100] w-[min(100vw-1rem,20rem)] max-w-[calc(100vw-1rem)] touch-manipulation overflow-y-auto overscroll-contain p-0 sm:w-auto sm:max-w-none',
          'pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]'
        )}
      >
        <Calendar
          mode='single'
          // Allow clearing by tapping the selected day again (react-day-picker v8).
          required={false}
          selected={selectedDate}
          onSelect={handleDaySelect}
          defaultMonth={selectedDate}
          initialFocus={false}
          className='w-full max-w-full'
          classNames={dateTimePickerCalendarClassNames}
        />
      </PopoverContent>
    </Popover>
  );
}
