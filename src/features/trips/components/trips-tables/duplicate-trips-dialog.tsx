'use client';

import * as React from 'react';
import { addDays } from 'date-fns';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-time-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { tripsService, type Trip } from '@/features/trips/api/trips.service';
import {
  combineYmdAndHmToIsoString,
  computePreserveScheduleForLeg,
  outboundIsoFromUnifiedTimeChoice,
  type DuplicateScheduleMode
} from '@/features/trips/lib/duplicate-trip-schedule';
import { getTripDirection } from '@/features/trips/lib/trip-direction';
import {
  pickOutboundAndReturn,
  tryGetOutboundReturnPairFromTrips
} from '@/features/trips/lib/duplicate-trips';
import {
  instantToYmdInBusinessTz,
  todayYmdInBusinessTz,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { useOptionalTripsRscRefresh } from '@/features/trips/providers';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import { cn } from '@/lib/utils';

export type DuplicateTripsDialogVariant = 'bulk' | 'detail';

export interface DuplicateTripsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedTrips: Trip[];
  /**
   * `bulk`: Fahrten table selection — copy matches list bulk behaviour.
   * `detail`: single trip from the sheet; can pass `linkedPartnerPreview` + `includeLinkedLeg` to API.
   */
  variant?: DuplicateTripsDialogVariant;
  /** Resolved partner from the parent sheet — avoids refetch and drives the “mitkopieren” checkbox. */
  linkedPartnerPreview?: Trip | null;
  /**
   * Optional hook with created row ids (same order as API — pair = [outboundId, returnId]).
   * Bulk callers may ignore the argument.
   */
  onSuccess?: (result?: { ids: string[] }) => void;
}

function nextCalendarDayYmd(): string {
  const base = ymdToPickerDate(todayYmdInBusinessTz());
  return instantToYmdInBusinessTz(addDays(base, 1).getTime());
}

/** Wall-clock HH:mm for `leg` mapped onto `targetDateYmd` (business TZ). */
function hmFromLegOnYmd(leg: Trip, targetDateYmd: string): string | null {
  const iso = computePreserveScheduleForLeg(leg, targetDateYmd).scheduled_at;
  if (!iso) return null;
  return format(new Date(iso), 'HH:mm');
}

function formatTripScheduleVorlage(trip: Trip): string {
  if (trip.scheduled_at) {
    return format(new Date(trip.scheduled_at), 'PPp', { locale: de });
  }
  if (trip.requested_date) {
    return `${trip.requested_date} (ohne feste Uhrzeit)`;
  }
  return 'Keine feste Zeit';
}

function linkedLegShortLabel(partner: Trip): string {
  const d = getTripDirection(partner);
  if (d === 'rueckfahrt') return 'Rückfahrt';
  if (d === 'hinfahrt') return 'Hinfahrt';
  return 'verknüpfte Fahrt';
}

/**
 * Duplicate-to-new-day UI. `variant === 'detail'` + linked Hin/Rück: „Neue Uhrzeit“ uses two time
 * inputs and `explicitPerLegUnifiedTimes` (see `docs/trips-duplicate.md`). Bulk pair with both
 * Vorlage times still uses anchor radio + single `unifiedTimeHm`.
 */
export function DuplicateTripsDialog({
  open,
  onOpenChange,
  selectedTrips,
  variant = 'bulk',
  linkedPartnerPreview = null,
  onSuccess
}: DuplicateTripsDialogProps) {
  const tripsRsc = useOptionalTripsRscRefresh();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [targetDateYmd, setTargetDateYmd] = React.useState('');
  const [scheduleMode, setScheduleMode] = React.useState<DuplicateScheduleMode>(
    'preserve_original_time'
  );
  const [unifiedTimeHm, setUnifiedTimeHm] = React.useState('12:00');
  const [unifiedHinTimeHm, setUnifiedHinTimeHm] = React.useState('');
  const [unifiedRueckTimeHm, setUnifiedRueckTimeHm] = React.useState('');
  const [unifiedAnchor, setUnifiedAnchor] = React.useState<
    'hinfahrt' | 'rueckfahrt'
  >('hinfahrt');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [includeLinkedLeg, setIncludeLinkedLeg] = React.useState(true);

  const hasRecurringSource = React.useMemo(
    () => selectedTrips.some((t) => !!t.rule_id),
    [selectedTrips]
  );

  const isDetail = variant === 'detail';
  const showLinkedToggle =
    isDetail && selectedTrips.length === 1 && linkedPartnerPreview !== null;

  const pairForUnified = React.useMemo(() => {
    if (
      showLinkedToggle &&
      includeLinkedLeg &&
      linkedPartnerPreview &&
      selectedTrips[0]
    ) {
      return pickOutboundAndReturn(selectedTrips[0], linkedPartnerPreview);
    }
    return tryGetOutboundReturnPairFromTrips(selectedTrips);
  }, [showLinkedToggle, includeLinkedLeg, linkedPartnerPreview, selectedTrips]);

  const rueckVorlageForCheckbox =
    showLinkedToggle && includeLinkedLeg && pairForUnified
      ? pairForUnified.ret
      : null;

  const bothSourceHaveScheduledAt = React.useMemo(
    () =>
      Boolean(
        pairForUnified?.outbound.scheduled_at &&
          pairForUnified?.ret.scheduled_at
      ),
    [pairForUnified]
  );

  /** Detail + Paar: zwei Zeitfelder (Hinfahrt / Rückfahrt), optional leer; kein Anker-Radio. */
  const showUnifiedDualDetail =
    isDetail && !!pairForUnified && scheduleMode === 'unified_time';

  /** Bulk: Hin/Rück-Anker + eine Uhrzeit, wenn in der Vorlage beide Zeiten stehen. */
  const showUnifiedAnchorPair =
    !isDetail &&
    !!pairForUnified &&
    bothSourceHaveScheduledAt &&
    scheduleMode === 'unified_time';

  const loneTripWithTime = React.useMemo(
    () => selectedTrips.find((t) => t.scheduled_at),
    [selectedTrips]
  );

  const wasOpenRef = React.useRef(false);

  /** Bulk: Rückfahrt-Anker nur sinnvoll mit zwei Vorlage-Uhrzeiten — erzwinge Hinfahrt. */
  React.useEffect(() => {
    if (!isDetail && pairForUnified && !bothSourceHaveScheduledAt) {
      setUnifiedAnchor('hinfahrt');
    }
  }, [isDetail, pairForUnified, bothSourceHaveScheduledAt]);

  /** Reset form when the dialog opens (not on every parent re-render while open). */
  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      const nextDay = nextCalendarDayYmd();
      setTargetDateYmd(nextDay);
      setScheduleMode('preserve_original_time');
      setIncludeLinkedLeg(true);
      setUnifiedAnchor('hinfahrt');
      setUnifiedTimeHm('12:00');
      setUnifiedHinTimeHm('');
      setUnifiedRueckTimeHm('');
    }
    wasOpenRef.current = open;
  }, [open, selectedTrips]);

  /** Detail + Paar + unified: map each leg’s Vorlage time onto `targetDateYmd` when `scheduled_at` exists. */
  React.useEffect(() => {
    if (!open || scheduleMode !== 'unified_time' || !targetDateYmd) return;
    if (!isDetail || !pairForUnified) return;
    const o = pairForUnified.outbound;
    const r = pairForUnified.ret;
    if (o.scheduled_at) {
      const hm = hmFromLegOnYmd(o, targetDateYmd);
      if (hm) setUnifiedHinTimeHm(hm);
    }
    if (r.scheduled_at) {
      const hm = hmFromLegOnYmd(r, targetDateYmd);
      if (hm) setUnifiedRueckTimeHm(hm);
    }
  }, [open, scheduleMode, targetDateYmd, isDetail, pairForUnified]);

  /** Single `unifiedTimeHm`: sync from Vorlage onto `targetDateYmd`. Not used when detail+pair (dual fields). */
  React.useEffect(() => {
    if (!open || scheduleMode !== 'unified_time' || !targetDateYmd) return;
    if (isDetail && pairForUnified) return;
    const pair = pairForUnified;
    const leg =
      pair && unifiedAnchor === 'rueckfahrt'
        ? pair.ret
        : (pair?.outbound ?? loneTripWithTime);
    if (!leg?.scheduled_at) {
      return;
    }
    const hm = hmFromLegOnYmd(leg, targetDateYmd);
    if (hm) setUnifiedTimeHm(hm);
  }, [
    targetDateYmd,
    unifiedAnchor,
    scheduleMode,
    open,
    pairForUnified,
    loneTripWithTime,
    isDetail
  ]);

  const handleSubmit = async (): Promise<void> => {
    if (!targetDateYmd) {
      toast.error('Bitte ein Datum wählen.');
      return;
    }
    let unifiedScheduledAtIso: string | undefined;
    let unifiedReturnScheduledAtIso: string | undefined;

    if (scheduleMode === 'unified_time') {
      if (isDetail && pairForUnified) {
        try {
          if (unifiedHinTimeHm?.trim()) {
            unifiedScheduledAtIso = combineYmdAndHmToIsoString(
              targetDateYmd,
              unifiedHinTimeHm
            );
          }
          if (unifiedRueckTimeHm?.trim()) {
            unifiedReturnScheduledAtIso = combineYmdAndHmToIsoString(
              targetDateYmd,
              unifiedRueckTimeHm
            );
          }
        } catch (e) {
          toast.error(
            e instanceof Error
              ? e.message
              : 'Uhrzeit konnte nicht übernommen werden.'
          );
          return;
        }
      } else {
        if (!unifiedTimeHm?.trim()) {
          toast.error('Bitte eine Uhrzeit festlegen.');
          return;
        }
        try {
          unifiedScheduledAtIso = outboundIsoFromUnifiedTimeChoice({
            targetDateYmd,
            hm: unifiedTimeHm,
            anchor:
              pairForUnified && bothSourceHaveScheduledAt
                ? unifiedAnchor
                : 'hinfahrt',
            pair: pairForUnified
          });
        } catch (e) {
          toast.error(
            e instanceof Error
              ? e.message
              : 'Uhrzeit konnte nicht übernommen werden.'
          );
          return;
        }
      }
    }

    try {
      setIsSubmitting(true);
      const result = await tripsService.duplicateTrips({
        ids: selectedTrips.map((t) => t.id),
        targetDateYmd,
        scheduleMode,
        ...(isDetail && pairForUnified
          ? { explicitPerLegUnifiedTimes: true }
          : {}),
        ...(unifiedScheduledAtIso ? { unifiedScheduledAtIso } : {}),
        ...(unifiedReturnScheduledAtIso ? { unifiedReturnScheduledAtIso } : {}),
        ...(showLinkedToggle ? { includeLinkedLeg } : {})
      });
      toast.success(
        result.created === 1
          ? 'Eine Fahrt wurde dupliziert.'
          : `${result.created} Fahrten wurden dupliziert.`
      );
      onOpenChange(false);
      onSuccess?.({ ids: result.ids });
      if (tripsRsc) {
        void tripsRsc.refreshTripsPage();
      } else {
        void router.refresh();
        void queryClient.invalidateQueries({ queryKey: tripKeys.all });
      }
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
      <DialogContent
        showCloseButton
        className={cn(
          'flex max-h-[min(90vh,840px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg'
        )}
      >
        <div className='shrink-0 border-b px-6 pt-6 pb-4'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <Copy className='size-4' />
              {isDetail ? 'Fahrt duplizieren' : 'Fahrten duplizieren'}
            </DialogTitle>
            <DialogDescription>
              {isDetail ? (
                <>
                  Es wird eine neue, einmalige Fahrt erstellt (ohne
                  wiederkehrende Regel). Optional können Sie die verknüpfte
                  Gegenfahrt mitkopieren.
                </>
              ) : (
                <>
                  Es werden neue, einmalige Fahrten erstellt (ohne
                  wiederkehrende Regel). Verknüpfte Hin- und Rückfahrten werden
                  zusammen übernommen, wenn nur eine Seite ausgewählt ist.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
          <div className='space-y-4'>
            {isDetail ? (
              <p className='text-muted-foreground text-sm'>
                Ausgang:{' '}
                <span className='text-foreground font-medium'>
                  {selectedTrips[0]?.client_name?.trim() ||
                    selectedTrips[0]?.pickup_address ||
                    'Diese Fahrt'}
                </span>
              </p>
            ) : (
              <p className='text-muted-foreground text-sm'>
                Ausgewählt:{' '}
                <span className='text-foreground font-medium'>
                  {selectionCount} {selectionCount === 1 ? 'Zeile' : 'Zeilen'}
                </span>{' '}
                (nur diese Fahrten; keine ganze Gruppe aus dem Blatt).
              </p>
            )}

            {showLinkedToggle ? (
              <div className='flex items-start gap-3 rounded-md border p-3'>
                <Checkbox
                  id='dup-include-linked'
                  checked={includeLinkedLeg}
                  onCheckedChange={(v) => setIncludeLinkedLeg(v === true)}
                  disabled={isSubmitting}
                  className='mt-0.5'
                />
                <div className='grid min-w-0 flex-1 gap-1'>
                  <Label
                    htmlFor='dup-include-linked'
                    className='cursor-pointer leading-snug font-normal'
                  >
                    {linkedLegShortLabel(linkedPartnerPreview)} mitkopieren
                  </Label>
                  <p className='text-muted-foreground text-xs'>
                    Wenn deaktiviert, wird nur die geöffnete Fahrt kopiert; die
                    neue Fahrt ist dann nicht mit der Gegenfahrt verknüpft.
                  </p>
                  {rueckVorlageForCheckbox ? (
                    <div className='text-muted-foreground bg-muted/50 mt-2 space-y-0.5 rounded-md px-2.5 py-2 text-xs'>
                      <span className='text-foreground font-medium'>
                        Rückfahrt (Vorlage)
                      </span>
                      <span className='block'>
                        {formatTripScheduleVorlage(rueckVorlageForCheckbox)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {hasRecurringSource ? (
              <Alert variant='default'>
                <AlertTriangle className='size-4' />
                <AlertTitle>Wiederkehrende Quelle</AlertTitle>
                <AlertDescription>
                  Mindestens eine ausgewählte Fahrt stammt aus einer Regel. Die
                  Kopien sind einmalig. Prüfen Sie, ob sich Termine mit
                  künftigen Fahrten aus der gleichen Regel überschneiden
                  könnten.
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
                }}
                disabled={isSubmitting}
              />
              <p className='text-muted-foreground text-xs'>
                Standard ist morgen (Kalendertag im konfigurierten
                Geschäftszeitraum).
              </p>
            </div>

            <div className='space-y-3'>
              <Label>Zeit der Kopie</Label>
              <RadioGroup
                value={scheduleMode}
                onValueChange={(v) => {
                  const mode = v as DuplicateScheduleMode;
                  setScheduleMode(mode);
                  if (mode === 'unified_time' && !unifiedTimeHm?.trim()) {
                    setUnifiedTimeHm('12:00');
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
                      Gleiche Uhrzeit wie in der Vorlage
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      Jede kopierte Fahrt übernimmt dieselbe Tageszeit am neuen
                      Datum. Hatte die Vorlage keine feste Abholzeit, bleibt die
                      Kopie ohne Uhrzeit — nur mit dem gewählten Kalendertag.
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
                      Neue Uhrzeit wählen
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      {isDetail && pairForUnified
                        ? 'Das Datum steht oben unter „Neues Datum“. Legen Sie für die Kopie Hinfahrt und Rückfahrt getrennt fest — oder leer lassen, wenn die Uhrzeit noch offen ist.'
                        : 'Das Datum steht oben unter „Neues Datum“. Hier legen Sie nur die Uhrzeit fest — für die Hinfahrt oder für die Rückfahrt, je nach Auswahl. Bei einem Hin- und Rückfahrt-Paar wird die andere Fahrt so berechnet, dass der Abstand wie in der Vorlage bleibt, sofern dort für beide Fahrten eine Uhrzeit eingetragen war.'}
                    </p>
                    {scheduleMode === 'unified_time' ? (
                      <div className='space-y-3 pt-1'>
                        {showUnifiedDualDetail ? (
                          <>
                            <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
                              <Label
                                htmlFor='dup-unified-hin'
                                className='w-[5.75rem] shrink-0 font-normal'
                              >
                                Hinfahrt
                              </Label>
                              <Input
                                id='dup-unified-hin'
                                type='time'
                                step={60}
                                value={unifiedHinTimeHm}
                                onChange={(e) =>
                                  setUnifiedHinTimeHm(e.target.value)
                                }
                                disabled={isSubmitting}
                                className='bg-background max-w-[11rem] min-w-[7.5rem] flex-1 font-mono'
                              />
                            </div>
                            <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
                              <Label
                                htmlFor='dup-unified-rueck'
                                className='w-[5.75rem] shrink-0 font-normal'
                              >
                                Rückfahrt
                              </Label>
                              <Input
                                id='dup-unified-rueck'
                                type='time'
                                step={60}
                                value={unifiedRueckTimeHm}
                                onChange={(e) =>
                                  setUnifiedRueckTimeHm(e.target.value)
                                }
                                disabled={isSubmitting}
                                className='bg-background max-w-[11rem] min-w-[7.5rem] flex-1 font-mono'
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            {showUnifiedAnchorPair ? (
                              <RadioGroup
                                value={unifiedAnchor}
                                onValueChange={(v) =>
                                  setUnifiedAnchor(
                                    v as 'hinfahrt' | 'rueckfahrt'
                                  )
                                }
                                className='gap-2'
                                disabled={isSubmitting}
                              >
                                <div className='flex items-center gap-2'>
                                  <RadioGroupItem
                                    value='hinfahrt'
                                    id='dup-anchor-hin'
                                  />
                                  <Label
                                    htmlFor='dup-anchor-hin'
                                    className='cursor-pointer font-normal'
                                  >
                                    Uhrzeit gilt für die Hinfahrt
                                  </Label>
                                </div>
                                <div className='flex items-center gap-2'>
                                  <RadioGroupItem
                                    value='rueckfahrt'
                                    id='dup-anchor-rueck'
                                  />
                                  <Label
                                    htmlFor='dup-anchor-rueck'
                                    className='cursor-pointer font-normal'
                                  >
                                    Uhrzeit gilt für die Rückfahrt
                                  </Label>
                                </div>
                              </RadioGroup>
                            ) : null}
                            <div className='space-y-1.5'>
                              <Label htmlFor='dup-unified-time'>Uhrzeit</Label>
                              <Input
                                id='dup-unified-time'
                                type='time'
                                step={60}
                                value={unifiedTimeHm}
                                onChange={(e) =>
                                  setUnifiedTimeHm(e.target.value)
                                }
                                disabled={isSubmitting}
                                className='bg-background w-full max-w-[11rem] font-mono'
                              />
                            </div>
                          </>
                        )}
                      </div>
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
                      Nur Datum, Zeit noch offen
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      Es wird nur der Kalendertag übernommen; in der Kopie gibt
                      es keine feste Abholzeit (z.&nbsp;B. noch mit dem Kunden
                      abzusprechen).
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>
          </div>
        </div>

        <div className='bg-background shrink-0 border-t px-6 py-4'>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
