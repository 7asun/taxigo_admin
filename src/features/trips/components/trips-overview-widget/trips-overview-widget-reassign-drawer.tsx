'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { Trip } from '@/features/trips/api/trips.service';
import { isTripFremdfirma } from '@/features/trips/lib/trip-assignee';
import { resolvePassengerLabel } from '@/features/trips/lib/resolve-passenger-label';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { Database } from '@/types/database.types';

type Driver = Pick<
  Database['public']['Tables']['accounts']['Row'],
  'id' | 'name'
>;

interface TripsOverviewWidgetReassignDrawerProps {
  trip: Trip | null;
  drivers: Driver[];
  onAssign: (trip: Trip, newDriverId: string | null) => void;
  isPending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Mobile narrow-viewport fallback for driver reassignment.
 * WHY not TripDetailSheet: that sheet couples to RSC refresh and is a full edit
 * surface; this is a focused dispatch quick-assign using the same mutation path.
 */
export function TripsOverviewWidgetReassignDrawer({
  trip,
  drivers,
  onAssign,
  isPending,
  open,
  onOpenChange
}: TripsOverviewWidgetReassignDrawerProps) {
  const [selectedDriverId, setSelectedDriverId] = useState('unassigned');

  useEffect(() => {
    if (trip) {
      setSelectedDriverId(trip.driver_id ?? 'unassigned');
    }
  }, [trip?.id, trip?.driver_id]);

  if (!trip || isTripFremdfirma(trip)) {
    return null;
  }

  const timeLabel = trip.scheduled_at
    ? format(new Date(trip.scheduled_at), 'HH:mm', { locale: de })
    : '--:--';

  const handleAssign = () => {
    onAssign(trip, selectedDriverId === 'unassigned' ? null : selectedDriverId);
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className='flex max-h-[90dvh] flex-col gap-0'>
        <DrawerHeader className='text-left'>
          <DrawerTitle className='text-sm font-medium'>
            {resolvePassengerLabel(trip)} · {timeLabel}
          </DrawerTitle>
        </DrawerHeader>

        <div className='px-4 pb-4'>
          <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Fahrer wählen' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='unassigned'>Nicht zugewiesen</SelectItem>
              {drivers.map((driver) => (
                <SelectItem key={driver.id} value={driver.id}>
                  {driver.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DrawerFooter className='flex-row gap-2'>
          <Button
            type='button'
            variant='outline'
            className='flex-1'
            onClick={() => onOpenChange(false)}
          >
            Abbrechen
          </Button>
          <Button
            type='button'
            variant='default'
            className='flex-1'
            disabled={isPending}
            onClick={handleAssign}
          >
            Zuweisen
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
