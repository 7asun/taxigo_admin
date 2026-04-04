'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Check, CircleDollarSign } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useBillingTypes } from '../hooks/use-billing-types';
import { cn } from '@/lib/utils';
import type { BillingFamilyWithVariants } from '../types/payer.types';
import { BILLING_FAMILY_PRESET_COLORS } from '../lib/billing-family-preset-colors';
import { useRechnungsempfaengerOptions } from '@/features/rechnungsempfaenger/hooks/use-rechnungsempfaenger-options';
import type { PricingStrategy } from '@/features/invoices/types/pricing.types';
import { useBillingPricingRules } from '../hooks/use-billing-pricing-rules';
import {
  PricingRuleDialog,
  PRICING_STRATEGY_LABELS_DE
} from './pricing-rule-dialog';
import { PricingRuleDeleteButton } from './pricing-rule-delete-button';
import type { BillingPricingRuleRow } from '../api/billing-pricing-rules.api';

const formSchema = z.object({
  familyName: z.string().min(2, { message: 'Name der Familie ist zu kurz' }),
  color: z.string(),
  rechnungsempfaenger_id: z.string().optional()
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
  const { data: recipients = [] } = useRechnungsempfaengerOptions();
  const {
    data: pricingRules = [],
    refetch: refetchPricing,
    deleteRule,
    isDeleting: isDeletingRule
  } = useBillingPricingRules(open && family ? payerId : null);

  const [pricingOpen, setPricingOpen] = useState(false);

  const familyPricingRule = useMemo((): BillingPricingRuleRow | null => {
    if (!family) return null;
    return (
      pricingRules.find(
        (r) => r.billing_type_id === family.id && r.billing_variant_id == null
      ) ?? null
    );
  }, [family, pricingRules]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      familyName: '',
      color: BILLING_FAMILY_PRESET_COLORS[0],
      rechnungsempfaenger_id: ''
    }
  });

  useEffect(() => {
    if (open && family) {
      form.reset({
        familyName: family.name,
        color: family.color,
        rechnungsempfaenger_id: family.rechnungsempfaenger_id ?? ''
      });
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
        color: data.color,
        rechnungsempfaenger_id:
          data.rechnungsempfaenger_id && data.rechnungsempfaenger_id.length > 0
            ? data.rechnungsempfaenger_id
            : null
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
    <>
      <Dialog
        open={open}
        onOpenChange={(val) => !isUpdatingFamily && handleOpenChange(val)}
      >
        <DialogContent className='flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[440px]'>
          <DialogHeader className='shrink-0 border-b px-6 pt-6 pr-14 pb-4'>
            <DialogTitle>Abrechnungsfamilie bearbeiten</DialogTitle>
            <DialogDescription>
              Name und Farbe; Verhalten ändern Sie über das Zahnrad-Symbol.
            </DialogDescription>
          </DialogHeader>
          <Form
            {...form}
            form={form as any}
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex min-h-0 flex-1 flex-col'
          >
            <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4'>
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
                name='rechnungsempfaenger_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rechnungsempfänger (optional)</FormLabel>
                    <Select
                      value={
                        field.value && field.value.length > 0
                          ? field.value
                          : '__none__'
                      }
                      onValueChange={(v) =>
                        field.onChange(v === '__none__' ? '' : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Keiner' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='__none__'>Keiner</SelectItem>
                        {recipients.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {family ? (
                <div className='bg-muted/40 space-y-2 rounded-lg border p-3'>
                  <p className='text-sm font-medium'>
                    Preisregel (Abrechnungsfamilie)
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {familyPricingRule ? (
                      <>
                        Aktiv:{' '}
                        <span className='text-foreground font-medium'>
                          {PRICING_STRATEGY_LABELS_DE[
                            familyPricingRule.strategy as PricingStrategy
                          ] ?? familyPricingRule.strategy}
                        </span>
                      </>
                    ) : (
                      'Keine Regel — es gilt die Kostenträger-Regel bzw. Fahrt/Preis-Tag.'
                    )}
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className='gap-1'
                      onClick={() => setPricingOpen(true)}
                    >
                      <CircleDollarSign className='h-3.5 w-3.5' />
                      {familyPricingRule
                        ? 'Preisregel bearbeiten'
                        : 'Preisregel anlegen'}
                    </Button>
                    {familyPricingRule ? (
                      <PricingRuleDeleteButton
                        rule={familyPricingRule}
                        deleteRule={deleteRule}
                        isDeleting={isDeletingRule}
                        onDeleted={() => setPricingOpen(false)}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}

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
            </div>
            <DialogFooter className='bg-background shrink-0 border-t px-6 py-4'>
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

      {family ? (
        <PricingRuleDialog
          open={pricingOpen}
          onOpenChange={setPricingOpen}
          scope={{
            kind: 'billing_type',
            payerId,
            billingTypeId: family.id
          }}
          editing={familyPricingRule}
          onSaved={() => void refetchPricing()}
        />
      ) : null}
    </>
  );
}
