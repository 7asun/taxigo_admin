'use client';

import * as React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { useFremdfirmenQuery } from '@/features/trips/hooks/use-trip-reference-queries';
import type { RuleFormValues } from './recurring-rule-form-body';
import { resolveKtsDefault } from '@/features/trips/lib/resolve-kts-default';
import { resolveNoInvoiceRequiredDefault } from '@/features/trips/lib/resolve-no-invoice-required';
import { FREMDFIRMA_PAYMENT_MODE_OPTIONS } from '@/features/fremdfirmen/lib/fremdfirma-payment-mode-labels';
import type { FremdfirmaPaymentMode } from '@/features/trips/types/trip-form-reference.types';

interface RecurringRuleBillingFieldsProps {
  form: UseFormReturn<RuleFormValues>;
}

/**
 * Kostenträger / Abrechnung for recurring rules — same UX as Neue Fahrt
 * (`payer-section.tsx`), driven by `useTripFormData` + flattened variant list.
 */
export function RecurringRuleBillingFields({
  form
}: RecurringRuleBillingFieldsProps) {
  const watchedPayerId = form.watch('payer_id');
  const watchedBillingVariantId = form.watch('billing_variant_id');
  const { payers, billingTypes, isLoading } = useTripFormData(watchedPayerId);

  const [billingFamilyId, setBillingFamilyId] = React.useState('');
  const [ktsCatalogHint, setKtsCatalogHint] = React.useState<string | null>(
    null
  );
  const [noInvoiceCatalogHint, setNoInvoiceCatalogHint] = React.useState<
    string | null
  >(null);

  const { data: fremdVendors = [] } = useFremdfirmenQuery();

  const prevPayerRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (
      prevPayerRef.current !== undefined &&
      prevPayerRef.current !== watchedPayerId
    ) {
      form.setValue('billing_variant_id', '');
      setBillingFamilyId('');
      form.setValue('kts_manual', false);
      form.setValue('fremdfirma_enabled', false);
      form.setValue('fremdfirma_id', '');
      form.setValue('fremdfirma_payment_mode', null);
      form.setValue('fremdfirma_cost', '');
    }
    prevPayerRef.current = watchedPayerId;
  }, [watchedPayerId, form]);

  React.useEffect(() => {
    if (form.getValues('kts_manual')) return;
    if (!watchedPayerId || !watchedBillingVariantId) {
      setKtsCatalogHint(null);
      return;
    }
    const payer = payers.find((p) => p.id === watchedPayerId);
    const variant = billingTypes.find((b) => b.id === watchedBillingVariantId);
    if (!payer || !variant) return;
    const r = resolveKtsDefault({
      payerKtsDefault: payer.kts_default,
      familyBehaviorProfile: variant.behavior_profile,
      variantKtsDefault: variant.kts_default
    });
    form.setValue('kts_document_applies', r.value);
    if (!r.value) {
      setKtsCatalogHint(null);
    } else if (r.source === 'variant') {
      setKtsCatalogHint(`Voreingestellt aus Unterart: ${variant.name}`);
    } else if (r.source === 'familie') {
      setKtsCatalogHint(
        `Voreingestellt aus Abrechnungsfamilie: ${variant.billing_type_name}`
      );
    } else if (r.source === 'payer') {
      setKtsCatalogHint(`Voreingestellt aus Kostenträger: ${payer.name}`);
    } else {
      setKtsCatalogHint(null);
    }
  }, [watchedPayerId, watchedBillingVariantId, payers, billingTypes, form]);

  React.useEffect(() => {
    if (form.getValues('no_invoice_manual')) return;
    if (!watchedPayerId || !watchedBillingVariantId) {
      setNoInvoiceCatalogHint(null);
      return;
    }
    const payer = payers.find((p) => p.id === watchedPayerId);
    const variant = billingTypes.find((b) => b.id === watchedBillingVariantId);
    if (!payer || !variant) return;
    const r = resolveNoInvoiceRequiredDefault({
      payerNoInvoiceDefault: payer.no_invoice_required_default,
      familyBehaviorProfile: variant.behavior_profile,
      variantNoInvoiceDefault: variant.no_invoice_required_default
    });
    form.setValue('no_invoice_required', r.value);
    if (!r.value) {
      setNoInvoiceCatalogHint(null);
    } else if (r.source === 'variant') {
      setNoInvoiceCatalogHint(`Voreingestellt aus Unterart: ${variant.name}`);
    } else if (r.source === 'familie') {
      setNoInvoiceCatalogHint(
        `Voreingestellt aus Abrechnungsfamilie: ${variant.billing_type_name}`
      );
    } else if (r.source === 'payer') {
      setNoInvoiceCatalogHint(`Voreingestellt aus Kostenträger: ${payer.name}`);
    } else {
      setNoInvoiceCatalogHint(null);
    }
  }, [watchedPayerId, watchedBillingVariantId, payers, billingTypes, form]);

  const fremdEnabled = form.watch('fremdfirma_enabled');
  const fremdIdWatch = form.watch('fremdfirma_id');
  const noInvWatch = form.watch('no_invoice_required');
  const fremdModeWatch = form.watch('fremdfirma_payment_mode');

  React.useEffect(() => {
    if (!fremdEnabled || !fremdIdWatch || !noInvWatch) return;
    if (fremdModeWatch && fremdModeWatch !== 'self_payer') {
      form.setValue('fremdfirma_payment_mode', 'self_payer');
    }
  }, [fremdEnabled, fremdIdWatch, noInvWatch, fremdModeWatch, form]);

  const selectedFamilyId = billingFamilyId;

  const families = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const v of billingTypes) {
      if (!map.has(v.billing_type_id)) {
        map.set(v.billing_type_id, v.billing_type_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [billingTypes]);

  const effectiveFamilyId =
    families.length === 1 ? (families[0]?.id ?? '') : selectedFamilyId;

  const variantsInEffectiveFamily = React.useMemo(() => {
    if (!effectiveFamilyId) return [];
    return billingTypes.filter((v) => v.billing_type_id === effectiveFamilyId);
  }, [billingTypes, effectiveFamilyId]);

  React.useEffect(() => {
    if (!watchedBillingVariantId) return;
    const v = billingTypes.find((b) => b.id === watchedBillingVariantId);
    if (v) setBillingFamilyId(v.billing_type_id);
  }, [watchedBillingVariantId, billingTypes]);

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

  const selectedBillingType = watchedBillingVariantId
    ? billingTypes.find((b) => b.id === watchedBillingVariantId)
    : undefined;

  const summaryLabel = selectedBillingType
    ? `${selectedBillingType.billing_type_name} · ${selectedBillingType.name}`
    : '';
  const summaryCode = selectedBillingType?.code;

  return (
    <div className='bg-muted/20 space-y-3 rounded-lg border p-4'>
      <div className='mb-1 flex items-center gap-2'>
        <CreditCard className='text-muted-foreground h-4 w-4' />
        <span className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>
          Kostenträger / Abrechnung
        </span>
      </div>
      <div className='grid grid-cols-2 gap-2 sm:gap-3'>
        <FormField
          control={form.control}
          name='payer_id'
          render={({ field }) => (
            <FormItem className={cn('min-w-0', payerSpansFull && 'col-span-2')}>
              <FormLabel className='text-xs'>Kostenträger *</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value || undefined}
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
              control={form.control}
              name='billing_variant_id'
              render={({ field }) => (
                <FormItem
                  className={cn('min-w-0', showFamilySelect && 'col-span-2')}
                >
                  <FormLabel className='text-xs'>Unterart *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value || undefined}
                  >
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
      {watchedPayerId ? (
        <FormField
          control={form.control}
          name='kts_document_applies'
          render={({ field }) => (
            <FormItem className='bg-muted/30 mt-2 rounded-lg border p-3'>
              <div className='flex flex-row items-center justify-between gap-3'>
                <div className='min-w-0 space-y-1'>
                  <FormLabel className='text-sm'>
                    KTS / Krankentransportschein
                  </FormLabel>
                  {ktsCatalogHint && field.value ? (
                    <p className='text-muted-foreground text-xs'>
                      {ktsCatalogHint}
                    </p>
                  ) : null}
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={(c) => {
                      form.setValue('kts_manual', true);
                      if (!c) setKtsCatalogHint(null);
                      field.onChange(c);
                    }}
                  />
                </FormControl>
              </div>
              <p className='text-muted-foreground mt-2 text-xs'>
                Wird auf alle Fahrten dieser Regel übertragen.
              </p>
            </FormItem>
          )}
        />
      ) : null}

      {watchedPayerId ? (
        <FormField
          control={form.control}
          name='no_invoice_required'
          render={({ field }) => (
            <FormItem className='bg-muted/30 mt-2 rounded-lg border p-3'>
              <div className='flex flex-row items-center justify-between gap-3'>
                <div className='min-w-0 space-y-1'>
                  <FormLabel className='text-sm'>Keine Rechnung</FormLabel>
                  {noInvoiceCatalogHint && field.value ? (
                    <p className='text-muted-foreground text-xs'>
                      {noInvoiceCatalogHint}
                    </p>
                  ) : null}
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={(c) => {
                      form.setValue('no_invoice_manual', true);
                      if (!c) setNoInvoiceCatalogHint(null);
                      field.onChange(c);
                    }}
                  />
                </FormControl>
              </div>
              <p className='text-muted-foreground mt-2 text-xs'>
                Wird auf alle Fahrten dieser Regel übertragen.
              </p>
            </FormItem>
          )}
        />
      ) : null}

      {watchedPayerId &&
      form.watch('kts_document_applies') &&
      form.watch('no_invoice_required') ? (
        <Alert className='border-amber-200/80 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/30'>
          <AlertDescription className='text-xs'>
            KTS und „Keine Rechnung“ sind beide aktiv — bitte prüfen, ob die
            Abrechnung so beabsichtigt ist.
          </AlertDescription>
        </Alert>
      ) : null}

      {watchedPayerId ? (
        <div className='bg-muted/30 space-y-3 rounded-lg border p-3'>
          <FormField
            control={form.control}
            name='fremdfirma_enabled'
            render={({ field }) => (
              <FormItem>
                <div className='flex flex-row items-center justify-between gap-3'>
                  <div className='min-w-0 space-y-1'>
                    <FormLabel className='text-sm'>Fremdfirma</FormLabel>
                    <p className='text-muted-foreground text-xs'>
                      Externe Durchführung — wird auf generierte Fahrten
                      übernommen.
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={(on) => {
                        field.onChange(on);
                        if (!on) {
                          form.setValue('fremdfirma_id', '');
                          form.setValue('fremdfirma_payment_mode', null);
                          form.setValue('fremdfirma_cost', '');
                        } else if (fremdVendors.length === 1) {
                          const v = fremdVendors[0]!;
                          form.setValue('fremdfirma_id', v.id);
                          form.setValue(
                            'fremdfirma_payment_mode',
                            v.default_payment_mode as FremdfirmaPaymentMode
                          );
                        }
                      }}
                    />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
          {form.watch('no_invoice_required') && fremdEnabled ? (
            <Alert>
              <AlertDescription className='text-xs'>
                Keine Rechnung aktiv — Fremdfirma erhält Zahlung direkt vom
                Patienten.
              </AlertDescription>
            </Alert>
          ) : null}
          {fremdEnabled ? (
            <div className='space-y-3'>
              <FormField
                control={form.control}
                name='fremdfirma_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-xs'>Partner</FormLabel>
                    <Select
                      value={field.value || undefined}
                      onValueChange={(v) => {
                        field.onChange(v);
                        const nv = fremdVendors.find((x) => x.id === v);
                        if (nv?.default_payment_mode) {
                          form.setValue(
                            'fremdfirma_payment_mode',
                            nv.default_payment_mode as FremdfirmaPaymentMode
                          );
                        }
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className='h-9 text-sm'>
                          <SelectValue placeholder='Fremdfirma wählen' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {fremdVendors.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className='text-xs' />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='fremdfirma_payment_mode'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-xs'>
                      Abrechnungsart Fremdfirma
                    </FormLabel>
                    <Select
                      value={field.value ?? undefined}
                      onValueChange={(v) =>
                        field.onChange(v as FremdfirmaPaymentMode)
                      }
                    >
                      <FormControl>
                        <SelectTrigger className='h-9 text-sm'>
                          <SelectValue placeholder='Modus' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FREMDFIRMA_PAYMENT_MODE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className='text-xs' />
                  </FormItem>
                )}
              />
              {(fremdModeWatch === 'cash_per_trip' ||
                fremdModeWatch === 'monthly_invoice') && (
                <FormField
                  control={form.control}
                  name='fremdfirma_cost'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='text-xs'>
                        Vereinbarter Betrag (optional)
                      </FormLabel>
                      <FormControl>
                        <Input
                          className='h-9 text-sm'
                          {...field}
                          placeholder='z. B. 45.00'
                        />
                      </FormControl>
                      <FormMessage className='text-xs' />
                    </FormItem>
                  )}
                />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedBillingType && (
        <div
          className='mt-1 flex flex-col gap-0.5 rounded-md px-3 py-1.5 text-xs font-medium'
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
