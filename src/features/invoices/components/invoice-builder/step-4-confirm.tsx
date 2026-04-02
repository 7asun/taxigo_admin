'use client';

/**
 * step-4-confirm.tsx
 *
 * Invoice builder — Step 4: Confirmation and creation.
 *
 * Shows a summary of what will be created:
 *   - Invoice number preview (RE-YYYY-MM-NNNN — shown as "wird automatisch vergeben")
 *   - Totals recap (Netto / MwSt / Brutto)
 *   - Editable: Notes (Notizen) + Zahlungsziel (payment days override)
 *   - Warning if prices are missing (non-blocking)
 *   - "Rechnung erstellen" button (disabled while saving)
 */

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, AlertTriangle, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Form,
  FormControl,
  FormDescription,
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
import { useAllInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';

/** Step 4 local schema — only the invoice meta fields. */
const step4Schema = z.object({
  intro_block_id: z.string().optional(),
  outro_block_id: z.string().optional(),
  payment_due_days: z
    .number({ message: 'Bitte eine Zahl eingeben' })
    .int()
    .min(1, 'Mindestens 1 Tag')
    .max(90, 'Maximal 90 Tage')
});

type Step4Values = z.infer<typeof step4Schema>;

/** Euro formatter for Germany locale. */
const formatEur = (v: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
    v
  );

interface Step4ConfirmProps {
  subtotal: number;
  taxAmount: number;
  total: number;
  lineItemCount: number;
  /** Default from company_profiles.default_payment_days */
  defaultPaymentDays: number;
  missingPrices: boolean;
  isCreating: boolean;
  onBack: () => void;
  onConfirm: (values: Step4Values) => void;
  /** Payer's default intro block (pre-selected if exists) */
  payerIntroBlockId?: string | null;
  /** Payer's default outro block (pre-selected if exists) */
  payerOutroBlockId?: string | null;
}

/**
 * Step 4: Summary display + notes/payment days form + create button.
 */
export function Step4Confirm({
  subtotal,
  taxAmount,
  total,
  lineItemCount,
  defaultPaymentDays,
  missingPrices,
  isCreating,
  onBack,
  onConfirm,
  payerIntroBlockId,
  payerOutroBlockId
}: Step4ConfirmProps) {
  const { data: textBlocks, isLoading: isLoadingTextBlocks } =
    useAllInvoiceTextBlocks();

  const form = useForm<Step4Values>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(step4Schema) as any,
    defaultValues: {
      intro_block_id: payerIntroBlockId || 'none',
      outro_block_id: payerOutroBlockId || 'none',
      payment_due_days: defaultPaymentDays
    }
  });

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-lg font-semibold'>Rechnung bestätigen</h2>
        <p className='text-muted-foreground text-sm'>
          Prüfen Sie die Zusammenfassung und erstellen Sie die Rechnung.
        </p>
      </div>

      {/* Advisory warning if prices are missing */}
      {missingPrices && (
        <Alert>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription>
            Einige Positionen haben keinen Preis (werden als 0,00 €
            gespeichert). Die Rechnung kann trotzdem erstellt werden.
          </AlertDescription>
        </Alert>
      )}

      {/* Totals summary (read-only) */}
      <div className='bg-muted/50 space-y-2 rounded-lg p-4'>
        <div className='flex justify-between text-sm'>
          <span className='text-muted-foreground'>
            {lineItemCount} Positionen · Netto
          </span>
          <span>{formatEur(subtotal)}</span>
        </div>
        <div className='flex justify-between text-sm'>
          <span className='text-muted-foreground'>MwSt.</span>
          <span>{formatEur(taxAmount)}</span>
        </div>
        <Separator />
        <div className='flex justify-between font-bold'>
          <span>Gesamtbetrag</span>
          <span>{formatEur(total)}</span>
        </div>
      </div>

      {/* Invoice number info */}
      <div className='bg-card border-border rounded-lg border px-4 py-3'>
        <p className='text-muted-foreground text-xs'>Rechnungsnummer</p>
        <p className='text-sm font-medium'>
          {`Wird automatisch vergeben (RE-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-XXXX)`}
        </p>
      </div>

      {/* Editable meta fields */}
      <Form
        form={form}
        onSubmit={form.handleSubmit(onConfirm)}
        className='space-y-4'
      >
        {/* Payment days override */}
        <FormField
          control={form.control}
          name='payment_due_days'
          render={({ field }) => (
            <FormItem className='max-w-xs'>
              <FormLabel>Zahlungsziel (Tage)</FormLabel>
              <FormControl>
                <Input
                  type='number'
                  min={1}
                  max={90}
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Standard: {defaultPaymentDays} Tage (aus
                Unternehmenseinstellungen)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Rechnungsvorlagen */}
        <div className='space-y-4'>
          <h3 className='text-sm font-medium'>Rechnungsvorlagen</h3>

          {/* Intro Block */}
          <FormField
            control={form.control}
            name='intro_block_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel className='flex items-center gap-2'>
                  <FileText className='h-4 w-4' />
                  Einleitung
                </FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isLoadingTextBlocks || isCreating}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue placeholder='Vorlage wählen' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='none'>Keine Vorlage</SelectItem>
                      {textBlocks
                        ?.filter((b) => b.type === 'intro')
                        .map((block) => (
                          <SelectItem key={block.id} value={block.id}>
                            {block.name}
                            {block.is_default ? ' (Standard)' : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormDescription>
                  Wird als Einleitung im Rechnungstext verwendet.
                </FormDescription>
              </FormItem>
            )}
          />

          {/* Outro Block */}
          <FormField
            control={form.control}
            name='outro_block_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel className='flex items-center gap-2'>
                  <FileText className='h-4 w-4' />
                  Schlussformel
                </FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isLoadingTextBlocks || isCreating}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue placeholder='Vorlage wählen' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='none'>Keine Vorlage</SelectItem>
                      {textBlocks
                        ?.filter((b) => b.type === 'outro')
                        .map((block) => (
                          <SelectItem key={block.id} value={block.id}>
                            {block.name}
                            {block.is_default ? ' (Standard)' : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormDescription>
                  Wird als Schlussformel im Rechnungstext verwendet.
                </FormDescription>
              </FormItem>
            )}
          />
        </div>

        {/* Navigation */}
        <div className='flex justify-between pt-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={onBack}
            className='gap-2'
          >
            <ArrowLeft className='h-4 w-4' />
            Zurück
          </Button>
          <Button type='submit' disabled={isCreating} className='gap-2'>
            {isCreating ? 'Erstelle Rechnung…' : 'Rechnung erstellen'}
          </Button>
        </div>
      </Form>
    </div>
  );
}
