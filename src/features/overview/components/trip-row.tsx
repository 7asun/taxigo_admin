'use client';

import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Accessibility, AlertTriangle, Share2, Users } from 'lucide-react';
import { copyTripToClipboard } from '@/features/trips/lib/share-utils';
import { getCancelledPartnerLabel } from '@/features/trips/lib/trip-direction';
import { toast } from 'sonner';
import {
  tripStatusBadge,
  tripStatusLabels,
  type TripStatus
} from '@/lib/trip-status';
import { UrgencyIndicator } from '@/features/trips/components/urgency-indicator';
import {
  billingFamilyFromEmbed,
  formatBillingDisplayLabel
} from '@/features/trips/lib/format-billing-display-label';

interface TripRowProps {
  trip: any;
  onClick: () => void;
  compact?: boolean;
  showDate?: boolean;
}

export function TripRow({
  trip,
  onClick,
  compact = false,
  showDate = false
}: TripRowProps) {
  const scheduledTime = trip.scheduled_at
    ? format(new Date(trip.scheduled_at), 'HH:mm')
    : '--:--';

  const bv = trip.billing_variant;
  const fam = billingFamilyFromEmbed(bv?.billing_types);
  const rowColor = fam?.color || 'transparent';
  /** Same rules as Fahrten-Tabelle / Sheet: Standard-Unterart → nur Familienname. */
  const billingLabel = formatBillingDisplayLabel(bv);
  const payerName =
    trip.payer?.name?.trim() ||
    (
      trip.payers as { name?: string | null } | null | undefined
    )?.name?.trim() ||
    '';
  const lineBelowTime = billingLabel || payerName;

  const isGrouped = !!trip.group_id;
  const tripStatus = (trip.status as TripStatus) ?? 'pending';
  const partnerCancelled = trip.linked_partner_status === 'cancelled';
  const selfCancelled = tripStatus === 'cancelled';
  const bothLegsCancelled = partnerCancelled && selfCancelled;

  const formatDropoffAddress = (address: string | null | undefined) => {
    if (!address) return 'Keine Zieladresse';

    const zipCityMatch = address.match(/\b(\d{5})\s+(.*)$/);
    if (zipCityMatch) {
      const isOldenburg = /oldenburg/i.test(zipCityMatch[2]);
      if (isOldenburg) {
        // Oldenburg: Do not show Zip and City
        return (
          address.replace(/(?:,\s*)?\b\d{5}\s+Oldenburg[\s\S]*$/i, '').trim() ||
          'Keine Zieladresse'
        );
      }
    }

    // Not Oldenburg: Show full address (streetname+number and zip+city)
    return address;
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'group mb-0 flex cursor-pointer items-start rounded-lg p-2 transition-all select-none',
        rowColor === 'transparent' ? 'hover:bg-muted/50' : 'hover:brightness-95'
      )}
      style={{
        backgroundColor:
          rowColor !== 'transparent'
            ? `color-mix(in srgb, ${rowColor}, var(--background) 85%)`
            : undefined,
        // Same 4px slot for every row so times align; transparent when no billing color.
        borderLeft: `4px solid ${rowColor === 'transparent' ? 'transparent' : rowColor}`
      }}
    >
      <div
        className={cn(
          'flex min-w-0 shrink-0 items-start gap-1.5',
          compact ? 'min-h-8' : 'min-h-10'
        )}
      >
        <div className='flex w-4 shrink-0 justify-center pt-0.5'>
          <UrgencyIndicator
            scheduledAt={trip.scheduled_at}
            status={trip.status}
            variant='dot'
          />
        </div>
        {/* Time first; Abrechnung (or Kostenträger if empty) directly underneath. */}
        <div
          className={cn(
            'flex min-w-0 shrink-0 flex-col gap-0.5',
            compact ? 'text-sm' : 'text-lg'
          )}
        >
          <div
            className={cn(
              'text-primary w-[4.5ch] leading-none font-bold tabular-nums sm:w-[5ch]',
              compact ? 'text-sm' : 'text-lg'
            )}
          >
            {scheduledTime}
          </div>
          {lineBelowTime ? (
            <div
              className={cn(
                'text-muted-foreground max-w-full text-[10px] leading-snug font-medium wrap-break-word',
                compact
                  ? 'max-w-[min(52vw,11rem)] sm:max-w-[13rem]'
                  : 'max-w-[min(56vw,12rem)] sm:max-w-[14rem]'
              )}
            >
              {lineBelowTime}
            </div>
          ) : null}
          {showDate && trip.scheduled_at && (
            <div className='text-muted-foreground text-[10px] font-medium'>
              {format(new Date(trip.scheduled_at), 'dd.MM.yy')}
            </div>
          )}
        </div>
      </div>
      <div className='ml-4 min-w-0 flex-1 space-y-1'>
        <div className='flex flex-wrap items-start gap-2'>
          <p
            className={cn(
              'group-hover:text-primary min-w-0 leading-none font-semibold transition-colors',
              compact ? 'text-xs' : 'text-sm'
            )}
          >
            {trip.client_name || 'Unbekannter Kunde'}
          </p>
          {trip.is_wheelchair && (
            <Badge
              variant='outline'
              title='Rollstuhl'
              aria-label='Rollstuhl'
              className={cn(
                'shrink-0 border-rose-200 bg-rose-50 px-1 py-0 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400',
                'inline-flex size-4 items-center justify-center p-0 [&>svg]:size-2.5',
                !compact && 'size-5 [&>svg]:size-3'
              )}
            >
              <Accessibility aria-hidden />
            </Badge>
          )}
          {isGrouped && (
            <div className='flex shrink-0 items-center gap-0.5 rounded-full border border-sky-200 bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400'>
              <Users className='h-2.5 w-2.5' /> Gruppe
            </div>
          )}
        </div>
        <p className='text-muted-foreground line-clamp-1 text-xs'>
          {formatDropoffAddress(trip.dropoff_address)}
        </p>
      </div>
      <div className='ml-4 flex flex-col items-end gap-1.5'>
        <div className='flex items-center gap-1.5'>
          {bothLegsCancelled ? (
            <Badge
              className={cn(
                tripStatusBadge({ status: 'cancelled' }),
                'flex items-center gap-0.5 px-2 py-0 whitespace-nowrap',
                compact ? 'h-4 text-[9px]' : 'h-5 text-[10px]'
              )}
            >
              <AlertTriangle className='h-2.5 w-2.5 shrink-0' aria-hidden />
              Beides storniert
            </Badge>
          ) : (
            <>
              {partnerCancelled && (
                <div
                  className={cn(
                    tripStatusBadge({ status: 'cancelled' }),
                    'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold whitespace-nowrap'
                  )}
                >
                  <AlertTriangle className='h-2.5 w-2.5 shrink-0' aria-hidden />
                  {getCancelledPartnerLabel(trip)}
                </div>
              )}
              <Badge
                className={cn(
                  tripStatusBadge({ status: tripStatus }),
                  'px-2 py-0 whitespace-nowrap',
                  compact ? 'h-4 text-[9px]' : 'h-5 text-[10px]'
                )}
              >
                {tripStatusLabels[tripStatus] ?? trip.status}
              </Badge>
            </>
          )}
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const success = await copyTripToClipboard(trip);
              if (success) {
                toast.success('Details kopiert');
              } else {
                toast.error('Fehler');
              }
            }}
            className='hover:bg-primary/10 border-border bg-background/50 text-muted-foreground hover:text-primary flex h-6 w-6 items-center justify-center rounded-md border transition-colors'
            title='QuickShare (WhatsApp)'
          >
            <Share2 className='h-3.5 w-3.5' />
          </button>
        </div>
        <p className='text-muted-foreground text-[10px] font-bold tracking-wider whitespace-nowrap uppercase'>
          Fahrer:{' '}
          <span className='text-foreground font-medium'>
            {trip.driver?.name || '---'}
          </span>
        </p>
      </div>
    </div>
  );
}
