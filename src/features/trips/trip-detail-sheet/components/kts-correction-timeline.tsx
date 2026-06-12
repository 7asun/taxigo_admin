'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCloseKtsCorrectionMutation,
  useTripCorrections,
  type KtsCorrection
} from '@/features/kts/hooks/use-kts-corrections';
import { cn } from '@/lib/utils';

interface KtsCorrectionTimelineProps {
  tripId: string;
}

function formatKtsCorrectionDate(iso: string): string {
  return format(new Date(iso), 'dd.MM.yyyy HH:mm', { locale: de });
}

export function KtsCorrectionTimeline({ tripId }: KtsCorrectionTimelineProps) {
  // why: detail sheet remounts per open; staleTime 0 on the hook keeps open/closed badges aligned with DB after close or insert.
  const { data: rounds = [], isLoading } = useTripCorrections(tripId);
  const closeMutation = useCloseKtsCorrectionMutation();
  const [closingId, setClosingId] = useState<string | null>(null);
  // why: per-round inline errors — toast would be easy to miss in a scrollable sheet and would not show which round failed.
  const [closeErrors, setCloseErrors] = useState<Record<string, string>>({});

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-16 w-full rounded-lg' />
        <Skeleton className='h-16 w-full rounded-lg' />
      </div>
    );
  }

  if (rounds.length === 0) {
    return null;
  }

  const handleClose = async (round: KtsCorrection) => {
    setClosingId(round.id);
    setCloseErrors((prev) => {
      const next = { ...prev };
      delete next[round.id];
      return next;
    });
    try {
      await closeMutation.mutateAsync({
        correctionId: round.id,
        tripId,
        receivedAt: new Date()
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setCloseErrors((prev) => ({ ...prev, [round.id]: message }));
    } finally {
      setClosingId(null);
    }
  };

  return (
    <div className='space-y-2' aria-label='KTS-Korrekturen'>
      {rounds.map((round) => {
        const isOpen = round.received_at == null;
        const isClosing = closeMutation.isPending && closingId === round.id;

        return (
          <div
            key={round.id}
            className='border-border bg-muted/30 space-y-1.5 rounded-lg border p-3'
          >
            <div className='flex items-start justify-between gap-2'>
              <p className='text-foreground min-w-0 text-xs font-medium'>
                <span className='text-muted-foreground mr-1.5' aria-hidden>
                  •
                </span>
                {round.sent_to}
              </p>
              <Badge
                variant='outline'
                className={cn(
                  'h-5 shrink-0 px-1.5 py-0 text-[10px] font-semibold',
                  isOpen
                    ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'border-green-100 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400'
                )}
              >
                {isOpen ? 'Offen' : 'Erhalten'}
              </Badge>
            </div>
            <p className='text-muted-foreground text-[11px]'>
              Gesendet: {formatKtsCorrectionDate(round.sent_at)}
            </p>
            <p className='text-muted-foreground text-[11px]'>
              Erhalten:{' '}
              {round.received_at
                ? formatKtsCorrectionDate(round.received_at)
                : '—'}
            </p>
            {round.notes?.trim() ? (
              <p className='text-muted-foreground text-[11px]'>{round.notes}</p>
            ) : null}
            {isOpen ? (
              <div className='space-y-1.5 pt-1'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-8 text-xs'
                  disabled={isClosing}
                  onClick={() => {
                    void handleClose(round);
                  }}
                >
                  {isClosing ? (
                    <>
                      <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                      Wird gespeichert…
                    </>
                  ) : (
                    'Korrektur erhalten'
                  )}
                </Button>
                {closeErrors[round.id] ? (
                  <p className='text-destructive text-[11px]'>
                    {closeErrors[round.id]}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
