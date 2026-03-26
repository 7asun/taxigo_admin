'use client';

import { useEffect, useRef, useState } from 'react';
import { useTripsRscRefresh } from '@/features/trips/providers';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { Trip } from '@/features/trips/api/trips.service';
import { useDriversQuery } from '@/features/trips/hooks/use-trip-reference-queries';
import { getStatusWhenDriverChanges } from '@/features/trips/lib/trip-status';

/** Minimum time the “loading” UI stays visible before the select appears (trial UX). */
const DRIVER_CELL_MIN_LOADING_MS = 250;

interface DriverSelectCellProps {
  /** Server list query embeds `driver:accounts!trips_driver_id_fkey(name)` for row context / refresh. */
  trip: Trip & {
    group_id?: string | null;
    driver?: { name: string } | null;
  };
}

export function DriverSelectCell({ trip }: DriverSelectCellProps) {
  const { refreshTripsPage } = useTripsRscRefresh();
  const { data: drivers = [], isPending } = useDriversQuery();
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(
    trip.driver_id
  );
  const [isUpdating, setIsUpdating] = useState(false);

  const isLoadingDrivers = isPending && drivers.length === 0;
  const loadingPassStartedAtRef = useRef<number | null>(null);
  const [canRevealSelect, setCanRevealSelect] = useState(
    () => !isLoadingDrivers
  );

  /**
   * Enforce a minimum visible loading state so fast cache hits don’t “pop” instantly.
   * Instant cache (never entered loading): no extra delay.
   */
  useEffect(() => {
    if (isLoadingDrivers) {
      if (loadingPassStartedAtRef.current === null) {
        loadingPassStartedAtRef.current = Date.now();
      }
      setCanRevealSelect(false);
      return;
    }

    if (loadingPassStartedAtRef.current === null) {
      setCanRevealSelect(true);
      return;
    }

    const elapsed = Date.now() - loadingPassStartedAtRef.current;
    const remaining = Math.max(0, DRIVER_CELL_MIN_LOADING_MS - elapsed);
    if (remaining === 0) {
      loadingPassStartedAtRef.current = null;
      setCanRevealSelect(true);
      return;
    }
    const id = window.setTimeout(() => {
      loadingPassStartedAtRef.current = null;
      setCanRevealSelect(true);
    }, remaining);
    return () => clearTimeout(id);
  }, [isLoadingDrivers]);

  // Keep local state in sync with latest trip data so reused table cells
  // don't show a stale driver for rows that are actually unassigned.
  useEffect(() => {
    setSelectedDriverId(trip.driver_id);
  }, [trip.driver_id, trip.id]);

  const handleChange = async (value: string) => {
    const newDriverId = value === 'unassigned' ? null : value;
    if (newDriverId === selectedDriverId) return;

    setIsUpdating(true);

    const payload: { driver_id: string | null; status?: string } = {
      driver_id: newDriverId
    };
    const derivedStatus = getStatusWhenDriverChanges(trip.status, newDriverId);
    if (derivedStatus) payload.status = derivedStatus;

    const supabase = createClient();

    try {
      if (trip.group_id) {
        const { error } = await supabase
          .from('trips')
          .update(payload)
          .eq('group_id', trip.group_id);

        if (error) throw error;
        toast.success('Fahrer für die Gruppe aktualisiert');
      } else {
        const { error } = await supabase
          .from('trips')
          .update(payload)
          .eq('id', trip.id);

        if (error) throw error;
        toast.success('Fahrer aktualisiert');
      }

      setSelectedDriverId(newDriverId);
      void refreshTripsPage();
    } catch (error: any) {
      toast.error(
        `Fehler beim Zuweisen des Fahrers: ${
          error?.message ?? 'Unbekannter Fehler'
        }`
      );
    } finally {
      setIsUpdating(false);
    }
  };

  // Until minimum loading window + drivers list ready: same skeleton as before (not the full Select).
  if (!canRevealSelect) {
    return <Skeleton className='h-8 w-32' />;
  }

  return (
    <Select
      value={selectedDriverId ?? 'unassigned'}
      onValueChange={handleChange}
      disabled={isUpdating}
    >
      <SelectTrigger className='h-8 w-40 text-xs'>
        <SelectValue placeholder='Fahrer auswählen' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          value='unassigned'
          className='text-muted-foreground text-xs italic'
        >
          Nicht zugewiesen
        </SelectItem>
        {drivers.map((driver) => (
          <SelectItem
            key={driver.id}
            value={driver.id}
            className='text-xs font-medium'
          >
            {driver.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
