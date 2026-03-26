'use client';

import * as React from 'react';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTripFormSections } from '../trip-form-sections-context';

export function CreateTripPayerSection() {
  const {
    form,
    watchedPayerId,
    billingTypes,
    payers,
    isLoading,
    selectedBillingType,
    watchedBillingVariantId
  } = useTripFormSections();

  const [selectedFamilyId, setSelectedFamilyId] = React.useState('');

  // Distinct families for the current payer’s variant list (already flattened from API).
  const families = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const v of billingTypes) {
      if (!map.has(v.billing_type_id)) {
        map.set(v.billing_type_id, v.billing_type_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [billingTypes]);

  const variantsForFamily = React.useMemo(() => {
    if (!selectedFamilyId) return billingTypes;
    return billingTypes.filter((v) => v.billing_type_id === selectedFamilyId);
  }, [billingTypes, selectedFamilyId]);

  // Reset family when Kostenträger changes (variant cleared in parent).
  React.useEffect(() => {
    setSelectedFamilyId('');
  }, [watchedPayerId]);

  // Keep family dropdown aligned with the selected variant (e.g. prefilled draft).
  React.useEffect(() => {
    if (!watchedBillingVariantId) return;
    const v = billingTypes.find((b) => b.id === watchedBillingVariantId);
    if (v) setSelectedFamilyId(v.billing_type_id);
  }, [watchedBillingVariantId, billingTypes]);

  // Exactly one variant under payer → pick it automatically (no extra clicks).
  React.useEffect(() => {
    if (!watchedPayerId || billingTypes.length !== 1) return;
    const only = billingTypes[0];
    form.setValue('billing_variant_id', only.id);
    setSelectedFamilyId(only.billing_type_id);
  }, [watchedPayerId, billingTypes, form]);

  // Single family, multiple variants → lock family id so only Unterart select shows.
  React.useEffect(() => {
    if (families.length === 1) {
      setSelectedFamilyId(families[0].id);
    }
  }, [families]);

  const showFamilySelect = families.length > 1;
  // If exactly one variant total, we auto-set above — no variant dropdown.
  const needVariantDropdown =
    billingTypes.length > 1 ||
    (families.length > 1 && !!selectedFamilyId && variantsForFamily.length > 0);

  const handleFamilyChange = (familyId: string) => {
    setSelectedFamilyId(familyId);
    const currentVid = form.getValues('billing_variant_id');
    const stillOk = billingTypes.some(
      (v) => v.id === currentVid && v.billing_type_id === familyId
    );
    if (!stillOk) form.setValue('billing_variant_id', '');
  };

  const payerSpansFull =
    !watchedPayerId ||
    billingTypes.length === 0 ||
    (billingTypes.length === 1 && families.length === 1);

  const summaryLabel = selectedBillingType
    ? `${selectedBillingType.billing_type_name} · ${selectedBillingType.name}`
    : '';
  const summaryCode = selectedBillingType?.code;

  return (
    <div data-create-trip-section='payer' className='px-6 pt-4 pb-4'>
      <div className='mb-3 flex items-center gap-2'>
        <CreditCard className='text-muted-foreground h-4 w-4' />
        <span className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>
          Kostenträger
        </span>
      </div>
      <div className='grid grid-cols-2 gap-2 sm:gap-3'>
        <FormField
          control={form.control as any}
          name='payer_id'
          render={({ field }) => (
            <FormItem className={cn('min-w-0', payerSpansFull && 'col-span-2')}>
              <FormLabel className='text-xs'>Kostenträger *</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                disabled={isLoading}
              >
                <FormControl>
                  <SelectTrigger className='h-9 w-full min-w-0 text-base md:text-sm'>
                    <SelectValue placeholder='Wählen...' />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {payers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className='text-xs' />
            </FormItem>
          )}
        />

        {watchedPayerId && billingTypes.length > 0 && showFamilySelect && (
          <FormItem className='min-w-0'>
            <FormLabel className='text-xs'>Abrechnungsfamilie</FormLabel>
            <Select
              value={selectedFamilyId || undefined}
              onValueChange={handleFamilyChange}
            >
              <FormControl>
                <SelectTrigger className='h-9 w-full min-w-0 text-base md:text-sm'>
                  <SelectValue placeholder='Wählen...' />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {families.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        )}

        {watchedPayerId &&
          billingTypes.length > 0 &&
          needVariantDropdown &&
          (!showFamilySelect || selectedFamilyId) && (
            <FormField
              control={form.control as any}
              name='billing_variant_id'
              render={({ field }) => (
                <FormItem
                  className={cn(
                    'min-w-0',
                    // Second row full width when Familie sits beside Kostenträger above.
                    showFamilySelect && 'col-span-2'
                  )}
                >
                  <FormLabel className='text-xs'>Unterart</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className='h-9 w-full min-w-0 text-base md:text-sm'>
                        <SelectValue placeholder='Wählen...' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(showFamilySelect
                        ? variantsForFamily
                        : billingTypes
                      ).map((bt) => (
                        <SelectItem key={bt.id} value={bt.id}>
                          <span className='flex flex-col gap-0 leading-tight'>
                            <span className='flex items-center gap-2'>
                              <span
                                className='inline-block h-2 w-2 shrink-0 rounded-full'
                                style={{ backgroundColor: bt.color }}
                              />
                              <span>
                                {bt.billing_type_name} · {bt.name}
                              </span>
                            </span>
                            <span className='text-muted-foreground pl-4 font-mono text-[10px]'>
                              {bt.code}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage className='text-xs' />
                </FormItem>
              )}
            />
          )}
      </div>
      {selectedBillingType && (
        <div
          className='mt-2 flex flex-col gap-0.5 rounded-md px-3 py-1.5 text-xs font-medium'
          style={{
            backgroundColor: `color-mix(in srgb, ${selectedBillingType.color}, white 85%)`,
            borderLeft: `3px solid ${selectedBillingType.color}`,
            color: selectedBillingType.color
          }}
        >
          <div className='flex items-center gap-2'>
            <span
              className='inline-block h-1.5 w-1.5 rounded-full'
              style={{ backgroundColor: selectedBillingType.color }}
            />
            {summaryLabel}
          </div>
          {summaryCode ? (
            <span className='text-muted-foreground font-mono text-[10px]'>
              CSV-Code: {summaryCode}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
