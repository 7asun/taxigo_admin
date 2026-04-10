/**
 * Single definition of “effective” Rechnungsstatus per trip (badge + list filter).
 * Ignores cancelled/corrected — same rules as the trip list badge.
 */
export type EffectiveTripInvoiceStatus =
  | 'uninvoiced'
  | 'draft'
  | 'sent'
  | 'paid';

export type InvoiceStatusLite =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'cancelled'
  | 'corrected';

export type TripInvoiceLineForStatus = {
  invoices: { status: InvoiceStatusLite } | null;
};

export function resolveEffectiveTripInvoiceStatus(
  lineItems: TripInvoiceLineForStatus[]
): EffectiveTripInvoiceStatus {
  const activeStatuses = lineItems
    .map((li) => li.invoices?.status)
    .filter(
      (s): s is 'draft' | 'sent' | 'paid' =>
        s === 'draft' || s === 'sent' || s === 'paid'
    );
  if (activeStatuses.includes('paid')) return 'paid';
  if (activeStatuses.includes('sent')) return 'sent';
  if (activeStatuses.includes('draft')) return 'draft';
  return 'uninvoiced';
}
