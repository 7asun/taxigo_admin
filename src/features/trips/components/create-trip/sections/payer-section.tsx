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
    watchedBillingVariantId,
    billingFamilyId,
    setBillingFamilyId
  } = useTripFormSections();

  /** Multi-family Abrechnungsfamilie; single-family flows use `effectiveFamilyId` only. */
  const selectedFamilyId = billingFamilyId;

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

  // Resolved family: explicit pick, or the only family when there is just one row in billing_types.
  const effectiveFamilyId =
    families.length === 1 ? (families[0]?.id ?? '') : selectedFamilyId;

  const variantsInEffectiveFamily = React.useMemo(() => {
    if (!effectiveFamilyId) return [];
    return billingTypes.filter((v) => v.billing_type_id === effectiveFamilyId);
  }, [billingTypes, effectiveFamilyId]);

  // Keep family dropdown aligned with the selected variant (e.g. prefilled draft).
  React.useEffect(() => {
    if (!watchedBillingVariantId) return;
    const v = billingTypes.find((b) => b.id === watchedBillingVariantId);
    if (v) setBillingFamilyId(v.billing_type_id);
  }, [watchedBillingVariantId, billingTypes, setBillingFamilyId]);

  // One Unterart under the effective family → set billing_variant_id; no dropdown needed.
  React.useEffect(() => {
    if (!watchedPayerId || !effectiveFamilyId) return;
    if (variantsInEffectiveFamily.length !== 1) return;
    const only = variantsInEffectiveFamily[0];
    form.setValue('billing_variant_id', only.id);
  }, [watchedPayerId, effectiveFamilyId, variantsInEffectiveFamily, form]);

  const showFamilySelect = families.length > 1;
  const needVariantDropdown =
    !!watchedPayerId &&
    billingTypes.length > 0 &&
    variantsInEffectiveFamily.length > 1 &&
    (families.length === 1 || !!selectedFamilyId);

  const handleFamilyChange = (familyId: string) => {
    setBillingFamilyId(familyId);
    const currentVid = form.getValues('billing_variant_id');
    const stillOk = billingTypes.some(
      (v) => v.id === currentVid && v.billing_type_id === familyId
    );
    if (!stillOk) form.setValue('billing_variant_id', '');
  };

  const payerSpansFull =
    !watchedPayerId ||
    billingTypes.length === 0 ||
    (!showFamilySelect && !needVariantDropdown);

  const singleVariantInScope =
    !!effectiveFamilyId && variantsInEffectiveFamily.length === 1;

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
                      {variantsInEffectiveFamily.map((bt) => (
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
            {singleVariantInScope
              ? selectedBillingType.billing_type_name
              : summaryLabel}
          </div>
          {!singleVariantInScope && summaryCode ? (
            <span className='text-muted-foreground font-mono text-[10px]'>
              CSV-Code: {summaryCode}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
