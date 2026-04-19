'use client';

import type { UnassignedTrip } from '../types/unassigned-trips.types';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Link2 } from 'lucide-react';

interface TripRowProps {
  trip: UnassignedTrip;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
  isLinkedSelected: boolean;
}

export function TripRow({
  trip,
  isSelected,
  onSelect,
  isLinkedSelected
}: TripRowProps) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return 'null €';
    return `${price.toFixed(2)} €`;
  };

  const formatDistance = (km: number | null) => {
    if (km === null || km === undefined) return '-';
    return `${km.toFixed(2)} km`;
  };

  const getLinkTypeBadge = () => {
    switch (trip.link_type) {
      case 'outbound':
        return <Badge variant='outline'>Hinfahrt</Badge>;
      case 'return':
        return <Badge variant='secondary'>Rückfahrt</Badge>;
      default:
        return <Badge variant='outline'>—</Badge>;
    }
  };

  // Shorten addresses for display
  const shortenAddress = (address: string | null) => {
    if (!address) return '—';
    // Take first 40 chars and add ellipsis if needed
    return address.length > 40 ? `${address.slice(0, 40)}...` : address;
  };

  return (
    <div
      className={`grid grid-cols-[auto_1fr_1fr_auto_auto_auto] items-center gap-4 rounded-md border p-2 transition-colors ${
        isSelected ? 'bg-accent' : 'hover:bg-accent/50'
      } ${isLinkedSelected ? 'border-l-primary border-l-4' : ''}`}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={(checked: boolean | 'indeterminate') =>
          onSelect(checked as boolean)
        }
      />

      <div className='text-sm'>{formatDate(trip.scheduled_at)}</div>

      <div className='text-sm'>
        <div className='flex items-center gap-1'>
          {shortenAddress(trip.pickup_address)}
          <span className='text-muted-foreground'>→</span>
          {shortenAddress(trip.dropoff_address)}
        </div>
        {trip.linked_trip_id && (
          <div className='text-muted-foreground flex items-center gap-1 text-xs'>
            <Link2 className='h-3 w-3' />
            {trip.link_type === 'return'
              ? 'Gekoppelt mit Hinfahrt'
              : 'Hat Rückfahrt'}
          </div>
        )}
      </div>

      <div className='text-right text-sm'>
        {formatDistance(trip.driving_distance_km)}
      </div>

      <div className='text-right text-sm font-medium'>
        {formatPrice(trip.net_price)}
      </div>

      <div>{getLinkTypeBadge()}</div>
    </div>
  );
}
