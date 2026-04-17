'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { set, format } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Loader2, PlusCircle } from 'lucide-react';
import { tripsService, type Trip } from '@/features/trips/api/trips.service';
import { referenceKeys, tripKeys } from '@/query/keys';
import {
  useTimelessRuleTrips,
  type TimelessRulePair
} from '@/features/dashboard/hooks/use-timeless-rule-trips';
import { fetchPayers } from '@/features/trips/api/trip-reference-data';

function formatHm(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

function firstAddressLine(address: string | null): string {
  if (!address) return '—';
  return address.split(',')[0] || address;
}

type EditableLeg = {
  trip: Trip;
  time: string;
  setTime: (v: string) => void;
};

function isTimeless(trip: Trip | null): trip is Trip {
  return !!trip && trip.scheduled_at === null;
}

function TimelessRulePairRow({ pair }: { pair: TimelessRulePair }) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [outboundTime, setOutboundTime] = useState('');
  const [returnTime, setReturnTime] = useState('');

  const outboundEditable: EditableLeg | null = isTimeless(pair.outbound)
    ? { trip: pair.outbound, time: outboundTime, setTime: setOutboundTime }
    : null;

  const returnEditable: EditableLeg | null = isTimeless(pair.return)
    ? { trip: pair.return, time: returnTime, setTime: setReturnTime }
    : null;

  const canSave =
    (outboundEditable?.time?.trim() ? true : false) ||
    (returnEditable?.time?.trim() ? true : false);

  const handleSave = async () => {
    const edits: EditableLeg[] = [];
    if (outboundEditable?.time.trim()) edits.push(outboundEditable);
    if (returnEditable?.time.trim()) edits.push(returnEditable);

    if (edits.length === 0) {
      toast.error('Bitte geben Sie mindestens eine Abholzeit ein.');
      return;
    }

    try {
      setIsSubmitting(true);

      for (const e of edits) {
        const [hours, minutes] = e.time.split(':');
        const scheduledDate = set(new Date(pair.requested_date), {
          hours: parseInt(hours, 10),
          minutes: parseInt(minutes, 10),
          seconds: 0,
          milliseconds: 0
        });

        // No driver assignment and no status mutation here: the widget only confirms a time.
        await tripsService.updateTrip(e.trip.id, {
          scheduled_at: scheduledDate.toISOString()
        });

        void queryClient.invalidateQueries({
          queryKey: tripKeys.detail(e.trip.id)
        });
      }

      void queryClient.invalidateQueries({
        queryKey: tripKeys.timelessRuleTripsRoot
      });

      toast.success(`Zeit für ${pair.client_name || 'Fahrt'} gesetzt.`);
      setOutboundTime('');
      setReturnTime('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Fehler: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
      <div className='w-full min-w-0 flex-1 sm:w-auto'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm font-semibold'>
            {pair.client_name || 'Unbekannt'}
          </span>
          <Badge variant='outline' className='px-1.5 py-0 text-xs'>
            {format(new Date(pair.requested_date), 'dd.MM.yyyy')}
          </Badge>
        </div>
        <p className='text-muted-foreground line-clamp-1 text-xs'>
          {firstAddressLine(pair.pickup_address)} →{' '}
          {firstAddressLine(pair.dropoff_address)}
        </p>
      </div>

      <div className='flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end'>
        {/* Hinfahrt */}
        <div className='min-w-0 flex-1 sm:w-28 sm:flex-none'>
          <div className='text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase'>
            Hinfahrt
          </div>
          {pair.outbound == null ? (
            <div className='text-muted-foreground h-8 text-xs leading-8'>—</div>
          ) : pair.outbound.scheduled_at ? (
            <div className='text-muted-foreground h-8 text-xs leading-8'>
              bereits geplant: {formatHm(pair.outbound.scheduled_at)}
            </div>
          ) : (
            <Input
              type='time'
              value={outboundTime}
              onChange={(e) => setOutboundTime(e.target.value)}
              className='h-8 text-xs'
              disabled={isSubmitting}
            />
          )}
        </div>

        {/* Rückfahrt */}
        <div className='min-w-0 flex-1 sm:w-28 sm:flex-none'>
          <div className='text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase'>
            Rückfahrt
          </div>
          {pair.return == null ? (
            <div className='text-muted-foreground h-8 text-xs leading-8'>—</div>
          ) : pair.return.scheduled_at ? (
            <div className='text-muted-foreground h-8 text-xs leading-8'>
              bereits geplant: {formatHm(pair.return.scheduled_at)}
            </div>
          ) : (
            <Input
              type='time'
              value={returnTime}
              onChange={(e) => setReturnTime(e.target.value)}
              className='h-8 text-xs'
              disabled={isSubmitting}
            />
          )}
        </div>

        <Button
          size='sm'
          className='h-8 px-2'
          onClick={handleSave}
          disabled={!canSave || isSubmitting}
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

export function TimelessRuleTripsWidget() {
  const { pairs, isLoading } = useTimelessRuleTrips();
  const [payerFilterId, setPayerFilterId] = useState<string>('all');

  const payersQuery = useQuery({
    queryKey: referenceKeys.payers(),
    queryFn: fetchPayers,
    staleTime: 5 * 60_000
  });

  const filteredPairs = useMemo(() => {
    if (payerFilterId === 'all') return pairs;
    return pairs.filter((p) => {
      const pid = p.outbound?.payer_id ?? p.return?.payer_id ?? null;
      return pid === payerFilterId;
    });
  }, [pairs, payerFilterId]);

  const description = useMemo(() => {
    const count = filteredPairs.length;
    if (count === 0) return 'Alle Fahrten geplant';
    return `${count} Fahrten morgen ohne Zeit`;
  }, [filteredPairs.length]);

  if (isLoading) {
    return (
      <Card className='h-full'>
        <CardHeader>
          <CardTitle>Wiederkehrende Trips</CardTitle>
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
        <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
          <div className='space-y-1'>
            <CardTitle>Wiederkehrende Trips</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className='w-full sm:w-[240px]'>
            <Select
              value={payerFilterId}
              onValueChange={(v) => setPayerFilterId(v)}
            >
              <SelectTrigger className='h-8 w-full text-xs'>
                <SelectValue placeholder='Kostenträger' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all' className='text-xs'>
                  Alle Kostenträger
                </SelectItem>
                {(payersQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className='text-xs'>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filteredPairs.length === 0 ? (
          <div className='border-muted flex h-32 items-center justify-center rounded-lg border-2 border-dashed'>
            <p className='text-muted-foreground text-sm italic'>
              Keine timeless rule trips für morgen.
            </p>
          </div>
        ) : (
          <div className='space-y-3'>
            {filteredPairs.map((p) => (
              <TimelessRulePairRow key={p.id} pair={p} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
