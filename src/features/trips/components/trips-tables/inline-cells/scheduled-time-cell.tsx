'use client';

import * as React from 'react';
import { RepeatIcon } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { UrgencyIndicator } from '@/features/trips/components/urgency-indicator';
import type { UpdateTrip } from '@/features/trips/api/trips.service';
import { useUpdateTripMutation } from '@/features/trips/hooks/use-update-trip-mutation';
import {
  buildScheduledAt,
  parseScheduledAtOrFallback,
  TripTimeError
} from '@/features/trips/lib/trip-time';
import { useTripsRscRefresh } from '@/features/trips/providers';
import type { TripRow } from '@/features/trips/types/trip-row';

import { useInlineFieldDraft } from './use-inline-field-draft';

interface ScheduledTimeCellProps {
  trip: TripRow;
}

export function ScheduledTimeCell({ trip }: ScheduledTimeCellProps) {
  const { mutateAsync, isPending } = useUpdateTripMutation();
  const { refreshTripsPage } = useTripsRscRefresh();

  const persistTime = React.useCallback(
    async (hm: string) => {
      const trimmed = hm.trim();

      if (trimmed) {
        const ymd =
          parseScheduledAtOrFallback(trip.scheduled_at)?.ymd ??
          trip.requested_date ??
          null;

        if (!ymd) {
          toast.error('Kein Datum für diese Fahrt — Datum zuerst setzen.');
          return;
        }

        const currentHm = parseScheduledAtOrFallback(trip.scheduled_at)?.hm;
        if (trip.scheduled_at && currentHm === trimmed) {
          return;
        }

        let newScheduledAt: string;
        try {
          newScheduledAt = buildScheduledAt(ymd, trimmed);
        } catch (err) {
          toast.error(
            err instanceof TripTimeError ? err.message : 'Ungültige Zeit'
          );
          return;
        }

        const patch: UpdateTrip = { scheduled_at: newScheduledAt };
        // WHY: first-time time on date-only row clears requested_date — detail sheet contract.
        if (!trip.scheduled_at && trip.requested_date) {
          patch.requested_date = null;
        }

        try {
          await mutateAsync({ id: trip.id, patch });
          await refreshTripsPage();
        } catch {
          toast.error('Zeit konnte nicht gespeichert werden.');
        }
        return;
      }

      if (!trip.scheduled_at) {
        return;
      }

      const preservedYmd =
        parseScheduledAtOrFallback(trip.scheduled_at)?.ymd ??
        trip.requested_date ??
        null;

      const patch: UpdateTrip = {
        scheduled_at: null,
        ...(preservedYmd ? { requested_date: preservedYmd } : {})
      };

      try {
        await mutateAsync({ id: trip.id, patch });
        await refreshTripsPage();
      } catch {
        toast.error('Zeit konnte nicht gespeichert werden.');
      }
    },
    [
      trip.id,
      trip.scheduled_at,
      trip.requested_date,
      mutateAsync,
      refreshTripsPage
    ]
  );

  const hm = parseScheduledAtOrFallback(trip.scheduled_at)?.hm ?? '';
  const { draft, setDraft, flush } = useInlineFieldDraft({
    initialValue: hm,
    debounceMs: 1500,
    onPersist: (value) => void persistTime(value)
  });

  const isRecurring = !!trip.rule_id;

  return (
    <div className='flex items-center'>
      <div className='flex w-4 shrink-0 items-center justify-center'>
        <UrgencyIndicator
          scheduledAt={trip.scheduled_at}
          status={trip.status}
          variant='dot'
        />
      </div>
      <input
        type='time'
        className={cn(
          'border-input bg-background rounded-md border px-2 py-1 text-sm font-medium',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          draft === '' && 'text-muted-foreground',
          isPending && 'opacity-60'
        )}
        value={draft}
        disabled={isPending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Enter') flush();
        }}
        aria-label='Fahrtzeit'
      />
      {isRecurring && (
        <RepeatIcon className='ml-2 h-3 w-3 text-blue-500 dark:text-blue-400' />
      )}
    </div>
  );
}
