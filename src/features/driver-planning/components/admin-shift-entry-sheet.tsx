'use client';

/**
 * Toolbar backfill sheet — admin enters shift actuals for any driver/date.
 */

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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { useEffect, useState } from 'react';
import { CREATE_DRIVER_PLACEHOLDER } from '../lib/planning-url-params';
import type { PlanningDriverListItem } from '../types';
import { AdminShiftEntryForm } from './admin-shift-entry-form';

type AdminShiftEntrySheetProps = {
  drivers: PlanningDriverListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDriverId?: string | null;
};

export function AdminShiftEntrySheet({
  drivers,
  open,
  onOpenChange,
  defaultDriverId
}: AdminShiftEntrySheetProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() =>
    todayYmdInBusinessTz()
  );

  useEffect(() => {
    if (open) {
      setSelectedDriverId(defaultDriverId ?? null);
      setSelectedDate(todayYmdInBusinessTz());
    } else {
      setSelectedDriverId(null);
      setSelectedDate(todayYmdInBusinessTz());
    }
  }, [open, defaultDriverId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className='flex w-full flex-col gap-6 overflow-y-auto px-6 py-6 sm:max-w-lg'
      >
        <SheetHeader>
          <SheetTitle>Schicht erfassen</SheetTitle>
        </SheetHeader>

        <div className='flex flex-col gap-4'>
          <div className='space-y-2'>
            <Label htmlFor='shift-sheet-driver'>Fahrer</Label>
            <Select
              value={selectedDriverId ?? CREATE_DRIVER_PLACEHOLDER}
              onValueChange={(v) =>
                setSelectedDriverId(v === CREATE_DRIVER_PLACEHOLDER ? null : v)
              }
            >
              <SelectTrigger id='shift-sheet-driver'>
                <SelectValue placeholder='Fahrer wählen…' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={CREATE_DRIVER_PLACEHOLDER}
                  className='text-muted-foreground'
                >
                  Fahrer wählen…
                </SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='shift-sheet-date'>Datum</Label>
            <DatePicker
              id='shift-sheet-date'
              value={selectedDate}
              onChange={(v) => {
                if (v) setSelectedDate(v);
              }}
            />
          </div>

          {selectedDriverId ? (
            <AdminShiftEntryForm
              key={`${selectedDriverId}-${selectedDate}`}
              driverId={selectedDriverId}
              date={selectedDate}
              showDateField={false}
              onSaved={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          ) : (
            <p className='text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm'>
              Bitte zuerst einen Fahrer wählen.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
