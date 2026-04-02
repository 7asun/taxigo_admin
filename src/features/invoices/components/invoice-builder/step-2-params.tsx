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

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
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
import { DatePicker } from '@/components/ui/date-time-picker';
import { ClientAutoSuggest } from '@/components/ui/client-auto-suggest';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { useClientPayers } from '../../hooks/use-client-payers';
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
  billing_types?: { id: string; name: string }[];
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
  onBack: () => void;
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
  onBack,
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
  const selectedPayer = payers.find((p) => p.id === selectedPayerId);
  const billingTypes = selectedPayer?.billing_types ?? [];

  // Watch client_id to fetch historical combinations
  const selectedClientId = form.watch('client_id');
  const { data: clientCombinations = [], isLoading: isLoadingCombinations } =
    useClientPayers(selectedClientId ?? null);

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
      <div>
        <h2 className='text-lg font-semibold'>Parameter festlegen</h2>
        <p className='text-muted-foreground text-sm'>
          Wählen Sie Kostenträger und Zeitraum.
        </p>
      </div>

      <Form
        form={form}
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
                    <Select value={field.value} onValueChange={field.onChange}>
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

        {/* Date range (always at the bottom) */}
        <div className='grid grid-cols-2 gap-4'>
          <FormField
            control={form.control}
            name='period_from'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Von <span className='text-destructive'>*</span>
                </FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='period_to'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Bis <span className='text-destructive'>*</span>
                </FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Navigation */}
        <div className='flex justify-between pt-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={onBack}
            className='gap-2'
          >
            <ArrowLeft className='h-4 w-4' />
            Zurück
          </Button>
          <Button type='submit' disabled={isLoadingTrips}>
            {isLoadingTrips ? 'Fahrten werden geladen…' : 'Fahrten laden'}
          </Button>
        </div>
      </Form>
    </div>
  );
}
