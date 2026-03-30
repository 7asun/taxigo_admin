'use client';

import { format, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { ArrowLeftRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Trip } from '@/features/trips/api/trips.service';
import { getTripDirection } from '@/features/trips/lib/trip-direction';

export interface LinkedPartnerCalloutProps {
  anchorTrip: Trip;
  partner: Trip;
  statusClass: string;
  statusLabel: string;
  onNavigateToTrip?: (tripId: string) => void;
}

export function LinkedPartnerCallout({
  anchorTrip,
  partner,
  statusClass,
  statusLabel,
  onNavigateToTrip
}: LinkedPartnerCalloutProps) {
  const dir = getTripDirection(partner);
  const typeShort =
    dir === 'rueckfahrt'
      ? 'Rückfahrt'
      : dir === 'hinfahrt'
        ? 'Hinfahrt'
        : 'Gegenfahrt';
  const legAction =
    dir === 'rueckfahrt'
      ? 'Rückfahrt öffnen'
      : dir === 'hinfahrt'
        ? 'Hinfahrt öffnen'
        : 'Gegenfahrt öffnen';

  const partnerDate = partner.scheduled_at
    ? new Date(partner.scheduled_at)
    : null;
  const anchorDate = anchorTrip.scheduled_at
    ? new Date(anchorTrip.scheduled_at)
    : null;
  const showDate =
    !!partnerDate && (!anchorDate || !isSameDay(partnerDate, anchorDate));

  const timeStr = partnerDate != null ? format(partnerDate, 'HH:mm') : '—';

  return (
    <section aria-label='Verknüpfte Gegenfahrt'>
      <p className='text-muted-foreground mb-1.5 text-[10px] font-bold tracking-widest uppercase'>
        Verknüpfte Fahrt
      </p>
      <TooltipProvider delayDuration={200}>
        <div className='bg-muted/40 border-border flex min-h-9 items-center gap-2 rounded-lg border px-2 py-1.5 pr-1'>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                className={cn(
                  'text-foreground flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs',
                  'hover:bg-muted/80 -mx-1 rounded-md px-1 py-0.5 transition-colors',
                  'focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-offset-2'
                )}
              >
                <span className='text-muted-foreground shrink-0 font-semibold'>
                  {typeShort}
                </span>
                {showDate && partnerDate != null && (
                  <>
                    <span className='text-muted-foreground/80' aria-hidden>
                      ·
                    </span>
                    <span className='text-muted-foreground shrink-0 tabular-nums'>
                      {format(partnerDate, 'dd.MM.yyyy', { locale: de })}
                    </span>
                  </>
                )}
                <span className='text-muted-foreground/80' aria-hidden>
                  ·
                </span>
                <span className='text-muted-foreground shrink-0 text-[11px] font-medium'>
                  Uhrzeit
                </span>
                <span className='shrink-0 font-medium tabular-nums'>
                  {timeStr}
                </span>
                <span className='text-muted-foreground/80' aria-hidden>
                  ·
                </span>
                <Badge
                  className={cn(
                    'h-5 max-w-[7rem] shrink-0 truncate px-1.5 py-0 text-[9px]',
                    statusClass
                  )}
                >
                  {statusLabel}
                </Badge>
              </button>
            </TooltipTrigger>
            <TooltipContent
              side='bottom'
              align='start'
              className={cn(
                'border-border bg-muted/95 text-foreground max-w-sm space-y-2 border text-left shadow-md backdrop-blur-sm'
              )}
              arrowClassName='bg-muted/95 fill-muted/95'
            >
              <p className='bg-background/80 border-border/60 text-foreground rounded-md border px-2 py-1.5 text-xs font-semibold'>
                {dir === 'rueckfahrt'
                  ? 'Rückfahrt'
                  : dir === 'hinfahrt'
                    ? 'Hinfahrt'
                    : 'Gegenfahrt'}
                {partnerDate != null && (
                  <span className='text-muted-foreground font-normal'>
                    {' '}
                    · {format(partnerDate, 'PPP', { locale: de })}{' '}
                    <span className='text-foreground font-medium'>
                      Uhrzeit {format(partnerDate, 'HH:mm')}
                    </span>
                  </span>
                )}
              </p>
              <div className='space-y-1.5 text-xs leading-snug'>
                <p className='text-foreground rounded-r-md border-l-2 border-sky-500/45 bg-sky-500/8 py-1 pr-1 pl-2'>
                  <span className='font-medium text-sky-700 dark:text-sky-300'>
                    Von:{' '}
                  </span>
                  <span className='text-muted-foreground'>
                    {partner.pickup_address || '—'}
                    {partner.pickup_station
                      ? ` (${partner.pickup_station})`
                      : ''}
                  </span>
                </p>
                <p className='text-foreground rounded-r-md border-l-2 border-emerald-500/45 bg-emerald-500/8 py-1 pr-1 pl-2'>
                  <span className='font-medium text-emerald-700 dark:text-emerald-300'>
                    Nach:{' '}
                  </span>
                  <span className='text-muted-foreground'>
                    {partner.dropoff_address || '—'}
                    {partner.dropoff_station
                      ? ` (${partner.dropoff_station})`
                      : ''}
                  </span>
                </p>
                {partner.client_name && (
                  <p className='text-foreground'>
                    <span className='font-medium text-violet-700 dark:text-violet-300'>
                      Fahrgast:{' '}
                    </span>
                    <span className='text-muted-foreground'>
                      {partner.client_name}
                    </span>
                  </p>
                )}
                {partner.driving_distance_km != null &&
                  partner.driving_distance_km > 0 && (
                    <p className='text-foreground'>
                      <span className='font-medium text-amber-700 dark:text-amber-300'>
                        Distanz:{' '}
                      </span>
                      <span className='text-muted-foreground'>
                        {partner.driving_distance_km} km
                      </span>
                    </p>
                  )}
                {partner.notes?.trim() && (
                  <p className='border-border text-foreground border-t pt-1.5'>
                    <span className='font-medium text-orange-800 dark:text-orange-200'>
                      Hinweise:{' '}
                    </span>
                    <span className='text-muted-foreground'>
                      {partner.notes}
                    </span>
                  </p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
          <Button
            type='button'
            variant='outline'
            size='icon'
            className='text-foreground h-8 w-8 shrink-0'
            disabled={!onNavigateToTrip}
            title={
              onNavigateToTrip
                ? legAction
                : 'Navigation in diesem Kontext nicht verfügbar'
            }
            aria-label={legAction}
            onClick={() => {
              if (onNavigateToTrip && partner.id) {
                onNavigateToTrip(partner.id);
              }
            }}
          >
            <ArrowLeftRight className='h-4 w-4' />
          </Button>
        </div>
      </TooltipProvider>
    </section>
  );
}
