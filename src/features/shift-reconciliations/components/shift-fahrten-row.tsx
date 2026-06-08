'use client';

import { Button } from '@/components/ui/button';
import {
  SHIFT_RECONCILIATION_CURRENCY_CODE,
  SHIFT_RECONCILIATION_CURRENCY_LOCALE
} from '../lib/constants';
import type { ShiftDayType } from '../types';
import { ChevronDown, ChevronUp } from 'lucide-react';

const money = new Intl.NumberFormat(SHIFT_RECONCILIATION_CURRENCY_LOCALE, {
  style: 'currency',
  currency: SHIFT_RECONCILIATION_CURRENCY_CODE
});

type ShiftFahrtenRowProps = {
  dayType: ShiftDayType;
  totalTrips: number;
  selbstzahlerCount: number;
  rechnungCount: number;
  totalRevenue: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
};

export function ShiftFahrtenRow({
  dayType,
  totalTrips,
  selbstzahlerCount,
  rechnungCount,
  totalRevenue,
  isExpanded,
  onToggleExpand
}: ShiftFahrtenRowProps) {
  const splitTotal = Math.max(selbstzahlerCount + rechnungCount, 1);
  const selbstPct = (selbstzahlerCount / splitTotal) * 100;
  const rechnungPct = (rechnungCount / splitTotal) * 100;

  return (
    <div className='flex flex-wrap items-center gap-3 py-2 text-sm'>
      {totalTrips === 0 && dayType === 'shift_only' ? (
        <span className='text-muted-foreground'>Keine Fahrten erfasst</span>
      ) : (
        <span className='font-semibold tabular-nums'>{totalTrips} Fahrten</span>
      )}

      {totalTrips > 0 && (
        <div className='flex min-w-[10rem] flex-1 items-center gap-2'>
          <div className='bg-muted flex h-2 flex-1 overflow-hidden rounded-full'>
            {selbstzahlerCount > 0 && (
              <div
                className='bg-primary/70 h-full'
                style={{ width: `${selbstPct}%` }}
                title={`Selbstzahler ${selbstzahlerCount}`}
              />
            )}
            {rechnungCount > 0 && (
              <div
                className='h-full bg-blue-500/60'
                style={{ width: `${rechnungPct}%` }}
                title={`Rechnung ${rechnungCount}`}
              />
            )}
          </div>
          <span className='text-muted-foreground text-xs whitespace-nowrap'>
            Selbstzahler {selbstzahlerCount} · Rechnung {rechnungCount}
          </span>
        </div>
      )}

      <span className='ml-auto font-medium tabular-nums'>
        {money.format(totalRevenue)}
      </span>

      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-8 w-8 shrink-0'
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Details ausblenden' : 'Details einblenden'}
      >
        {isExpanded ? (
          <ChevronUp className='h-4 w-4' />
        ) : (
          <ChevronDown className='h-4 w-4' />
        )}
      </Button>
    </div>
  );
}
