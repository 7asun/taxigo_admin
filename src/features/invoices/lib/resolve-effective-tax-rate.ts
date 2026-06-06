import { resolveTaxRate } from '@/features/invoices/lib/tax-calculator';

/**
 * Resolves the VAT rate for invoice line building and cancelled-trip billing.
 * Priority: admin write-back override → distance-based §12 UStG tiering.
 */
export function resolveEffectiveTaxRate(input: {
  manualTaxRate: number | null | undefined;
  taxRate: number | null | undefined;
  effectiveDistanceKm: number | null | undefined;
}): number {
  if (input.manualTaxRate != null) return input.manualTaxRate;
  // why: preserve §12 UStG distance tiering for trips without a write-back override;
  // trip.tax_rate is the billing-engine value at trip creation, not the invoice VAT tier.
  const fromDistance = resolveTaxRate(input.effectiveDistanceKm ?? null).rate;
  return fromDistance;
}
