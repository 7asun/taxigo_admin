'use client';

import {
  ChevronRight,
  ChevronLeft,
  Tag,
  Check,
  SkipForward
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { BillingVariantOption } from '@/features/trips/types/trip-form-reference.types';

interface BillingTypeSelectionStepProps {
  billingVariants: BillingVariantOption[];
  selectedBillingTypeId: string | null;
  onBillingTypeChange: (billingTypeId: string | null) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

/**
 * Step 2: Billing Type Selection
 *
 * Allows users to select a specific billing type (billing variant) or "All types".
 * Shown only when a specific payer was selected in step 1.
 */
export function BillingTypeSelectionStep({
  billingVariants,
  selectedBillingTypeId,
  onBillingTypeChange,
  onNext,
  onSkip,
  onBack
}: BillingTypeSelectionStepProps) {
  const selectedVariant = billingVariants.find(
    (v) => v.id === selectedBillingTypeId
  );

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='billing-type-select'>Abrechnungsart auswählen</Label>
        <Select
          value={selectedBillingTypeId ?? 'all'}
          onValueChange={(value) =>
            onBillingTypeChange(value === 'all' ? null : value)
          }
        >
          <SelectTrigger id='billing-type-select' className='w-full'>
            <SelectValue placeholder='Abrechnungsart wählen...' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>
              <div className='flex items-center gap-2'>
                <Tag className='text-muted-foreground h-4 w-4' />
                <span>Alle Abrechnungsarten</span>
              </div>
            </SelectItem>
            {billingVariants.map((variant) => (
              <SelectItem key={variant.id} value={variant.id}>
                <div className='flex items-center gap-2'>
                  <Tag className='text-muted-foreground h-4 w-4' />
                  <div className='flex flex-col'>
                    <span>{variant.name}</span>
                    <span className='text-muted-foreground text-xs'>
                      {variant.billing_type_name}
                    </span>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className='text-muted-foreground text-xs'>
          Wählen Sie eine bestimmte Abrechnungsart oder exportieren Sie alle
          Fahrten dieses Kostenträgers.
        </p>
      </div>

      {selectedVariant && (
        <div className='bg-muted rounded-md p-3'>
          <div className='flex items-center gap-2 text-sm'>
            <Check className='h-4 w-4 text-emerald-600' />
            <span className='font-medium'>{selectedVariant.name}</span>
            <span className='text-muted-foreground text-xs'>
              ({selectedVariant.billing_type_name})
            </span>
          </div>
        </div>
      )}

      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          className='flex-1'
          onClick={onBack}
        >
          <ChevronLeft className='mr-1 h-4 w-4' />
          Zurück
        </Button>
        <Button
          type='button'
          variant='secondary'
          className='flex-1'
          onClick={onSkip}
        >
          <SkipForward className='mr-1 h-4 w-4' />
          Überspringen
        </Button>
        <Button type='button' className='flex-1' onClick={onNext}>
          Weiter
          <ChevronRight className='ml-1 h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
