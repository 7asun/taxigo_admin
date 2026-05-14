'use client';

import { Skeleton } from '@/components/ui/skeleton';

import { TripInvoiceStatusBadge } from '@/features/trips/components/trip-invoice-status-badge';
import { useTripInvoiceStatusLineItemsForRow } from '@/features/trips/components/trip-invoice-statuses-context';

export function TripInvoiceStatusBadgeCell({ tripId }: { tripId: string }) {
  const { isLoading, lineItems } = useTripInvoiceStatusLineItemsForRow(tripId);
  if (isLoading) {
    return (
      <Skeleton className='mx-auto h-5 w-[5.5rem] rounded-full' aria-hidden />
    );
  }
  return <TripInvoiceStatusBadge lineItems={lineItems} />;
}
