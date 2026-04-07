'use client';

/**
 * Preisregel-Editor (Kostenträger-Katalog).
 *
 * — Zod boundary: `billingPricingRuleUpsertSchema.safeParse` on submit (matches DB + `resolveTripPrice`).
 * — DB partial unique indexes → Postgres 23505; user-facing copy via `pricingRulesErrorMessage`.
 * — `useFieldArray` for km-Staffeln (tiered + fixed-above-threshold branches).
 * — `time_based`: pro Wochentag aktivieren + Von/Bis (HH:mm, Europe/Berlin-Auswertung zur Laufzeit im Resolver).
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { billingPricingRuleUpsertSchema } from '@/features/invoices/lib/pricing-rule-config.schema';
import type {
  PricingStrategy,
  WeekdayKey,
  TimeBasedConfig
} from '@/features/invoices/types/pricing.types';
import { PRICING_STRATEGY_LABELS_DE } from '@/features/invoices/lib/pricing-strategy-labels-de';

export { PRICING_STRATEGY_LABELS_DE };

import {
  createPricingRule,
  pricingRulesErrorMessage,
  updatePricingRule,
  type BillingPricingRuleRow,
  type PricingRuleScope
} from '@/features/payers/api/billing-pricing-rules.api';
import { toast } from 'sonner';

const WEEKDAY_ORDER: WeekdayKey[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun'
];

const WEEKDAY_LABEL: Record<WeekdayKey, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag'
};

interface KmTierFormValue {
  from_km: number;
  to_km: number | null;
  price_per_km: number;
}

interface DaySlotFormValue {
  enabled: boolean;
  start: string;
  end: string;
}

type DaysForm = Record<WeekdayKey, DaySlotFormValue>;

interface PricingRuleFormValues {
  strategy: PricingStrategy;
  /** Optional net Anfahrtspreis — merged into rule `config` for all strategies (resolver applies per cascade). */
  approach_fee_net: number | null;
  tiers: KmTierFormValue[];
  threshold_km: number;
  fixed_price: number;
  km_tiers: KmTierFormValue[];
  fixed_fee: number;
  holiday_rule: 'closed' | 'normal';
  holidays: string[];
  days: DaysForm;
}

function defaultTier(): KmTierFormValue {
  return { from_km: 0, to_km: null, price_per_km: 2.5 };
}

function defaultDaysForNewRule(): DaysForm {
  const o = {} as DaysForm;
  for (const k of WEEKDAY_ORDER) {
    o[k] =
      k === 'sat' || k === 'sun'
        ? { enabled: false, start: '07:00', end: '18:00' }
        : { enabled: true, start: '07:00', end: '18:00' };
  }
  return o;
}

function daysFromTimeConfig(cfg: TimeBasedConfig | undefined): DaysForm {
  const wh = cfg?.working_hours;
  const out = defaultDaysForNewRule();
  if (!wh) return out;
  for (const k of WEEKDAY_ORDER) {
    const slot = wh[k];
    if (
      slot &&
      typeof slot.start === 'string' &&
      typeof slot.end === 'string'
    ) {
      out[k] = { enabled: true, start: slot.start, end: slot.end };
    } else {
      out[k] = { enabled: false, start: '07:00', end: '18:00' };
    }
  }
  return out;
}

function buildWorkingHoursFromDays(
  days: DaysForm
): TimeBasedConfig['working_hours'] {
  const wh: TimeBasedConfig['working_hours'] = {};
  for (const k of WEEKDAY_ORDER) {
    const d = days[k];
    wh[k] = d.enabled ? { start: d.start, end: d.end } : null;
  }
  return wh;
}

function defaultFormValues(): PricingRuleFormValues {
  return {
    strategy: 'tiered_km',
    approach_fee_net: null,
    tiers: [defaultTier()],
    threshold_km: 4,
    fixed_price: 15,
    km_tiers: [defaultTier()],
    fixed_fee: 45,
    holiday_rule: 'normal',
    holidays: [],
    days: defaultDaysForNewRule()
  };
}

export interface PricingRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: PricingRuleScope;
  editing: BillingPricingRuleRow | null;
  onSaved: () => void;
}

export function PricingRuleDialog({
  open,
  onOpenChange,
  scope,
  editing,
  onSaved
}: PricingRuleDialogProps) {
  const eur = useMemo(
    () =>
      new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }),
    []
  );

  const form = useForm<PricingRuleFormValues>({
    defaultValues: defaultFormValues()
  });

  const { control, register, handleSubmit, reset, watch } = form;

  const tierFA = useFieldArray({ control, name: 'tiers' });
  const kmTierFA = useFieldArray({ control, name: 'km_tiers' });

  const [holidayInput, setHolidayInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const s = editing.strategy as PricingStrategy;
      const cfg = editing.config as Record<string, unknown>;
      const base = defaultFormValues();
      base.strategy = s;
      if (
        typeof cfg.approach_fee_net === 'number' &&
        !Number.isNaN(cfg.approach_fee_net)
      ) {
        base.approach_fee_net = cfg.approach_fee_net;
      }
      if (s === 'tiered_km' && Array.isArray(cfg.tiers)) {
        base.tiers = cfg.tiers as KmTierFormValue[];
      }
      if (s === 'fixed_below_threshold_then_km') {
        base.threshold_km =
          typeof cfg.threshold_km === 'number'
            ? cfg.threshold_km
            : base.threshold_km;
        base.fixed_price =
          typeof cfg.fixed_price === 'number'
            ? cfg.fixed_price
            : base.fixed_price;
        if (Array.isArray(cfg.km_tiers)) {
          base.km_tiers = cfg.km_tiers as KmTierFormValue[];
        }
      }
      if (s === 'time_based') {
        const tc = cfg as unknown as TimeBasedConfig;
        base.fixed_fee =
          typeof tc.fixed_fee === 'number' ? tc.fixed_fee : base.fixed_fee;
        base.holiday_rule = tc.holiday_rule ?? 'normal';
        base.holidays = Array.isArray(tc.holidays) ? [...tc.holidays] : [];
        base.days = daysFromTimeConfig(tc);
      }
      reset(base);
    } else {
      reset(defaultFormValues());
      setHolidayInput('');
    }
  }, [open, editing, reset]);

  const scopeLabel = useMemo(() => {
    if (scope.kind === 'payer') return 'Kostenträger';
    if (scope.kind === 'billing_type') return 'Abrechnungsfamilie';
    return 'Unterart';
  }, [scope]);

  const buildApiPayload = (v: PricingRuleFormValues) => {
    const withApproach = (
      config: Record<string, unknown>
    ): Record<string, unknown> => {
      if (
        v.approach_fee_net != null &&
        Number.isFinite(v.approach_fee_net) &&
        v.approach_fee_net >= 0
      ) {
        return { ...config, approach_fee_net: v.approach_fee_net };
      }
      return config;
    };

    switch (v.strategy) {
      case 'client_price_tag':
      case 'manual_trip_price':
      case 'no_price':
        return {
          strategy: v.strategy,
          config: withApproach({})
        };
      case 'tiered_km':
        return {
          strategy: v.strategy,
          config: withApproach({ tiers: v.tiers })
        };
      case 'fixed_below_threshold_then_km':
        return {
          strategy: v.strategy,
          config: withApproach({
            threshold_km: v.threshold_km,
            fixed_price: v.fixed_price,
            km_tiers: v.km_tiers
          })
        };
      case 'time_based':
        return {
          strategy: v.strategy,
          config: withApproach({
            fixed_fee: v.fixed_fee,
            working_hours: buildWorkingHoursFromDays(v.days),
            holiday_rule: v.holiday_rule,
            holidays: v.holidays
          })
        };
      default: {
        const _e: never = v.strategy;
        return _e;
      }
    }
  };

  const onSubmit = async (v: PricingRuleFormValues) => {
    const raw = buildApiPayload(v);
    const parsed = billingPricingRuleUpsertSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Ungültige Eingaben');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updatePricingRule(editing.id, {
          strategy: parsed.data.strategy,
          config: parsed.data.config
        });
        toast.success('Preisregel aktualisiert');
      } else {
        const ruleScope: Parameters<typeof createPricingRule>[0]['scope'] =
          scope.kind === 'payer'
            ? { kind: 'payer', payerId: scope.payerId }
            : scope.kind === 'billing_type'
              ? {
                  kind: 'billing_type',
                  payerId: scope.payerId,
                  billingTypeId: scope.billingTypeId
                }
              : {
                  kind: 'billing_variant',
                  payerId: scope.payerId,
                  billingVariantId: scope.billingVariantId
                };
        await createPricingRule({
          strategy: parsed.data.strategy,
          config: parsed.data.config,
          scope: ruleScope
        });
        toast.success('Preisregel angelegt');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(pricingRulesErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const addHoliday = (holidays: string[]) => {
    const v = holidayInput.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      toast.error('Datum als JJJJ-MM-TT');
      return;
    }
    form.setValue('holidays', [...holidays, v]);
    setHolidayInput('');
  };

  const strategy = watch('strategy');
  const holidaysWatch = watch('holidays');

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Preisregel bearbeiten' : 'Neue Preisregel'}
          </DialogTitle>
          <DialogDescription>
            Ebene: {scopeLabel}. Nur eine aktive Regel pro Ebene möglich.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(onSubmit)(e);
          }}
          className='space-y-4'
        >
          <div>
            <Label>Strategie</Label>
            <Select
              value={strategy}
              onValueChange={(val) =>
                form.setValue('strategy', val as PricingStrategy)
              }
              disabled={!!editing || saving}
            >
              <SelectTrigger className='mt-1'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(PRICING_STRATEGY_LABELS_DE) as PricingStrategy[]
                ).map((k) => (
                  <SelectItem key={k} value={k}>
                    {PRICING_STRATEGY_LABELS_DE[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor='approach_fee_net'>
              Anfahrtspreis (Netto, optional)
            </Label>
            <Controller
              control={control}
              name='approach_fee_net'
              render={({ field }) => (
                <Input
                  id='approach_fee_net'
                  type='number'
                  step='0.01'
                  min='0'
                  className='mt-1'
                  placeholder='z. B. 5,00'
                  value={
                    field.value === null || field.value === undefined
                      ? ''
                      : String(field.value)
                  }
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === '') {
                      field.onChange(null);
                      return;
                    }
                    const n = parseFloat(raw.replace(',', '.'));
                    field.onChange(Number.isNaN(n) ? null : n);
                  }}
                  disabled={saving}
                />
              )}
            />
            <p className='text-muted-foreground mt-1 text-xs'>
              Pro Fahrt netto; wird bei Staffeln, Fix+km und Zeit angewendet —
              nicht bei Kunden-Preis (P-Tag) oder KTS.
            </p>
          </div>

          {strategy === 'tiered_km' && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label>Km-Staffeln</Label>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => tierFA.append(defaultTier())}
                >
                  <Plus className='mr-1 h-3 w-3' />
                  Staffel
                </Button>
              </div>
              {tierFA.fields.map((field, idx) => (
                <div
                  key={field.id}
                  className='flex flex-wrap items-end gap-2 border-b pb-2'
                >
                  <div>
                    <Label className='text-xs'>von km</Label>
                    <Input
                      type='number'
                      step='0.1'
                      {...register(`tiers.${idx}.from_km`, {
                        valueAsNumber: true
                      })}
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>bis km (leer = ∞)</Label>
                    <Controller
                      control={control}
                      name={`tiers.${idx}.to_km`}
                      render={({ field: f }) => (
                        <Input
                          placeholder='∞'
                          value={
                            f.value === null || f.value === undefined
                              ? ''
                              : String(f.value)
                          }
                          onChange={(e) => {
                            const t = e.target.value.trim();
                            f.onChange(
                              t === '' ? null : parseFloat(t.replace(',', '.'))
                            );
                          }}
                        />
                      )}
                    />
                  </div>
                  <div className='min-w-[120px]'>
                    <Label className='text-xs'>€ / km (netto)</Label>
                    <Input
                      type='number'
                      step='0.01'
                      {...register(`tiers.${idx}.price_per_km`, {
                        valueAsNumber: true
                      })}
                    />
                    <p className='text-muted-foreground mt-0.5 text-[10px]'>
                      {eur.format(
                        Number.isFinite(watch(`tiers.${idx}.price_per_km`))
                          ? watch(`tiers.${idx}.price_per_km`)
                          : 0
                      )}{' '}
                      pro km
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => tierFA.remove(idx)}
                    disabled={tierFA.fields.length <= 1}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {strategy === 'fixed_below_threshold_then_km' && (
            <div className='space-y-3'>
              <div className='grid grid-cols-2 gap-2'>
                <div>
                  <Label>Schwelle km</Label>
                  <Input
                    type='number'
                    step='0.1'
                    {...register('threshold_km', { valueAsNumber: true })}
                  />
                </div>
                <div>
                  <Label>Festpreis unter Schwelle (netto)</Label>
                  <Input
                    type='number'
                    step='0.01'
                    {...register('fixed_price', { valueAsNumber: true })}
                  />
                  <p className='text-muted-foreground mt-0.5 text-[10px]'>
                    {eur.format(
                      Number.isFinite(watch('fixed_price'))
                        ? watch('fixed_price')
                        : 0
                    )}
                  </p>
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <Label className='text-muted-foreground text-xs'>
                  Km-Staffeln oberhalb der Schwelle (volle Strecke)
                </Label>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => kmTierFA.append(defaultTier())}
                >
                  <Plus className='mr-1 h-3 w-3' />
                  Staffel
                </Button>
              </div>
              {kmTierFA.fields.map((field, idx) => (
                <div
                  key={field.id}
                  className='flex flex-wrap items-end gap-2 border-b pb-2'
                >
                  <Input
                    type='number'
                    className='w-24'
                    placeholder='von'
                    {...register(`km_tiers.${idx}.from_km`, {
                      valueAsNumber: true
                    })}
                  />
                  <Controller
                    control={control}
                    name={`km_tiers.${idx}.to_km`}
                    render={({ field: f }) => (
                      <Input
                        className='w-24'
                        placeholder='bis'
                        value={
                          f.value === null || f.value === undefined
                            ? ''
                            : String(f.value)
                        }
                        onChange={(e) => {
                          const t = e.target.value.trim();
                          f.onChange(
                            t === '' ? null : parseFloat(t.replace(',', '.'))
                          );
                        }}
                      />
                    )}
                  />
                  <div className='min-w-[100px]'>
                    <Input
                      type='number'
                      step='0.01'
                      placeholder='€/km'
                      {...register(`km_tiers.${idx}.price_per_km`, {
                        valueAsNumber: true
                      })}
                    />
                    <p className='text-muted-foreground text-[10px]'>
                      {eur.format(
                        Number.isFinite(watch(`km_tiers.${idx}.price_per_km`))
                          ? watch(`km_tiers.${idx}.price_per_km`)
                          : 0
                      )}
                      /km
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => kmTierFA.remove(idx)}
                    disabled={kmTierFA.fields.length <= 1}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {strategy === 'time_based' && (
            <div className='space-y-4'>
              <div>
                <Label>
                  Festpreis außerhalb Arbeitszeit / Feiertag (netto)
                </Label>
                <Input
                  type='number'
                  step='0.01'
                  {...register('fixed_fee', { valueAsNumber: true })}
                />
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  Anzeige:{' '}
                  <span className='text-foreground font-medium'>
                    {eur.format(
                      Number.isFinite(watch('fixed_fee'))
                        ? watch('fixed_fee')
                        : 0
                    )}
                  </span>
                </p>
              </div>

              <div>
                <Label className='mb-2 block'>
                  Arbeitszeit (Europe/Berlin)
                </Label>
                <p className='text-muted-foreground mb-3 text-xs'>
                  Pro Wochentag: aktivieren und Uhrzeitfenster setzen.
                  Deaktiviert = dieser Tag zählt immer als „außerhalb“
                  (Zuschlag).
                </p>
                <div className='space-y-3'>
                  {WEEKDAY_ORDER.map((key) => (
                    <div
                      key={key}
                      className='flex flex-col gap-2 border-b pb-3 md:flex-row md:items-end'
                    >
                      <div className='flex w-full min-w-[140px] items-center gap-2 md:w-44'>
                        <Controller
                          name={`days.${key}.enabled`}
                          control={control}
                          render={({ field }) => (
                            <Switch
                              id={`wh-en-${key}`}
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          )}
                        />
                        <Label
                          htmlFor={`wh-en-${key}`}
                          className='cursor-pointer text-sm font-medium'
                        >
                          {WEEKDAY_LABEL[key]}
                        </Label>
                      </div>
                      {watch(`days.${key}.enabled`) ? (
                        <div className='flex flex-wrap gap-3'>
                          <div>
                            <Label className='text-xs'>Von</Label>
                            <Input
                              type='time'
                              className='w-[7.5rem]'
                              {...register(`days.${key}.start`)}
                            />
                          </div>
                          <div>
                            <Label className='text-xs'>Bis</Label>
                            <Input
                              type='time'
                              className='w-[7.5rem]'
                              {...register(`days.${key}.end`)}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className='text-muted-foreground text-xs md:pb-2'>
                          — ganzer Tag außerhalb (Zuschlag möglich)
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>Feiertagsregel</Label>
                <Select
                  value={watch('holiday_rule')}
                  onValueChange={(val) =>
                    form.setValue('holiday_rule', val as 'closed' | 'normal')
                  }
                >
                  <SelectTrigger className='mt-1'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='closed'>
                      Feiertag = geschlossen (wie außerhalb)
                    </SelectItem>
                    <SelectItem value='normal'>
                      Feiertag = normaler Werktag
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Feiertage (Kalenderdatum Berlin)</Label>
                <div className='mt-1 flex gap-2'>
                  <Input
                    placeholder='JJJJ-MM-TT'
                    value={holidayInput}
                    onChange={(e) => setHolidayInput(e.target.value)}
                  />
                  <Button
                    type='button'
                    variant='secondary'
                    onClick={() => addHoliday(holidaysWatch)}
                  >
                    Hinzufügen
                  </Button>
                </div>
                <ul className='mt-2 space-y-1 text-sm'>
                  {holidaysWatch.map((h, i) => (
                    <li
                      key={`${h}-${i}`}
                      className='flex items-center justify-between gap-2'
                    >
                      <span>{h}</span>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        className='text-destructive h-7'
                        onClick={() =>
                          form.setValue(
                            'holidays',
                            holidaysWatch.filter((_, j) => j !== i)
                          )
                        }
                      >
                        Entfernen
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {(strategy === 'client_price_tag' ||
            strategy === 'manual_trip_price' ||
            strategy === 'no_price') && (
            <p className='text-muted-foreground text-sm'>
              Keine weiteren Parameter. Hinweis: <strong>Preis-Tag</strong> des
              Fahrgasts setzt sich vor Katalog-Regeln durch (Kaskade).
            </p>
          )}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button type='submit' disabled={saving}>
              {saving ? 'Speichern…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
