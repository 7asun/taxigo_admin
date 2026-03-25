'use client';

/**
 * Reschedule (“Verschieben”): split **Datum** / **Uhrzeit** so “Zeitabsprache” can leave
 * time empty while still setting `requested_date`. Imports **`DatePicker`** from
 * `@/components/ui/date-time-picker` (same file as `DateTimePicker`) plus `<input type="time">`.
 * A single `DateTimePicker` is not used here because the form models day + optional time
 * as separate fields. See `docs/date-picker.md` and `docs/trip-reschedule-v1.md`.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, ClockIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-time-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Trip } from '@/features/trips/api/trips.service';
import { findPairedTrip } from '@/features/trips/api/recurring-exceptions.actions';
import {
  rescheduleTripWithOptionalPair,
  type LegScheduleInput
} from '../api/reschedule.actions';
import { canRescheduleTrip, isRecurringTrip } from '../lib/reschedule-trip';
import { getTripDirection } from '@/features/trips/lib/trip-direction';

function linkedLegPickerTitle(
  paired: Pick<Trip, 'link_type' | 'linked_trip_id'>
): string {
  const d = getTripDirection(paired);
  if (d === 'rueckfahrt') return 'Rückfahrt';
  if (d === 'hinfahrt') return 'Hinfahrt';
  return 'Verknüpfte Fahrt';
}

function parseLocalYmdHm(ymd: string, hm: string): Date | null {
  const ymdTrim = ymd.trim();
  const hmTrim = hm.trim();
  if (!ymdTrim || !hmTrim) return null;
  const [y, m, d] = ymdTrim.split('-').map((x) => parseInt(x, 10));
  const [hh, mm] = hmTrim.split(':').map((x) => parseInt(x, 10));
  if (
    Number.isNaN(y) ||
    Number.isNaN(m) ||
    Number.isNaN(d) ||
    Number.isNaN(hh) ||
    Number.isNaN(mm)
  ) {
    return null;
  }
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function buildLeg(ymd: string, hm: string): LegScheduleInput {
  const hmTrim = hm.trim();
  if (hmTrim) {
    const ymdTrim = ymd.trim();
    if (!ymdTrim) {
      throw new Error('Bitte ein Datum wählen, wenn eine Uhrzeit gesetzt ist.');
    }
    const d = parseLocalYmdHm(ymdTrim, hmTrim);
    if (!d || Number.isNaN(d.getTime())) {
      throw new Error('Ungültiges Datum oder Uhrzeit.');
    }
    return { scheduledAt: d, requestedDate: null };
  }
  return {
    scheduledAt: null,
    requestedDate: ymd.trim() || null
  };
}

export interface TripRescheduleDialogProps {
  trip: Trip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function TripRescheduleDialog({
  trip,
  open,
  onOpenChange,
  onSuccess
}: TripRescheduleDialogProps) {
  const router = useRouter();
  const [paired, setPaired] = useState<Trip | null>(null);
  const [loadingPair, setLoadingPair] = useState(false);
  const [primaryYmd, setPrimaryYmd] = useState('');
  const [primaryHm, setPrimaryHm] = useState('');
  const [partnerYmd, setPartnerYmd] = useState('');
  const [partnerHm, setPartnerHm] = useState('');
  const [partnerHadTimeAtOpen, setPartnerHadTimeAtOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const baselinePrimaryMsRef = useRef<number | null>(null);
  const baselinePartnerMsRef = useRef<number | null>(null);
  const partnerEditedByUserRef = useRef(false);

  useEffect(() => {
    if (!open || !trip) {
      return;
    }

    partnerEditedByUserRef.current = false;

    baselinePrimaryMsRef.current = trip.scheduled_at
      ? new Date(trip.scheduled_at).getTime()
      : null;
    if (
      baselinePrimaryMsRef.current !== null &&
      Number.isNaN(baselinePrimaryMsRef.current)
    ) {
      baselinePrimaryMsRef.current = null;
    }

    if (trip.scheduled_at) {
      const d = new Date(trip.scheduled_at);
      if (!Number.isNaN(d.getTime())) {
        setPrimaryYmd(format(d, 'yyyy-MM-dd'));
        setPrimaryHm(format(d, 'HH:mm'));
      } else {
        setPrimaryYmd('');
        setPrimaryHm('');
      }
    } else if (trip.requested_date) {
      setPrimaryYmd(trip.requested_date);
      setPrimaryHm('');
    } else {
      setPrimaryYmd('');
      setPrimaryHm('');
    }

    setPartnerYmd('');
    setPartnerHm('');
    setPaired(null);
    setPartnerHadTimeAtOpen(false);
    baselinePartnerMsRef.current = null;
    setLoadingPair(true);

    findPairedTrip(trip)
      .then((p) => {
        setPaired(p ?? null);
        const had = Boolean(p?.scheduled_at);
        setPartnerHadTimeAtOpen(had);
        if (p?.scheduled_at) {
          const tMs = new Date(p.scheduled_at).getTime();
          baselinePartnerMsRef.current = Number.isNaN(tMs) ? null : tMs;
          const pd = new Date(p.scheduled_at);
          if (!Number.isNaN(pd.getTime())) {
            setPartnerYmd(format(pd, 'yyyy-MM-dd'));
            setPartnerHm(format(pd, 'HH:mm'));
          }
        } else if (p?.requested_date) {
          baselinePartnerMsRef.current = null;
          setPartnerYmd(p.requested_date);
          setPartnerHm('');
        } else {
          baselinePartnerMsRef.current = null;
          setPartnerYmd('');
          setPartnerHm('');
        }
      })
      .catch(() => {
        setPaired(null);
        baselinePartnerMsRef.current = null;
      })
      .finally(() => {
        setLoadingPair(false);
      });
  }, [open, trip?.id, trip?.scheduled_at, trip?.requested_date]);

  const applyPartnerDeltaIfSync = (nextYmd: string, nextHm: string) => {
    if (partnerEditedByUserRef.current) {
      return;
    }
    if (
      baselinePrimaryMsRef.current == null ||
      baselinePartnerMsRef.current == null
    ) {
      return;
    }
    const nextHmTrim = nextHm.trim();
    const nextYmdTrim = nextYmd.trim();
    if (!nextHmTrim || !nextYmdTrim) {
      return;
    }
    const d = parseLocalYmdHm(nextYmdTrim, nextHmTrim);
    if (!d || Number.isNaN(d.getTime())) {
      return;
    }
    const b0 = baselinePrimaryMsRef.current;
    const bp = baselinePartnerMsRef.current;
    const next = new Date(bp + (d.getTime() - b0));
    setPartnerYmd(format(next, 'yyyy-MM-dd'));
    setPartnerHm(format(next, 'HH:mm'));
  };

  const handlePrimaryYmdChange = (value: string) => {
    setPrimaryYmd(value);
    applyPartnerDeltaIfSync(value, primaryHm);
  };

  const handlePrimaryHmChange = (value: string) => {
    setPrimaryHm(value);
    applyPartnerDeltaIfSync(primaryYmd, value);
  };

  const handlePartnerYmdChange = (value: string) => {
    partnerEditedByUserRef.current = true;
    setPartnerYmd(value);
  };

  const handlePartnerHmChange = (value: string) => {
    partnerEditedByUserRef.current = true;
    setPartnerHm(value);
  };

  const handleSubmit = async () => {
    if (!trip) {
      return;
    }

    let primaryLeg: LegScheduleInput;
    try {
      primaryLeg = buildLeg(primaryYmd, primaryHm);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ungültige Eingabe.');
      return;
    }

    let partnerLeg: LegScheduleInput | null = null;
    if (paired) {
      try {
        partnerLeg = buildLeg(partnerYmd, partnerHm);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Ungültige Eingabe.');
        return;
      }
    }

    setSaving(true);
    try {
      const result = await rescheduleTripWithOptionalPair(
        trip,
        primaryLeg,
        partnerLeg
      );

      if (!result.ok) {
        toast.error(result.error ?? 'Verschieben fehlgeschlagen.');
        return;
      }

      toast.success(
        paired ? 'Fahrten wurden aktualisiert.' : 'Fahrt wurde aktualisiert.'
      );
      onOpenChange(false);
      onSuccess?.();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const eligible = trip ? canRescheduleTrip(trip) : false;
  const recurring = trip ? isRecurringTrip(trip) : false;

  const primaryHmTrim = primaryHm.trim();
  const primaryYmdTrim = primaryYmd.trim();
  const invalidPrimary = Boolean(primaryHmTrim) && !primaryYmdTrim;

  const partnerHmTrim = partnerHm.trim();
  const partnerYmdTrim = partnerYmd.trim();
  const invalidPartner =
    Boolean(paired) && Boolean(partnerHmTrim) && !partnerYmdTrim;

  const submitDisabled = Boolean(
    saving || !eligible || recurring || invalidPrimary || invalidPartner
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[min(90dvh,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md'
        )}
      >
        <DialogHeader className='border-border shrink-0 border-b px-6 pt-6 pb-4'>
          <DialogTitle className='flex items-center gap-2'>
            <CalendarRange className='h-5 w-5' />
            Verschieben
          </DialogTitle>
          <DialogDescription>
            {recurring
              ? 'Wiederkehrende Fahrten können hier noch nicht verschoben werden.'
              : 'Neues Datum und optional Abholzeit festlegen.'}
          </DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4'>
          {!trip ? null : recurring ? (
            <p className='text-muted-foreground text-sm'>
              Diese Funktion ist für einmalige Fahrten vorgesehen. Bitte
              wiederkehrende Fahrten später über die geplante Serien-Verwaltung
              anpassen.
            </p>
          ) : !eligible ? (
            <p className='text-muted-foreground text-sm'>
              Diese Fahrt kann nicht verschoben werden (kein Termin, oder
              bereits abgeschlossen/storniert).
            </p>
          ) : (
            <>
              <div className='space-y-2'>
                <span className='text-muted-foreground text-xs font-medium'>
                  Neue Abholzeit
                </span>
                <div className='flex w-full flex-row items-end gap-2'>
                  <div className='min-w-0 flex-1'>
                    <Label
                      htmlFor='reschedule-primary-date'
                      className='text-muted-foreground mb-1 block text-xs'
                    >
                      Datum
                    </Label>
                    <DatePicker
                      id='reschedule-primary-date'
                      value={primaryYmd}
                      onChange={handlePrimaryYmdChange}
                      disabled={saving}
                    />
                  </div>
                  <div className='w-[8.25rem] shrink-0 sm:w-[9.5rem]'>
                    <Label
                      htmlFor='reschedule-primary-time'
                      className='text-muted-foreground mb-1 block text-xs'
                    >
                      Uhrzeit
                    </Label>
                    <div className='relative'>
                      <ClockIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                      <Input
                        id='reschedule-primary-time'
                        type='time'
                        step={60}
                        value={primaryHm}
                        onChange={(e) => handlePrimaryHmChange(e.target.value)}
                        disabled={saving}
                        className={cn(
                          'h-10 min-h-10 touch-manipulation pl-9 font-mono md:h-9 md:min-h-0',
                          !primaryHmTrim && 'text-muted-foreground'
                        )}
                      />
                    </div>
                  </div>
                </div>
                <p className='text-muted-foreground text-[11px] leading-snug'>
                  Leeres Uhrzeitfeld wie bei „Rückfahrt mit Zeitabsprache“:
                  keine feste Abholzeit; optional ein Tag für die Übersicht.
                  Ohne Datum und ohne Zeit ist die Fahrt vollständig offen.
                </p>
              </div>

              {loadingPair ? (
                <p className='text-muted-foreground text-xs'>
                  Verknüpfung wird geladen…
                </p>
              ) : paired ? (
                <div className='space-y-2'>
                  <span className='text-muted-foreground text-xs font-medium'>
                    {linkedLegPickerTitle(paired)}
                  </span>
                  <div className='flex w-full flex-row items-end gap-2'>
                    <div className='min-w-0 flex-1'>
                      <Label
                        htmlFor='reschedule-partner-date'
                        className='text-muted-foreground mb-1 block text-xs'
                      >
                        Datum
                      </Label>
                      <DatePicker
                        id='reschedule-partner-date'
                        value={partnerYmd}
                        onChange={handlePartnerYmdChange}
                        disabled={saving}
                      />
                    </div>
                    <div className='w-[8.25rem] shrink-0 sm:w-[9.5rem]'>
                      <Label
                        htmlFor='reschedule-partner-time'
                        className='text-muted-foreground mb-1 block text-xs'
                      >
                        Uhrzeit
                      </Label>
                      <div className='relative'>
                        <ClockIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                        <Input
                          id='reschedule-partner-time'
                          type='time'
                          step={60}
                          value={partnerHm}
                          onChange={(e) =>
                            handlePartnerHmChange(e.target.value)
                          }
                          disabled={saving}
                          className={cn(
                            'h-10 min-h-10 touch-manipulation pl-9 font-mono md:h-9 md:min-h-0',
                            !partnerHm.trim() && 'text-muted-foreground'
                          )}
                        />
                      </div>
                    </div>
                  </div>
                  <p className='text-muted-foreground text-[11px] leading-snug'>
                    {partnerHadTimeAtOpen &&
                    baselinePrimaryMsRef.current != null &&
                    baselinePartnerMsRef.current != null
                      ? 'Verschiebt sich mit der neuen Abholzeit um denselben Zeitraum — hier bei Bedarf anpassen.'
                      : 'Optional: Datum und Zeit für die verknüpfte Fahrt setzen (oder nur Tag bei Zeitabsprache).'}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className='border-border shrink-0 gap-2 border-t px-6 py-4'>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Abbrechen
          </Button>
          <Button
            type='button'
            onClick={() => void handleSubmit()}
            disabled={submitDisabled}
          >
            {saving ? 'Wird gespeichert…' : 'Verschieben'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
