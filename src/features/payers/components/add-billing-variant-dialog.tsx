'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
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
import {
  BILLING_VARIANT_CODE_HINT,
  isValidBillingVariantCode,
  normalizeBillingVariantCodeInput
} from '../lib/billing-variant-code';

const formSchema = z.object({
  name: z.string().min(1, { message: 'Name erforderlich' }),
  code: z
    .string()
    .min(1, { message: 'CSV-Code erforderlich' })
    .refine(
      (v) => isValidBillingVariantCode(normalizeBillingVariantCodeInput(v)),
      {
        message: BILLING_VARIANT_CODE_HINT
      }
    )
});

type FormValues = z.infer<typeof formSchema>;

interface AddBillingVariantDialogProps {
  payerId: string;
  familyId: string;
  familyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Next sort_order = max existing + 1 (optional; 0 is fine for MVP). */
  nextSortOrder?: number;
}

export function AddBillingVariantDialog({
  payerId,
  familyId,
  familyName,
  open,
  onOpenChange,
  nextSortOrder = 0
}: AddBillingVariantDialogProps) {
  const { createBillingVariant, isCreatingVariant } = useBillingTypes(payerId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', code: '' }
  });

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) form.reset({ name: '', code: '' });
    onOpenChange(newOpen);
  };

  async function onSubmit(data: FormValues) {
    try {
      await createBillingVariant({
        familyId,
        name: data.name.trim(),
        code: normalizeBillingVariantCodeInput(data.code),
        sortOrder: nextSortOrder
      });
      toast.success('Unterart erstellt');
      handleOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error('Fehler beim Erstellen der Unterart');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => !isCreatingVariant && handleOpenChange(val)}
    >
      <DialogContent className='sm:max-w-[400px]'>
        <DialogHeader>
          <DialogTitle>Neue Unterart</DialogTitle>
          <DialogDescription>
            Familie:{' '}
            <span className='text-foreground font-medium'>{familyName}</span>.
            Code für CSV-Spalte{' '}
            <code className='text-xs'>abrechnungsvariante</code>.
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
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Anzeigename</FormLabel>
                <FormControl>
                  <Input placeholder='z. B. KTS, Reha' {...field} autoFocus />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='code'
            render={({ field }) => (
              <FormItem>
                <FormLabel>CSV-Code</FormLabel>
                <FormControl>
                  <Input
                    placeholder='z. B. KTS'
                    className='font-mono uppercase'
                    {...field}
                    onChange={(e) =>
                      field.onChange(
                        normalizeBillingVariantCodeInput(e.target.value)
                      )
                    }
                  />
                </FormControl>
                <FormDescription>{BILLING_VARIANT_CODE_HINT}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => handleOpenChange(false)}
              disabled={isCreatingVariant}
            >
              Abbrechen
            </Button>
            <Button type='submit' disabled={isCreatingVariant}>
              {isCreatingVariant ? (
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
