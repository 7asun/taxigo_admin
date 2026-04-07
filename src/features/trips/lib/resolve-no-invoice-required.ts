/**
 * Cascade: variant → familie (behavior_profile) → payer → false.
 * Same precedence as KTS; persist trips.no_invoice_source with the winning tier.
 */
import { parseBehaviorProfileRaw } from '@/features/trips/lib/normalize-billing-type-behavior-profile';

export type NoInvoiceCatalogSource =
  | 'variant'
  | 'familie'
  | 'payer'
  | 'system_default';

export type TripNoInvoiceSource = NoInvoiceCatalogSource | 'manual';

export interface ResolveNoInvoiceRequiredInput {
  payerNoInvoiceDefault: boolean | null | undefined;
  familyBehaviorProfile: unknown;
  variantNoInvoiceDefault: boolean | null | undefined;
}

export function normalizeNoInvoiceDefaultFromBehavior(
  familyBehaviorProfile: unknown
): 'yes' | 'no' | 'unset' {
  const b = parseBehaviorProfileRaw(familyBehaviorProfile);
  const v =
    b.no_invoice_required_default ?? b.noInvoiceRequiredDefault ?? b.no_invoice;
  if (v === 'yes' || v === true) return 'yes';
  if (v === 'no' || v === false) return 'no';
  return 'unset';
}

export function resolveNoInvoiceRequiredDefault(
  input: ResolveNoInvoiceRequiredInput
): { value: boolean; source: NoInvoiceCatalogSource } {
  const vn = input.variantNoInvoiceDefault;
  if (vn !== null && vn !== undefined) {
    return { value: !!vn, source: 'variant' };
  }

  const fd = normalizeNoInvoiceDefaultFromBehavior(input.familyBehaviorProfile);
  if (fd === 'yes') return { value: true, source: 'familie' };
  if (fd === 'no') return { value: false, source: 'familie' };

  const pn = input.payerNoInvoiceDefault;
  if (pn !== null && pn !== undefined) {
    return { value: !!pn, source: 'payer' };
  }

  return { value: false, source: 'system_default' };
}
