'use client';

import { useState } from 'react';
import { unassignedTripsService } from '../api/unassigned-trips.service';
import type {
  UnassignedTripsByPayer,
  BillingVariantWithType
} from '../types/unassigned-trips.types';
import { TripRow } from './trip-row';
import { NoBillingTypesWarning } from './no-billing-types-warning';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { IconCheck } from '@tabler/icons-react';

interface PayerGroupProps {
  group: UnassignedTripsByPayer;
  selectedTrips: Record<string, boolean>;
  onTripSelect: (trip: any, selected: boolean) => void;
  onSelectAll: (payerId: string, selected: boolean) => void;
  onBulkAssign: (tripIds: string[], billingVariantId: string) => void;
  isAssigning: boolean;
}

export function PayerGroup({
  group,
  selectedTrips,
  onTripSelect,
  onSelectAll,
  onBulkAssign,
  isAssigning
}: PayerGroupProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isAssigningLocal, setIsAssigningLocal] = useState(false);

  const selectedCount = group.trips.filter((t) => selectedTrips[t.id]).length;
  const allSelected =
    selectedCount === group.trips.length && group.trips.length > 0;
  const someSelected = selectedCount > 0 && !allSelected;

  const handleSelectAll = () => {
    onSelectAll(group.payerId, !allSelected);
  };

  const handleAssign = async (billingVariantId: string) => {
    const tripIds = group.trips
      .filter((t) => selectedTrips[t.id])
      .map((t) => t.id);

    if (tripIds.length === 0) return;

    setIsAssigningLocal(true);
    try {
      await onBulkAssign(tripIds, billingVariantId);
    } finally {
      setIsAssigningLocal(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className='bg-card rounded-lg border'>
        {/* Header */}
        <CollapsibleTrigger asChild>
          <div className='hover:bg-accent/50 flex cursor-pointer items-center gap-3 border-b p-4'>
            <div className='flex items-center gap-2'>
              {isOpen ? (
                <ChevronDown className='h-4 w-4' />
              ) : (
                <ChevronRight className='h-4 w-4' />
              )}
              <span className='font-semibold'>{group.payerName}</span>
              <span className='text-muted-foreground text-sm'>
                — {group.trips.length} Fahrten ohne Abrechnungsart
              </span>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className='p-4 pt-0'>
            {/* Actions bar */}
            <div className='mb-4 flex items-center justify-between border-b pb-3'>
              <div className='flex items-center gap-3'>
                <Checkbox
                  id={`select-all-${group.payerId}`}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) {
                      (el as HTMLInputElement).indeterminate = someSelected;
                    }
                  }}
                  onCheckedChange={handleSelectAll}
                />
                <label
                  htmlFor={`select-all-${group.payerId}`}
                  className='cursor-pointer text-sm font-medium'
                >
                  Alle auswählen
                </label>
              </div>

              {selectedCount > 0 && group.billingVariants.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='default'
                      size='sm'
                      disabled={isAssigning || isAssigningLocal}
                    >
                      Abrechnungsart zuweisen
                      <ChevronDown className='ml-2 h-4 w-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    {group.billingVariants.map((variant) => (
                      <DropdownMenuItem
                        key={variant.id}
                        onClick={() => handleAssign(variant.id)}
                        disabled={isAssigning || isAssigningLocal}
                      >
                        <div className='flex flex-col'>
                          <span className='font-medium'>{variant.name}</span>
                          <span className='text-muted-foreground text-xs'>
                            {variant.code}
                            {variant.billing_type?.name
                              ? ` — ${variant.billing_type.name}`
                              : ''}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* No billing types warning */}
            {group.billingVariants.length === 0 && (
              <NoBillingTypesWarning payerId={group.payerId} />
            )}

            {/* Trip list */}
            <div className='space-y-2'>
              <div className='text-muted-foreground grid grid-cols-[auto_1fr_1fr_auto_auto_auto] gap-4 px-2 text-sm font-medium'>
                <div className='w-4' /> {/* Checkbox column */}
                <div>Datum</div>
                <div>Route</div>
                <div className='text-right'>km</div>
                <div className='text-right'>Preis</div>
                <div>Typ</div>
              </div>

              {group.trips.map((trip) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  isSelected={selectedTrips[trip.id] || false}
                  onSelect={(selected: boolean) => onTripSelect(trip, selected)}
                  isLinkedSelected={
                    trip.linked_trip_id
                      ? selectedTrips[trip.linked_trip_id] || false
                      : false
                  }
                />
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
