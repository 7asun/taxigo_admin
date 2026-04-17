'use client';

/**
 * RecurringRuleFormBody
 *
 * The complete form content for creating or editing a recurring trip rule.
 * This component is intentionally "headless" with respect to its outer shell —
 * it knows nothing about whether it lives inside a Sheet overlay or a Panel column.
 *
 * Both RecurringRuleSheet (overlay) and RecurringRulePanel (column) render this
 * component as their form body. The visual result is identical in both contexts:
 * same fields, same layout, same validation messages.
 *
 * **Billing:** `payer_id` and `billing_variant_id` are required on submit (parity with
 * Neue Fahrt). The cron copies them onto each generated trip; DB columns stay nullable
 * for legacy rules until an admin saves the form once.
 *
 * Structure (top to bottom):
 *   1. Wochentage (Mon–Sun checkboxes, 2-column grid)
 *   2. Gültig ab / Gültig bis (date range, side-by-side)
 *   3. Kostenträger / Abrechnung (before trip address block, same order as Neue Fahrt)
 *   4. Hinfahrt Details (time + Abholadresse / Zieladresse via `AddressAutocomplete`, same Places flow as Neue Fahrt)
 *   5. Rückfahrt mode (none / Zeitabsprache / genaue Zeit) + billing-driven prefill/lock
 *   6. Regel Aktiv toggle (edit mode only)
 *
 * Props:
 *   form         — react-hook-form instance (UseFormReturn<RuleFormValues>)
 *                  Both parent components own their own form state and pass it in.
 *   isSubmitting — disables fields while the save is in progress
 *   onCancel     — called by the Abbrechen button; parents handle close logic
 *   showIsActive — when true, shows the "Regel Aktiv" toggle (edit mode only)
 *
 * The footer (Abbrechen + Speichern buttons) is included here so the form body
 * is fully self-contained. The parent wraps it in either SheetContent or a
 * Panel shell — both are flex-col containers with an overflow-y-auto scroll area.
 *
 * NOTE: The scrollable wrapper (the div with overflow-y-auto) is intentionally
 * NOT part of this component. The parent shell (Sheet or Panel) owns the scroll
 * container so it can control padding and height independently.
 */

import * as React from 'react';
import { format } from 'date-fns';
import { FormProvider, UseFormReturn } from 'react-hook-form';
import * as z from 'zod';
import {
  FormControl,
  FormField,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  AddressAutocomplete,
  type AddressResult
} from '@/features/trips/components/address-autocomplete';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { normalizeBillingTypeBehavior } from '@/features/trips/lib/normalize-billing-type-behavior-profile';
import {
  recurringReturnModeFromRow,
  type RecurringRuleReturnMode
} from '@/features/trips/lib/recurring-return-mode';
import { RecurringRuleBillingFields } from './recurring-rule-billing-fields';
import type { FremdfirmaPaymentMode } from '@/features/trips/types/trip-form-reference.types';

// ─── Schema (shared between Sheet and Panel) ─────────────────────────────────

export const DAYS_OF_WEEK = [
  { id: 'MO', label: 'Montag' },
  { id: 'TU', label: 'Dienstag' },
  { id: 'WE', label: 'Mittwoch' },
  { id: 'TH', label: 'Donnerstag' },
  { id: 'FR', label: 'Freitag' },
  { id: 'SA', label: 'Samstag' },
  { id: 'SU', label: 'Sonntag' }
] as const;

export const ruleFormSchema = z
  .object({
    days: z.array(z.string()).refine((value) => value.length > 0, {
      message: 'Sie müssen mindestens einen Wochentag auswählen.'
    }),
    payer_id: z.string().min(1, 'Kostenträger ist erforderlich'),
    /** Required on save like Neue Fahrt; auto-filled when the payer has a single Unterart. */
    billing_variant_id: z.string().min(1, 'Unterart ist erforderlich'),
    kts_document_applies: z.boolean(),
    /** True after dispatcher toggles KTS; false when only catalog cascade updates the switch. */
    kts_manual: z.boolean(),
    no_invoice_required: z.boolean(),
    no_invoice_manual: z.boolean(),
    fremdfirma_enabled: z.boolean(),
    fremdfirma_id: z.string().optional(),
    fremdfirma_payment_mode: z
      .enum([
        'cash_per_trip',
        'monthly_invoice',
        'self_payer',
        'kts_to_fremdfirma'
      ])
      .nullable()
      .optional(),
    fremdfirma_cost: z.string().optional(),
    // Mirrors the Neue Fahrt empty-time pattern: the form uses '' for “no clock time”,
    // which is later persisted as NULL so the dispatcher can confirm time day-before.
    pickup_time: z.union([
      z.literal(''),
      z
        .string()
        .regex(
          /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
          'Bitte ein gültiges Zeitformat verwenden (HH:MM)'
        )
    ]),
    pickup_address: z.string().min(1, 'Abholadresse ist erforderlich'),
    dropoff_address: z.string().min(1, 'Zieladresse ist erforderlich'),
    return_mode: z.enum(['none', 'time_tbd', 'exact']),
    return_time: z.string().optional(),
    start_date: z.string().min(1, 'Startdatum ist erforderlich'),
    end_date: z.string().optional(),
    is_active: z.boolean()
  })
  .superRefine((data, ctx) => {
    if (data.return_mode === 'exact') {
      const t = data.return_time?.trim() ?? '';
      if (!t) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Rückfahrtzeit ist erforderlich bei „Rückfahrt mit genauer Zeit“.',
          path: ['return_time']
        });
      }
    }
    if (data.fremdfirma_enabled) {
      if (!data.fremdfirma_id?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Fremdfirma auswählen.',
          path: ['fremdfirma_id']
        });
      }
      if (!data.fremdfirma_payment_mode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Abrechnungsart der Fremdfirma wählen.',
          path: ['fremdfirma_payment_mode']
        });
      }
    }
  });

export type RuleFormValues = z.infer<typeof ruleFormSchema>;

// ─── Default values helper ───────────────────────────────────────────────────

export function getRuleFormDefaults(
  initialData?: {
    rrule_string: string;
    pickup_time: string | null;
    pickup_address: string;
    dropoff_address: string;
    return_mode?: string | null;
    return_trip: boolean;
    return_time?: string | null;
    start_date: string;
    end_date?: string | null;
    is_active: boolean;
    payer_id?: string | null;
    billing_variant_id?: string | null;
    kts_document_applies?: boolean | null;
    kts_source?: string | null;
    no_invoice_required?: boolean | null;
    no_invoice_source?: string | null;
    fremdfirma_id?: string | null;
    fremdfirma_payment_mode?: string | null;
    fremdfirma_cost?: number | null;
  } | null
): RuleFormValues {
  if (!initialData) {
    return {
      days: ['MO', 'TU', 'WE', 'TH', 'FR'],
      payer_id: '',
      billing_variant_id: '',
      kts_document_applies: false,
      kts_manual: false,
      no_invoice_required: false,
      no_invoice_manual: false,
      fremdfirma_enabled: false,
      fremdfirma_id: '',
      fremdfirma_payment_mode: null,
      fremdfirma_cost: '',
      pickup_time: '',
      pickup_address: '',
      dropoff_address: '',
      return_mode: 'exact',
      return_time: '15:00',
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: '',
      is_active: true
    };
  }

  const match = initialData.rrule_string.match(/BYDAY=([^;]+)/);
  const days = match ? match[1].split(',') : ['MO', 'TU', 'WE', 'TH', 'FR'];
  const returnMode = recurringReturnModeFromRow(initialData);

  return {
    days,
    payer_id: initialData.payer_id ?? '',
    billing_variant_id: initialData.billing_variant_id ?? '',
    kts_document_applies: !!initialData.kts_document_applies,
    kts_manual: (initialData.kts_source ?? '') === 'manual',
    no_invoice_required: !!initialData.no_invoice_required,
    no_invoice_manual: (initialData.no_invoice_source ?? '') === 'manual',
    fremdfirma_enabled: !!initialData.fremdfirma_id,
    fremdfirma_id: initialData.fremdfirma_id ?? '',
    fremdfirma_payment_mode:
      (initialData.fremdfirma_payment_mode as FremdfirmaPaymentMode | null) ??
      null,
    fremdfirma_cost:
      initialData.fremdfirma_cost != null
        ? String(initialData.fremdfirma_cost)
        : '',
    pickup_time: initialData.pickup_time
      ? initialData.pickup_time.substring(0, 5)
      : '',
    pickup_address: initialData.pickup_address,
    dropoff_address: initialData.dropoff_address,
    return_mode: returnMode,
    return_time:
      returnMode === 'exact'
        ? (initialData.return_time?.substring(0, 5) ?? '15:00')
        : '',
    start_date: initialData.start_date,
    end_date: initialData.end_date ?? '',
    is_active: initialData.is_active ?? true
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

interface RecurringRuleFormBodyProps {
  form: UseFormReturn<RuleFormValues>;
  /** Show the "Regel Aktiv" toggle — only relevant when editing an existing rule */
  showIsActive?: boolean;
  /** Optional address pre-fill selector (Home as Pickup/Dropoff) */
  addressRoleSelection?: {
    homeRole: 'pickup' | 'dropoff';
    formattedHomeAddress: string;
    onRoleChange: (role: 'pickup' | 'dropoff') => void;
  };
}

export function RecurringRuleFormBody({
  form,
  showIsActive = false,
  addressRoleSelection
}: RecurringRuleFormBodyProps) {
  const watchedPayerId = form.watch('payer_id');
  const watchedBillingVariantId = form.watch('billing_variant_id');
  const watchedReturnMode = form.watch(
    'return_mode'
  ) as RecurringRuleReturnMode;
  const { billingTypes } = useTripFormData(watchedPayerId);

  const billingBehavior = React.useMemo(() => {
    const v = billingTypes.find((b) => b.id === watchedBillingVariantId);
    if (!v) return null;
    return normalizeBillingTypeBehavior(v.behavior_profile);
  }, [billingTypes, watchedBillingVariantId]);

  const isReturnModeLocked = Boolean(
    billingBehavior &&
      (billingBehavior.lockReturnMode ||
        billingBehavior.returnPolicy === 'none')
  );

  React.useEffect(() => {
    if (!watchedBillingVariantId || !billingBehavior) return;
    const rp = billingBehavior.returnPolicy as string | null | undefined;
    const lockedNone = billingBehavior.lockReturnMode || rp === 'none';
    if (lockedNone) {
      const rawPolicy = rp ?? 'none';
      let mode: RecurringRuleReturnMode = 'none';
      if (rawPolicy === 'time_tbd' || rawPolicy === 'create_placeholder') {
        mode = 'time_tbd';
      } else if (rawPolicy === 'exact') {
        mode = 'exact';
      }
      form.setValue('return_mode', mode, { shouldValidate: true });
      return;
    }
    if (rp === 'time_tbd' || rp === 'create_placeholder') {
      form.setValue('return_mode', 'time_tbd', { shouldValidate: true });
      return;
    }
    if (rp === 'exact') {
      form.setValue('return_mode', 'exact', { shouldValidate: true });
    }
  }, [watchedBillingVariantId, billingBehavior, form]);

  return (
    <FormProvider {...form}>
      <div className='space-y-6 py-6'>
        {/* ── Wochentage ──────────────────────────────────────── */}
        <FormField
          control={form.control}
          name='days'
          render={() => (
            <FormItem>
              <FormLabel>Wochentage</FormLabel>
              <div className='mt-2 grid grid-cols-2 gap-2'>
                {DAYS_OF_WEEK.map((day) => (
                  <FormField
                    key={day.id}
                    control={form.control}
                    name='days'
                    render={({ field }) => (
                      <FormItem
                        key={day.id}
                        className='flex flex-row items-start space-y-0 space-x-3 rounded-md border p-3 shadow-sm'
                      >
                        <FormControl>
                          <Checkbox
                            checked={field.value?.includes(day.id)}
                            onCheckedChange={(checked) =>
                              checked
                                ? field.onChange([...field.value, day.id])
                                : field.onChange(
                                    field.value?.filter((v) => v !== day.id)
                                  )
                            }
                          />
                        </FormControl>
                        <FormLabel className='cursor-pointer font-normal'>
                          {day.label}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Gültig ab / bis ─────────────────────────────────── */}
        <div className='grid grid-cols-2 gap-4'>
          <FormField
            control={form.control}
            name='start_date'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Gültig ab</FormLabel>
                <FormControl>
                  <Input type='date' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='end_date'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Gültig bis (Optional)</FormLabel>
                <FormControl>
                  <Input type='date' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <RecurringRuleBillingFields form={form} />

        {addressRoleSelection && (
          <div className='bg-muted/20 rounded-lg border p-4'>
            <div className='mb-3 flex items-center justify-between'>
              <span className='text-sm font-medium'>
                Home-Adresse verwenden als:
              </span>
            </div>
            <Tabs
              value={addressRoleSelection.homeRole}
              onValueChange={(v) =>
                addressRoleSelection.onRoleChange(v as 'pickup' | 'dropoff')
              }
              className='w-full'
            >
              <TabsList className='grid w-full grid-cols-2'>
                <TabsTrigger value='pickup'>Abholung</TabsTrigger>
                <TabsTrigger value='dropoff'>Ziel</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className='text-muted-foreground mt-2 text-[10px]'>
              {addressRoleSelection.formattedHomeAddress ||
                'Keine Adresse hinterlegt'}
            </p>
          </div>
        )}

        {/* ── Hinfahrt Details ────────────────────────────────── */}
        <div className='bg-muted/20 space-y-4 rounded-lg border p-4'>
          <h4 className='text-sm font-medium'>Hinfahrt Details</h4>
          <FormField
            control={form.control}
            name='pickup_time'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Abholzeit</FormLabel>
                <FormControl>
                  <Input type='time' {...field} />
                </FormControl>
                <FormDescription>
                  Leer lassen für tägliche Zeitabsprache
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='pickup_address'
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Abholadresse</FormLabel>
                <FormControl>
                  <AddressAutocomplete
                    value={field.value}
                    onChange={(result: AddressResult | string) => {
                      if (typeof result === 'string') {
                        field.onChange(result);
                        return;
                      }
                      // Single-line rule fields: use formatted line after Place Details (or typed query).
                      field.onChange(result.address ?? '');
                    }}
                    placeholder='Adresse suchen…'
                    className={cn(fieldState.error && 'border-destructive')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='dropoff_address'
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Zieladresse</FormLabel>
                <FormControl>
                  <AddressAutocomplete
                    value={field.value}
                    onChange={(result: AddressResult | string) => {
                      if (typeof result === 'string') {
                        field.onChange(result);
                        return;
                      }
                      field.onChange(result.address ?? '');
                    }}
                    placeholder='Adresse suchen…'
                    className={cn(fieldState.error && 'border-destructive')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ── Rückfahrt (parity with Neue Fahrt) ───────────────── */}
        <div className='bg-muted/20 space-y-4 rounded-lg border p-4'>
          <div className='mb-1 flex items-center gap-2'>
            <span className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>
              Rückfahrt
            </span>
            {isReturnModeLocked ? (
              <span className='text-muted-foreground text-[10px] font-medium'>
                (Abrechnung)
              </span>
            ) : null}
          </div>
          <FormField
            control={form.control}
            name='return_mode'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rückfahrt</FormLabel>
                <Select
                  onValueChange={(v) => {
                    field.onChange(v as RecurringRuleReturnMode);
                    if (v !== 'exact') {
                      form.setValue('return_time', '', {
                        shouldValidate: true
                      });
                    }
                  }}
                  value={field.value}
                  disabled={isReturnModeLocked}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder='Wählen…' />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value='none'>Keine Rückfahrt</SelectItem>
                    <SelectItem value='time_tbd'>
                      Rückfahrt mit Zeitabsprache
                    </SelectItem>
                    <SelectItem value='exact'>
                      Rückfahrt mit genauer Zeit
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {watchedReturnMode === 'exact' && (
            <FormField
              control={form.control}
              name='return_time'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rückfahrt Abholzeit</FormLabel>
                  <FormControl>
                    <Input
                      type='time'
                      {...field}
                      disabled={isReturnModeLocked}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {watchedReturnMode === 'time_tbd' && (
            <p className='text-muted-foreground text-xs'>
              Die Rückfahrt wird ohne feste Uhrzeit angelegt; die Zeit kann
              später gesetzt werden (wie bei Neue Fahrt).
            </p>
          )}
        </div>

        {/* ── Regel Aktiv (edit mode only) ─────────────────────── */}
        {showIsActive && (
          <FormField
            control={form.control}
            name='is_active'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base text-rose-500'>
                    Regel Aktiv
                  </FormLabel>
                  <p className='text-muted-foreground text-sm'>
                    Deaktivieren Sie diese Regel, um die Fahrten vorübergehend
                    auszusetzen ohne sie zu löschen.
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        )}
      </div>
    </FormProvider>
  );
}
