'use client';

/**
 * driver + date live in the URL (nuqs) so links are shareable and state survives refresh
 * without losing context — see docs/shift-reconciliations.md.
 */

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-time-picker';
import type { DriverListItem } from '../api/shift-reconciliations.service';
import { parseAsString, useQueryState } from 'nuqs';

type ShiftReconciliationFiltersProps = {
  drivers: DriverListItem[];
};

export function ShiftReconciliationFilters({
  drivers
}: ShiftReconciliationFiltersProps) {
  const [driverId, setDriverId] = useQueryState('driver', parseAsString);
  const [dateYmd, setDateYmd] = useQueryState('date', parseAsString);
  const [, setViewMode] = useQueryState('mode', parseAsString);

  return (
    <div className='flex flex-col gap-4 sm:flex-row sm:items-end'>
      <div className='min-w-0 flex-1 space-y-2'>
        <Label htmlFor='sr-driver'>Fahrer</Label>
        <Select
          value={driverId ?? '__none__'}
          onValueChange={(v) => {
            const id = v === '__none__' ? null : v;
            void setDriverId(id);
            void setDateYmd(null);
            void setViewMode(null);
          }}
        >
          <SelectTrigger id='sr-driver' className='w-full sm:max-w-md'>
            <SelectValue placeholder='Fahrer wählen…' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='__none__' className='text-muted-foreground'>
              Bitte wählen…
            </SelectItem>
            {drivers.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className='w-full min-w-0 space-y-2 sm:w-56 sm:shrink-0'>
        <Label htmlFor='sr-date'>Datum (optional)</Label>
        <DatePicker
          id='sr-date'
          value={dateYmd ?? ''}
          onChange={(v) => {
            void setDateYmd(v ? v : null);
            if (v) {
              void setViewMode('detail');
            } else {
              void setViewMode(null);
            }
          }}
        />
      </div>
    </div>
  );
}
