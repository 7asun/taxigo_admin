'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { toast } from 'sonner';
import { useBillingTypes } from '../hooks/use-billing-types';
import { cn } from '@/lib/utils';
import type { BillingFamilyWithVariants } from '../types/payer.types';
import { BILLING_FAMILY_PRESET_COLORS } from '../lib/billing-family-preset-colors';

const formSchema = z.object({
  familyName: z.string().min(2, { message: 'Name der Familie ist zu kurz' }),
  color: z.string()
});

type FormValues = z.infer<typeof formSchema>;

interface EditBillingFamilyDialogProps {
  payerId: string;
  family: BillingFamilyWithVariants | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditBillingFamilyDialog({
  payerId,
  family,
  open,
  onOpenChange
}: EditBillingFamilyDialogProps) {
  const { updateBillingFamily, isUpdatingFamily } = useBillingTypes(payerId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { familyName: '', color: BILLING_FAMILY_PRESET_COLORS[0] }
  });

  useEffect(() => {
    if (open && family) {
      form.reset({ familyName: family.name, color: family.color });
    }
  }, [open, family, form]);

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
  };

  async function onSubmit(data: FormValues) {
    if (!family) return;
    try {
      await updateBillingFamily({
        familyId: family.id,
        name: data.familyName,
        color: data.color
      });
      toast.success('Familie aktualisiert');
      handleOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Fehler beim Speichern'
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => !isUpdatingFamily && handleOpenChange(val)}
    >
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>Abrechnungsfamilie bearbeiten</DialogTitle>
          <DialogDescription>
            Name und Farbe; Verhalten ändern Sie über das Zahnrad-Symbol.
          </DialogDescription>
        </DialogHeader>
        <Form
          {...form}
          form={form as any}
          onSubmit={form.handleSubmit(onSubmit)}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='familyName'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} autoFocus />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='color'
            render={({ field }) => (
              <FormItem>
                <div className='mb-2 flex items-center gap-2'>
                  <FormLabel className='mb-0'>Farbe</FormLabel>
                  <div
                    className='h-5 w-5 rounded-full shadow-sm ring-2 ring-transparent ring-offset-2'
                    style={{ backgroundColor: field.value }}
                  />
                </div>
                <FormControl>
                  <div className='flex flex-wrap gap-3'>
                    {BILLING_FAMILY_PRESET_COLORS.map((color) => {
                      const isSelected = field.value === color;
                      return (
                        <button
                          key={color}
                          type='button'
                          onClick={() => field.onChange(color)}
                          className={cn(
                            'flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-all hover:scale-110',
                            isSelected
                              ? 'ring-foreground ring-2 ring-offset-2'
                              : ''
                          )}
                          style={{ backgroundColor: color }}
                        >
                          {isSelected && (
                            <Check className='h-5 w-5 text-white' />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <DialogFooter className='pt-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => handleOpenChange(false)}
              disabled={isUpdatingFamily}
            >
              Abbrechen
            </Button>
            <Button type='submit' disabled={isUpdatingFamily}>
              {isUpdatingFamily ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Speichern…
                </>
              ) : (
                'Speichern'
              )}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
