'use client';

import { useState, useEffect } from 'react';
import {
  useUnplannedTrips,
  type UnplannedFilter
} from '@/features/dashboard/hooks/use-unplanned-trips';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { tripsService } from '@/features/trips/api/trips.service';
import { invalidateAfterTripSave } from '@/features/trips/lib/invalidate-after-trip-save';
import { buildAssignmentPatch } from '@/features/trips/lib/trip-assignee';
import { toast } from 'sonner';
import {
  PlusCircle,
  Loader2,
  ArrowLeftRight,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { UnplannedTrip } from '@/features/dashboard/hooks/use-unplanned-trips';
import {
  getCancelledPartnerLabel,
  getTripDirection
} from '@/features/trips/lib/trip-direction';
import { createClient } from '@/lib/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { format } from 'date-fns';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import {
  TripTimeError,
  buildScheduledAtOrNull,
  parseScheduledAtOrFallback
} from '@/features/trips/lib/trip-time';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { URGENCY_STYLES } from '@/features/trips/constants/urgency-config';
import { useUrgencyLevel } from '@/features/trips/hooks/use-urgency-level';
import { isTripUnassignedForDispatch } from '@/features/trips/lib/trip-assignee';

const FILTER_TABS: { value: UnplannedFilter; label: string }[] = [
  { value: 'today', label: 'Heute' },
  { value: 'week', label: 'Woche' },
  { value: 'all', label: 'All' }
];

/** Date/time/driver defaults for a row — same priority as mount and post-refetch sync. */
function getUnplannedRowFormDefaults(trip: UnplannedTrip): {
  dateStr: string;
  time: string;
  driverId: string | null;
} {
  let dateStr: string;
  if (trip.scheduled_at) {
    dateStr =
      parseScheduledAtOrFallback(trip.scheduled_at)?.ymd ??
      todayYmdInBusinessTz();
  } else if (trip.requested_date) {
    dateStr = trip.requested_date;
  } else {
    const linkedAt = trip.linked_trip?.scheduled_at;
    dateStr = linkedAt
      ? (parseScheduledAtOrFallback(linkedAt)?.ymd ?? todayYmdInBusinessTz())
      : todayYmdInBusinessTz();
  }

  const time = trip.scheduled_at
    ? (parseScheduledAtOrFallback(trip.scheduled_at)?.hm ?? '')
    : '';

  return {
    dateStr,
    time,
    driverId: trip.driver_id ?? null
  };
}

export function PendingToursWidget() {
  const [filter, setFilter] = useState<UnplannedFilter>('today');
  const { trips, isLoading } = useUnplannedTrips(filter);
  const [drivers, setDrivers] = useState<any[]>([]);

  useEffect(() => {
    const fetchDrivers = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('role', 'driver')
        .order('name');
      setDrivers(data || []);
    };
    fetchDrivers();
  }, []);

  if (isLoading) {
    return (
      <Card className='h-full'>
        <CardHeader>
          <CardTitle>Offene Touren</CardTitle>
          <CardDescription>Lade Fahrten...</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-12 w-full' />
          <Skeleton className='h-12 w-full' />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className='h-full'>
      <CardHeader>
        <CardTitle>Offene Touren</CardTitle>
        <CardDescription>
          {(() => {
            const noTime = trips.filter((t) => !t.scheduled_at).length;
            const noDriver = trips.filter(
              (t) => t.scheduled_at && isTripUnassignedForDispatch(t)
            ).length;
            const parts: string[] = [];
            if (noTime > 0) parts.push(`${noTime} ohne Zeit`);
            if (noDriver > 0) parts.push(`${noDriver} ohne Fahrer`);
            if (parts.length === 0) return 'Alle Fahrten geplant';
            return parts.join(' · ');
          })()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as UnplannedFilter)}
          className='w-full'
        >
          <TabsList className='grid w-full grid-cols-3'>
            {FILTER_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={filter} className='mt-4'>
            {trips.length === 0 ? (
              <div className='border-muted flex h-32 items-center justify-center rounded-lg border-2 border-dashed'>
                <p className='text-muted-foreground text-sm italic'>
                  Keine offenen Touren in dieser Ansicht.
                </p>
              </div>
            ) : (
              <div className='space-y-3'>
                {trips.map((trip) => (
                  <UnplannedTripRow
                    key={trip.id}
                    trip={trip}
                    drivers={drivers}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function UnplannedTripRow({
  trip,
  drivers
}: {
  trip: UnplannedTrip;
  drivers: any[];
}) {
  const queryClient = useQueryClient();
  // WHY shared hook + URGENCY_STYLES.rowClass (not local colors): same live cadence and
  // left-border tint as Fahrten mobile cards — avoids a third urgency palette in the widget.
  const urgencyLevel = useUrgencyLevel(trip.scheduled_at, trip.status);
  const urgencyRowClass = URGENCY_STYLES[urgencyLevel].rowClass;

  // Use the direction utility so legacy rows without link_type are handled via
  // the linked_trip_id fallback (see src/features/trips/lib/trip-direction.ts).
  const isReturnTrip = getTripDirection(trip) === 'rueckfahrt';
  const linkedPartnerCancelled = trip.linked_trip?.status === 'cancelled';
  const cancelledPartnerLabel = getCancelledPartnerLabel(trip);

  const formDefaults = getUnplannedRowFormDefaults(trip);
  const [dateStr, setDateStr] = useState(formDefaults.dateStr);
  const [time, setTime] = useState(formDefaults.time);
  const [driverId, setDriverId] = useState<string | null>(
    formDefaults.driverId
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // WHY sync from trip props: awaited unplanned invalidation refreshes cache but controlled
  // inputs stay on stale local state — clearing time after save showed `--:--` until remount.
  useEffect(() => {
    const next = getUnplannedRowFormDefaults(trip);
    setDateStr(next.dateStr);
    setTime(next.time);
    setDriverId(next.driverId);
  }, [
    trip.scheduled_at,
    trip.requested_date,
    trip.linked_trip?.scheduled_at,
    trip.driver_id
  ]);

  const handleSetTime = async () => {
    if (!time) {
      toast.error('Bitte geben Sie eine Abholzeit ein.');
      return;
    }

    try {
      setIsSubmitting(true);
      // WHY trip-time.ts (not `new Date(dateStr)` + `set`): server/client TZ mixes mis-store `scheduled_at`.
      let scheduledAtIso: string;
      try {
        const iso = buildScheduledAtOrNull(dateStr, time);
        if (!iso) {
          toast.error('Bitte Datum und Uhrzeit vollständig angeben.');
          return;
        }
        scheduledAtIso = iso;
      } catch (err) {
        if (err instanceof TripTimeError) {
          toast.error(err.message || 'Ungültige Datum/Uhrzeit.');
          return;
        }
        throw err;
      }

      const updatePayload: Parameters<typeof tripsService.updateTrip>[1] = {
        scheduled_at: scheduledAtIso
      };
      Object.assign(
        updatePayload,
        buildAssignmentPatch(trip, { driver_id: driverId })
      );

      await tripsService.updateTrip(trip.id, updatePayload);

      await invalidateAfterTripSave(queryClient, {
        tripIds: [trip.id],
        patch: updatePayload,
        includePlanningWidgets: true
      });

      toast.success(
        `Abholzeit ${driverId ? 'und Fahrer ' : ''}für ${trip.client_name || 'Fahrt'} gesetzt.`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Fehler: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const linkedOutboundTime = trip.linked_trip?.scheduled_at
    ? format(new Date(trip.linked_trip.scheduled_at), 'EEE dd.MM. HH:mm', {
        locale: de
      })
    : null;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
        urgencyRowClass
      )}
    >
      {/* Trip Information (Left) */}
      <div className='w-full min-w-0 flex-1 sm:w-auto'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <span className='text-sm font-semibold'>
            {trip.client_name || 'Unbekannt'}
          </span>
          {isReturnTrip && (
            <Badge variant='secondary' className='gap-1 px-1.5 py-0 text-xs'>
              <ArrowLeftRight className='h-3 w-3' />
              Rückfahrt
            </Badge>
          )}
          {linkedPartnerCancelled && (
            <Badge variant='destructive' className='gap-1 px-1.5 py-0 text-xs'>
              <AlertTriangle className='h-3 w-3' />
              {cancelledPartnerLabel}
            </Badge>
          )}
          {trip.requested_date && !isReturnTrip && (
            <Badge variant='outline' className='gap-1 px-1.5 py-0 text-xs'>
              <Calendar className='h-3 w-3' />
              Termin:{' '}
              {format(new Date(trip.requested_date), 'dd.MM.', {
                locale: de
              })}
            </Badge>
          )}
        </div>
        {trip.pickup_address && (
          <p className='text-muted-foreground line-clamp-1 text-xs'>
            {trip.pickup_address.split(',')[0]} →{' '}
            {trip.dropoff_address?.split(',')[0] || '—'}
          </p>
        )}
        {isReturnTrip && linkedOutboundTime && (
          <p className='text-muted-foreground mt-0.5 text-xs'>
            Hinfahrt: {linkedOutboundTime}
          </p>
        )}
      </div>
      {/* Scheduling controls — wrap / stack on narrow viewports so the row cannot force page-wide overflow */}
      <div className='flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:max-w-[min(100%,28rem)] sm:justify-end'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <Input
            type='date'
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className='h-8 min-w-0 flex-1 text-xs sm:w-28 sm:flex-none'
            disabled={isSubmitting}
          />
          <Input
            type='time'
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className='h-8 min-w-0 flex-1 text-xs sm:w-24 sm:flex-none'
            disabled={isSubmitting}
          />
        </div>

        <Select
          value={driverId || 'unassigned'}
          onValueChange={(v) => setDriverId(v === 'unassigned' ? null : v)}
        >
          <SelectTrigger className='h-8 min-w-[7.5rem] flex-1 text-xs sm:w-[120px] sm:flex-none'>
            <SelectValue placeholder='Fahrer' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='unassigned' className='text-xs italic'>
              Ohne Fahrer
            </SelectItem>
            {drivers.map((d) => (
              <SelectItem key={d.id} value={d.id} className='text-xs'>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size='sm'
          className='h-8 px-2'
          onClick={handleSetTime}
          disabled={!time || isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <PlusCircle className='h-4 w-4' />
          )}
        </Button>
      </div>
    </div>
  );
}
