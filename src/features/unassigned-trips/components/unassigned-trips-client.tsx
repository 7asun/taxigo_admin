'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { unassignedTripsService } from '../api/unassigned-trips.service';
import type {
  UnassignedTrip,
  UnassignedTripsByPayer
} from '../types/unassigned-trips.types';
import { UnassignedTripsFilterBar } from './filter-bar';
import { PayerGroup } from './payer-group';
import { BulkActionBar } from './bulk-action-bar';
import { EmptyState } from './empty-state';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface UnassignedTripsClientProps {
  initialGroupedTrips: UnassignedTripsByPayer[];
  initialTotalTrips: number;
  initialTotalPayers: number;
}

export function UnassignedTripsClient({
  initialGroupedTrips,
  initialTotalTrips,
  initialTotalPayers
}: UnassignedTripsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // URL state
  const payerIdsParam = searchParams.get('payer_ids');
  const dateFromParam = searchParams.get('date_from');
  const dateToParam = searchParams.get('date_to');

  const [selectedPayerIds, setSelectedPayerIds] = useState<string[]>(
    payerIdsParam ? payerIdsParam.split(',').filter(Boolean) : []
  );
  const [dateFrom, setDateFrom] = useState<string | null>(dateFromParam);
  const [dateTo, setDateTo] = useState<string | null>(dateToParam);

  // Selection state - map of tripId to selected boolean
  const [selectedTrips, setSelectedTrips] = useState<Record<string, boolean>>(
    {}
  );

  // Update URL when filters change
  const updateUrl = useCallback(
    (payers: string[], from: string | null, to: string | null) => {
      const params = new URLSearchParams();
      if (payers.length > 0) params.set('payer_ids', payers.join(','));
      if (from) params.set('date_from', from);
      if (to) params.set('date_to', to);

      const newUrl = params.toString()
        ? `?${params.toString()}`
        : '/dashboard/settings/unzugeordnete-fahrten';
      router.push(newUrl, { scroll: false });
    },
    [router]
  );

  // Fetch data
  const { data: groupedTrips, isLoading } = useQuery({
    queryKey: ['unassigned-trips', selectedPayerIds, dateFrom, dateTo],
    queryFn: () =>
      unassignedTripsService.getUnassignedTripsGrouped(
        selectedPayerIds,
        dateFrom,
        dateTo
      ),
    initialData: initialGroupedTrips,
    staleTime: 30000
  });

  // Mutation for assigning billing variants
  const assignMutation = useMutation({
    mutationFn: ({
      tripIds,
      billingVariantId
    }: {
      tripIds: string[];
      billingVariantId: string;
    }) =>
      unassignedTripsService.assignBillingVariant(tripIds, billingVariantId),
    onSuccess: () => {
      // Clear selections and refresh data
      setSelectedTrips({});
      queryClient.invalidateQueries({ queryKey: ['unassigned-trips'] });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    }
  });

  // Computed values
  const totalTrips = useMemo(
    () =>
      groupedTrips?.reduce((sum, group) => sum + group.trips.length, 0) ?? 0,
    [groupedTrips]
  );

  const totalPayers = useMemo(() => groupedTrips?.length ?? 0, [groupedTrips]);

  const selectedCount = useMemo(
    () => Object.values(selectedTrips).filter(Boolean).length,
    [selectedTrips]
  );

  // Get selected trip IDs for a specific payer
  const getSelectedTripIdsForPayer = useCallback(
    (payerId: string) => {
      const payerGroup = groupedTrips?.find((g) => g.payerId === payerId);
      if (!payerGroup) return [];

      return payerGroup.trips
        .filter((trip) => selectedTrips[trip.id])
        .map((trip) => trip.id);
    },
    [groupedTrips, selectedTrips]
  );

  // Handle trip selection with paired trip awareness
  const handleTripSelect = useCallback(
    (trip: UnassignedTrip, selected: boolean) => {
      setSelectedTrips((prev) => {
        const newState = { ...prev, [trip.id]: selected };

        // If selecting a return trip, also select its linked outbound trip
        if (selected && trip.link_type === 'return' && trip.linked_trip_id) {
          newState[trip.linked_trip_id] = true;
        }

        // If unselecting an outbound trip that has a return trip selected,
        // also unselect the return trip
        if (!selected && trip.link_type !== 'return') {
          // Find if there's a return trip linked to this one
          const payerGroup = groupedTrips?.find(
            (g) => g.payerId === trip.payer_id
          );
          const returnTrip = payerGroup?.trips.find(
            (t) => t.linked_trip_id === trip.id && t.link_type === 'return'
          );
          if (returnTrip && newState[returnTrip.id]) {
            newState[returnTrip.id] = false;
          }
        }

        return newState;
      });
    },
    [groupedTrips]
  );

  // Handle select all for a payer
  const handleSelectAllForPayer = useCallback(
    (payerId: string, selected: boolean) => {
      const payerGroup = groupedTrips?.find((g) => g.payerId === payerId);
      if (!payerGroup) return;

      setSelectedTrips((prev) => {
        const newState = { ...prev };
        payerGroup.trips.forEach((trip) => {
          newState[trip.id] = selected;
        });
        return newState;
      });
    },
    [groupedTrips]
  );

  // Handle filter changes
  const handlePayerChange = useCallback(
    (payers: string[]) => {
      setSelectedPayerIds(payers);
      updateUrl(payers, dateFrom, dateTo);
    },
    [dateFrom, dateTo, updateUrl]
  );

  const handleDateChange = useCallback(
    (from: string | null, to: string | null) => {
      setDateFrom(from);
      setDateTo(to);
      updateUrl(selectedPayerIds, from, to);
    },
    [selectedPayerIds, updateUrl]
  );

  // Handle bulk assignment
  const handleBulkAssign = useCallback(
    (tripIds: string[], billingVariantId: string) => {
      assignMutation.mutate({ tripIds, billingVariantId });
    },
    [assignMutation]
  );

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-32 w-full' />
        <Skeleton className='h-32 w-full' />
      </div>
    );
  }

  if (totalTrips === 0) {
    return (
      <div className='space-y-4'>
        <UnassignedTripsFilterBar
          selectedPayerIds={selectedPayerIds}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onPayerChange={handlePayerChange}
          onDateChange={handleDateChange}
        />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col space-y-4 overflow-hidden'>
      {/* Summary badge */}
      <div className='flex items-center gap-2'>
        <Badge variant='secondary' className='text-sm'>
          {totalTrips} Fahrten bei {totalPayers} Kostenträgern ohne
          Abrechnungsart
        </Badge>
      </div>

      {/* Filter bar */}
      <UnassignedTripsFilterBar
        selectedPayerIds={selectedPayerIds}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onPayerChange={handlePayerChange}
        onDateChange={handleDateChange}
      />

      {/* Payer groups */}
      <div className='flex-1 space-y-4 overflow-y-auto'>
        {groupedTrips?.map((group) => (
          <PayerGroup
            key={group.payerId}
            group={group}
            selectedTrips={selectedTrips}
            onTripSelect={handleTripSelect}
            onSelectAll={handleSelectAllForPayer}
            onBulkAssign={handleBulkAssign}
            isAssigning={assignMutation.isPending}
          />
        ))}
      </div>

      {/* Global bulk action bar */}
      <BulkActionBar
        selectedCount={selectedCount}
        selectedTrips={selectedTrips}
        groupedTrips={groupedTrips || []}
        onBulkAssign={handleBulkAssign}
        isAssigning={assignMutation.isPending}
      />
    </div>
  );
}
