'use client';

import { useState } from 'react';
import type {
  UnassignedTripsByPayer,
  BillingVariantWithType
} from '../types/unassigned-trips.types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet';
import { ChevronDown, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface BulkActionBarProps {
  selectedCount: number;
  selectedTrips: Record<string, boolean>;
  groupedTrips: UnassignedTripsByPayer[];
  onBulkAssign: (tripIds: string[], billingVariantId: string) => void;
  isAssigning: boolean;
}

export function BulkActionBar({
  selectedCount,
  selectedTrips,
  groupedTrips,
  onBulkAssign,
  isAssigning
}: BulkActionBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAssigningLocal, setIsAssigningLocal] = useState(false);

  if (selectedCount === 0) return null;

  // Get all selected trip IDs
  const selectedTripIds = Object.entries(selectedTrips)
    .filter(([, selected]) => selected)
    .map(([id]) => id);

  // Collect billing variants from all selected payers
  const selectedPayerIds = new Set<string>();
  const billingVariantsByPayer: Record<string, BillingVariantWithType[]> = {};

  groupedTrips.forEach((group) => {
    const hasSelectedTrips = group.trips.some((t) => selectedTrips[t.id]);
    if (hasSelectedTrips) {
      selectedPayerIds.add(group.payerId);
      billingVariantsByPayer[group.payerId] = group.billingVariants;
    }
  });

  // Check if we have multiple payers selected
  const hasMultiplePayers = selectedPayerIds.size > 1;

  // Get billing variants for single payer selection
  const singlePayerId = hasMultiplePayers
    ? null
    : Array.from(selectedPayerIds)[0];
  const availableVariants = singlePayerId
    ? billingVariantsByPayer[singlePayerId] || []
    : [];

  const handleAssign = async (billingVariantId: string) => {
    setIsAssigningLocal(true);
    try {
      await onBulkAssign(selectedTripIds, billingVariantId);
    } finally {
      setIsAssigningLocal(false);
      setIsOpen(false);
    }
  };

  return (
    <div className='bg-card fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border p-4 shadow-lg'>
      <div className='flex items-center gap-4'>
        <Badge variant='secondary' className='text-sm'>
          {selectedCount} Fahrten ausgewählt
        </Badge>

        {hasMultiplePayers ? (
          <div className='flex items-center gap-2 text-sm text-amber-600'>
            <AlertTriangle className='h-4 w-4' />
            <span>Bitte nur einen Kostenträger auswählen</span>
          </div>
        ) : availableVariants.length > 0 ? (
          <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
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
            <DropdownMenuContent align='end' className='w-72'>
              {availableVariants.map((variant) => (
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
        ) : (
          <div className='flex items-center gap-2 text-sm text-amber-600'>
            <AlertTriangle className='h-4 w-4' />
            <span>Keine Abrechnungsarten verfügbar</span>
          </div>
        )}
      </div>
    </div>
  );
}
