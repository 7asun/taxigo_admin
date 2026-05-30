'use client';

import { useMemo, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DatePicker } from '@/components/ui/date-time-picker';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { buildControllingPeriod } from '../lib/controlling-utils';
import type {
  ControllingPeriod,
  ControllingPeriodKey
} from '../types/controlling.types';

const PERIOD_OPTIONS: { key: ControllingPeriodKey; label: string }[] = [
  { key: 'today', label: 'Heute' },
  { key: 'this_week', label: 'Diese Woche' },
  { key: 'this_month', label: 'Dieser Monat' },
  { key: 'last_month', label: 'Letzter Monat' },
  { key: 'custom', label: 'Benutzerdefiniert' }
];

export interface PeriodPickerProps {
  defaultPeriod?: ControllingPeriodKey;
  onPeriodChange: (period: ControllingPeriod) => void;
  className?: string;
}

export function PeriodPicker({
  defaultPeriod = 'this_month',
  onPeriodChange,
  className
}: PeriodPickerProps) {
  const [selectedKey, setSelectedKey] =
    useState<ControllingPeriodKey>(defaultPeriod);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const currentPeriod = useMemo(() => {
    if (selectedKey === 'custom') {
      if (!customFrom || !customTo) {
        return buildControllingPeriod('this_month');
      }
      return buildControllingPeriod('custom', customFrom, customTo);
    }
    return buildControllingPeriod(selectedKey);
  }, [selectedKey, customFrom, customTo]);

  function emitPeriod(key: ControllingPeriodKey) {
    setSelectedKey(key);
    if (key !== 'custom') {
      onPeriodChange(buildControllingPeriod(key));
    }
  }

  function emitCustom(from: string, to: string) {
    if (!from || !to) return;
    try {
      onPeriodChange(buildControllingPeriod('custom', from, to));
    } catch {
      // invalid range — wait for valid inputs
    }
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ToggleGroup
        type='single'
        value={selectedKey}
        onValueChange={(value) => {
          if (!value) return;
          emitPeriod(value as ControllingPeriodKey);
        }}
        variant='outline'
        className='flex h-auto w-full flex-wrap justify-start'
      >
        {PERIOD_OPTIONS.map((option) => (
          <ToggleGroupItem
            key={option.key}
            value={option.key}
            className='text-xs sm:text-sm'
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {selectedKey === 'custom' ? (
        <div className='bg-muted/40 flex flex-wrap items-end gap-4 rounded-md border px-4 py-3'>
          <div className='flex flex-col gap-1.5'>
            <Label
              htmlFor='custom-from'
              className='text-muted-foreground text-xs'
            >
              Von
            </Label>
            <DatePicker
              id='custom-from'
              value={customFrom}
              triggerClassName='w-40'
              onChange={(ymd) => {
                setCustomFrom(ymd);
                emitCustom(ymd, customTo || ymd);
              }}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label
              htmlFor='custom-to'
              className='text-muted-foreground text-xs'
            >
              Bis
            </Label>
            <DatePicker
              id='custom-to'
              value={customTo}
              triggerClassName='w-40'
              onChange={(ymd) => {
                setCustomTo(ymd);
                emitCustom(customFrom || ymd, ymd);
              }}
            />
          </div>
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>
          Zeitraum: {currentPeriod.label}
        </p>
      )}
    </div>
  );
}
