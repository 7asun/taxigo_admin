/**
 * Invoice recipient id cascade: variant → billing_type → payer.
 * Pure — pass FK ids from joined catalog rows.
 */
import type { RechnungsempfaengerResolutionSource } from '@/features/invoices/types/pricing.types';

export interface ResolveRechnungsempfaengerInput {
  billingVariantRechnungsempfaengerId: string | null | undefined;
  billingTypeRechnungsempfaengerId: string | null | undefined;
  payerRechnungsempfaengerId: string | null | undefined;
}

export interface RechnungsempfaengerResolution {
  rechnungsempfaengerId: string | null;
  source: RechnungsempfaengerResolutionSource;
}

export function resolveRechnungsempfaenger(
  input: ResolveRechnungsempfaengerInput
): RechnungsempfaengerResolution {
  const v = input.billingVariantRechnungsempfaengerId;
  if (v !== null && v !== undefined && v !== '') {
    return { rechnungsempfaengerId: v, source: 'variant' };
  }
  const t = input.billingTypeRechnungsempfaengerId;
  if (t !== null && t !== undefined && t !== '') {
    return { rechnungsempfaengerId: t, source: 'billing_type' };
  }
  const p = input.payerRechnungsempfaengerId;
  if (p !== null && p !== undefined && p !== '') {
    return { rechnungsempfaengerId: p, source: 'payer' };
  }
  return { rechnungsempfaengerId: null, source: 'none' };
}
