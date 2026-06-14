'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  useMarkKtsFehlerhaftMutation,
  useSendKtsCorrectionMutation
} from '@/features/kts/hooks/use-kts-status';
import type { KtsTripRow } from '@/features/kts/types/kts-trip-row';
import { cn } from '@/lib/utils';

const IconCheck = Icons.check;
const IconX = Icons.close;
const IconLoader = Icons.spinner;

export interface KtsExpandRowProps {
  trip: KtsTripRow;
  mode: 'fehler' | 'send';
  onClose: () => void;
}

interface ExpandActionButtonsProps {
  confirmTooltip: string;
  isPending: boolean;
  canConfirm: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function ExpandActionButtons({
  confirmTooltip,
  isPending,
  canConfirm,
  onConfirm,
  onClose
}: ExpandActionButtonsProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className='flex shrink-0 items-center gap-1 pt-0.5'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              variant='default'
              size='icon'
              className='h-7 w-7'
              onClick={onConfirm}
              disabled={isPending || !canConfirm}
              aria-label={confirmTooltip}
            >
              {isPending ? (
                <IconLoader className='h-3.5 w-3.5 animate-spin' />
              ) : (
                <IconCheck className='h-3.5 w-3.5' />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{confirmTooltip}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='text-muted-foreground hover:bg-muted h-7 w-7'
              onClick={onClose}
              disabled={isPending}
              aria-label='Abbrechen'
            >
              <IconX className='h-3.5 w-3.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Abbrechen</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function KtsExpandRow({ trip, mode, onClose }: KtsExpandRowProps) {
  // why: one text field + Enter — no date on send; sent_at defaults server-side in sendKtsCorrection.
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fehlerMutation = useMarkKtsFehlerhaftMutation();
  const sendMutation = useSendKtsCorrectionMutation();

  const isPending =
    mode === 'fehler' ? fehlerMutation.isPending : sendMutation.isPending;

  useEffect(() => {
    setValue('');
    setError(null);
    if (mode === 'fehler') {
      textareaRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [mode]);

  const handleConfirm = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(
        mode === 'fehler'
          ? 'Fehlerbeschreibung darf nicht leer sein.'
          : 'Empfänger darf nicht leer sein.'
      );
      return;
    }
    setError(null);
    try {
      if (mode === 'fehler') {
        await fehlerMutation.mutateAsync({
          tripId: trip.id,
          beschreibung: trimmed
        });
      } else {
        if (!trip.company_id) {
          setError('Unternehmen konnte nicht ermittelt werden.');
          return;
        }
        await sendMutation.mutateAsync({
          tripId: trip.id,
          companyId: trip.company_id,
          sentTo: trimmed
        });
      }
      setValue('');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    }
  }, [
    value,
    mode,
    fehlerMutation,
    sendMutation,
    trip.id,
    trip.company_id,
    onClose
  ]);

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleConfirm();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleChange = (next: string) => {
    setValue(next);
    if (error) setError(null);
  };

  const confirmTooltip = mode === 'fehler' ? 'Fehler speichern' : 'Absenden';
  const canConfirm = Boolean(value.trim());

  return (
    <div
      className={cn(
        'border-border bg-muted/30 rounded-md border border-dashed px-4 py-3'
      )}
    >
      <div className='flex items-start gap-2'>
        {mode === 'fehler' ? (
          <Textarea
            ref={textareaRef}
            autoFocus
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Fehler beschreiben…'
            rows={1}
            disabled={isPending}
            className='max-h-[5rem] min-h-[2rem] flex-1 resize-none overflow-y-auto py-1.5 text-sm'
            autoComplete='off'
            aria-label='Fehlerbeschreibung'
          />
        ) : (
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='z. B. Krankenkasse XY'
            disabled={isPending}
            className='h-8 flex-1 text-sm'
            autoComplete='off'
            aria-label='Gesendet an'
          />
        )}
        <ExpandActionButtons
          confirmTooltip={confirmTooltip}
          isPending={isPending}
          canConfirm={canConfirm}
          onConfirm={() => {
            void handleConfirm();
          }}
          onClose={onClose}
        />
      </div>
      {error ? <p className='text-destructive mt-1 text-xs'>{error}</p> : null}
    </div>
  );
}
