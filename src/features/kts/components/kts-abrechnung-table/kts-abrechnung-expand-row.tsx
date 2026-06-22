'use client';

import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import * as React from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useAbrechnungTripsByBelegnummer } from '@/features/kts/hooks/use-abrechnung-trips-by-belegnummer';
import {
  useMarkBelegnummerAbgerechnetMutation,
  useMarkBelegnummerBezahltMutation,
  useMarkBelegnummerRuecklauferMutation
} from '@/features/kts/hooks/use-kts-abrechnung-mutations';
import type { KtsAbrechnungGroup } from '@/features/kts/types/kts-abrechnung-group';

function formatKtsInvoiceAmount(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

export interface KtsAbrechnungExpandRowProps {
  group: KtsAbrechnungGroup;
  onClose: () => void;
}

export function KtsAbrechnungExpandRow({
  group,
  onClose
}: KtsAbrechnungExpandRowProps) {
  const { data: trips = [], isLoading } = useAbrechnungTripsByBelegnummer(
    group.kts_belegnummer
  );
  const bezahltMutation = useMarkBelegnummerBezahltMutation();
  const ruecklauferMutation = useMarkBelegnummerRuecklauferMutation();
  const abgerechnetMutation = useMarkBelegnummerAbgerechnetMutation();

  const [showRuecklauferInput, setShowRuecklauferInput] = React.useState(false);
  const [ruecklauferReason, setRuecklauferReason] = React.useState('');
  const [bezahltError, setBezahltError] = React.useState<string | null>(null);

  const anyPending =
    bezahltMutation.isPending ||
    ruecklauferMutation.isPending ||
    abgerechnetMutation.isPending;

  const handleMarkBezahlt = async () => {
    setBezahltError(null);
    const result = await bezahltMutation.mutateAsync({
      belegnummer: group.kts_belegnummer
    });
    if (!result.success && result.error === 'ruecklaufer_open') {
      setBezahltError(
        'Dieser Beleg enthält Rückläufer. Bitte zuerst auflösen.'
      );
      return;
    }
    onClose();
  };

  const handleMarkRuecklaufer = async () => {
    await ruecklauferMutation.mutateAsync({
      belegnummer: group.kts_belegnummer,
      reason: ruecklauferReason || null
    });
    onClose();
  };

  const handleMarkAbgerechnet = async () => {
    await abgerechnetMutation.mutateAsync({
      belegnummer: group.kts_belegnummer
    });
    onClose();
  };

  const importLine =
    group.source_filename || group.imported_at
      ? `Importiert aus: ${group.source_filename ?? '—'}${
          group.imported_at
            ? ` · ${format(new Date(group.imported_at), 'dd.MM.yyyy HH:mm', { locale: de })}`
            : ''
        }`
      : null;

  const persistedReason = trips
    .map((t) => t.kts_ruecklaufer_reason?.trim())
    .find(Boolean);

  return (
    <div className='bg-muted/20 space-y-4 rounded-lg border p-4'>
      {group.has_multiple_imports ? (
        <div className='flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50/80 px-3 py-2 text-xs text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300'>
          <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
          <span>
            Diese Belegnummer erscheint in {group.import_count} Import-Batches.
            Beträge und Status können aus mehreren Uploads stammen.
          </span>
        </div>
      ) : null}

      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='text-xs'>Termin</TableHead>
              <TableHead className='text-xs'>Fahrgast</TableHead>
              <TableHead className='text-xs'>KTS-Patient-ID</TableHead>
              <TableHead className='text-center text-xs'>Betrag</TableHead>
              <TableHead className='text-center text-xs'>Eigenanteil</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className='h-16 text-center text-xs'>
                  <Loader2 className='mx-auto h-4 w-4 animate-spin' />
                </TableCell>
              </TableRow>
            ) : trips.length > 0 ? (
              trips.map((trip) => (
                <TableRow key={trip.id}>
                  <TableCell className='text-xs tabular-nums'>
                    {trip.scheduled_at
                      ? format(
                          new Date(trip.scheduled_at),
                          'dd.MM.yyyy HH:mm',
                          {
                            locale: de
                          }
                        )
                      : '—'}
                  </TableCell>
                  <TableCell className='text-xs'>
                    {trip.client_name ?? '—'}
                  </TableCell>
                  <TableCell className='font-mono text-xs tabular-nums'>
                    {trip.kts_patient_id ?? '—'}
                  </TableCell>
                  <TableCell className='text-center text-xs tabular-nums'>
                    {trip.kts_invoice_amount != null
                      ? formatKtsInvoiceAmount(trip.kts_invoice_amount)
                      : '—'}
                  </TableCell>
                  <TableCell className='text-center text-xs tabular-nums'>
                    {trip.kts_eigenanteil != null
                      ? formatKtsInvoiceAmount(trip.kts_eigenanteil)
                      : '—'}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className='h-16 text-center text-xs'>
                  Keine Fahrten gefunden.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {group.group_status === 'abgerechnet' ? (
        <div className='space-y-3'>
          {bezahltError ? (
            <p className='text-destructive text-xs'>{bezahltError}</p>
          ) : null}
          <div className='flex items-center justify-between gap-4'>
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                size='sm'
                className='gap-1.5'
                disabled={anyPending}
                onClick={() => void handleMarkBezahlt()}
              >
                {bezahltMutation.isPending ? (
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                ) : (
                  <Check className='h-3.5 w-3.5' />
                )}
                Als bezahlt markieren
              </Button>
              {!showRuecklauferInput ? (
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='gap-1.5'
                  disabled={anyPending}
                  onClick={() => setShowRuecklauferInput(true)}
                >
                  <AlertTriangle className='h-3.5 w-3.5' />
                  Rückläufer melden
                </Button>
              ) : (
                <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
                  <Input
                    value={ruecklauferReason}
                    onChange={(e) => setRuecklauferReason(e.target.value)}
                    placeholder='Grund (optional)'
                    className='h-8 max-w-xs text-xs'
                  />
                  <Button
                    type='button'
                    size='sm'
                    variant='destructive'
                    disabled={anyPending}
                    onClick={() => void handleMarkRuecklaufer()}
                  >
                    Bestätigen
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    disabled={anyPending}
                    onClick={() => {
                      setShowRuecklauferInput(false);
                      setRuecklauferReason('');
                    }}
                  >
                    Abbrechen
                  </Button>
                </div>
              )}
            </div>
            {importLine ? (
              <span className='text-muted-foreground shrink-0 text-right text-xs'>
                {importLine}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {group.group_status === 'ruecklaufer' ? (
        <div className='space-y-3'>
          <div className='rounded-md border border-orange-200 bg-orange-50/80 px-3 py-2 text-xs text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300'>
            Rückläufer — dieser Beleg wurde zur Korrektur zurückgesendet. Der
            Steuerberater muss diesen Beleg korrigieren und erneut importieren.
            {persistedReason ? (
              <span className='mt-1 block font-medium'>
                Grund: {persistedReason}
              </span>
            ) : null}
          </div>
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={anyPending}
            onClick={() => void handleMarkAbgerechnet()}
          >
            {abgerechnetMutation.isPending ? (
              <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
            ) : null}
            Zurück zu Abgerechnet
          </Button>
        </div>
      ) : null}

      {group.group_status === 'bezahlt' ? (
        <div className='flex items-center gap-2 rounded-md border border-green-200 bg-green-50/80 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'>
          <Check className='h-4 w-4 shrink-0' />
          Bezahlt — Zahlung eingegangen.
        </div>
      ) : null}
    </div>
  );
}
