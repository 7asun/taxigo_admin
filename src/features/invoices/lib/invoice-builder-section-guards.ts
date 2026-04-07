/**
 * Section completion for the long-form invoice builder (progressive disclosure).
 * Mirrors the former step-gating rules without a step index.
 *
 * Section indices match invoice-builder/index.tsx: ④ PDF-Vorlage, ⑤ Bestätigung.
 */

import type {
  BuilderLineItem,
  InvoiceBuilderFormValues
} from '@/features/invoices/types/invoice.types';

export type InvoiceBuilderStep2Slice = Pick<
  InvoiceBuilderFormValues,
  | 'mode'
  | 'payer_id'
  | 'billing_type_id'
  | 'period_from'
  | 'period_to'
  | 'client_id'
> | null;

export function isInvoiceBuilderSection1Complete(
  step2Values: InvoiceBuilderStep2Slice
): boolean {
  return !!step2Values?.mode;
}

/** Same fields required as Step 2 form validation + Fahrten laden. */
export function isInvoiceBuilderSection2Complete(
  step2Values: InvoiceBuilderStep2Slice
): boolean {
  if (
    !step2Values?.mode ||
    !step2Values.payer_id ||
    !step2Values.period_from ||
    !step2Values.period_to
  ) {
    return false;
  }
  if (step2Values.mode === 'per_client' && !step2Values.client_id) {
    return false;
  }
  return true;
}

export function step2ValuesReadyForTripsFetch(
  step2Values: InvoiceBuilderStep2Slice
): boolean {
  return isInvoiceBuilderSection2Complete(step2Values);
}

export function isInvoiceBuilderSection3Complete(
  section2Complete: boolean,
  lineItems: BuilderLineItem[],
  isLoadingTrips: boolean,
  isTripsError: boolean
): boolean {
  if (!section2Complete || isLoadingTrips || isTripsError) return false;
  return lineItems.length > 0;
}

export function isInvoiceBuilderSection4Unlocked(
  section3Complete: boolean
): boolean {
  return section3Complete;
}

/**
 * Section 5 (Bestätigung) unlocks after the user clicks “Weiter zur Bestätigung”
 * on Section 4 (PDF-Vorlage).
 *
 * @param reachedFromPdfVorlage — pdfStepAcknowledged flag from the shell
 * @returns whether the confirmation card may be opened / interacted with
 */
export function isInvoiceBuilderSection5Unlocked(
  reachedFromPdfVorlage: boolean
): boolean {
  return reachedFromPdfVorlage;
}
