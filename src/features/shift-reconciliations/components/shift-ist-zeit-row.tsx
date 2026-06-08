'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';

import { Label } from '@/components/ui/label';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';

import { parseScheduledAtOrFallback } from '@/features/trips/lib/trip-time';

import { cn } from '@/lib/utils';

import { Clock, Hash, Trash2 } from 'lucide-react';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useDeleteIstZeitInline } from '../hooks/use-delete-ist-zeit-inline';

import { useSaveIstZeitInline } from '../hooks/use-save-ist-zeit-inline';

import {
  SHIFT_RECONCILIATION_CURRENCY_CODE,
  SHIFT_RECONCILIATION_CURRENCY_LOCALE
} from '../lib/constants';

import {
  calcArbeitsstundenDecimal,
  formatArbeitsstundenDecimal,
  parseTimeToMinutes
} from '../lib/time-helpers';

import type { IstZeitRowProps } from '../types';

const money = new Intl.NumberFormat(SHIFT_RECONCILIATION_CURRENCY_LOCALE, {
  style: 'currency',

  currency: SHIFT_RECONCILIATION_CURRENCY_CODE
});

type BreakMode = 'minutes' | 'timerange';

function isoToHm(iso: string | null): string {
  if (!iso) return '';

  const parsed = parseScheduledAtOrFallback(iso);

  return parsed?.hm ?? '';
}

function deriveBreakMinutesFromRange(
  pauseStart: string,

  pauseEnd: string
): { minutes: number; rangeError: string | null } {
  const trimmedStart = pauseStart.trim();

  const trimmedEnd = pauseEnd.trim();

  if (!trimmedStart && !trimmedEnd) {
    return { minutes: 0, rangeError: null };
  }

  if (!trimmedStart || !trimmedEnd) {
    return { minutes: 0, rangeError: null };
  }

  const startMin = parseTimeToMinutes(trimmedStart);

  const endMin = parseTimeToMinutes(trimmedEnd);

  if (endMin <= startMin) {
    return {
      minutes: 0,

      rangeError: 'Ende der Pause muss nach dem Anfang liegen.'
    };
  }

  return { minutes: endMin - startMin, rangeError: null };
}

type ClearShiftButtonProps = {
  driverId: string;

  date: string;

  disabled: boolean;

  onCleared: () => void;
};

function ClearShiftButton({
  driverId,

  date,

  disabled,

  onCleared
}: ClearShiftButtonProps) {
  const deleteMutation = useDeleteIstZeitInline(driverId, date);

  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    void deleteMutation

      .mutateAsync()

      .then((result) => {
        if (!result.success) return;

        setOpen(false);

        onCleared();
      });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='text-muted-foreground hover:text-destructive h-8 w-8 shrink-0'
          disabled={disabled || deleteMutation.isPending}
          aria-label='Ist-Zeit löschen'
        >
          <Trash2 className='h-3.5 w-3.5' />
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ist-Zeit löschen?</AlertDialogTitle>

          <AlertDialogDescription>
            Die erfassten Zeiten für diesen Tag werden unwiderruflich gelöscht.
            Fahrten und Abgleich-Status bleiben erhalten.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>

          <AlertDialogAction
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={deleteMutation.isPending}
          >
            Löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ShiftIstZeitRow({
  driverId,

  date,

  startedAt,

  endedAt,

  breakMinutes: breakMinutesProp,

  totalRevenue,

  showIstZeit,

  onSaved
}: IstZeitRowProps) {
  // WHY showIstZeit: Option B — always true now; Option A path swaps to

  // driver.requires_shift_times here only (see types.ts IstZeitRowProps).

  if (!showIstZeit) return null;

  const mutation = useSaveIstZeitInline(driverId, date);

  const saveInFlight = useRef(false);

  const [startTime, setStartTime] = useState('');

  const [endTime, setEndTime] = useState('');

  const [breakMode, setBreakMode] = useState<BreakMode>('minutes');

  const [breakMinutesInput, setBreakMinutesInput] = useState('');

  const [pauseStart, setPauseStart] = useState('');

  const [pauseEnd, setPauseEnd] = useState('');

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStartTime(isoToHm(startedAt));

    setEndTime(isoToHm(endedAt));

    setBreakMode('minutes');

    setBreakMinutesInput(
      breakMinutesProp != null && breakMinutesProp > 0
        ? String(breakMinutesProp)
        : ''
    );

    setPauseStart('');

    setPauseEnd('');

    setError(null);
  }, [startedAt, endedAt, breakMinutesProp, date]);

  const clearLocalState = () => {
    setStartTime('');

    setEndTime('');

    setBreakMinutesInput('');

    setPauseStart('');

    setPauseEnd('');

    setBreakMode('minutes');

    setError(null);
  };

  const handleShiftCleared = () => {
    clearLocalState();

    onSaved();
  };

  const minutesFromInput = (() => {
    const trimmed = breakMinutesInput.trim();

    if (trimmed === '') return 0;

    const parsed = Number.parseInt(trimmed, 10);

    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  })();

  const rangeBreak = deriveBreakMinutesFromRange(pauseStart, pauseEnd);

  const effectiveBreakMinutes =
    breakMode === 'minutes' ? minutesFromInput : rangeBreak.minutes;

  const arbeitsstundenLabel = formatArbeitsstundenDecimal(
    startTime,

    endTime,

    effectiveBreakMinutes
  );

  const hoursDecimal = calcArbeitsstundenDecimal(
    startTime,

    endTime,

    effectiveBreakMinutes
  );

  const showEurPerHour =
    hoursDecimal != null &&
    hoursDecimal > 0 &&
    totalRevenue != null &&
    totalRevenue > 0;

  const eurPerHourLabel = showEurPerHour
    ? money.format(totalRevenue! / hoursDecimal!) + '/h'
    : null;

  const switchToTimeRange = () => {
    setPauseStart('');

    setPauseEnd('');

    setBreakMode('timerange');

    setError(null);
  };

  const switchToMinutes = () => {
    const derived = deriveBreakMinutesFromRange(pauseStart, pauseEnd);

    if (!derived.rangeError && derived.minutes > 0) {
      setBreakMinutesInput(String(derived.minutes));
    }

    setBreakMode('minutes');

    setError(null);
  };

  const commitSave = () => {
    if (saveInFlight.current || mutation.isPending) return;

    const trimmedStart = startTime.trim();

    const trimmedEnd = endTime.trim();

    if (breakMode === 'timerange' && rangeBreak.rangeError) {
      setError(rangeBreak.rangeError);

      return;
    }

    const breakMinutesToSave =
      breakMode === 'minutes' ? minutesFromInput : rangeBreak.minutes;

    if (!trimmedStart && !trimmedEnd && breakMinutesToSave === 0) return;

    if (!trimmedStart || !trimmedEnd) {
      setError('Beginn und Ende sind erforderlich.');

      return;
    }

    saveInFlight.current = true;

    setError(null);

    void mutation

      .mutateAsync({
        driverId,

        date,

        startTime: trimmedStart,

        endTime: trimmedEnd,

        breakMinutes: breakMinutesToSave
      })

      .then((result) => {
        if (!result.success) {
          if (result.error === 'ACTIVE_SHIFT_BLOCKED') {
            setError('Fahrer hat eine aktive Schicht — Eintrag nicht möglich.');
          } else {
            setError('Speichern fehlgeschlagen.');
          }

          return;
        }

        // WHY silent success: inline editing should feel frictionless when

        // processing many days — no toast, list refreshes via invalidation.

        onSaved();
      })

      .finally(() => {
        saveInFlight.current = false;
      });
  };

  const handleBlur = () => {
    // WHY save-on-blur: avoid partial saves mid-keystroke.

    commitSave();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();

      commitSave();
    }
  };

  const displayError =
    error ?? (breakMode === 'timerange' ? rangeBreak.rangeError : null);

  const startId = `sr-start-${date}`;

  const endId = `sr-end-${date}`;

  const pauseMinId = `sr-pause-min-${date}`;

  const pauseStartId = `sr-pause-start-${date}`;

  const pauseEndId = `sr-pause-end-${date}`;

  const rowBusy = mutation.isPending;

  return (
    <div className='space-y-1'>
      <div
        className={cn(
          'flex flex-wrap items-end gap-x-3 gap-y-2 py-2 text-sm',

          rowBusy && 'opacity-60'
        )}
      >
        <div className='flex flex-col gap-1'>
          <Label htmlFor={startId} className='text-muted-foreground text-xs'>
            Anfang
          </Label>

          <Input
            id={startId}
            type='time'
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className='h-8 w-[7rem] font-mono tabular-nums'
            disabled={rowBusy}
          />
        </div>

        <span
          className='text-muted-foreground hidden pb-2 sm:inline'
          aria-hidden
        >
          →
        </span>

        <div className='flex flex-col gap-1'>
          <Label htmlFor={endId} className='text-muted-foreground text-xs'>
            Ende
          </Label>

          <Input
            id={endId}
            type='time'
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className='h-8 w-[7rem] font-mono tabular-nums'
            disabled={rowBusy}
          />
        </div>

        <div className='flex flex-col gap-1'>
          {breakMode === 'minutes' ? (
            <Label
              htmlFor={pauseMinId}
              className='text-muted-foreground text-xs'
            >
              Pause
            </Label>
          ) : (
            <span className='text-muted-foreground text-xs'>Pause</span>
          )}

          <div className='flex items-center gap-1.5'>
            {breakMode === 'minutes' ? (
              <>
                <Input
                  id={pauseMinId}
                  type='number'
                  min={0}
                  max={120}
                  step={5}
                  inputMode='numeric'
                  value={breakMinutesInput}
                  onChange={(e) => setBreakMinutesInput(e.target.value)}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  className='h-8 w-16 font-mono tabular-nums'
                  disabled={rowBusy}
                />

                <span className='text-muted-foreground text-xs whitespace-nowrap'>
                  min
                </span>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8 shrink-0'
                        onClick={switchToTimeRange}
                        disabled={rowBusy}
                        aria-label='Pausenzeit als Uhrzeit eingeben'
                      >
                        <Clock className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>

                    <TooltipContent>
                      Pausenzeit als Uhrzeit eingeben
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            ) : (
              <>
                <Label htmlFor={pauseStartId} className='sr-only'>
                  Pause von
                </Label>

                <Input
                  id={pauseStartId}
                  type='time'
                  value={pauseStart}
                  onChange={(e) => {
                    setPauseStart(e.target.value);

                    if (error?.includes('Pause')) setError(null);
                  }}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  className='h-8 w-[7rem] font-mono tabular-nums'
                  disabled={rowBusy}
                />

                <span className='text-muted-foreground text-xs'>–</span>

                <Label htmlFor={pauseEndId} className='sr-only'>
                  Pause bis
                </Label>

                <Input
                  id={pauseEndId}
                  type='time'
                  value={pauseEnd}
                  onChange={(e) => {
                    setPauseEnd(e.target.value);

                    if (error?.includes('Pause')) setError(null);
                  }}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  className='h-8 w-[7rem] font-mono tabular-nums'
                  disabled={rowBusy}
                />

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8 shrink-0'
                        onClick={switchToMinutes}
                        disabled={rowBusy}
                        aria-label='Pausenzeit in Minuten eingeben'
                      >
                        <Hash className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>

                    <TooltipContent>
                      Pausenzeit in Minuten eingeben
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>
        </div>

        <span
          className='text-muted-foreground hidden pb-2 sm:inline'
          aria-hidden
        >
          │
        </span>

        <span className='pb-2 font-medium tabular-nums'>
          {arbeitsstundenLabel}
        </span>

        {eurPerHourLabel && (
          <>
            <span
              className='text-muted-foreground hidden pb-2 sm:inline'
              aria-hidden
            >
              │
            </span>

            <span className='text-muted-foreground pb-2 tabular-nums'>
              {eurPerHourLabel}
            </span>
          </>
        )}

        {startedAt && (
          <div className='ml-auto pb-1'>
            <ClearShiftButton
              driverId={driverId}
              date={date}
              disabled={rowBusy}
              onCleared={handleShiftCleared}
            />
          </div>
        )}
      </div>

      {displayError && (
        <p className='text-destructive text-xs' role='alert'>
          {displayError}
        </p>
      )}
    </div>
  );
}
