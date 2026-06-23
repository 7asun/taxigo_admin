'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Database } from '@/types/database.types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { useDriversQuery } from '@/features/trips/hooks/use-trip-reference-queries';
import { useTripsOverviewWidget } from '@/features/trips/hooks/use-trips-overview-widget';
import { useWidgetTripAssignment } from '@/features/trips/hooks/use-widget-trip-assignment';
import type { KanbanTrip } from '@/features/trips/lib/kanban-types';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { useIsNarrowScreen } from '@/hooks/use-is-narrow-screen';
import { cn } from '@/lib/utils';
import { TripsOverviewWidgetBoard } from './trips-overview-widget-board';
import { TripsOverviewWidgetDateNav } from './trips-overview-widget-date-nav';
import { TripsOverviewWidgetReassignDrawer } from './trips-overview-widget-reassign-drawer';

interface TripsOverviewWidgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Berlin business-day YMD — owned by trigger for badge count sync. */
  dateYmd: string;
  onDateChange: (ymd: string) => void;
}

type DriverRow = Pick<
  Database['public']['Tables']['accounts']['Row'],
  'id' | 'name'
>;

function deriveQualifyingDriverIds(trips: KanbanTrip[]): string[] {
  const ids = new Set<string>();
  for (const trip of trips) {
    if (trip.driver_id != null && trip.fremdfirma_id == null) {
      ids.add(trip.driver_id);
    }
  }
  return Array.from(ids).sort();
}

function deriveVisibleTrips(
  trips: KanbanTrip[],
  isToday: boolean
): KanbanTrip[] {
  if (!isToday) {
    return trips;
  }

  const now = new Date();
  const pastTrips = trips
    .filter((trip) => trip.scheduled_at && new Date(trip.scheduled_at) < now)
    .sort(
      (a, b) =>
        new Date(b.scheduled_at!).getTime() -
        new Date(a.scheduled_at!).getTime()
    );
  const lastPastTrip = pastTrips[0] ?? null;
  const futureTrips = trips.filter(
    (trip) => !trip.scheduled_at || new Date(trip.scheduled_at) >= now
  );

  return [...(lastPastTrip ? [lastPastTrip] : []), ...futureTrips];
}

interface WidgetDriverFilterProps {
  allDrivers: DriverRow[];
  qualifyingDriverIds: string[];
  selectedDriverIds: string[];
  onSelectedDriverIdsChange: (ids: string[]) => void;
  disabled: boolean;
}

function WidgetDriverFilter({
  allDrivers,
  qualifyingDriverIds,
  selectedDriverIds,
  onSelectedDriverIdsChange,
  disabled
}: WidgetDriverFilterProps) {
  const qualifyingSet = useMemo(
    () => new Set(qualifyingDriverIds),
    [qualifyingDriverIds]
  );

  const driversWithTrips = useMemo(
    () =>
      allDrivers
        .filter((driver) => qualifyingSet.has(driver.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [allDrivers, qualifyingSet]
  );

  const driversWithoutTrips = useMemo(
    () =>
      allDrivers
        .filter((driver) => !qualifyingSet.has(driver.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [allDrivers, qualifyingSet]
  );

  const allQualifyingSelected =
    qualifyingDriverIds.length > 0 &&
    qualifyingDriverIds.every((id) => selectedDriverIds.includes(id));
  const noneSelected = selectedDriverIds.length === 0;

  const triggerLabel = allQualifyingSelected
    ? 'Alle Fahrer'
    : noneSelected
      ? 'Kein Fahrer'
      : `${selectedDriverIds.length} Fahrer`;

  const toggleAll = () => {
    if (allQualifyingSelected) {
      onSelectedDriverIdsChange([]);
      return;
    }
    onSelectedDriverIdsChange(qualifyingDriverIds);
  };

  const toggleDriver = (driverId: string, checked: boolean) => {
    if (checked) {
      onSelectedDriverIdsChange([...selectedDriverIds, driverId]);
      return;
    }
    onSelectedDriverIdsChange(
      selectedDriverIds.filter((id) => id !== driverId)
    );
  };

  const renderDriverRow = (driver: DriverRow) => {
    const checked = selectedDriverIds.includes(driver.id);
    return (
      <label
        key={driver.id}
        className='hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded px-2 py-1'
      >
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => toggleDriver(driver.id, value === true)}
        />
        <span className='text-sm'>{driver.name}</span>
      </label>
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-9 shrink-0 gap-1 px-2.5'
          disabled={disabled || allDrivers.length === 0}
        >
          <span className='text-sm'>{triggerLabel}</span>
          <ChevronDown className='h-3.5 w-3.5 opacity-60' />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-56 p-2'>
        <button
          type='button'
          className='text-muted-foreground hover:text-foreground mb-1 w-full rounded px-2 py-1 text-left text-xs font-medium'
          onClick={toggleAll}
        >
          {allQualifyingSelected ? 'Alle abwählen' : 'Alle auswählen'}
        </button>
        <div className='flex max-h-64 flex-col overflow-y-auto'>
          {driversWithTrips.length > 0 ? (
            <>
              <p className='text-muted-foreground px-2 py-1 text-xs'>
                Mit Fahrten
              </p>
              {driversWithTrips.map(renderDriverRow)}
            </>
          ) : null}
          {driversWithTrips.length > 0 && driversWithoutTrips.length > 0 ? (
            <Separator className='my-1' />
          ) : null}
          {driversWithoutTrips.length > 0 ? (
            <>
              <p className='text-muted-foreground px-2 py-1 text-xs'>
                Ohne Fahrten
              </p>
              {driversWithoutTrips.map(renderDriverRow)}
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Modal shell for the day-scoped mini-Kanban.
 * Decoupled from Fahrten RSC refresh and Kanban pending store — TanStack Query only.
 */
export function TripsOverviewWidgetDialog({
  open,
  onOpenChange,
  dateYmd,
  onDateChange
}: TripsOverviewWidgetDialogProps) {
  const effectiveDate = dateYmd || todayYmdInBusinessTz();
  const isToday = effectiveDate === todayYmdInBusinessTz();
  const { trips, isLoading, isError } = useTripsOverviewWidget(effectiveDate, {
    enabled: open
  });
  const { data: drivers = [] } = useDriversQuery();
  const { assignDriver, isAssigning } = useWidgetTripAssignment();
  const isNarrow = useIsNarrowScreen(768);
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<KanbanTrip | null>(null);

  const kanbanTrips = trips as KanbanTrip[];

  const visibleTrips = useMemo(
    () => deriveVisibleTrips(kanbanTrips, isToday),
    [kanbanTrips, isToday]
  );

  const qualifyingDriverIds = useMemo(
    () => deriveQualifyingDriverIds(visibleTrips),
    [visibleTrips]
  );

  const qualifyingDriverIdsKey = qualifyingDriverIds.join(',');

  useEffect(() => {
    setSelectedDriverIds(
      qualifyingDriverIdsKey.length > 0 ? qualifyingDriverIdsKey.split(',') : []
    );
  }, [qualifyingDriverIdsKey]);

  // Desktop: drag is the primary reassignment path; tap-to-drawer would conflict.
  const handleCardClick = (trip: KanbanTrip) => {
    if (!isNarrow) return;
    setSelectedTrip(trip);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex h-full max-h-[100dvh] min-h-0 w-full max-w-none flex-col gap-0 overflow-hidden p-0',
          'fixed inset-0 h-[100dvh] translate-x-0 translate-y-0 rounded-none border-0',
          'sm:inset-auto sm:top-[50%] sm:left-[50%] sm:h-full sm:max-h-[85vh] sm:w-full sm:max-w-[90vw] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-0'
        )}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className='flex h-full min-h-0 flex-col'>
          <DialogHeader className='shrink-0 space-y-0 border-b px-4 py-2 pr-10 sm:px-6'>
            <DialogTitle className='sr-only'>Fahrtenübersicht</DialogTitle>
            <DialogDescription className='sr-only'>
              Fahrten nach Fahrer — Zuweisungen werden sofort gespeichert.
            </DialogDescription>

            <div className='grid grid-cols-[1fr_auto_1fr] items-center'>
              <div aria-hidden='true' />

              <TripsOverviewWidgetDateNav
                dateYmd={effectiveDate}
                onDateChange={onDateChange}
              />

              <div className='justify-self-end'>
                <WidgetDriverFilter
                  allDrivers={drivers}
                  qualifyingDriverIds={qualifyingDriverIds}
                  selectedDriverIds={selectedDriverIds}
                  onSelectedDriverIdsChange={setSelectedDriverIds}
                  disabled={isLoading}
                />
              </div>
            </div>
          </DialogHeader>

          <div className='flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-6'>
            <TripsOverviewWidgetBoard
              trips={visibleTrips}
              drivers={drivers}
              selectedDriverIds={selectedDriverIds}
              isLoading={isLoading}
              isError={isError}
              onAssign={(trip, newDriverId) =>
                assignDriver({ trip, newDriverId })
              }
              onCardClick={handleCardClick}
            />
            <TripsOverviewWidgetReassignDrawer
              trip={selectedTrip}
              drivers={drivers}
              onAssign={(trip, newDriverId) => {
                assignDriver({ trip, newDriverId });
                setSelectedTrip(null);
              }}
              isPending={isAssigning}
              open={selectedTrip !== null}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setSelectedTrip(null);
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
