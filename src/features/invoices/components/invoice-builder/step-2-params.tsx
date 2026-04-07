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

import { useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

// ─── Local schema for step 2 form ─────────────────────────────────────────────
// NOTE: Zod v4 — use 'message' instead of 'required_error'

const step2Schema = z.object({
  payer_id: z.string().uuid(),
  billing_type_id: z.string().uuid().nullish().or(z.literal('')),
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
  onNext: (values: {
    payer_id: string;
    billing_type_id: string | null;
    period_from: string;
    period_to: string;
    client_id: string | null;
    mode: InvoiceMode;
  }) => void;
}

/** Step 2: Payer, date range, billing type, and (per_client) client picker. */
export function Step2Params({
  mode,
  payers,
  clients,
  isLoadingTrips,
  onNext
}: Step2ParamsProps) {
  const { searchClients } = useTripFormData();

  const form = useForm<Step2Values>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(step2Schema) as any,
    defaultValues: {
      payer_id: '',
      billing_type_id: null,
      period_from: '',
      period_to: '',
      client_id: null
    }
  });

  // Get billing types for the currently selected payer
  const selectedPayerId = form.watch('payer_id');
  const billingTypeIdRaw = form.watch('billing_type_id');
  const billingTypeIdNorm =
    billingTypeIdRaw && String(billingTypeIdRaw).length > 0
      ? String(billingTypeIdRaw)
      : null;
  const selectedPayer = payers.find((p) => p.id === selectedPayerId);
  const billingTypes = selectedPayer?.billing_types ?? [];

  const { data: empfaengerCatalog = [], isLoading: empfaengerLoading } =
    useRechnungsempfaengerOptions();

  const step2RecipientPreview = useMemo(() => {
    if (!selectedPayerId || !selectedPayer) return null;
    const bt = billingTypeIdNorm
      ? selectedPayer.billing_types?.find((b) => b.id === billingTypeIdNorm)
      : null;
    return resolveRechnungsempfaenger({
      billingVariantRechnungsempfaengerId: null,
      billingTypeRechnungsempfaengerId: bt?.rechnungsempfaenger_id ?? null,
      payerRechnungsempfaengerId: selectedPayer.rechnungsempfaenger_id ?? null
    });
  }, [selectedPayerId, selectedPayer, billingTypeIdNorm]);

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
    onNext({
      payer_id: values.payer_id,
      billing_type_id: values.billing_type_id || null,
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
                    const currentBillingTypeId = form.watch('billing_type_id');
                    const combinedValue = field.value
                      ? `${field.value}|${currentBillingTypeId || ''}`
                      : '';

                    return (
                      <FormItem>
                        <FormLabel>
                          Abrechnung <span className='text-destructive'>*</span>
                        </FormLabel>
                        <Select
                          value={combinedValue}
                          onValueChange={(val) => {
                            const [pId, bId] = val.split('|');
                            field.onChange(pId);
                            form.setValue('billing_type_id', bId || null, {
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
                                const btName = payerObj?.billing_types?.find(
                                  (b) => b.id === comb.billing_type_id
                                )?.name;
                                const label = btName
                                  ? `${payerName} (${btName})`
                                  : payerName;
                                const valStr = `${comb.payer_id}|${comb.billing_type_id || ''}`;
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
                        onValueChange={field.onChange}
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

              {/* Billing type filter (optional) */}
              {billingTypes.length > 0 && (
                <FormField
                  control={form.control}
                  name='billing_type_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Abrechnungsart (optional)</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value ?? 'all'}
                          onValueChange={(val) =>
                            field.onChange(val === 'all' ? null : val)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Alle Abrechnungsarten' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='all'>
                              Alle Abrechnungsarten
                            </SelectItem>
                            {billingTypes.map((bt) => (
                              <SelectItem key={bt.id} value={bt.id}>
                                {bt.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>
                        Nur Fahrten dieser Abrechnungsart einbeziehen.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
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
