'use client';

import { useEffect } from 'react';
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
import type { BillingVariant } from '../types/payer.types';
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

interface EditBillingVariantDialogProps {
  payerId: string;
  familyName: string;
  variant: BillingVariant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditBillingVariantDialog({
  payerId,
  familyName,
  variant,
  open,
  onOpenChange
}: EditBillingVariantDialogProps) {
  const { updateBillingVariant, isUpdatingVariant } = useBillingTypes(payerId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', code: '' }
  });

  useEffect(() => {
    if (open && variant) {
      form.reset({ name: variant.name, code: variant.code });
    }
  }, [open, variant, form]);

  async function onSubmit(data: FormValues) {
    if (!variant) return;
    try {
      await updateBillingVariant({
        variantId: variant.id,
        name: data.name.trim(),
        code: normalizeBillingVariantCodeInput(data.code)
      });
      toast.success('Unterart aktualisiert');
      onOpenChange(false);
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
      onOpenChange={(val) => !isUpdatingVariant && onOpenChange(val)}
    >
      <DialogContent className='sm:max-w-[400px]'>
        <DialogHeader>
          <DialogTitle>Unterart bearbeiten</DialogTitle>
          <DialogDescription>
            Familie:{' '}
            <span className='text-foreground font-medium'>{familyName}</span>.
            Code-Änderung wirkt auf künftige CSV-Imports; bestehende Fahrten
            behalten die Varianten-Zeile.
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
                  <Input {...field} autoFocus />
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
              onClick={() => onOpenChange(false)}
              disabled={isUpdatingVariant}
            >
              Abbrechen
            </Button>
            <Button type='submit' disabled={isUpdatingVariant}>
              {isUpdatingVariant ? (
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
