'use client';

/**
 * Step2RuleConfig — renders the strategy-specific configuration fields for
 * step 2 of PricingRuleDialog (and direct edit mode).
 *
 * Sections:
 *   tiered_km                     → km tier table (useFieldArray)
 *   fixed_below_threshold_then_km → threshold + fixed price + km tiers above
 *   time_based                    → weekday schedule + holiday config
 *   client_price_tag (edit only)  → info note; price is on clients.price_tag
 *   manual_trip_price / no_price  → info note only
 *   Anfahrtspreis                 → shared optional net field (all except client_price_tag)
 */

import { Plus, Trash2 } from 'lucide-react';
import type { UseFormReturn, UseFieldArrayReturn } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/button';
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
import type { PricingStrategy } from '@/features/invoices/types/pricing.types';
import type { BillingPricingRuleRow } from '@/features/payers/api/billing-pricing-rules.api';
import {
  WEEKDAY_LABEL,
  WEEKDAY_ORDER,
  type PricingRuleFormValues
} from './pricing-rule-dialog.types';
import { defaultTier } from './pricing-rule-form-helpers';

export interface Step2RuleConfigProps {
  form: UseFormReturn<PricingRuleFormValues>;
  tierFA: UseFieldArrayReturn<PricingRuleFormValues, 'tiers'>;
  kmTierFA: UseFieldArrayReturn<PricingRuleFormValues, 'km_tiers'>;
  holidayInput: string;
  setHolidayInput: (v: string) => void;
  busy: boolean;
  eur: Intl.NumberFormat;
  editing: BillingPricingRuleRow | null;
  addHoliday: (holidays: string[]) => void;
}

export function Step2RuleConfig({
  form,
  tierFA,
  kmTierFA,
  holidayInput,
  setHolidayInput,
  busy,
  eur,
  editing,
  addHoliday
}: Step2RuleConfigProps) {
  const { control, register, watch, setValue } = form;
  const strategy = watch('strategy') as PricingStrategy;
  const holidaysWatch = watch('holidays');

  return (
    <div className='space-y-4'>
      {strategy === 'tiered_km' && (
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>Km-Staffeln</Label>
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
              className='grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2'
            >
              <div className='space-y-1'>
                <Label className='text-xs' htmlFor={`tier-${idx}-from`}>
                  von km
                </Label>
                <Input
                  id={`tier-${idx}-from`}
                  type='number'
                  step='0.1'
                  {...register(`tiers.${idx}.from_km`, { valueAsNumber: true })}
                />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs' htmlFor={`tier-${idx}-to`}>
                  bis km
                </Label>
                <Controller
                  control={control}
                  name={`tiers.${idx}.to_km`}
                  render={({ field: f }) => (
                    <Input
                      id={`tier-${idx}-to`}
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
              <div className='space-y-1'>
                <Label className='text-xs' htmlFor={`tier-${idx}-ppk`}>
                  €/km netto
                </Label>
                <Input
                  id={`tier-${idx}-ppk`}
                  type='number'
                  step='0.01'
                  {...register(`tiers.${idx}.price_per_km`, {
                    valueAsNumber: true
                  })}
                />
                <p className='text-muted-foreground text-xs'>
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
        <div className='space-y-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='threshold_km'>Schwelle km</Label>
              <Input
                id='threshold_km'
                type='number'
                step='0.1'
                {...register('threshold_km', { valueAsNumber: true })}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='fixed_price'>
                Festpreis unter Schwelle (netto)
              </Label>
              <Input
                id='fixed_price'
                type='number'
                step='0.01'
                {...register('fixed_price', { valueAsNumber: true })}
              />
              <p className='text-muted-foreground text-xs'>
                Anzeige:{' '}
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
              className='grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2'
            >
              <div className='space-y-1'>
                <Label className='text-xs' htmlFor={`km-tier-${idx}-from`}>
                  von km
                </Label>
                <Input
                  id={`km-tier-${idx}-from`}
                  type='number'
                  {...register(`km_tiers.${idx}.from_km`, {
                    valueAsNumber: true
                  })}
                />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs' htmlFor={`km-tier-${idx}-to`}>
                  bis km
                </Label>
                <Controller
                  control={control}
                  name={`km_tiers.${idx}.to_km`}
                  render={({ field: f }) => (
                    <Input
                      id={`km-tier-${idx}-to`}
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
              </div>
              <div className='space-y-1'>
                <Label className='text-xs' htmlFor={`km-tier-${idx}-ppk`}>
                  €/km netto
                </Label>
                <Input
                  id={`km-tier-${idx}-ppk`}
                  type='number'
                  step='0.01'
                  {...register(`km_tiers.${idx}.price_per_km`, {
                    valueAsNumber: true
                  })}
                />
                <p className='text-muted-foreground text-xs'>
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
          <div className='space-y-1.5'>
            <Label htmlFor='fixed_fee'>
              Festpreis außerhalb Arbeitszeit / Feiertag (netto)
            </Label>
            <Input
              id='fixed_fee'
              type='number'
              step='0.01'
              {...register('fixed_fee', { valueAsNumber: true })}
            />
            <p className='text-muted-foreground text-xs'>
              Anzeige:{' '}
              <span className='text-foreground font-medium'>
                {eur.format(
                  Number.isFinite(watch('fixed_fee')) ? watch('fixed_fee') : 0
                )}
              </span>
            </p>
          </div>

          <div className='space-y-1.5'>
            <Label>Arbeitszeit (Europe/Berlin)</Label>
            <p className='text-muted-foreground text-xs'>
              Pro Wochentag: aktivieren und Uhrzeitfenster setzen. Deaktiviert =
              dieser Tag zählt immer als „außerhalb“ (Zuschlag).
            </p>
            <div className='space-y-3 pt-1'>
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
                      <div className='space-y-1'>
                        <Label className='text-xs' htmlFor={`wh-start-${key}`}>
                          Von
                        </Label>
                        <Input
                          id={`wh-start-${key}`}
                          type='time'
                          className='w-[7.5rem]'
                          {...register(`days.${key}.start`)}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label className='text-xs' htmlFor={`wh-end-${key}`}>
                          Bis
                        </Label>
                        <Input
                          id={`wh-end-${key}`}
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

          <div className='space-y-1.5'>
            <Label htmlFor='holiday_rule_select'>Feiertagsregel</Label>
            <Select
              value={watch('holiday_rule')}
              onValueChange={(val) =>
                setValue('holiday_rule', val as 'closed' | 'normal')
              }
            >
              <SelectTrigger id='holiday_rule_select' className='mt-0'>
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

          <div className='space-y-1.5'>
            <Label htmlFor='holiday_date_input'>
              Feiertage (Kalenderdatum Berlin)
            </Label>
            <div className='flex gap-2'>
              <Input
                id='holiday_date_input'
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
            <p className='text-muted-foreground text-xs'>
              Datum im Format JJJJ-MM-TT eingeben und hinzufügen.
            </p>
            <ul className='space-y-1 text-sm'>
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
                      setValue(
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

      {strategy === 'client_price_tag' && editing && (
        <p className='text-muted-foreground text-sm'>
          Katalog-Regel „Kunden-Preis“ ohne weitere Parameter. Der Betrag kommt
          vom Feld <strong>Preis (Brutto)</strong> beim Fahrgast.
        </p>
      )}

      {(strategy === 'manual_trip_price' || strategy === 'no_price') && (
        <div className='space-y-1.5'>
          <p className='text-muted-foreground text-sm'>
            Keine weiteren Parameter. Hinweis: <strong>Preis-Tag</strong> des
            Fahrgasts setzt sich vor Katalog-Regeln durch (Kaskade).
          </p>
        </div>
      )}

      {strategy !== 'client_price_tag' && (
        <div className='space-y-1.5'>
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
                disabled={busy}
              />
            )}
          />
          <p className='text-muted-foreground text-xs'>
            Pro Fahrt netto; wird bei Staffeln, Fix+km und Zeit angewendet —
            nicht bei Kunden-Preis (P-Tag) oder KTS.
          </p>
        </div>
      )}
    </div>
  );
}
