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
 * | `DateRangePicker` | Date range selection with preset shortcuts (e.g. trips filter bar). |
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
import {
  format,
  startOfWeek,
  addDays,
  subWeeks,
  addWeeks,
  startOfMonth,
  endOfMonth,
  subMonths
} from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarIcon, ChevronDownIcon, ClockIcon, X } from 'lucide-react';
import { parseYmdToLocalDate } from '@/lib/date-ymd';
import { cn } from '@/lib/utils';
import { useIsNarrowScreen } from '@/hooks/use-is-narrow-screen';
import { MobileDateTimeSheet } from '@/features/trips/components/create-trip/mobile-datetime-sheet';
import type { DateRange } from 'react-day-picker';

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
    'text-muted-foreground w-[2.75rem] rounded-md text-[0.85rem] font-normal sm:w-9 sm:text-[0.8rem] md:w-8 md:min-w-8',
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

// --- Date range picker with preset shortcuts (for filter bars)

/** Preset option for quick range selection */
export interface DateRangePreset {
  label: string;
  getRange: () => { from: Date; to: Date };
}

export interface DateRangePickerProps {
  /** Selected date range */
  value?: DateRange;
  /** Called when range changes (undefined = cleared) */
  onChange: (range: DateRange | undefined) => void;
  disabled?: boolean;
  id?: string;
  triggerClassName?: string;
  /** Optional custom presets; defaults to standard week/month presets */
  presets?: DateRangePreset[];
  placeholder?: string;
}

/** Default presets for date range selection (e.g. trips filter). Exported for consumers that want to subset. */
export const dateRangePickerDefaultPresets: DateRangePreset[] = [
  {
    label: 'Heute',
    getRange: () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(today);
      end.setHours(23, 59, 59, 999);
      return { from: today, to: end };
    }
  },
  {
    label: 'Diese Woche',
    getRange: () => {
      const from = startOfWeek(new Date(), { weekStartsOn: 1 });
      from.setHours(0, 0, 0, 0);
      const to = addDays(from, 6);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
  },
  {
    label: 'Letzte Woche',
    getRange: () => {
      const anchor = subWeeks(new Date(), 1);
      const from = startOfWeek(anchor, { weekStartsOn: 1 });
      from.setHours(0, 0, 0, 0);
      const to = addDays(from, 6);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
  },
  {
    label: 'Nächste Woche',
    getRange: () => {
      const anchor = addWeeks(new Date(), 1);
      const from = startOfWeek(anchor, { weekStartsOn: 1 });
      from.setHours(0, 0, 0, 0);
      const to = addDays(from, 6);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
  },
  {
    label: 'Dieser Monat',
    getRange: () => {
      const from = startOfMonth(new Date());
      from.setHours(0, 0, 0, 0);
      const to = endOfMonth(new Date());
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
  },
  {
    label: 'Letzter Monat',
    getRange: () => {
      const anchor = subMonths(new Date(), 1);
      const from = startOfMonth(anchor);
      from.setHours(0, 0, 0, 0);
      const to = endOfMonth(anchor);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
  }
];

function formatRangeDisplay(range: DateRange | undefined): string {
  if (!range?.from) return '';
  if (!range.to || range.from.getTime() === range.to.getTime()) {
    return format(range.from, 'dd.MM.yyyy', { locale: de });
  }
  const sameMonth =
    range.from.getMonth() === range.to.getMonth() &&
    range.from.getFullYear() === range.to.getFullYear();
  if (sameMonth) {
    return `${format(range.from, 'dd.', { locale: de })} – ${format(range.to, 'dd.MM.yyyy', { locale: de })}`;
  }
  return `${format(range.from, 'dd.MM.', { locale: de })} – ${format(range.to, 'dd.MM.yyyy', { locale: de })}`;
}

/**
 * Date range picker with preset shortcuts (Heute, Diese Woche, etc.).
 * Returns a DateRange with from/to dates inclusive (time set to start/end of day).
 */
export function DateRangePicker({
  value,
  onChange,
  disabled,
  id = 'date-range-picker',
  triggerClassName,
  presets = dateRangePickerDefaultPresets,
  placeholder = 'Zeitraum wählen'
}: DateRangePickerProps) {
  const narrow = useIsNarrowScreen(768);
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [dateSheetOpen, setDateSheetOpen] = React.useState(false);

  const displayText = formatRangeDisplay(value) || placeholder;

  const handlePreset = (preset: DateRangePreset) => {
    const range = preset.getRange();
    onChange(range);
    setPopoverOpen(false);
  };

  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range) {
      onChange(undefined);
      return;
    }
    // Normalize times: from=start of day, to=end of day
    const normalized: DateRange = {
      from: range.from
        ? new Date(
            range.from.getFullYear(),
            range.from.getMonth(),
            range.from.getDate(),
            0,
            0,
            0,
            0
          )
        : undefined,
      to: range.to
        ? new Date(
            range.to.getFullYear(),
            range.to.getMonth(),
            range.to.getDate(),
            23,
            59,
            59,
            999
          )
        : undefined
    };
    onChange(normalized.from ? normalized : undefined);
  };

  const clearSelection = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange(undefined);
  };

  // Mobile: use sheet picker (single day for now - range via presets)
  if (narrow) {
    return (
      <>
        {/* Outer control is a div so the clear action can be a real <button> (no nested buttons). */}
        <div
          id={id}
          role='button'
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled ? true : undefined}
          aria-haspopup='dialog'
          onClick={() => {
            if (!disabled) setDateSheetOpen(true);
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setDateSheetOpen(true);
            }
          }}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-10 min-h-10 w-full touch-manipulation justify-between text-left text-base font-normal md:h-9 md:min-h-0',
            !value?.from && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className='flex min-w-0 items-center gap-1.5'>
            <CalendarIcon className='h-3.5 w-3.5 shrink-0 opacity-60' />
            <span className='min-w-0 truncate'>{displayText}</span>
          </span>
          <span className='flex items-center gap-1'>
            {value?.from && (
              <button
                type='button'
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'icon' }),
                  'h-6 w-6 shrink-0 opacity-50 hover:opacity-100'
                )}
                aria-label='Zeitraum zurücksetzen'
                onClick={clearSelection}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X className='h-3 w-3' />
              </button>
            )}
            <ChevronDownIcon className='h-3.5 w-3.5 shrink-0 opacity-50' />
          </span>
        </div>
        <MobileDateTimeSheet
          open={dateSheetOpen}
          onOpenChange={setDateSheetOpen}
          value={value?.from}
          title='Zeitraum wählen'
          mode='date'
          onConfirm={(d) => {
            const from = new Date(
              d.getFullYear(),
              d.getMonth(),
              d.getDate(),
              0,
              0,
              0,
              0
            );
            const to = new Date(
              d.getFullYear(),
              d.getMonth(),
              d.getDate(),
              23,
              59,
              59,
              999
            );
            onChange({ from, to });
          }}
        />
      </>
    );
  }

  return (
    <Popover modal={false} open={popoverOpen} onOpenChange={setPopoverOpen}>
      {/* `asChild` + div: Radix attaches trigger behaviour without a <button>, so the clear control can be a real button. */}
      <PopoverTrigger asChild disabled={disabled}>
        <div
          id={id}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-10 min-h-10 w-full touch-manipulation justify-between text-left font-normal md:h-9 md:min-h-0',
            !value?.from && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className='flex min-w-0 items-center gap-1.5'>
            <CalendarIcon className='h-3.5 w-3.5 shrink-0 opacity-60' />
            <span className='truncate'>{displayText}</span>
          </span>
          <span className='flex items-center gap-1'>
            {value?.from && (
              <button
                type='button'
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'icon' }),
                  'h-6 w-6 shrink-0 opacity-50 hover:opacity-100'
                )}
                aria-label='Zeitraum zurücksetzen'
                onClick={clearSelection}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X className='h-3 w-3' />
              </button>
            )}
            <ChevronDownIcon className='h-3.5 w-3.5 shrink-0 opacity-50' />
          </span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        side='bottom'
        sideOffset={4}
        collisionPadding={16}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          'z-[100] w-auto touch-manipulation overflow-y-auto overscroll-contain p-0',
          'pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]',
          'max-w-[calc(100vw-1rem)] sm:max-w-[20rem]'
        )}
      >
        <div className='flex flex-col gap-2 p-3'>
          {/* Presets - compact grid */}
          <div className='grid grid-cols-3 gap-1'>
            {presets.map((preset) => (
              <Button
                key={preset.label}
                type='button'
                variant='outline'
                size='sm'
                className='h-7 px-1.5 text-[11px]'
                onClick={() => handlePreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          {/* Range calendar */}
          <div className='flex justify-center'>
            <Calendar
              mode='range'
              selected={value}
              onSelect={handleRangeSelect}
              defaultMonth={value?.from}
              initialFocus={false}
              numberOfMonths={1}
              className='w-full'
              classNames={dateTimePickerCalendarClassNames}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
