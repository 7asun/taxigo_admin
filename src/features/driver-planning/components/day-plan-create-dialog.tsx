'use client';

/**
 * Toolbar quick-create shell for new day plans.
 * WHY Dialog (not Popover): forms with driver/date pickers and nested Selects need a shell
 * whose dismiss model does not treat portaled Select dropdowns as "outside" clicks — Dialog
 * backdrop dismiss avoids the Popover + SelectContent conflict from cell edit.
 */

import { DatePicker } from '@/components/ui/date-time-picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { useEffect, useState } from 'react';
import { CREATE_DRIVER_PLACEHOLDER } from '../lib/planning-url-params';
import { snapYmdToWeekStart } from '../lib/week-dates';
import type { PlanningDriverListItem } from '../types';
import { DayPlanEditForm } from './day-plan-edit-form';

type DayPlanCreateDialogProps = {
  drivers: PlanningDriverListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DayPlanCreateDialog({
  drivers,
  open,
  onOpenChange
}: DayPlanCreateDialogProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [selectedPlanDate, setSelectedPlanDate] = useState(() =>
    todayYmdInBusinessTz()
  );
  const [driverTouched, setDriverTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedDriverId(null);
      setSelectedPlanDate(todayYmdInBusinessTz());
      setDriverTouched(false);
    }
  }, [open]);

  const showDriverRequiredHint = driverTouched && selectedDriverId == null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Planung hinzufügen</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='space-y-2'>
            <Label htmlFor='dp-create-driver'>Fahrer</Label>
            <Select
              value={selectedDriverId ?? CREATE_DRIVER_PLACEHOLDER}
              onValueChange={(v) => {
                setDriverTouched(true);
                setSelectedDriverId(v === CREATE_DRIVER_PLACEHOLDER ? null : v);
              }}
            >
              <SelectTrigger id='dp-create-driver'>
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
            {showDriverRequiredHint && (
              <p className='text-destructive text-sm' role='alert'>
                Fahrer ist erforderlich.
              </p>
            )}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='dp-create-date'>Datum</Label>
            <DatePicker
              id='dp-create-date'
              value={selectedPlanDate}
              onChange={(v) => {
                if (v) setSelectedPlanDate(v);
              }}
            />
          </div>

          {selectedDriverId ? (
            <DayPlanEditForm
              driverId={selectedDriverId}
              planDate={selectedPlanDate}
              plan={null}
              weekStartYmd={snapYmdToWeekStart(selectedPlanDate)}
              onSaved={() => onOpenChange(false)}
              onDeleted={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          ) : (
            <p
              className='text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm'
              onClick={() => setDriverTouched(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setDriverTouched(true);
              }}
              role='status'
            >
              Bitte zuerst einen Fahrer wählen.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
