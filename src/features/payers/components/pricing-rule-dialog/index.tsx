'use client';

/**
 * PricingRuleDialog — two-step create flow, direct-edit flow.
 *
 * Step routing:
 *   step 1  → strategy tile grid (create only)
 *   step 2  → config fields + scope assignment (create) / all fields (edit)
 *
 * Special case: strategy === 'client_price_tag' + !editing
 *   Skips step 2 entirely. Submit calls setClientPriceTag() directly —
 *   the price lives on clients.price_tag, not in billing_pricing_rules.config.
 *   See docs/preisregeln.md § "client_price_tag bypass".
 *
 * Footer wiring: the <form> has id={FORM_ID}; the footer submit button uses
 *   type="submit" form={FORM_ID} so it works outside the scrollable body.
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { billingPricingRuleUpsertSchema } from '@/features/invoices/lib/pricing-rule-config.schema';
import { PRICING_STRATEGY_LABELS_DE } from '@/features/invoices/lib/pricing-strategy-labels-de';
import type { PricingStrategy } from '@/features/invoices/types/pricing.types';
import type { TimeBasedConfig } from '@/features/invoices/types/pricing.types';
import {
  createPricingRule,
  pricingRulesErrorMessage,
  updatePricingRule
} from '@/features/payers/api/billing-pricing-rules.api';
import { usePayers } from '@/features/payers/hooks/use-payers';
import { useBillingTypes } from '@/features/payers/hooks/use-billing-types';
import {
  useClientsForPricing,
  useSetClientPriceTag
} from '@/features/clients/hooks/use-clients-for-pricing';
import { toast } from 'sonner';

import type { PricingRuleDialogProps } from './pricing-rule-dialog.types';
import type {
  KmTierFormValue,
  PricingRuleFormValues
} from './pricing-rule-dialog.types';
import {
  buildApiPayload,
  daysFromTimeConfig,
  defaultFormValues
} from './pricing-rule-form-helpers';
import { Step1StrategyPicker } from './step1-strategy-picker';
import { Step2RuleConfig } from './step2-rule-config';
import { Step2ScopePicker } from './step2-scope-picker';

export { PRICING_STRATEGY_LABELS_DE };

const FORM_ID = 'pricing-rule-dialog-form';

export function PricingRuleDialog({
  open,
  onOpenChange,
  scope,
  editing,
  onSaved,
  initialStrategy,
  initialClientId
}: PricingRuleDialogProps) {
  const eur = useMemo(
    () =>
      new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }),
    []
  );

  const { data: payers = [] } = usePayers();
  const [pickPayerId, setPickPayerId] = useState<string | null>(null);
  const [pickFamilyId, setPickFamilyId] = useState<string | null>(null);
  const [pickVariantId, setPickVariantId] = useState<string | null>(null);

  const { data: billingFamilies = [] } = useBillingTypes(pickPayerId);

  const form = useForm<PricingRuleFormValues>({
    defaultValues: defaultFormValues()
  });

  const { control, handleSubmit, reset, watch, setValue } = form;

  const strategy = watch('strategy');

  const tierFA = useFieldArray({ control, name: 'tiers' });
  const kmTierFA = useFieldArray({ control, name: 'km_tiers' });

  const [holidayInput, setHolidayInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [clientIdForPriceTag, setClientIdForPriceTag] = useState<string | null>(
    null
  );
  const [priceTagInput, setPriceTagInput] = useState('');
  const [step, setStep] = useState<1 | 2>(1);

  const { mutateAsync: saveClientPriceTag, isPending: savingClientPriceTag } =
    useSetClientPriceTag();
  const { data: clientsForPricing = [] } = useClientsForPricing();

  // Step resets to 1 on open (create) or 2 (edit: no strategy step needed).
  useEffect(() => {
    if (open) {
      setStep(editing ? 2 : 1);
    }
  }, [open, editing]);

  const showScopePicker = !editing && scope === null;
  // Scope picker only shown when creating from global page (scope prop is null)
  // and strategy is not client_price_tag (that flow has no scope assignment).
  const effectiveShowScopePicker =
    showScopePicker && strategy !== 'client_price_tag';

  useEffect(() => {
    if (!open || !effectiveShowScopePicker) return;
    setPickPayerId(null);
    setPickFamilyId(null);
    setPickVariantId(null);
  }, [open, effectiveShowScopePicker]);

  useEffect(() => {
    if (!open) {
      setClientIdForPriceTag(null);
      setPriceTagInput('');
      return;
    }
    if (editing || strategy !== 'client_price_tag') return;
    if (initialClientId) {
      const c = clientsForPricing.find((x) => x.id === initialClientId);
      if (c) {
        setClientIdForPriceTag(c.id);
        setPriceTagInput(c.price_tag != null ? String(c.price_tag) : '');
      }
    } else {
      setClientIdForPriceTag(null);
      setPriceTagInput('');
    }
  }, [open, editing, initialClientId, clientsForPricing, strategy]);

  useEffect(() => {
    if (strategy !== 'client_price_tag') {
      setClientIdForPriceTag(null);
      setPriceTagInput('');
    }
  }, [strategy]);

  // Downstream selects reset when upstream changes to prevent stale state.
  useEffect(() => {
    setPickFamilyId(null);
    setPickVariantId(null);
  }, [pickPayerId]);

  useEffect(() => {
    setPickVariantId(null);
  }, [pickFamilyId]);

  // resolvedCreateScope: most specific scope wins (variant > family > payer).
  const resolvedCreateScope = useMemo(() => {
    if (scope !== null) return scope;
    if (!pickPayerId) return null;
    if (pickVariantId) {
      return {
        kind: 'billing_variant' as const,
        payerId: pickPayerId,
        billingVariantId: pickVariantId
      };
    }
    if (pickFamilyId) {
      return {
        kind: 'billing_type' as const,
        payerId: pickPayerId,
        billingTypeId: pickFamilyId
      };
    }
    return { kind: 'payer' as const, payerId: pickPayerId };
  }, [scope, pickPayerId, pickFamilyId, pickVariantId]);

  const selectedFamily = useMemo(
    () => billingFamilies.find((f) => f.id === pickFamilyId) ?? null,
    [billingFamilies, pickFamilyId]
  );

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
      reset({
        ...defaultFormValues(),
        ...(initialStrategy ? { strategy: initialStrategy } : {})
      });
      setHolidayInput('');
    }
  }, [open, editing, reset, initialStrategy]);

  const onSubmit = async (v: PricingRuleFormValues) => {
    // For client_price_tag creates: bypass rule API, write directly to clients.price_tag.
    if (v.strategy === 'client_price_tag' && !editing) {
      if (!clientIdForPriceTag) {
        toast.error('Bitte Fahrgast wählen.');
        return;
      }
      const rawPrice = priceTagInput.trim();
      const priceGross =
        rawPrice === '' ? null : parseFloat(rawPrice.replace(',', '.'));
      if (priceGross !== null && (Number.isNaN(priceGross) || priceGross < 0)) {
        toast.error('Ungültiger Preis.');
        return;
      }
      try {
        await saveClientPriceTag({
          clientId: clientIdForPriceTag,
          price: priceGross
        });
        toast.success('Kunden-Preis gespeichert');
        onSaved();
        onOpenChange(false);
      } catch (e) {
        toast.error(pricingRulesErrorMessage(e));
      }
      return;
    }

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
        const rs = resolvedCreateScope;
        if (!rs) {
          toast.error('Bitte Kostenträger wählen.');
          return;
        }
        const ruleScope: Parameters<typeof createPricingRule>[0]['scope'] =
          rs.kind === 'payer'
            ? { kind: 'payer', payerId: rs.payerId }
            : rs.kind === 'billing_type'
              ? {
                  kind: 'billing_type',
                  payerId: rs.payerId,
                  billingTypeId: rs.billingTypeId
                }
              : {
                  kind: 'billing_variant',
                  payerId: rs.payerId,
                  billingVariantId: rs.billingVariantId
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
    setValue('holidays', [...holidays, v]);
    setHolidayInput('');
  };

  const busy = saving || savingClientPriceTag;
  const strategySummaryLabel = PRICING_STRATEGY_LABELS_DE[strategy];
  const isClientPriceStep1 =
    !editing && step === 1 && strategy === 'client_price_tag';
  const showStep1Strategy = !editing && step === 1;
  const showStep2Body =
    !!editing || (step === 2 && strategy !== 'client_price_tag');
  const showWeiter = !editing && step === 1 && strategy !== 'client_price_tag';
  // showSpeichern: true in edit mode, step 2, or client_price_tag step 1 (complete in one step).
  const showSpeichern =
    !!editing || step === 2 || (step === 1 && strategy === 'client_price_tag');
  const createNeedsScopeBlockingSubmit =
    !editing && step === 2 && effectiveShowScopePicker && !resolvedCreateScope;
  const submitDisabled =
    busy ||
    (isClientPriceStep1 && !clientIdForPriceTag) ||
    (showSpeichern && createNeedsScopeBlockingSubmit);

  const dialogTitle = editing
    ? 'Preisregel bearbeiten'
    : isClientPriceStep1
      ? 'Kunden-Preis setzen'
      : 'Neue Preisregel';
  const dialogDescription = editing
    ? strategySummaryLabel
    : isClientPriceStep1
      ? 'Fahrgast und Betrag wählen'
      : !editing && step === 1
        ? 'Strategie wählen'
        : strategySummaryLabel;

  const handleRemoveClientPriceTag = async () => {
    if (!clientIdForPriceTag) return;
    if (!window.confirm('Kunden-Preis wirklich entfernen?')) return;
    try {
      await saveClientPriceTag({
        clientId: clientIdForPriceTag,
        price: null
      });
      toast.success('Kunden-Preis entfernt');
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(pricingRulesErrorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className='flex max-h-[90vh] max-w-2xl flex-col'>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className='flex-1 space-y-4 overflow-y-auto pr-1'>
          <form
            id={FORM_ID}
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit(onSubmit)(e);
            }}
            className='space-y-4'
          >
            {showStep1Strategy && (
              <Step1StrategyPicker
                strategy={strategy}
                onStrategyChange={(s) => setValue('strategy', s)}
                clientId={clientIdForPriceTag}
                priceTagInput={priceTagInput}
                busy={busy}
                onClientSelect={(id, tag) => {
                  setClientIdForPriceTag(id);
                  setPriceTagInput(tag != null ? String(tag) : '');
                }}
                onClientClear={() => {
                  setClientIdForPriceTag(null);
                  setPriceTagInput('');
                }}
                onPriceTagChange={setPriceTagInput}
                onRemovePriceTag={() => void handleRemoveClientPriceTag()}
              />
            )}

            {showStep2Body && (
              <>
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge variant='outline' className='font-normal'>
                    {strategySummaryLabel}
                  </Badge>
                </div>
                <Step2RuleConfig
                  form={form}
                  tierFA={tierFA}
                  kmTierFA={kmTierFA}
                  holidayInput={holidayInput}
                  setHolidayInput={setHolidayInput}
                  busy={busy}
                  eur={eur}
                  editing={editing}
                  addHoliday={addHoliday}
                />
                {effectiveShowScopePicker && step === 2 && (
                  <Step2ScopePicker
                    pickPayerId={pickPayerId}
                    pickFamilyId={pickFamilyId}
                    pickVariantId={pickVariantId}
                    payers={payers}
                    billingFamilies={billingFamilies}
                    selectedFamily={selectedFamily}
                    busy={busy}
                    onPayerChange={setPickPayerId}
                    onFamilyChange={setPickFamilyId}
                    onVariantChange={setPickVariantId}
                  />
                )}
              </>
            )}
          </form>
        </div>

        <DialogFooter className='flex flex-row items-center gap-2 pt-2 sm:justify-start'>
          {!editing && step === 2 && (
            <Button
              type='button'
              variant='ghost'
              onClick={() => setStep(1)}
              disabled={busy}
            >
              ← Zurück
            </Button>
          )}
          <div className='flex-1' />
          {showSpeichern && (
            <Button type='submit' form={FORM_ID} disabled={submitDisabled}>
              {busy ? 'Speichern…' : 'Speichern'}
            </Button>
          )}
          {showWeiter && (
            <Button type='button' onClick={() => setStep(2)} disabled={busy}>
              Weiter →
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
