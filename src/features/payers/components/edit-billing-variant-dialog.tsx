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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { BillingVariant } from '../types/payer.types';
import {
  BILLING_VARIANT_CODE_HINT,
  pickUniqueBillingVariantCode,
  suggestBillingVariantCode
} from '../lib/billing-variant-code';
import { Badge } from '@/components/ui/badge';

const formSchema = z.object({
  name: z.string().min(1, { message: 'Name erforderlich' }),
  kts_variant: z.enum(['unset', 'yes', 'no']),
  no_invoice_variant: z.enum(['unset', 'yes', 'no'])
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
    defaultValues: {
      name: '',
      kts_variant: 'unset',
      no_invoice_variant: 'unset'
    }
  });

  useEffect(() => {
    if (open && variant) {
      form.reset({
        name: variant.name,
        kts_variant:
          variant.kts_default === true
            ? 'yes'
            : variant.kts_default === false
              ? 'no'
              : 'unset',
        no_invoice_variant:
          variant.no_invoice_required_default === true
            ? 'yes'
            : variant.no_invoice_required_default === false
              ? 'no'
              : 'unset'
      });
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
        code,
        kts_default:
          data.kts_variant === 'unset'
            ? null
            : data.kts_variant === 'yes'
              ? true
              : false,
        no_invoice_required_default:
          data.no_invoice_variant === 'unset'
            ? null
            : data.no_invoice_variant === 'yes'
              ? true
              : false
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
          <FormField
            control={form.control}
            name='kts_variant'
            render={({ field }) => (
              <FormItem>
                <FormLabel>KTS-Standard (Unterart)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value='unset'>
                      Nicht festlegen (Familie / Kostenträger)
                    </SelectItem>
                    <SelectItem value='yes'>Ja</SelectItem>
                    <SelectItem value='no'>Nein</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  Stärkster Katalog-Level für die KTS-Voreinstellung.
                </FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='no_invoice_variant'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Keine Rechnung (Unterart)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value='unset'>
                      Nicht festlegen (Familie / Kostenträger)
                    </SelectItem>
                    <SelectItem value='yes'>Ja</SelectItem>
                    <SelectItem value='no'>Nein</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  Stärkster Katalog-Level für „Keine Rechnung“.
                </FormDescription>
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
