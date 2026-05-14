import { Badge } from '@/components/ui/badge';
import {
  resolveEffectiveTripInvoiceStatus,
  type EffectiveTripInvoiceStatus,
  type InvoiceLineItemWithStatus
} from '@/features/trips/lib/effective-trip-invoice-status';

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
