'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { parseYmdToLocalDate } from '@/lib/date-ymd';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronDown } from 'lucide-react';
import { parseAsString, useQueryState } from 'nuqs';
import {
  SHIFT_RECONCILIATION_CURRENCY_CODE,
  SHIFT_RECONCILIATION_CURRENCY_LOCALE
} from '../lib/constants';
import { useShiftDaySummaries } from '../hooks/use-shift-day-summaries';
import { groupByMonth } from '../lib/group-by-month';
import type { ShiftDaySummary } from '../types';
import { ShiftDetailPanel } from './shift-detail-panel';

const money = new Intl.NumberFormat(SHIFT_RECONCILIATION_CURRENCY_LOCALE, {
  style: 'currency',
  currency: SHIFT_RECONCILIATION_CURRENCY_CODE
});

type ShiftDayListProps = {
  driverId: string;
  driverName: string;
  initialData?: ShiftDaySummary[];
};

export function ShiftDayList({
  driverId,
  driverName,
  initialData
}: ShiftDayListProps) {
  const [dateYmd, setDateYmd] = useQueryState('date', parseAsString);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const { data: summaries = [], isLoading } = useShiftDaySummaries(driverId, {
    initialData
  });
  const grouped = groupByMonth(summaries);

  useEffect(() => {
    if (dateYmd) {
      setExpandedDate(dateYmd);
    } else {
      setExpandedDate(null);
    }
  }, [dateYmd]);

  const handleRowClick = (d: string) => {
    const next = expandedDate === d ? null : d;
    setExpandedDate(next);
    void setDateYmd(next);
  };

  if (isLoading && summaries.length === 0) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-14 w-full' />
        <Skeleton className='h-14 w-full' />
        <Skeleton className='h-14 w-full' />
      </div>
    );
  }

  if (!isLoading && summaries.length === 0) {
    return (
      <p className='text-muted-foreground border border-dashed py-10 text-center text-sm'>
        Keine Fahrten für diesen Fahrer gefunden
      </p>
    );
  }

  return (
    <TooltipProvider>
      <div className='space-y-8'>
        {grouped.map((section) => (
          <div key={section.monthLabel} className='space-y-2'>
            <h3 className='text-muted-foreground text-sm font-semibold tracking-wide uppercase'>
              {section.monthLabel}
            </h3>
            <div className='space-y-2'>
              {section.days.map((day) => {
                const isOpen = expandedDate === day.shift_date;
                return (
                  <div
                    key={day.shift_date}
                    className='bg-card text-card-foreground border-border overflow-hidden rounded-md border shadow-sm'
                  >
                    <button
                      type='button'
                      onClick={() => handleRowClick(day.shift_date)}
                      className={cn(
                        'hover:bg-muted/50 flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left text-sm transition-colors',
                        'sm:gap-4'
                      )}
                    >
                      <div className='min-w-0 shrink font-medium sm:w-36'>
                        {formatDayHeading(day.shift_date)}
                      </div>
                      <div className='text-muted-foreground min-w-0 flex-1 text-xs sm:text-sm'>
                        <span className='text-foreground inline-flex flex-wrap items-center gap-1.5'>
                          Fahrten gesamt: {day.total_trips}
                          {day.unconfigured_count > 0 && (
                            <span
                              className='inline-block size-2 shrink-0 rounded-full bg-amber-500'
                              title='Nicht konfigurierte Kostenträger'
                              aria-hidden
                            />
                          )}
                        </span>
                        {' · '}
                        Selbstzahler: {money.format(day.self_pay_total)} (
                        {day.self_pay_count}) · Rechnung: {day.invoice_count}{' '}
                        Fahrten
                      </div>
                      <div className='flex shrink-0 items-center gap-2'>
                        {day.is_reconciled ? (
                          day.reconciled_by_name ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  className='border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200'
                                  variant='outline'
                                >
                                  ✓ Bestätigt
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                {day.reconciled_by_name}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge
                              className='border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200'
                              variant='outline'
                            >
                              ✓ Bestätigt
                            </Badge>
                          )
                        ) : (
                          <Badge
                            variant='secondary'
                            className='border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
                          >
                            Nicht geprüft
                          </Badge>
                        )}
                        <ChevronDown
                          className={cn(
                            'text-muted-foreground size-5 shrink-0 transition-transform duration-200',
                            isOpen && 'rotate-180'
                          )}
                          aria-hidden
                        />
                      </div>
                    </button>
                    {isOpen && (
                      <div className='border-border bg-muted/20 border-t px-3 py-4 sm:px-4'>
                        <ShiftDetailPanel
                          driverId={driverId}
                          dateYmd={day.shift_date}
                          driverName={driverName}
                          onAfterConfirm={() => {
                            setExpandedDate(null);
                            void setDateYmd(null);
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}

function formatDayHeading(shiftDate: string): string {
  const d = parseYmdToLocalDate(shiftDate);
  if (!d) return shiftDate;
  return format(d, 'EEE, d. MMM', { locale: de });
}
