'use client';

import { ChevronRight, ChevronLeft, Building2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { PayerOption } from '@/features/trips/types/trip-form-reference.types';

interface PayerSelectionStepProps {
  payers: PayerOption[];
  selectedPayerId: string | null;
  onPayerChange: (payerId: string | null) => void;
  onNext: () => void;
  onCancel: () => void;
}

/**
 * Step 1: Payer Selection
 *
 * Allows users to select a specific payer or "All payers" for the export.
 * If a specific payer is selected, the next step will show billing types.
 */
export function PayerSelectionStep({
  payers,
  selectedPayerId,
  onPayerChange,
  onNext,
  onCancel
}: PayerSelectionStepProps) {
  const selectedPayer = payers.find((p) => p.id === selectedPayerId);

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='payer-select'>Kostenträger auswählen</Label>
        <Select
          value={selectedPayerId ?? 'all'}
          onValueChange={(value) =>
            onPayerChange(value === 'all' ? null : value)
          }
        >
          <SelectTrigger id='payer-select' className='w-full'>
            <SelectValue placeholder='Kostenträger wählen...' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>
              <div className='flex items-center gap-2'>
                <Building2 className='text-muted-foreground h-4 w-4' />
                <span>Alle Kostenträger</span>
              </div>
            </SelectItem>
            {payers.map((payer) => (
              <SelectItem key={payer.id} value={payer.id}>
                <div className='flex items-center gap-2'>
                  <Building2 className='text-muted-foreground h-4 w-4' />
                  <span>{payer.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className='text-muted-foreground text-xs'>
          Wählen Sie einen bestimmten Kostenträger oder exportieren Sie alle
          Fahrten.
        </p>
      </div>

      {selectedPayer && (
        <div className='bg-muted rounded-md p-3'>
          <div className='flex items-center gap-2 text-sm'>
            <Check className='h-4 w-4 text-emerald-600' />
            <span className='font-medium'>{selectedPayer.name}</span>
          </div>
          <p className='text-muted-foreground mt-1 text-xs'>
            Als nächstes können Sie eine Abrechnungsart auswählen.
          </p>
        </div>
      )}

      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          className='flex-1'
          onClick={onCancel}
        >
          Abbrechen
        </Button>
        <Button type='button' className='flex-1' onClick={onNext}>
          Weiter
          <ChevronRight className='ml-1 h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
