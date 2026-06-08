'use client';

/**
 * Presentational shift time entry — shared by driver and admin wrappers.
 *
 * WHY extracted from ShiftTimeForm: remove auth coupling so admin can target
 * any driver via server actions while reusing the same field logic and validation.
 */

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import * as z from 'zod';

export type ShiftEntryData = {
  date: string;
  startTime: string;
  endTime: string;
  breaks: Array<{ start: string; end: string }>;
  vehicleId?: string | null;
};

export type ShiftEntryExistingShift = {
  startTime: string;
  endTime: string;
  breaks: Array<{ start: string; end: string }>;
  vehicleId?: string | null;
};

export type ShiftEntryVehicle = {
  id: string;
  name: string;
  license_plate?: string;
};

export type ShiftEntryFormProps = {
  defaultDate?: string;
  defaultVehicleId?: string | null;
  existingShift?: ShiftEntryExistingShift | null;
  vehicles?: ShiftEntryVehicle[];
  onSubmit: (data: ShiftEntryData) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitError?: string | null;
  showDateField?: boolean;
  showVehicleField?: boolean;
  /** Admin entry: empty Beginn/Ende when no existingShift. Driver wrapper omits this. */
  blankTimeFields?: boolean;
};

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

type BreakSlot = { start: string; end: string };

export function formatPaidDuration(
  startTime: string,
  endTime: string,
  breaks: BreakSlot[]
): string {
  if (!startTime?.trim() || !endTime?.trim()) return '–';

  const startMin = parseTimeToMinutes(startTime);
  let endMin = parseTimeToMinutes(endTime);
  if (endMin < startMin) endMin += 24 * 60;

  let totalMin = endMin - startMin;
  for (const br of breaks) {
    if (br.start && br.end) {
      const brStart = parseTimeToMinutes(br.start);
      let brEnd = parseTimeToMinutes(br.end);
      if (brEnd < brStart) brEnd += 24 * 60;
      totalMin -= Math.max(0, brEnd - brStart);
    }
  }

  if (totalMin < 0) return '–';
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0) {
    return `${hours} h ${minutes > 0 ? `${minutes} min` : ''}`.trim();
  }
  return `${minutes} min`;
}

const breakSchema = z.object({
  start: z.string(),
  end: z.string()
});

const formSchema = z
  .object({
    date: z.string().min(1, 'Datum ist erforderlich'),
    startTime: z.string().min(1, 'Beginn ist erforderlich'),
    endTime: z.string().min(1, 'Ende ist erforderlich'),
    hasBreak: z.boolean(),
    breaks: z.array(breakSchema),
    vehicleId: z.string().nullable()
  })
  .refine(
    (data) => {
      if (!data.hasBreak) return true;
      const filled = data.breaks.filter((b) => b.start && b.end);
      return filled.length >= 1;
    },
    {
      message: 'Mindestens eine Pause mit von und bis angeben.',
      path: ['breaks']
    }
  )
  .refine(
    (data) => {
      const start = parseTimeToMinutes(data.startTime);
      let end = parseTimeToMinutes(data.endTime);
      if (end < start) end += 24 * 60;
      return end > start;
    },
    { message: 'Ende muss nach Beginn liegen.', path: ['endTime'] }
  )
  .refine(
    (data) => {
      if (!data.hasBreak) return true;
      const start = parseTimeToMinutes(data.startTime);
      const end = parseTimeToMinutes(data.endTime);
      for (const br of data.breaks) {
        if (!br.start || !br.end) continue;
        const brStart = parseTimeToMinutes(br.start);
        const brEnd = parseTimeToMinutes(br.end);
        if (brStart >= brEnd || brStart < start || brEnd > end) return false;
      }
      return true;
    },
    {
      message: 'Jede Pause muss innerhalb der Schicht liegen (von vor bis).',
      path: ['breaks']
    }
  );

type FormValues = z.infer<typeof formSchema>;

function buildDefaultValues(
  defaultDate?: string,
  defaultVehicleId?: string | null,
  existingShift?: ShiftEntryExistingShift | null,
  blankTimeFields?: boolean
): FormValues {
  const hasBreaks = (existingShift?.breaks?.length ?? 0) > 0;
  return {
    date: defaultDate ?? todayYmdInBusinessTz(),
    startTime: existingShift?.startTime ?? (blankTimeFields ? '' : '08:00'),
    endTime: existingShift?.endTime ?? (blankTimeFields ? '' : '17:00'),
    hasBreak: hasBreaks,
    breaks:
      hasBreaks && existingShift?.breaks?.length
        ? existingShift.breaks
        : blankTimeFields
          ? []
          : [{ start: '', end: '' }],
    vehicleId: existingShift?.vehicleId ?? defaultVehicleId ?? null
  };
}

export function ShiftEntryForm({
  defaultDate,
  defaultVehicleId,
  existingShift,
  vehicles,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitError,
  showDateField = true,
  showVehicleField = false,
  blankTimeFields = false
}: ShiftEntryFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: buildDefaultValues(
      defaultDate,
      defaultVehicleId,
      existingShift,
      blankTimeFields
    )
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'breaks'
  });

  const watchedStart = form.watch('startTime');
  const watchedEnd = form.watch('endTime');
  const watchedBreaks = form.watch('breaks');
  const watchedHasBreak = form.watch('hasBreak');

  const paidDisplay = formatPaidDuration(
    watchedStart,
    watchedEnd,
    watchedHasBreak ? (watchedBreaks ?? []) : []
  );

  useEffect(() => {
    form.reset(
      buildDefaultValues(
        defaultDate,
        defaultVehicleId,
        existingShift,
        blankTimeFields
      )
    );
  }, [defaultDate, defaultVehicleId, existingShift, blankTimeFields, form]);

  const handleSubmit = form.handleSubmit(async (values) => {
    const breaksToSave =
      values.hasBreak && values.breaks?.length
        ? values.breaks.filter((b) => b.start && b.end)
        : [];

    await onSubmit({
      date: values.date,
      startTime: values.startTime,
      endTime: values.endTime,
      breaks: breaksToSave,
      vehicleId: values.vehicleId || null
    });
  });

  return (
    <Form form={form} onSubmit={handleSubmit}>
      <div className='space-y-6'>
        <div className='bg-muted/50 flex flex-col items-center justify-center rounded-lg border py-4'>
          <p className='text-muted-foreground text-sm'>Bezahlte Zeit</p>
          <p
            className={cn(
              'font-mono text-2xl font-semibold tabular-nums',
              paidDisplay === '–' && 'text-destructive'
            )}
          >
            {paidDisplay}
          </p>
        </div>

        {showDateField && (
          <FormField
            control={form.control}
            name='date'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Datum</FormLabel>
                <FormControl>
                  <Input type='date' {...field} className='h-11 text-base' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {!showDateField && (
          <FormField
            control={form.control}
            name='date'
            render={({ field }) => <input type='hidden' {...field} />}
          />
        )}

        <FormField
          control={form.control}
          name='startTime'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Beginn</FormLabel>
              <FormControl>
                <Input type='time' {...field} className='h-11 text-base' />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className='flex items-center justify-between rounded-lg border p-4'>
          <div className='space-y-0.5'>
            <Label htmlFor='hasBreak'>Pause eingeben</Label>
            <p className='text-muted-foreground text-sm'>
              Mittagspause oder Kurzpause abziehen
            </p>
          </div>
          <FormField
            control={form.control}
            name='hasBreak'
            render={({ field }) => (
              <FormControl>
                <Switch
                  id='hasBreak'
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    if (checked && form.getValues('breaks').length === 0) {
                      append({ start: '', end: '' });
                    }
                  }}
                />
              </FormControl>
            )}
          />
        </div>

        {watchedHasBreak && (
          <div className='bg-muted/20 space-y-4 rounded-lg border p-4'>
            <div className='flex items-center justify-between'>
              <p className='text-muted-foreground text-sm'>
                Pausen abziehen (Mittag, Kurzpause, Tanken…)
              </p>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => append({ start: '', end: '' })}
                className='shrink-0'
              >
                <IconPlus className='mr-1 h-4 w-4' />
                Weitere Pause
              </Button>
            </div>
            {fields.map((field, index) => (
              <div
                key={field.id}
                className='bg-background flex flex-col gap-3 rounded-md border p-3'
              >
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground text-sm'>
                    {fields.length > 1 ? `Pause ${index + 1}` : 'Pause'}
                  </span>
                  {fields.length > 1 && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      onClick={() => remove(index)}
                      aria-label='Pause entfernen'
                      className='text-muted-foreground hover:text-destructive h-8 w-8'
                    >
                      <IconTrash className='h-4 w-4' />
                    </Button>
                  )}
                </div>
                <div className='grid grid-cols-2 gap-3'>
                  <FormField
                    control={form.control}
                    name={`breaks.${index}.start`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel>Von</FormLabel>
                        <FormControl>
                          <Input
                            type='time'
                            {...f}
                            value={f.value ?? ''}
                            className='h-11 text-base'
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`breaks.${index}.end`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel>Bis</FormLabel>
                        <FormControl>
                          <Input
                            type='time'
                            {...f}
                            value={f.value ?? ''}
                            className='h-11 text-base'
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ))}
            {form.formState.errors.breaks && (
              <p className='text-destructive text-sm'>
                {form.formState.errors.breaks.message}
              </p>
            )}
          </div>
        )}

        <FormField
          control={form.control}
          name='endTime'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ende</FormLabel>
              <FormControl>
                <Input type='time' {...field} className='h-11 text-base' />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {showVehicleField && vehicles && vehicles.length > 0 && (
          <FormField
            control={form.control}
            name='vehicleId'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fahrzeug (optional)</FormLabel>
                <Select
                  value={field.value ?? '__none__'}
                  onValueChange={(v) =>
                    field.onChange(v === '__none__' ? null : v)
                  }
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder='Kein Fahrzeug' />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value='__none__'>Kein Fahrzeug</SelectItem>
                    {vehicles.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.license_plate
                          ? `${v.name} (${v.license_plate})`
                          : v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
        )}

        {submitError && (
          <p className='text-destructive text-sm' role='alert'>
            {submitError}
          </p>
        )}

        <div className='flex flex-wrap items-center justify-end gap-2'>
          {onCancel && (
            <Button
              type='button'
              variant='outline'
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Abbrechen
            </Button>
          )}
          <Button
            type='submit'
            className='flex-1'
            size='lg'
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Wird gespeichert…' : 'Schicht speichern'}
          </Button>
        </div>
      </div>
    </Form>
  );
}
