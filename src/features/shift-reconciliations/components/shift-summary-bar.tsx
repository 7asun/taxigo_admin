'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  SHIFT_RECONCILIATION_CURRENCY_CODE,
  SHIFT_RECONCILIATION_CURRENCY_LOCALE
} from '../lib/constants';
import {
  getEffectivePrice,
  isInvoiceTrip,
  isSelfPay,
  isUnconfiguredPayer,
  RECONCILIATION_STATUS,
  type ShiftReconciliationWithMeta,
  type ShiftTrip
} from '../types';

const money = new Intl.NumberFormat(SHIFT_RECONCILIATION_CURRENCY_LOCALE, {
  style: 'currency',
  currency: SHIFT_RECONCILIATION_CURRENCY_CODE
});

type ShiftSummaryBarProps = {
  trips: ShiftTrip[];
  reconciliation: ShiftReconciliationWithMeta | null | undefined;
  isLoading?: boolean;
};

export function ShiftSummaryBar({
  trips,
  reconciliation,
  isLoading
}: ShiftSummaryBarProps) {
  const selfPayTrips = trips.filter((t) => isSelfPay(t));
  const invoiceTrips = trips.filter((t) => isInvoiceTrip(t));
  const unconfigured = trips.filter((t) => isUnconfiguredPayer(t));
  const selfPaySum = selfPayTrips.reduce((s, t) => s + getEffectivePrice(t), 0);

  const statusBadge = (() => {
    if (!reconciliation) {
      return (
        <Badge variant='secondary' className='text-muted-foreground'>
          Noch nicht geprüft
        </Badge>
      );
    }
    if (reconciliation.status === RECONCILIATION_STATUS.OPEN) {
      return (
        <Badge
          variant='secondary'
          className='border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
        >
          In Bearbeitung
        </Badge>
      );
    }
    const confirmed = format(
      new Date(reconciliation.confirmed_at),
      "dd.MM.yyyy 'um' HH:mm",
      { locale: de }
    );
    const byName = reconciliation.confirmer_name?.trim() || 'Kolleg:in';
    return (
      <Badge
        className='border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200'
        variant='outline'
      >
        Abgeschlossen von {byName} am {confirmed}
      </Badge>
    );
  })();

  return (
    <div className='space-y-3'>
      {unconfigured.length > 0 && (
        <Alert
          variant='default'
          className='border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30'
        >
          <AlertTitle className='text-amber-900 dark:text-amber-200'>
            {unconfigured.length} Kostenträger nicht konfiguriert
          </AlertTitle>
          <AlertDescription className='text-amber-900/90 dark:text-amber-100/90'>
            Bitte in den Stammdaten (Kostenträger) festlegen, ob der Fahrgast
            direkt zahlt oder per Rechnung.
          </AlertDescription>
        </Alert>
      )}

      <div className='bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4'>
        <div className='text-muted-foreground flex flex-wrap items-center gap-4 text-sm'>
          <span>
            Fahrten gesamt:{' '}
            <span className='text-foreground font-semibold tabular-nums'>
              {isLoading ? '—' : trips.length}
            </span>
          </span>
          <span>
            Selbstzahler:{' '}
            <span className='text-foreground font-semibold tabular-nums'>
              {isLoading
                ? '—'
                : `${money.format(selfPaySum)} (${selfPayTrips.length})`}
            </span>
          </span>
          <span>
            Rechnung:{' '}
            <span className='text-foreground font-semibold tabular-nums'>
              {isLoading ? '—' : `${invoiceTrips.length} Fahrten`}
            </span>
          </span>
        </div>
        {statusBadge}
      </div>
    </div>
  );
}
