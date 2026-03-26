'use client';

import * as React from 'react';
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
  pickUniqueBillingVariantCode,
  suggestBillingVariantCode
} from '../lib/billing-variant-code';
import { Badge } from '@/components/ui/badge';

const formSchema = z.object({
  name: z.string().min(1, { message: 'Name erforderlich' })
});

type FormValues = z.infer<typeof formSchema>;

interface EditBillingVariantDialogProps {
  payerId: string;
  familyName: string;
  variant: BillingVariant | null;
  /** Other variants’ codes in the same family (excludes the row being edited). */
  peerVariantCodes: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditBillingVariantDialog({
  payerId,
  familyName,
  variant,
  peerVariantCodes,
  open,
  onOpenChange
}: EditBillingVariantDialogProps) {
  const { updateBillingVariant, isUpdatingVariant } = useBillingTypes(payerId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '' }
  });

  useEffect(() => {
    if (open && variant) {
      form.reset({ name: variant.name });
    }
  }, [open, variant, form]);

  const nameWatch = form.watch('name');

  const resolvedCode = React.useMemo(() => {
    if (!variant) return '';
    if (nameWatch.trim() === variant.name.trim()) return variant.code;
    // Peers only — this row’s current code is released when picking a new one on save.
    return pickUniqueBillingVariantCode(
      suggestBillingVariantCode(nameWatch, familyName),
      peerVariantCodes
    );
  }, [nameWatch, familyName, variant, peerVariantCodes]);

  async function onSubmit(data: FormValues) {
    if (!variant) return;
    try {
      const code =
        data.name.trim() === variant.name.trim()
          ? variant.code
          : pickUniqueBillingVariantCode(
              suggestBillingVariantCode(data.name.trim(), familyName),
              peerVariantCodes
            );
      await updateBillingVariant({
        variantId: variant.id,
        name: data.name.trim(),
        code
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
            Der CSV-Code passt sich an, wenn Sie den Anzeigenamen ändern.
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
          <div className='space-y-1.5'>
            <p className='text-sm font-medium'>CSV-Code</p>
            <Badge
              variant='secondary'
              className='font-mono text-xs tracking-wide uppercase'
            >
              {resolvedCode}
            </Badge>
            <FormDescription>{BILLING_VARIANT_CODE_HINT}</FormDescription>
          </div>
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
