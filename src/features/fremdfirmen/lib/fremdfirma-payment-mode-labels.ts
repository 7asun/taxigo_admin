import type { FremdfirmaPaymentMode } from '@/features/trips/types/trip-form-reference.types';

const LABELS: Record<FremdfirmaPaymentMode, string> = {
  cash_per_trip: 'Bar pro Fahrt',
  monthly_invoice: 'Monatsrechnung',
  self_payer: 'Selbstzahler',
  kts_to_fremdfirma: 'KTS an Fremdfirma'
};

export function isFremdfirmaPaymentMode(
  v: string | null | undefined
): v is FremdfirmaPaymentMode {
  return (
    v === 'cash_per_trip' ||
    v === 'monthly_invoice' ||
    v === 'self_payer' ||
    v === 'kts_to_fremdfirma'
  );
}

export function fremdfirmaPaymentModeLabel(
  mode: string | null | undefined
): string {
  if (mode && isFremdfirmaPaymentMode(mode)) return LABELS[mode];
  return '—';
}

export const FREMDFIRMA_PAYMENT_MODE_OPTIONS: {
  value: FremdfirmaPaymentMode;
  label: string;
}[] = [
  { value: 'cash_per_trip', label: LABELS.cash_per_trip },
  { value: 'monthly_invoice', label: LABELS.monthly_invoice },
  { value: 'self_payer', label: LABELS.self_payer },
  { value: 'kts_to_fremdfirma', label: LABELS.kts_to_fremdfirma }
];
