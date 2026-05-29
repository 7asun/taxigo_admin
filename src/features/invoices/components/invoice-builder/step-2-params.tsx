'use client';

/**
 * step-2-params.tsx
 *
 * Invoice builder — Step 2: Parameter selection.
 *
 * Form fields depend on the mode selected in step 1:
 *   All modes:    Payer (required) + Date range (required) + Billing type (optional)
 *   per_client:   + Client picker (required)
 *
 * On submit, fetches trips and advances to step 3 (line items preview).
 */

import { useCallback, useMemo, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, PlusCircle, XCircle } from 'lucide-react';
import { CheckIcon } from '@radix-ui/react-icons';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  FormControl,
  FormDescription,
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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { DateRangePicker } from '@/components/ui/date-time-picker';
import { invoiceDateRangePresets } from '../../lib/invoice-date-range-presets';
import { formatLocalDateToYmd, parseYmdToLocalDate } from '@/lib/date-ymd';
import type { DateRange } from 'react-day-picker';
import { ClientAutoSuggest } from '@/components/ui/client-auto-suggest';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { useClientPayers } from '../../hooks/use-client-payers';
import { useRechnungsempfaengerOptions } from '@/features/rechnungsempfaenger/hooks/use-rechnungsempfaenger-options';
import { resolveRechnungsempfaenger } from '../../lib/resolve-rechnungsempfaenger';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { InvoiceMode } from '../../types/invoice.types';
import { formatBillingVariantOptionLabel } from '@/features/trips/lib/format-billing-display-label';
import { useBillingVariantsForPayerQuery } from '@/features/trips/hooks/use-trip-reference-queries';
import type { BillingVariantOption } from '@/features/trips/types/trip-form-reference.types';

// ─── Local schema for step 2 form ─────────────────────────────────────────────
// NOTE: Zod v4 — use 'message' instead of 'required_error'

const step2Schema = z.object({
  payer_id: z.string().uuid(),
  billing_type_id: z.string().uuid().nullish().or(z.literal('')),
  /** Monthly / single_trip: multi-select families; per_client keeps null. */
  billing_type_ids: z.array(z.string().uuid()).nullable(),
  billing_variant_id: z.string().uuid().nullable().nullish().or(z.literal('')),
  billing_variant_ids: z.array(z.string().uuid()).nullable(),
  period_from: z.string().min(1, 'Startdatum erforderlich'),
  period_to: z.string().min(1, 'Enddatum erforderlich'),
  client_id: z.string().uuid().nullish().or(z.literal(''))
});

type Step2Values = z.infer<typeof step2Schema>;

interface Payer {
  id: string;
  name: string;
  number: string;
  rechnungsempfaenger_id?: string | null;
  billing_types?: {
    id: string;
    name: string;
    rechnungsempfaenger_id?: string | null;
  }[];
}

interface Client {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

interface Step2ParamsProps {
  mode: InvoiceMode;
  payers: Payer[];
  clients: Client[];
  isLoadingTrips: boolean;
  /**
   * Edit mode (draft re-open): payer is frozen. Changing it would invalidate the
   * line-item snapshots, so the payer selectors are rendered read-only.
   */
  locked?: boolean;
  onNext: (values: {
    payer_id: string;
    billing_type_id: string | null;
    billing_type_ids: string[] | null;
    billing_variant_id: string | null;
    billing_variant_ids: string[] | null;
    period_from: string;
    period_to: string;
    client_id: string | null;
    mode: InvoiceMode;
  }) => void;
}

interface MonthlyVariantSubsetPickerProps {
  variants: BillingVariantOption[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}

interface MonthlyBillingTypesPickerProps {
  options: { id: string; name: string }[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}

/** Popover + Command multi-select for Abrechnungsfamilien (monthly / single_trip). */
function MonthlyBillingTypesPicker({
  options,
  value,
  onChange,
  disabled
}: MonthlyBillingTypesPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => new Set(value ?? []), [value]);

  const triggerLabel = useMemo(() => {
    const n = selected.size;
    if (n === 0) return 'Alle Abrechnungsarten';
    if (n === 1) {
      const id = [...selected][0]!;
      const t = options.find((x) => x.id === id);
      return t?.name ?? '1 Abrechnungsart';
    }
    return `${n} Abrechnungsarten gewählt`;
  }, [selected, options]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange(next.size ? [...next] : null);
    },
    [selected, onChange]
  );

  const clear = useCallback(() => {
    onChange(null);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className='h-9 w-full justify-start border-dashed font-normal sm:w-[min(100%,20rem)]'
        >
          {selected.size > 0 ? (
            <span
              role='button'
              tabIndex={0}
              className='focus-visible:ring-ring mr-1 inline-flex rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-1 focus-visible:outline-none'
              aria-label='Abrechnungsarten-Auswahl zurücksetzen'
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  clear();
                }
              }}
            >
              <XCircle className='size-4' />
            </span>
          ) : (
            <PlusCircle className='mr-1 size-4' />
          )}
          <span className='truncate'>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className='w-[min(calc(100vw-2rem),18rem)] p-0'
        align='start'
      >
        <Command>
          <CommandInput placeholder='Abrechnungsart suchen…' />
          <CommandList>
            <CommandEmpty>Keine Abrechnungsart gefunden.</CommandEmpty>
            <CommandGroup className='max-h-[18.75rem] overflow-y-auto'>
              {options.map((t) => {
                const isSelected = selected.has(t.id);
                return (
                  <CommandItem
                    key={t.id}
                    value={`${t.name} ${t.id}`}
                    onSelect={() => toggle(t.id)}
                  >
                    <div
                      className={cn(
                        'border-primary mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible'
                      )}
                    >
                      <CheckIcon className='size-3' />
                    </div>
                    <span className='truncate'>{t.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.size > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => clear()}
                    className='justify-center text-center'
                  >
                    Auswahl löschen
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Popover + Command multi-select (monthly only) — pattern aligned with DataTableFacetedFilter, RHF-driven. */
function MonthlyVariantSubsetPicker({
  variants,
  value,
  onChange,
  disabled
}: MonthlyVariantSubsetPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => new Set(value ?? []), [value]);

  const triggerLabel = useMemo(() => {
    const n = selected.size;
    if (n === 0) return 'Alle Unterarten';
    if (n === 1) {
      const id = [...selected][0]!;
      const v = variants.find((x) => x.id === id);
      return v
        ? formatBillingVariantOptionLabel({
            name: v.name,
            billing_type_name: v.billing_type_name ?? ''
          })
        : '1 Unterart';
    }
    return `${n} Unterarten gewählt`;
  }, [selected, variants]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange(next.size ? [...next] : null);
    },
    [selected, onChange]
  );

  const clear = useCallback(() => {
    onChange(null);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className='h-9 w-full justify-start border-dashed font-normal sm:w-[min(100%,20rem)]'
        >
          {selected.size > 0 ? (
            <span
              role='button'
              tabIndex={0}
              className='focus-visible:ring-ring mr-1 inline-flex rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-1 focus-visible:outline-none'
              aria-label='Unterartenauswahl zurücksetzen'
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  clear();
                }
              }}
            >
              <XCircle className='size-4' />
            </span>
          ) : (
            <PlusCircle className='mr-1 size-4' />
          )}
          <span className='truncate'>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className='w-[min(calc(100vw-2rem),18rem)] p-0'
        align='start'
      >
        <Command>
          <CommandInput placeholder='Unterart suchen…' />
          <CommandList>
            <CommandEmpty>Keine Unterart gefunden.</CommandEmpty>
            <CommandGroup className='max-h-[18.75rem] overflow-y-auto'>
              {variants.map((v) => {
                const isSelected = selected.has(v.id);
                const label = formatBillingVariantOptionLabel({
                  name: v.name,
                  billing_type_name: v.billing_type_name ?? ''
                });
                return (
                  <CommandItem
                    key={v.id}
                    value={`${v.name} ${v.code} ${v.id}`}
                    onSelect={() => toggle(v.id)}
                  >
                    <div
                      className={cn(
                        'border-primary mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible'
                      )}
                    >
                      <CheckIcon className='size-3' />
                    </div>
                    <span className='truncate'>{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.size > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => clear()}
                    className='justify-center text-center'
                  >
                    Auswahl löschen
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Step 2: Payer, date range, billing type, and (per_client) client picker. */
export function Step2Params({
  mode,
  payers,
  clients,
  isLoadingTrips,
  locked = false,
  onNext
}: Step2ParamsProps) {
  const { searchClients } = useTripFormData();

  const form = useForm<Step2Values>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(step2Schema) as any,
    defaultValues: {
      payer_id: '',
      billing_type_id: null,
      billing_type_ids: null,
      billing_variant_id: null,
      billing_variant_ids: null,
      period_from: '',
      period_to: '',
      client_id: null
    }
  });

  // Get billing types for the currently selected payer
  const selectedPayerId = form.watch('payer_id');
  const billingTypeIdRaw = form.watch('billing_type_id');
  const billingTypeIdsRaw = form.watch('billing_type_ids');
  const billingTypeIdNorm =
    billingTypeIdRaw && String(billingTypeIdRaw).length > 0
      ? String(billingTypeIdRaw)
      : null;
  const monthlyTypeIdsSorted = useMemo(() => {
    if (!billingTypeIdsRaw?.length) return null;
    return [...billingTypeIdsRaw].sort();
  }, [billingTypeIdsRaw]);
  const monthlySingleTypeId =
    monthlyTypeIdsSorted?.length === 1 ? monthlyTypeIdsSorted[0]! : null;
  const selectedPayer = payers.find((p) => p.id === selectedPayerId);
  const billingTypes = selectedPayer?.billing_types ?? [];

  const { data: allBillingVariants = [] } = useBillingVariantsForPayerQuery(
    mode !== 'per_client' ? selectedPayerId : null
  );
  const variantsForType = useMemo(
    () =>
      monthlySingleTypeId
        ? allBillingVariants.filter(
            (v) => v.billing_type_id === monthlySingleTypeId
          )
        : [],
    [allBillingVariants, monthlySingleTypeId]
  );

  const { data: empfaengerCatalog = [], isLoading: empfaengerLoading } =
    useRechnungsempfaengerOptions();

  const step2RecipientPreview = useMemo(() => {
    if (!selectedPayerId || !selectedPayer) return null;
    let billingTypeRechnungsempfaengerId: string | null | undefined = null;
    if (mode === 'per_client' && billingTypeIdNorm) {
      const bt = selectedPayer.billing_types?.find(
        (b) => b.id === billingTypeIdNorm
      );
      billingTypeRechnungsempfaengerId = bt?.rechnungsempfaenger_id ?? null;
    } else if (mode !== 'per_client' && monthlySingleTypeId) {
      // why: exactly one family in scope may pin a type-level Empfänger; 0 or 2+ families use payer tier only in this preview.
      const bt = selectedPayer.billing_types?.find(
        (b) => b.id === monthlySingleTypeId
      );
      billingTypeRechnungsempfaengerId = bt?.rechnungsempfaenger_id ?? null;
    }
    return resolveRechnungsempfaenger({
      billingVariantRechnungsempfaengerId: null,
      billingTypeRechnungsempfaengerId,
      payerRechnungsempfaengerId: selectedPayer.rechnungsempfaenger_id ?? null
    });
  }, [
    selectedPayerId,
    selectedPayer,
    mode,
    billingTypeIdNorm,
    monthlySingleTypeId
  ]);

  // Watch client_id to fetch historical combinations
  const selectedClientId = form.watch('client_id');
  const { data: clientCombinations = [], isLoading: isLoadingCombinations } =
    useClientPayers(selectedClientId ?? null);

  const periodFrom = form.watch('period_from');
  const periodTo = form.watch('period_to');

  const step2DateRange = useMemo((): DateRange | undefined => {
    if (!periodFrom && !periodTo) return undefined;
    const fromD = periodFrom ? parseYmdToLocalDate(periodFrom) : undefined;
    const toD = periodTo ? parseYmdToLocalDate(periodTo) : undefined;
    const start = fromD ?? toD;
    const end = toD ?? fromD;
    if (!start || !end) return undefined;
    return {
      from: new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
        0,
        0,
        0,
        0
      ),
      to: new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate(),
        23,
        59,
        59,
        999
      )
    };
  }, [periodFrom, periodTo]);

  const handleStep2DateRangeChange = (range: DateRange | undefined) => {
    if (!range?.from) {
      form.setValue('period_from', '', { shouldValidate: true });
      form.setValue('period_to', '', { shouldValidate: true });
      return;
    }
    const fromYmd = formatLocalDateToYmd(range.from);
    const toYmd = formatLocalDateToYmd(range.to ?? range.from);
    form.setValue('period_from', fromYmd, { shouldValidate: true });
    form.setValue('period_to', toYmd, { shouldValidate: true });
  };

  const onSubmit = (values: Step2Values) => {
    const billing_variant_ids =
      mode === 'per_client'
        ? null
        : values.billing_variant_ids?.length
          ? values.billing_variant_ids
          : null;
    const billing_type_ids =
      mode === 'per_client'
        ? null
        : values.billing_type_ids?.length
          ? values.billing_type_ids
          : null;
    onNext({
      payer_id: values.payer_id,
      billing_type_id:
        mode === 'per_client' ? values.billing_type_id || null : null,
      billing_type_ids,
      billing_variant_id: values.billing_variant_id || null,
      billing_variant_ids,
      period_from: values.period_from,
      period_to: values.period_to,
      client_id: values.client_id || null,
      mode
    });
  };

  return (
    <div className='space-y-6'>
      <FormProvider {...form}>
        <form
          id='invoice-step2-form'
          onSubmit={form.handleSubmit(onSubmit)}
          className='space-y-5'
        >
          {/* ─── per_client Mode Flow ────────────────────────────────────── */}
          {mode === 'per_client' && (
            <>
              <FormField
                control={form.control}
                name='client_id'
                render={({ field }) => {
                  const selectedClient = clients.find(
                    (c) => c.id === field.value
                  );
                  const displayValue = selectedClient
                    ? [selectedClient.first_name, selectedClient.last_name]
                        .filter(Boolean)
                        .join(' ')
                    : '';

                  return (
                    <FormItem>
                      <FormLabel>
                        Fahrgast <span className='text-destructive'>*</span>
                      </FormLabel>
                      <FormControl>
                        <ClientAutoSuggest
                          value={displayValue}
                          onSelect={(client) => {
                            field.onChange(client?.id ?? '');
                            // Reset payer logic when client changes
                            form.setValue('payer_id', '');
                            form.clearErrors('payer_id');
                            form.setValue('billing_type_id', null);
                            form.setValue('billing_type_ids', null);
                            form.setValue('billing_variant_id', null);
                            form.setValue('billing_variant_ids', null);
                          }}
                          onNameChange={() => {}}
                          searchClients={searchClients}
                          placeholder='Fahrgast suchen…'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {selectedClientId && (
                <FormField
                  control={form.control}
                  name='payer_id'
                  render={({ field }) => {
                    const currentBillingVariantId =
                      form.watch('billing_variant_id');
                    const combinedValue = field.value
                      ? `${field.value}|${currentBillingVariantId || ''}`
                      : '';

                    return (
                      <FormItem>
                        <FormLabel>
                          Abrechnung <span className='text-destructive'>*</span>
                        </FormLabel>
                        <Select
                          value={combinedValue}
                          disabled={locked}
                          onValueChange={(val) => {
                            const [pId, rawVariant] = val.split('|');
                            const variantId =
                              rawVariant && rawVariant.length > 0
                                ? rawVariant
                                : null;
                            field.onChange(pId);
                            const comb = clientCombinations.find(
                              (c) =>
                                c.payer_id === pId &&
                                (c.billing_variant_id ?? '') ===
                                  (variantId ?? '')
                            );
                            form.setValue('billing_variant_id', variantId, {
                              shouldValidate: true
                            });
                            form.setValue(
                              'billing_type_id',
                              comb?.billing_type_id ?? null,
                              { shouldValidate: true }
                            );
                            form.setValue('billing_type_ids', null, {
                              shouldValidate: true
                            });
                          }}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  isLoadingCombinations
                                    ? 'Wird geladen…'
                                    : 'Abrechnung wählen…'
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {clientCombinations.length === 0 &&
                            !isLoadingCombinations ? (
                              <SelectItem
                                value='none'
                                disabled
                                className='text-sm opacity-70'
                              >
                                Keine bisherigen Abrechnungen gefunden
                              </SelectItem>
                            ) : (
                              clientCombinations.map((comb) => {
                                const payerObj = payers.find(
                                  (p) => p.id === comb.payer_id
                                );
                                const payerName = payerObj?.name || 'Unbekannt';
                                const abrechnung =
                                  formatBillingVariantOptionLabel({
                                    name: comb.billing_variant_name ?? '',
                                    billing_type_name:
                                      comb.billing_type_name ?? ''
                                  });
                                const label = abrechnung
                                  ? `${payerName} — ${abrechnung}`
                                  : payerName;
                                const valStr = `${comb.payer_id}|${comb.billing_variant_id || ''}`;
                                return (
                                  <SelectItem key={valStr} value={valStr}>
                                    {label}
                                  </SelectItem>
                                );
                              })
                            )}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Bisherige Kombinationen für diesen Fahrgast.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              )}
              <Separator />
            </>
          )}

          {/* ─── Standard Mode Flow (ALL OTHER MODES) ────────────────────── */}
          {mode !== 'per_client' && (
            <>
              {/* Payer picker */}
              <FormField
                control={form.control}
                name='payer_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Kostenträger <span className='text-destructive'>*</span>
                    </FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        disabled={locked}
                        onValueChange={(id) => {
                          field.onChange(id);
                          // why: payer-scoped families — reset all type / variant scope.
                          form.setValue('billing_type_id', null);
                          form.setValue('billing_type_ids', null);
                          form.setValue('billing_variant_id', null);
                          form.setValue('billing_variant_ids', null);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder='Kostenträger wählen…' />
                        </SelectTrigger>
                        <SelectContent>
                          {payers.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.number})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Abrechnungsfamilien (optional, multi) — monthly never mirrors into billing_type_id. */}
              {billingTypes.length > 0 && (
                <FormField
                  control={form.control}
                  name='billing_type_ids'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Abrechnungsarten (optional)</FormLabel>
                      <FormControl>
                        <MonthlyBillingTypesPicker
                          options={billingTypes.map((bt) => ({
                            id: bt.id,
                            name: bt.name
                          }))}
                          value={field.value ?? null}
                          onChange={(next) => {
                            field.onChange(next);
                            const len = next?.length ?? 0;
                            // why: Unterarten subset only meaningful relative to one Abrechnungsart.
                            if (len !== 1) {
                              form.setValue('billing_variant_ids', null);
                              form.setValue('billing_variant_id', null);
                            }
                          }}
                          disabled={isLoadingTrips}
                        />
                      </FormControl>
                      <FormDescription>
                        Leer = alle Abrechnungsarten dieses Kostenträgers.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {monthlySingleTypeId && variantsForType.length > 0 ? (
                <FormField
                  control={form.control}
                  name='billing_variant_ids'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unterarten (optional)</FormLabel>
                      <FormControl>
                        <MonthlyVariantSubsetPicker
                          variants={variantsForType}
                          value={field.value ?? null}
                          onChange={field.onChange}
                          disabled={isLoadingTrips}
                        />
                      </FormControl>
                      <FormDescription>
                        Leer = alle Unterarten der gewählten Abrechnungsart.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </>
          )}

          {/* Rechnungsempfänger-Vorschau (Katalog: Familie → Kostenträger; Unterart erst nach Fahrtenladen) */}
          {selectedPayerId && selectedPayer && !empfaengerLoading ? (
            step2RecipientPreview?.rechnungsempfaengerId ? (
              <div className='bg-muted/40 rounded-lg border px-4 py-3 text-sm'>
                <p>
                  <span className='font-medium'>Rechnungsempfänger: </span>
                  {(() => {
                    const row = empfaengerCatalog.find(
                      (e) =>
                        e.id === step2RecipientPreview.rechnungsempfaengerId
                    );
                    const city = row?.city?.trim();
                    const name = row?.name ?? '—';
                    return city && city.length > 0 ? `${name} · ${city}` : name;
                  })()}
                </p>
                <p className='text-muted-foreground mt-1 text-xs'>
                  Voreingestellt aus{' '}
                  {step2RecipientPreview.source === 'billing_type'
                    ? 'Abrechnungsfamilie'
                    : step2RecipientPreview.source === 'payer'
                      ? 'Kostenträger'
                      : step2RecipientPreview.source === 'variant'
                        ? 'Unterart'
                        : 'Katalog'}
                  . Die endgültige Zuordnung kann sich nach Unterart der ersten
                  Fahrt unterscheiden.
                </p>
              </div>
            ) : (
              <Alert className='border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'>
                <AlertTriangle className='h-4 w-4 text-amber-600' />
                <AlertDescription className='text-amber-950 dark:text-amber-100'>
                  Kein Rechnungsempfänger konfiguriert — bitte in Stammdaten
                  prüfen
                </AlertDescription>
              </Alert>
            )
          ) : null}

          {/* Date range (always at the bottom) — same control as trips filter bar */}
          <FormItem>
            <FormLabel>
              Zeitraum <span className='text-destructive'>*</span>
            </FormLabel>
            <FormControl>
              <DateRangePicker
                value={step2DateRange}
                onChange={handleStep2DateRangeChange}
                presets={invoiceDateRangePresets}
                placeholder='Zeitraum wählen'
              />
            </FormControl>
            {(form.formState.errors.period_from ||
              form.formState.errors.period_to) && (
              <p className='text-destructive text-sm font-medium'>
                {form.formState.errors.period_from?.message ??
                  form.formState.errors.period_to?.message}
              </p>
            )}
          </FormItem>

          <div className='flex justify-end pt-2'>
            <Button type='submit' disabled={isLoadingTrips}>
              {isLoadingTrips ? 'Fahrten werden geladen…' : 'Fahrten laden'}
            </Button>
          </div>
        </form>
      </FormProvider>
    </div>
  );
}
