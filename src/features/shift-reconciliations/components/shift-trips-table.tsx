'use client';

/**
 * Inline Betrag uses the same commit/blur/escape flow as the Fahrten driver cell
 * (see driver-select-cell.tsx) but writes manual_gross_price only via server action.
 */

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useUpdateTripManualPrice } from '../hooks/use-update-trip-price';
import {
  SHIFT_RECONCILIATION_CURRENCY_CODE,
  SHIFT_RECONCILIATION_CURRENCY_LOCALE
} from '../lib/constants';
import { getEffectivePrice, isSelfPay, isUnconfiguredPayer } from '../types';
import type { ShiftTrip } from '../types';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { IconPencil, IconX } from '@tabler/icons-react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const money = new Intl.NumberFormat(SHIFT_RECONCILIATION_CURRENCY_LOCALE, {
  style: 'currency',
  currency: SHIFT_RECONCILIATION_CURRENCY_CODE
});

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return format(new Date(iso), 'HH:mm', { locale: de });
}

function parseMoneyInput(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toInputString(value: number | null | undefined): string {
  if (value == null) return '';
  return String(value).replace('.', ',');
}

type ShiftTripsTableProps = {
  trips: ShiftTrip[];
  driverId: string;
  dateYmd: string;
  isLoading: boolean;
};

export function ShiftTripsTable({
  trips,
  driverId,
  dateYmd,
  isLoading
}: ShiftTripsTableProps) {
  const mutation = useUpdateTripManualPrice(driverId, dateYmd);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const commitInFlight = useRef(false);

  useEffect(() => {
    if (editingId) return;
    setEditValue('');
  }, [editingId, trips]);

  const startEdit = (t: ShiftTrip) => {
    setEditingId(t.id);
    const display =
      t.manual_gross_price != null ? t.manual_gross_price : t.gross_price;
    setEditValue(toInputString(display ?? null));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const commitEdit = (tripId: string) => {
    if (commitInFlight.current) return;
    commitInFlight.current = true;
    const n = parseMoneyInput(editValue);
    void mutation
      .mutateAsync(
        { tripId, manualGrossPrice: n },
        { onSettled: () => setEditingId(null) }
      )
      .finally(() => {
        commitInFlight.current = false;
      });
  };

  const clearOverride = (tripId: string) => {
    void mutation.mutateAsync({ tripId, manualGrossPrice: null });
  };

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <p className='text-muted-foreground border border-dashed py-8 text-center text-sm'>
        Keine zugewiesenen Fahrten für diesen Tag
      </p>
    );
  }

  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Zeit</TableHead>
            <TableHead>Abholung → Ziel</TableHead>
            <TableHead>Kostenträger</TableHead>
            <TableHead className='text-right'>Betrag</TableHead>
            <TableHead>Zahlungsart</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trips.map((t) => {
            const zahl = isSelfPay(t) ? (
              <Badge>Selbstzahler</Badge>
            ) : isUnconfiguredPayer(t) ? (
              <Badge
                variant='secondary'
                className='bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
              >
                Nicht konfiguriert
              </Badge>
            ) : (
              <Badge variant='secondary' className='text-muted-foreground'>
                Rechnung
              </Badge>
            );
            const isEditing = editingId === t.id;
            const hasOverride = t.manual_gross_price != null;
            const rowPending =
              mutation.isPending && mutation.variables?.tripId === t.id;
            return (
              <TableRow key={t.id} className='align-middle'>
                <TableCell className='align-middle font-mono text-sm whitespace-nowrap'>
                  {formatTime(t.scheduled_at)}
                </TableCell>
                <TableCell className='max-w-[min(28rem,50vw)] align-middle text-sm'>
                  <div className='flex min-w-0 flex-col gap-0.5'>
                    <div className='flex min-w-0 items-start gap-2'>
                      <span className='text-muted-foreground w-10 shrink-0 text-xs leading-snug font-medium'>
                        Von
                      </span>
                      <span className='text-foreground min-w-0 truncate text-sm leading-snug'>
                        {t.pickup_address ?? '—'}
                      </span>
                    </div>
                    <div className='flex min-w-0 items-start gap-2'>
                      <span className='text-muted-foreground w-10 shrink-0 text-xs leading-snug font-medium'>
                        Nach
                      </span>
                      <span className='text-muted-foreground min-w-0 truncate text-sm leading-snug'>
                        {t.dropoff_address ?? '—'}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className='align-middle text-sm'>
                  {t.payer.name || '—'}
                </TableCell>
                <TableCell className='text-right align-middle'>
                  {isEditing ? (
                    <div className='flex items-center justify-end gap-1'>
                      <Input
                        className='h-8 w-28 text-right font-mono tabular-nums'
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        disabled={rowPending}
                        autoFocus
                      />
                      {rowPending && (
                        <Loader2 className='text-muted-foreground h-4 w-4 animate-spin' />
                      )}
                    </div>
                  ) : (
                    <div className='group flex items-center justify-end gap-1'>
                      <button
                        type='button'
                        onClick={() => startEdit(t)}
                        className={cn(
                          'hover:bg-muted/60 inline-flex items-center gap-1 rounded border border-transparent px-1 py-0.5 text-right text-sm',
                          hasOverride && 'font-medium'
                        )}
                        title='Betrag bearbeiten'
                      >
                        {money.format(getEffectivePrice(t))}
                        <IconPencil
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            hasOverride
                              ? 'text-primary'
                              : 'text-muted-foreground opacity-60 group-hover:opacity-100'
                          )}
                          aria-hidden
                        />
                      </button>
                      {hasOverride && (
                        <Button
                          type='button'
                          size='icon'
                          variant='ghost'
                          className='h-7 w-7'
                          title='Korrektur zurücksetzen'
                          onClick={() => clearOverride(t.id)}
                          disabled={rowPending}
                        >
                          <IconX className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className='align-middle'>{zahl}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
