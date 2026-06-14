'use client';

import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { useUpdateKtsPatientIdMutation } from '@/features/kts/hooks/use-kts-status';
import type { KtsTripRow } from '@/features/kts/types/kts-trip-row';
import { cn } from '@/lib/utils';

export interface KtsPatientIdCellProps {
  trip: KtsTripRow;
}

export function KtsPatientIdCell({ trip }: KtsPatientIdCellProps) {
  const [value, setValue] = useState(trip.kts_patient_id ?? '');
  const mutation = useUpdateKtsPatientIdMutation();

  useEffect(() => {
    setValue(trip.kts_patient_id ?? '');
  }, [trip.kts_patient_id]);

  const handleBlur = () => {
    const trimmed = value.trim();
    if (trimmed === (trip.kts_patient_id ?? '')) return;

    mutation.mutate(
      { tripId: trip.id, patientId: trimmed || null },
      {
        onError: () => {
          setValue(trip.kts_patient_id ?? '');
        }
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setValue(trip.kts_patient_id ?? '');
      e.currentTarget.blur();
    }
  };

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder='–'
      disabled={mutation.isPending}
      className={cn(
        'focus:bg-background focus:border-input h-7 w-32 border-transparent bg-transparent px-1 text-sm',
        value ? 'text-left' : 'text-center',
        mutation.isPending && 'pointer-events-none opacity-50'
      )}
      autoComplete='off'
      aria-label='KTS Patienten-ID'
    />
  );
}
