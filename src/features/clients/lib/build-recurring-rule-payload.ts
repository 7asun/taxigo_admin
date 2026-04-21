import type { RuleFormValues } from '@/features/clients/components/recurring-rule-form-body';
import {
  resolveKtsDefault,
  type TripKtsSource
} from '@/features/trips/lib/resolve-kts-default';
import {
  resolveNoInvoiceRequiredDefault,
  type TripNoInvoiceSource
} from '@/features/trips/lib/resolve-no-invoice-required';
import type {
  BillingVariantOption,
  PayerOption
} from '@/features/trips/types/trip-form-reference.types';
import type { InsertRecurringRule } from '@/features/trips/api/recurring-rules.service';

function parseCost(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const t = raw.trim().replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function buildRecurringRulePayload(
  values: RuleFormValues,
  ctx: {
    clientId: string;
    payers: PayerOption[];
    billingTypes: BillingVariantOption[];
  }
): Omit<InsertRecurringRule, 'id' | 'created_at'> {
  const rruleString = `FREQ=WEEKLY;BYDAY=${values.days.join(',')}`;
  const variant = ctx.billingTypes.find(
    (b) => b.id === values.billing_variant_id
  );
  const payer = ctx.payers.find((p) => p.id === values.payer_id);
  const ktsResolved = resolveKtsDefault({
    payerKtsDefault: payer?.kts_default,
    familyBehaviorProfile: variant?.behavior_profile,
    variantKtsDefault: variant?.kts_default
  });
  const kts_source: TripKtsSource = values.kts_manual
    ? 'manual'
    : ktsResolved.source;

  const noInvResolved = resolveNoInvoiceRequiredDefault({
    payerNoInvoiceDefault: payer?.no_invoice_required_default,
    familyBehaviorProfile: variant?.behavior_profile,
    variantNoInvoiceDefault: variant?.no_invoice_required_default
  });
  const no_invoice_source: TripNoInvoiceSource = values.no_invoice_manual
    ? 'manual'
    : noInvResolved.source;

  const fremdfirma_id =
    values.fremdfirma_enabled && values.fremdfirma_id?.trim()
      ? values.fremdfirma_id.trim()
      : null;

  let fremdfirma_payment_mode = fremdfirma_id
    ? (values.fremdfirma_payment_mode ?? null)
    : null;
  let fremdfirma_cost = fremdfirma_id
    ? parseCost(values.fremdfirma_cost)
    : null;

  if (
    values.no_invoice_required &&
    fremdfirma_id &&
    fremdfirma_payment_mode &&
    fremdfirma_payment_mode !== 'self_payer'
  ) {
    fremdfirma_payment_mode = 'self_payer';
  }

  if (
    fremdfirma_payment_mode === 'self_payer' ||
    fremdfirma_payment_mode === 'kts_to_fremdfirma'
  ) {
    fremdfirma_cost = null;
  }

  return {
    client_id: ctx.clientId,
    rrule_string: rruleString,
    payer_id: values.payer_id,
    billing_variant_id: values.billing_variant_id,
    kts_document_applies: values.kts_document_applies,
    kts_source,
    no_invoice_required: values.no_invoice_required,
    no_invoice_source,
    fremdfirma_id,
    fremdfirma_payment_mode,
    fremdfirma_cost,
    // The form uses '' to represent daily-agreement mode; persist NULL so cron
    // can generate an outbound leg with `scheduled_at = null` (dispatcher sets time later).
    pickup_time: values.pickup_time ? `${values.pickup_time}:00` : null,
    pickup_address: values.pickup_address,
    dropoff_address: values.dropoff_address,
    return_mode: values.return_mode,
    return_trip: values.return_mode !== 'none',
    return_time:
      values.return_mode === 'exact' && values.return_time
        ? `${values.return_time}:00`
        : null,
    start_date: values.start_date,
    end_date: values.end_date || null,
    is_active: values.is_active
  };
}
