'use client';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import {
  useDeleteDayPlan,
  useUpsertDayPlan
} from '../hooks/use-driver-week-plan';
import {
  PLAN_STATUSES,
  PLAN_STATUSES_WITH_TIMES,
  type DriverDayPlan,
  type PlanStatus
} from '../types';

type VehicleOption = { id: string; name: string; license_plate: string };

export type DayPlanEditFormProps = {
  driverId: string;
  planDate: string;
  plan: DriverDayPlan | null;
  weekStartYmd: string;
  onSaved: () => void;
  onDeleted: () => void;
  onCancel: () => void;
};

function timeFromDb(value: string | null): string {
  if (!value) return '';
  return value.slice(0, 5);
}

export function DayPlanEditForm({
  driverId,
  planDate,
  plan,
  weekStartYmd,
  onSaved,
  onDeleted,
  onCancel
}: DayPlanEditFormProps) {
  const upsert = useUpsertDayPlan(driverId, weekStartYmd);
  const remove = useDeleteDayPlan(driverId, weekStartYmd);

  const [status, setStatus] = useState<PlanStatus>('working');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const showTimes = PLAN_STATUSES_WITH_TIMES.includes(status);

  useEffect(() => {
    setStatus((plan?.status as PlanStatus) ?? 'working');
    setPlannedStart(timeFromDb(plan?.planned_start ?? null));
    setPlannedEnd(timeFromDb(plan?.planned_end ?? null));
    setVehicleId(plan?.vehicle_id ?? null);
    setNotes(plan?.notes ?? '');
    setFormError(null);
  }, [plan, planDate, driverId]);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, name, license_plate')
        .eq('is_active', true)
        .order('name');
      if (!error && data) {
        setVehicles(data as VehicleOption[]);
      }
    };
    void load();
  }, []);

  const handleSave = async () => {
    setFormError(null);
    if (showTimes && plannedStart && plannedEnd && plannedStart >= plannedEnd) {
      setFormError('Ende muss nach Beginn liegen.');
      return;
    }

    try {
      await upsert.mutateAsync({
        driverId,
        planDate,
        status,
        plannedStart: showTimes ? plannedStart || null : null,
        plannedEnd: showTimes ? plannedEnd || null : null,
        vehicleId: vehicleId || null,
        notes: notes.trim() ? notes.trim().slice(0, 500) : null
      });
      onSaved();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'
      );
    }
  };

  const handleDelete = async () => {
    if (!plan?.id) return;
    setFormError(null);
    try {
      await remove.mutateAsync({ planId: plan.id, planDate });
      setShowDeleteDialog(false);
      onDeleted();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Löschen fehlgeschlagen.'
      );
    }
  };

  return (
    <>
      <div className='flex flex-col gap-4'>
        <div className='space-y-2'>
          <Label htmlFor='dp-status'>Status</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as PlanStatus)}
          >
            <SelectTrigger id='dp-status'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PLAN_STATUSES) as PlanStatus[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {PLAN_STATUSES[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showTimes && (
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='dp-start'>Geplant Beginn</Label>
              <Input
                id='dp-start'
                type='time'
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='dp-end'>Geplant Ende</Label>
              <Input
                id='dp-end'
                type='time'
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className='space-y-2'>
          <Label htmlFor='dp-vehicle'>Fahrzeug (optional)</Label>
          <Select
            value={vehicleId ?? '__none__'}
            onValueChange={(v) => setVehicleId(v === '__none__' ? null : v)}
          >
            <SelectTrigger id='dp-vehicle'>
              <SelectValue placeholder='Kein Fahrzeug' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='__none__'>Kein Fahrzeug</SelectItem>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name} ({v.license_plate})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='dp-notes'>Notizen</Label>
          <Textarea
            id='dp-notes'
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            rows={3}
            placeholder='Optionale Hinweise…'
          />
          <p className='text-muted-foreground text-xs'>{notes.length}/500</p>
        </div>

        {formError && (
          <p className='text-destructive text-sm' role='alert'>
            {formError}
          </p>
        )}

        <div className='flex flex-wrap items-center justify-between gap-2 pt-1'>
          {plan ? (
            <Button
              type='button'
              variant='destructive'
              size='sm'
              onClick={() => setShowDeleteDialog(true)}
              disabled={remove.isPending || upsert.isPending}
            >
              Löschen
            </Button>
          ) : (
            <span />
          )}
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={onCancel}
              disabled={remove.isPending || upsert.isPending}
            >
              Abbrechen
            </Button>
            <Button
              type='button'
              size='sm'
              onClick={() => void handleSave()}
              disabled={upsert.isPending || remove.isPending}
            >
              {upsert.isPending ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Planung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Eintrag für diesen Tag wird dauerhaft entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Abbrechen
            </AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => void handleDelete()}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Wird gelöscht…' : 'Löschen'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
