'use client';

import * as React from 'react';

import { Switch } from '@/components/ui/switch';

import { useTripFieldUpdate } from '@/features/trips/hooks/use-trip-field-update';

import type { TripRow } from './kts-cells';

export function RehaScheinSwitchCell({ trip }: { trip: TripRow }) {
  const { updateField } = useTripFieldUpdate();

  const [optimistic, setOptimistic] = React.useState<boolean | null>(null);
  const checked = optimistic ?? !!trip.reha_schein;

  React.useEffect(() => {
    setOptimistic(null);
  }, [trip.reha_schein]);

  // Same gate as Neue Fahrt / Detail: Reha only when Kostenträger has `reha_schein_enabled`.
  if (!trip.payer?.reha_schein_enabled) {
    return <span className='text-muted-foreground'>—</span>;
  }

  return (
    <div className='flex justify-center px-1'>
      <Switch
        checked={checked}
        onCheckedChange={(next) => {
          setOptimistic(next);
          updateField(trip.id, 'reha_schein', next);
        }}
        aria-label='Reha-Schein vorhanden'
      />
    </div>
  );
}
