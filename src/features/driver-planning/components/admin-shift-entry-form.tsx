'use client';

/**
 * Admin shift entry — server-action wrapper around ShiftEntryForm.
 */

import { Button } from '@/components/ui/button';
import {
  ShiftEntryForm,
  type ShiftEntryData,
  type ShiftEntryExistingShift
} from '@/features/driver-portal/components/shift-entry-form';
import { SHIFT_STATUSES } from '@/features/driver-portal/types';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import {
  createAdminShiftAction,
  deleteAdminShiftAction,
  getAdminShiftForDriverDateAction
} from '../actions';
import type { AdminShiftForDate } from '../types';

export type AdminShiftEntryFormProps = {
  driverId: string;
  date: string;
  onSaved: () => void;
  onCancel?: () => void;
  showDateField?: boolean;
};

type VehicleOption = { id: string; name: string; license_plate: string };

function mapToExistingShift(shift: AdminShiftForDate): ShiftEntryExistingShift {
  return {
    startTime: shift.startTime,
    endTime: shift.endTime,
    breaks: shift.breaks,
    vehicleId: shift.vehicleId
  };
}

export function AdminShiftEntryForm({
  driverId,
  date,
  onSaved,
  onCancel,
  showDateField = false
}: AdminShiftEntryFormProps) {
  const [existingShift, setExistingShift] = useState<AdminShiftForDate | null>(
    null
  );
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setSubmitError(null);
      try {
        const [shift, vehiclesResult] = await Promise.all([
          getAdminShiftForDriverDateAction(driverId, date),
          (async () => {
            const supabase = createClient();
            const { data, error } = await supabase
              .from('vehicles')
              .select('id, name, license_plate')
              .eq('is_active', true)
              .order('name');
            if (error || !data) return [];
            return data as VehicleOption[];
          })()
        ]);

        if (cancelled) return;
        setExistingShift(shift);
        setVehicles(vehiclesResult);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [driverId, date]);

  const handleSubmit = async (data: ShiftEntryData) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createAdminShiftAction({
        driverId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        breaks: data.breaks.length > 0 ? data.breaks : undefined,
        vehicleId: data.vehicleId
      });

      if (!result.success) {
        if (result.error === 'ACTIVE_SHIFT_BLOCKED') {
          setSubmitError(
            'Fahrer hat eine aktive Schicht — Eintrag nicht möglich.'
          );
        } else {
          setSubmitError('Speichern fehlgeschlagen.');
        }
        return;
      }

      onSaved();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!existingShift) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await deleteAdminShiftAction(driverId, date);
      if (!result.success) {
        setSubmitError('Löschen fehlgeschlagen.');
        return;
      }
      onSaved();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        Wird geladen…
      </p>
    );
  }

  return (
    <div className='space-y-4'>
      {existingShift && existingShift.status !== SHIFT_STATUSES.ENDED && (
        <p
          className='text-destructive border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 text-sm'
          role='alert'
        >
          Fahrer hat eine aktive Schicht — Eintrag nicht möglich.
        </p>
      )}

      {existingShift && existingShift.status === SHIFT_STATUSES.ENDED && (
        <p
          className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
          role='status'
        >
          {/* WHY no AlertDialog: admin intent is explicit from pre-filled form;
              blocking dialog adds friction without safety benefit unlike driver self-overwrite. */}
          Schicht vorhanden — wird überschrieben
        </p>
      )}

      <ShiftEntryForm
        defaultDate={date}
        blankTimeFields
        existingShift={existingShift ? mapToExistingShift(existingShift) : null}
        vehicles={vehicles}
        showDateField={showDateField}
        showVehicleField={vehicles.length > 0}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        isSubmitting={
          isSubmitting ||
          Boolean(
            existingShift && existingShift.status !== SHIFT_STATUSES.ENDED
          )
        }
        submitError={submitError}
      />

      {existingShift && (
        <Button
          type='button'
          variant='destructive'
          size='sm'
          onClick={() => void handleDelete()}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Wird gelöscht…' : 'Schicht löschen'}
        </Button>
      )}
    </div>
  );
}
