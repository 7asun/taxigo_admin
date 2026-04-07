'use client';

import * as React from 'react';
import { ChevronRight, Building2, Check, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type {
  PayerOption,
  BillingVariantOption
} from '@/features/trips/types/trip-form-reference.types';

interface PayerBillingStepProps {
  payers: PayerOption[];
  billingVariants: BillingVariantOption[];
  selectedPayerId: string | null;
  selectedBillingTypeId: string | null;
  onPayerChange: (payerId: string | null) => void;
  onBillingTypeChange: (billingTypeId: string | null) => void;
  onNext: () => void;
  onCancel: () => void;
}

/**
 * Step 1: Combined Payer & Billing Type Selection
 *
 * Following the same pattern as create-trip/payer-section.tsx:
 * - Shows payer selection first
 * - When payer has billing variants, shows family selector (if > 1 family)
 * - Shows variant selector only when family selected and > 1 variants in family
 */
export function PayerBillingStep({
  payers,
  billingVariants,
  selectedPayerId,
  selectedBillingTypeId,
  onPayerChange,
  onBillingTypeChange,
  onNext,
  onCancel
}: PayerBillingStepProps) {
  // Internal state for family selection (not stored in parent, only for UI flow)
  const [selectedFamilyId, setSelectedFamilyId] = React.useState<string>('');

  const selectedPayer = payers.find((p) => p.id === selectedPayerId);
  const selectedVariant = billingVariants.find(
    (v) => v.id === selectedBillingTypeId
  );

  // Compute distinct billing families from variants
  const families = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const v of billingVariants) {
      if (!map.has(v.billing_type_id)) {
        map.set(v.billing_type_id, v.billing_type_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [billingVariants]);

  // If only one family exists, auto-select it; otherwise use explicit selection
  const effectiveFamilyId = selectedFamilyId;

  // Variants filtered by the effective family
  const variantsInEffectiveFamily = React.useMemo(() => {
    if (!effectiveFamilyId) return [];
    return billingVariants.filter(
      (v) => v.billing_type_id === effectiveFamilyId
    );
  }, [billingVariants, effectiveFamilyId]);

  // Show family dropdown when specific payer selected AND families exist
  const showFamilySelect = selectedPayerId && families.length > 0;

  // Show variant dropdown only when a SPECIFIC family is selected (not "Alle")
  const showVariantDropdown =
    selectedPayerId &&
    effectiveFamilyId &&
    variantsInEffectiveFamily.length > 0;

  // Handle payer change
  const handlePayerChange = (value: string) => {
    if (value === 'all') {
      onPayerChange(null);
      onBillingTypeChange(null);
      setSelectedFamilyId('');
    } else {
      onPayerChange(value);
      onBillingTypeChange(null);
      setSelectedFamilyId('');
    }
  };

  // Handle family change - 'all' means "Alle Abrechnungsfamilien"
  const handleFamilyChange = (familyId: string) => {
    if (familyId === 'all') {
      setSelectedFamilyId('');
    } else {
      setSelectedFamilyId(familyId);
    }
    // Reset billing type when family changes
    onBillingTypeChange(null);
  };

  // Handle variant change
  const handleVariantChange = (value: string) => {
    onBillingTypeChange(value === 'all' ? null : value);
  };

  return (
    <div className='space-y-4'>
      {/* Payer Selection */}
      <div className='space-y-2'>
        <Label htmlFor='payer-select' className='flex items-center gap-2'>
          <Building2 className='text-muted-foreground h-4 w-4' />
          Kostenträger
        </Label>
        <Select
          value={selectedPayerId ?? 'all'}
          onValueChange={handlePayerChange}
        >
          <SelectTrigger id='payer-select' className='w-full'>
            <SelectValue placeholder='Kostenträger wählen...' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>
              <span>Alle Kostenträger</span>
            </SelectItem>
            {payers.map((payer) => (
              <SelectItem key={payer.id} value={payer.id}>
                <span>{payer.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Billing Family Selection - Only shown if specific payer selected AND families exist */}
      {showFamilySelect && (
        <div className='space-y-2'>
          <Label htmlFor='family-select' className='flex items-center gap-2'>
            <CreditCard className='text-muted-foreground h-4 w-4' />
            Abrechnungsfamilie
          </Label>
          <Select
            value={selectedFamilyId || 'all'}
            onValueChange={handleFamilyChange}
          >
            <SelectTrigger id='family-select' className='w-full'>
              <SelectValue placeholder='Abrechnungsfamilie wählen...' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>
                <span>Alle Abrechnungsfamilien</span>
              </SelectItem>
              {families.map((family) => (
                <SelectItem key={family.id} value={family.id}>
                  {family.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Billing Variant Selection - Only shown when family determined AND variants exist */}
      {showVariantDropdown && (
        <div className='space-y-2'>
          <Label htmlFor='variant-select' className='flex items-center gap-2'>
            <CreditCard className='text-muted-foreground h-4 w-4' />
            Abrechnungsart
          </Label>
          <Select
            value={selectedBillingTypeId ?? 'all'}
            onValueChange={handleVariantChange}
          >
            <SelectTrigger id='variant-select' className='w-full'>
              <SelectValue placeholder='Abrechnungsart wählen...' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>
                <span>Alle Abrechnungsarten</span>
              </SelectItem>
              {variantsInEffectiveFamily.map((variant) => (
                <SelectItem key={variant.id} value={variant.id}>
                  <div className='flex flex-col'>
                    <span className='flex items-center gap-2'>
                      <span
                        className='inline-block h-2 w-2 shrink-0 rounded-full'
                        style={{ backgroundColor: variant.color }}
                      />
                      <span>{variant.name}</span>
                    </span>
                    <span className='text-muted-foreground pl-4 text-xs'>
                      Code: {variant.code}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Selected summary */}
      {selectedPayer && (
        <div className='bg-muted rounded-md p-3'>
          <div className='flex items-center gap-2 text-sm'>
            <Check className='h-4 w-4 text-emerald-600' />
            <span className='font-medium'>{selectedPayer.name}</span>
          </div>
          {selectedVariant && (
            <div className='text-muted-foreground mt-1 flex items-center gap-2 text-sm'>
              <span
                className='inline-block h-2 w-2 rounded-full'
                style={{ backgroundColor: selectedVariant.color }}
              />
              <span>
                {selectedVariant.billing_type_name} · {selectedVariant.name}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Navigation buttons */}
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
