'use client';

import * as React from 'react';
import { addDays } from 'date-fns';
import { AlertTriangle, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { DatePicker, DateTimePicker } from '@/components/ui/date-time-picker';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { tripsService, type Trip } from '@/features/trips/api/trips.service';
import {
  computePreserveScheduleForLeg,
  type DuplicateScheduleMode
} from '@/features/trips/lib/duplicate-trip-schedule';
import {
  instantToYmdInBusinessTz,
  todayYmdInBusinessTz,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { useTripsRscRefresh } from '@/features/trips/providers';

export interface DuplicateTripsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Checkbox selection only — the API expands Hin/Rück partners. */
  selectedTrips: Trip[];
  onSuccess?: () => void;
}

function nextCalendarDayYmd(): string {
  const base = ymdToPickerDate(todayYmdInBusinessTz());
  return instantToYmdInBusinessTz(addDays(base, 1).getTime());
}

/** Default “eine Uhrzeit für alle” = first leg with a time mapped onto the target day (business TZ). */
function defaultUnifiedInstant(trips: Trip[], targetDateYmd: string): Date {
  const withTime = trips.find((t) => t.scheduled_at);
  if (withTime) {
    const iso = computePreserveScheduleForLeg(
      withTime,
      targetDateYmd
    ).scheduled_at;
    if (iso) return new Date(iso);
  }
  const d = ymdToPickerDate(targetDateYmd);
  d.setHours(12, 0, 0, 0);
  return d;
}

export function DuplicateTripsDialog({
  open,
  onOpenChange,
  selectedTrips,
  onSuccess
}: DuplicateTripsDialogProps) {
  const { refreshTripsPage } = useTripsRscRefresh();
  const [targetDateYmd, setTargetDateYmd] = React.useState('');
  const [scheduleMode, setScheduleMode] = React.useState<DuplicateScheduleMode>(
    'preserve_original_time'
  );
  const [unifiedAt, setUnifiedAt] = React.useState<Date | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const hasRecurringSource = React.useMemo(
    () => selectedTrips.some((t) => !!t.rule_id),
    [selectedTrips]
  );

  const wasOpenRef = React.useRef(false);

  /** Reset form when the dialog opens (not on every parent re-render while open). */
  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      const nextDay = nextCalendarDayYmd();
      setTargetDateYmd(nextDay);
      setScheduleMode('preserve_original_time');
      setUnifiedAt(defaultUnifiedInstant(selectedTrips, nextDay));
    }
    wasOpenRef.current = open;
  }, [open, selectedTrips]);

  const handleSubmit = async (): Promise<void> => {
    if (!targetDateYmd) {
      toast.error('Bitte ein Datum wählen.');
      return;
    }
    if (scheduleMode === 'unified_time' && !unifiedAt) {
      toast.error('Bitte Datum und Uhrzeit festlegen.');
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await tripsService.duplicateTrips({
        ids: selectedTrips.map((t) => t.id),
        targetDateYmd,
        scheduleMode,
        unifiedScheduledAtIso:
          scheduleMode === 'unified_time' && unifiedAt
            ? unifiedAt.toISOString()
            : undefined
      });
      toast.success(
        result.created === 1
          ? 'Eine Fahrt wurde dupliziert.'
          : `${result.created} Fahrten wurden dupliziert.`
      );
      onOpenChange(false);
      onSuccess?.();
      void refreshTripsPage();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Duplizieren fehlgeschlagen.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectionCount = selectedTrips.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Copy className='size-4' />
            Fahrten duplizieren
          </DialogTitle>
          <DialogDescription>
            Es werden neue, einmalige Fahrten erstellt (ohne wiederkehrende
            Regel). Verknüpfte Hin- und Rückfahrten werden zusammen übernommen,
            wenn nur eine Seite ausgewählt ist.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-1'>
          <p className='text-muted-foreground text-sm'>
            Ausgewählt:{' '}
            <span className='text-foreground font-medium'>
              {selectionCount} {selectionCount === 1 ? 'Zeile' : 'Zeilen'}
            </span>{' '}
            (nur diese Fahrten; keine ganze Gruppe aus dem Blatt).
          </p>

          {hasRecurringSource ? (
            <Alert variant='default'>
              <AlertTriangle className='size-4' />
              <AlertTitle>Wiederkehrende Quelle</AlertTitle>
              <AlertDescription>
                Mindestens eine ausgewählte Fahrt stammt aus einer Regel. Die
                Kopien sind einmalig. Prüfen Sie, ob sich Termine mit künftigen
                Fahrten aus der gleichen Regel überschneiden könnten.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className='space-y-2'>
            <Label htmlFor='dup-date'>Neues Datum</Label>
            <DatePicker
              id='dup-date'
              value={targetDateYmd}
              onChange={(ymd) => {
                setTargetDateYmd(ymd);
                if (scheduleMode === 'unified_time' && ymd) {
                  setUnifiedAt(defaultUnifiedInstant(selectedTrips, ymd));
                }
              }}
              disabled={isSubmitting}
            />
            <p className='text-muted-foreground text-xs'>
              Standard ist morgen (Kalendertag im konfigurierten
              Geschäftszeitraum).
            </p>
          </div>

          <div className='space-y-3'>
            <Label>Abfahrt / Zeit</Label>
            <RadioGroup
              value={scheduleMode}
              onValueChange={(v) => {
                const mode = v as DuplicateScheduleMode;
                setScheduleMode(mode);
                if (mode === 'unified_time' && targetDateYmd) {
                  setUnifiedAt(
                    defaultUnifiedInstant(selectedTrips, targetDateYmd)
                  );
                }
              }}
              className='gap-3'
              disabled={isSubmitting}
            >
              <div className='flex items-start gap-2'>
                <RadioGroupItem
                  value='preserve_original_time'
                  id='dup-mode-preserve'
                  className='mt-0.5'
                />
                <div className='grid gap-0.5'>
                  <Label htmlFor='dup-mode-preserve' className='font-normal'>
                    Uhrzeit wie Original
                  </Label>
                  <p className='text-muted-foreground text-xs'>
                    Pro Fahrt: gleiche Uhrzeit am gewählten Tag. Ohne Uhrzeit in
                    der Quelle bleibt die Kopie ohne feste Zeit (nur Datum).
                  </p>
                </div>
              </div>
              <div className='flex items-start gap-2'>
                <RadioGroupItem
                  value='unified_time'
                  id='dup-mode-unified'
                  className='mt-0.5'
                />
                <div className='grid w-full min-w-0 gap-2'>
                  <Label htmlFor='dup-mode-unified' className='font-normal'>
                    Eine Uhrzeit für alle (Hinfahrt)
                  </Label>
                  <p className='text-muted-foreground text-xs'>
                    Bei Hin- und Rückfahrt bleibt der zeitliche Abstand zwischen
                    den Beinen erhalten, wenn beide Zeiten hatten.
                  </p>
                  {scheduleMode === 'unified_time' ? (
                    <DateTimePicker
                      value={unifiedAt}
                      onChange={setUnifiedAt}
                      disabled={isSubmitting}
                      id='dup-unified-dt'
                      label='Datum und Uhrzeit'
                    />
                  ) : null}
                </div>
              </div>
              <div className='flex items-start gap-2'>
                <RadioGroupItem
                  value='time_open'
                  id='dup-mode-open'
                  className='mt-0.5'
                />
                <div className='grid gap-0.5'>
                  <Label htmlFor='dup-mode-open' className='font-normal'>
                    Zeit offen
                  </Label>
                  <p className='text-muted-foreground text-xs'>
                    Nur Kalendertag setzen; keine feste Abfahrtsuhrzeit in der
                    Kopie.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className='gap-2 sm:gap-0'>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Abbrechen
          </Button>
          <Button
            type='button'
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Duplizieren…' : 'Duplizieren'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
