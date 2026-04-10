import { Badge } from '@/components/ui/badge';
import {
  resolveEffectiveTripInvoiceStatus,
  type EffectiveTripInvoiceStatus
} from '@/features/trips/lib/effective-trip-invoice-status';

type InvoiceLineItemWithStatus = {
  invoice_id: string;
  invoices: {
    status: 'draft' | 'sent' | 'paid' | 'cancelled' | 'corrected';
    paid_at: string | null;
    sent_at: string | null;
  } | null;
};

const statusConfig: Record<
  EffectiveTripInvoiceStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'outline' | 'destructive';
  }
> = {
  paid: { label: 'Bezahlt', variant: 'default' },
  sent: { label: 'Versendet', variant: 'secondary' },
  draft: { label: 'Entwurf', variant: 'outline' },
  uninvoiced: { label: 'Nicht abger.', variant: 'outline' }
};

interface TripInvoiceStatusBadgeProps {
  lineItems: InvoiceLineItemWithStatus[];
}

export function TripInvoiceStatusBadge({
  lineItems
}: TripInvoiceStatusBadgeProps) {
  const status = resolveEffectiveTripInvoiceStatus(lineItems);
  const { label, variant } = statusConfig[status];
  return <Badge variant={variant}>{label}</Badge>;
}
