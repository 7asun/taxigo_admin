'use client';

import * as React from 'react';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { toast } from 'sonner';
import { useBillingTypes } from '../hooks/use-billing-types';
import { cn } from '@/lib/utils';
import type { BillingFamilyWithVariants } from '../types/payer.types';
import {
  BILLING_VARIANT_CODE_HINT,
  pickUniqueBillingVariantCode,
  suggestBillingVariantCode
} from '../lib/billing-variant-code';
import { Badge } from '@/components/ui/badge';
import { BILLING_FAMILY_PRESET_COLORS } from '../lib/billing-family-preset-colors';

const PRESET_COLORS = [...BILLING_FAMILY_PRESET_COLORS];

const formSchema = z.object({
  familyName: z.string().min(2, { message: 'Name der Familie ist zu kurz' }),
  color: z.string(),
  initialVariantName: z
    .string()
    .min(1, { message: 'Unterart-Name erforderlich' })
});

type FormValues = z.infer<typeof formSchema>;

interface AddBillingFamilyDialogProps {
  payerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing families — used to prefer unused preset colors. */
  existingFamilies: BillingFamilyWithVariants[];
}

export function AddBillingFamilyDialog({
  payerId,
  open,
  onOpenChange,
  existingFamilies
}: AddBillingFamilyDialogProps) {
  const { createBillingFamily, isCreatingFamily } = useBillingTypes(payerId);

  const usedColors = new Set(
    existingFamilies.map((f) => f.color.toUpperCase())
  );
  const availableColors = PRESET_COLORS.filter((c) => !usedColors.has(c));
  const defaultColor =
    availableColors.length > 0 ? availableColors[0] : PRESET_COLORS[0];

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      familyName: '',
      color: defaultColor,
      initialVariantName: 'Standard'
    }
  });

  const familyNameWatch = form.watch('familyName');
  const initialVariantNameWatch = form.watch('initialVariantName');

  const previewCode = React.useMemo(() => {
    const base = suggestBillingVariantCode(
      initialVariantNameWatch || 'Standard',
      familyNameWatch || ''
    );
    return pickUniqueBillingVariantCode(base, []);
  }, [familyNameWatch, initialVariantNameWatch]);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      const avail = PRESET_COLORS.filter((c) => !usedColors.has(c));
      form.reset({
        familyName: '',
        color: avail.length > 0 ? avail[0] : PRESET_COLORS[0],
        initialVariantName: 'Standard'
      });
    }
    onOpenChange(newOpen);
  };

  async function onSubmit(data: FormValues) {
    try {
      await createBillingFamily({
        familyName: data.familyName,
        color: data.color,
        initialVariantName: data.initialVariantName.trim()
      });
      toast.success('Abrechnungsfamilie erstellt');
      handleOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error('Fehler beim Erstellen');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => !isCreatingFamily && handleOpenChange(val)}
    >
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>Neue Abrechnungsfamilie</DialogTitle>
          <DialogDescription>
            Familie = bisherige „Abrechnungsart“ mit gemeinsamem Verhalten. Die
            erste Unterart (Variante) ist für Fahrten und CSV sofort nutzbar.
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
                <FormLabel>Name der Familie</FormLabel>
                <FormControl>
                  <Input
                    placeholder='z. B. Dialyse, Labor'
                    {...field}
                    autoFocus
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='initialVariantName'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Erste Unterart (Anzeigename)</FormLabel>
                <FormControl>
                  <Input placeholder='z. B. Standard, KTS' {...field} />
                </FormControl>
                <FormDescription>
                  Sichtbar in Fahrten-Formular und Listen neben dem CSV-Code.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='space-y-1.5'>
            <p className='text-sm font-medium'>CSV-Code (Vorschau)</p>
            <div className='flex items-center gap-2'>
              <Badge
                variant='secondary'
                className='font-mono text-xs tracking-wide uppercase'
              >
                {previewCode}
              </Badge>
            </div>
            <FormDescription>{BILLING_VARIANT_CODE_HINT}</FormDescription>
          </div>

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
                    {PRESET_COLORS.map((color) => {
                      const isSelected = field.value === color;
                      const isUsed = usedColors.has(color);
                      if (isUsed && availableColors.length > 2) return null;
                      return (
                        <button
                          key={color}
                          type='button'
                          onClick={() => field.onChange(color)}
                          className={cn(
                            'flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-all hover:scale-110',
                            isSelected
                              ? 'ring-foreground ring-2 ring-offset-2'
                              : '',
                            isUsed ? 'opacity-40' : ''
                          )}
                          style={{ backgroundColor: color }}
                          title={isUsed ? 'Bereits verwendet' : 'Auswählen'}
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
              disabled={isCreatingFamily}
            >
              Abbrechen
            </Button>
            <Button type='submit' disabled={isCreatingFamily}>
              {isCreatingFamily ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Speichern...
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
