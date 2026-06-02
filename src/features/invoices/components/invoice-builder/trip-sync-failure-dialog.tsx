'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { formatTaxRate } from '@/features/invoices/lib/tax-calculator';
import type { FailedSyncItem } from '@/features/invoices/types/invoice.types';

export interface TripSyncFailureDialogProps {
  open: boolean;
  items: FailedSyncItem[];
  onRetry: () => Promise<void>;
  /** Option A: dismiss without persisting has_sync_warning — see tax-rate-audit.md */
  onClose: () => void;
}

function formatLineDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'dd.MM.yyyy', { locale: de });
  } catch {
    return '—';
  }
}

export function TripSyncFailureDialog({
  open,
  items,
  onRetry,
  onClose
}: TripSyncFailureDialogProps) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {items.length} Fahrt{items.length === 1 ? '' : 'en'} konnten nicht
            aktualisiert werden
          </DialogTitle>
        </DialogHeader>
        <p className='text-muted-foreground text-sm'>
          Die Rechnung wurde erstellt. Die folgenden Fahrten wurden nicht
          aktualisiert. Bitte erneut versuchen.
        </p>
        <ul className='max-h-60 space-y-2 overflow-y-auto text-sm'>
          {items.map((item) => (
            <li
              key={item.trip_id}
              className='border-border rounded-md border px-3 py-2'
            >
              #{item.position} · {item.client_name ?? '—'} ·{' '}
              {formatLineDate(item.line_date)} ·{' '}
              {item.gross_price != null
                ? `${item.gross_price.toFixed(2)} €`
                : '—'}{' '}
              · {formatTaxRate(item.tax_rate)}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant='ghost' onClick={onClose} disabled={retrying}>
            Schließen
          </Button>
          <Button onClick={handleRetry} disabled={retrying}>
            {retrying ? 'Wird versucht…' : 'Alle erneut versuchen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
