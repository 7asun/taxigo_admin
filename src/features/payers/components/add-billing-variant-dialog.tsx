'use client';

import * as React from 'react';
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

interface AddBillingVariantDialogProps {
  payerId: string;
  familyId: string;
  familyName: string;
  /** Codes already used in this family — avoids duplicate CSV keys. */
  existingVariantCodes: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Next sort_order = max existing + 1 (optional; 0 is fine for MVP). */
  nextSortOrder?: number;
}

export function AddBillingVariantDialog({
  payerId,
  familyId,
  familyName,
  existingVariantCodes,
  open,
  onOpenChange,
  nextSortOrder = 0
}: AddBillingVariantDialogProps) {
  const { createBillingVariant, isCreatingVariant } = useBillingTypes(payerId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      kts_variant: 'unset',
      no_invoice_variant: 'unset'
    }
  });

  const nameWatch = form.watch('name');

  const previewCode = React.useMemo(() => {
    const base = suggestBillingVariantCode(nameWatch || '', familyName);
    return pickUniqueBillingVariantCode(base, existingVariantCodes);
  }, [nameWatch, familyName, existingVariantCodes]);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen)
      form.reset({
        name: '',
        kts_variant: 'unset',
        no_invoice_variant: 'unset'
      });
    onOpenChange(newOpen);
  };

  async function onSubmit(data: FormValues) {
    try {
      await createBillingVariant({
        familyId,
        name: data.name.trim(),
        sortOrder: nextSortOrder,
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
            CSV-Code wird aus dem Anzeigenamen (sonst aus der Familie) erzeugt.
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
                  Überschreibt die Abrechnungsfamilie für die
                  KTS-Voreinstellung.
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
                  Überschreibt die Familie für „Keine Rechnung“-Voreinstellung.
                </FormDescription>
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
              <span className='text-muted-foreground text-xs'>
                Spalte <code className='text-[10px]'>abrechnungsvariante</code>
              </span>
            </div>
            <FormDescription>{BILLING_VARIANT_CODE_HINT}</FormDescription>
          </div>
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
