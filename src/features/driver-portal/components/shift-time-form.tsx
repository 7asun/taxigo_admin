'use client';

/**
 * Shift time entry form — manual Zeiterfassung for drivers.
 *
 * Thin wrapper around ShiftEntryForm: resolves driver auth, duplicate overwrite
 * dialog, and client shiftsService persistence. Driver UX unchanged from pre-Phase-4.
 */

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { shiftsService } from '@/features/driver-portal/api/shifts.service';
import {
  ShiftEntryForm,
  type ShiftEntryData
} from '@/features/driver-portal/components/shift-entry-form';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { createClient } from '@/lib/supabase/client';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export interface ShiftTimeFormProps {
  onShiftSaved?: () => void;
}

export function ShiftTimeForm({ onShiftSaved }: ShiftTimeFormProps = {}) {
  const [driverId, setDriverId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false);
  const [existingShiftId, setExistingShiftId] = useState<string | null>(null);
  const [pendingValues, setPendingValues] = useState<ShiftEntryData | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('accounts')
        .select('id, company_id')
        .eq('id', user.id)
        .single();

      if (profile) {
        setDriverId(profile.id);
        setCompanyId(profile.company_id);
      }
    };
    init();
  }, []);

  const persistShift = async (
    values: ShiftEntryData,
    overwrite: boolean
  ): Promise<void> => {
    if (!driverId || !companyId) {
      toast.error('Nicht angemeldet.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (overwrite && existingShiftId) {
        await shiftsService.deleteShift(existingShiftId);
      }

      await shiftsService.createManualShift({
        driverId,
        companyId,
        date: values.date,
        startTime: values.startTime,
        endTime: values.endTime,
        breaks: values.breaks.length > 0 ? values.breaks : undefined,
        vehicleId: values.vehicleId
      });

      toast.success('Schicht gespeichert.');
      setShowOverwriteDialog(false);
      setExistingShiftId(null);
      setPendingValues(null);
      setFormOpen(false);
      onShiftSaved?.();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : 'Fehler beim Speichern der Schicht.';
      toast.error(msg);
      console.error('Shift save error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDriverSubmit = async (values: ShiftEntryData) => {
    if (!driverId || !companyId) {
      toast.error('Bitte melden Sie sich an.');
      return;
    }

    const existing = await shiftsService.getShiftForDriverByDate(
      driverId,
      values.date
    );

    if (existing) {
      setExistingShiftId(existing.id);
      setPendingValues(values);
      setShowOverwriteDialog(true);
      return;
    }

    await persistShift(values, false);
  };

  const handleOverwriteConfirm = () => {
    if (pendingValues) {
      void persistShift(pendingValues, true);
    }
  };

  if (!driverId || !companyId) {
    return (
      <Card>
        <CardContent className='py-8 text-center'>
          <p className='text-muted-foreground'>
            Bitte melden Sie sich an, um Ihre Arbeitszeit zu erfassen.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Collapsible open={formOpen} onOpenChange={setFormOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button
              type='button'
              className='flex w-full items-center justify-between px-6 py-4 text-left'
            >
              <div>
                <h2 className='text-lg font-medium'>Zeiterfassung</h2>
                <p className='text-muted-foreground text-sm'>
                  Neue Schicht erfassen
                </p>
              </div>
              {formOpen ? (
                <IconChevronUp className='h-5 w-5 shrink-0' />
              ) : (
                <IconChevronDown className='h-5 w-5 shrink-0' />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className='border-t pt-6'>
              <ShiftEntryForm
                defaultDate={todayYmdInBusinessTz()}
                onSubmit={handleDriverSubmit}
                isSubmitting={isSubmitting}
              />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <AlertDialog
        open={showOverwriteDialog}
        onOpenChange={setShowOverwriteDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Schicht überschreiben?</AlertDialogTitle>
            <AlertDialogDescription>
              Für diesen Tag existiert bereits eine Schicht. Soll sie
              überschrieben werden?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              Abbrechen
            </AlertDialogCancel>
            <Button
              onClick={() => void handleOverwriteConfirm()}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Wird gespeichert…' : 'Überschreiben'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
