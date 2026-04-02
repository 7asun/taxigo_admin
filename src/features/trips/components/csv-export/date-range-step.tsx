'use client';

import * as React from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Calendar as CalendarIcon
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DateRangeStepProps {
  dateFrom: string;
  dateTo: string;
  onDateRangeChange: (from: string, to: string) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Step 3: Date Range Selection
 *
 * Allows users to select a date range for the export using the project's
 * Calendar component with range mode. Shows selected range in German format.
 */
export function DateRangeStep({
  dateFrom,
  dateTo,
  onDateRangeChange,
  onNext,
  onBack
}: DateRangeStepProps) {
  // Convert string dates to Date objects for the Calendar
  const selectedRange: DateRange | undefined = React.useMemo(() => {
    if (!dateFrom && !dateTo) return undefined;
    return {
      from: dateFrom ? new Date(dateFrom) : undefined,
      to: dateTo ? new Date(dateTo) : undefined
    };
  }, [dateFrom, dateTo]);

  // Handle range selection from Calendar
  const handleRangeSelect = (range: DateRange | undefined) => {
    const from = range?.from ? format(range.from, 'yyyy-MM-dd') : '';
    const to = range?.to ? format(range.to, 'yyyy-MM-dd') : '';
    onDateRangeChange(from, to);
  };

  // Check if selection is valid (both dates selected and from <= to)
  const isValid = dateFrom && dateTo && new Date(dateFrom) <= new Date(dateTo);

  // Format dates for display in German format (DD.MM.YYYY)
  const formatDisplayDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return format(date, 'dd.MM.yyyy', { locale: de });
  };

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label>Zeitraum auswählen</Label>
        <p className='text-muted-foreground text-xs'>
          Wählen Sie den Zeitraum für den Fahrten-Export.
        </p>
      </div>

      {/* Date Range Picker */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            className={cn(
              'w-full justify-start text-left font-normal',
              !dateFrom && !dateTo && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className='mr-2 h-4 w-4' />
            {dateFrom && dateTo ? (
              <span>
                {formatDisplayDate(dateFrom)} - {formatDisplayDate(dateTo)}
              </span>
            ) : dateFrom ? (
              <span>{formatDisplayDate(dateFrom)}</span>
            ) : (
              <span>Zeitraum wählen...</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto p-0' align='start'>
          <Calendar
            initialFocus
            mode='range'
            selected={selectedRange}
            onSelect={handleRangeSelect}
            numberOfMonths={2}
            locale={de}
          />
        </PopoverContent>
      </Popover>

      {/* Validation message */}
      {dateFrom && dateTo && !isValid && (
        <p className='text-destructive text-xs'>
          Das Enddatum muss nach dem Startdatum liegen.
        </p>
      )}

      {/* Quick select presets */}
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => {
            const today = new Date();
            const startOfMonth = new Date(
              today.getFullYear(),
              today.getMonth(),
              1
            );
            const endOfMonth = new Date(
              today.getFullYear(),
              today.getMonth() + 1,
              0
            );
            onDateRangeChange(
              format(startOfMonth, 'yyyy-MM-dd'),
              format(endOfMonth, 'yyyy-MM-dd')
            );
          }}
        >
          Diesen Monat
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => {
            const today = new Date();
            const startOfLastMonth = new Date(
              today.getFullYear(),
              today.getMonth() - 1,
              1
            );
            const endOfLastMonth = new Date(
              today.getFullYear(),
              today.getMonth(),
              0
            );
            onDateRangeChange(
              format(startOfLastMonth, 'yyyy-MM-dd'),
              format(endOfLastMonth, 'yyyy-MM-dd')
            );
          }}
        >
          Letzten Monat
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => {
            const today = new Date();
            const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday
            const diffToMonday = (currentDay + 6) % 7; // Days to subtract to get Monday
            const monday = new Date(today);
            monday.setDate(today.getDate() - diffToMonday);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            onDateRangeChange(
              format(monday, 'yyyy-MM-dd'),
              format(sunday, 'yyyy-MM-dd')
            );
          }}
        >
          Diese Woche
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => {
            const today = new Date();
            const currentDay = today.getDay();
            const diffToMonday = (currentDay + 6) % 7;
            const thisMonday = new Date(today);
            thisMonday.setDate(today.getDate() - diffToMonday);
            const lastMonday = new Date(thisMonday);
            lastMonday.setDate(thisMonday.getDate() - 7);
            const lastSunday = new Date(lastMonday);
            lastSunday.setDate(lastMonday.getDate() + 6);
            onDateRangeChange(
              format(lastMonday, 'yyyy-MM-dd'),
              format(lastSunday, 'yyyy-MM-dd')
            );
          }}
        >
          Letzte Woche
        </Button>
      </div>

      {/* Navigation buttons */}
      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          className='flex-1'
          onClick={onBack}
        >
          <ChevronLeft className='mr-1 h-4 w-4' />
          Zurück
        </Button>
        <Button
          type='button'
          className='flex-1'
          onClick={onNext}
          disabled={!isValid}
        >
          Weiter
          <ChevronRight className='ml-1 h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
