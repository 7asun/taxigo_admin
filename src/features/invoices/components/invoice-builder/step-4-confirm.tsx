'use client';

/**
 * step-4-confirm.tsx
 *
 * Invoice builder — Section 5 (Bestätigung): meta fields, recap, and submit.
 *
 * Renders inside the shell’s fifth BuilderSectionCard; the primary submit control
 * may live in the card footer (hideSubmitButton) while the form id stays
 * invoice-step4-form for accessibility.
 *
 * PDF preview is driven by the parent hook; this step emits overlay state so
 * intro/outro/payment/recipient edits reflect in the live preview when enabled.
 */

import { useEffect, useMemo } from 'react';
import { useForm, useWatch, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, FileText, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
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
import { useRechnungsempfaengerOptions } from '@/features/rechnungsempfaenger/hooks/use-rechnungsempfaenger-options';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  PRICE_RESOLUTION_SOURCE_LABELS_DE,
  pricingStrategyUsedLabelDe
} from '@/features/invoices/lib/pricing-strategy-labels-de';
import { lineItemNetAmountForDisplay } from '@/features/invoices/lib/line-item-net-display';
import type { InvoiceBuilderStep4PdfOverlay } from './use-invoice-builder-pdf-preview';
import type { BuilderLineItem } from '../../types/invoice.types';

/** Step 4 local schema — only the invoice meta fields. */
const step4Schema = z.object({
  intro_block_id: z.string().optional(),
  outro_block_id: z.string().optional(),
  payment_due_days: z
    .number({ message: 'Bitte eine Zahl eingeben' })
    .int()
    .min(1, 'Mindestens 1 Tag')
    .max(90, 'Maximal 90 Tage'),
  /** `'none'` = Katalog (erste Fahrt); sonst UUID des Rechnungsempfängers */
  rechnungsempfaenger_id: z.string().optional()
});

type Step4Values = z.infer<typeof step4Schema>;

/** Euro formatter for Germany locale. */
const formatEur = (v: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
    v
  );

function formatRecipientFullAddress(row: {
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
}): string {
  const line1 = [row.address_line1, row.address_line2]
    .filter(Boolean)
    .join(', ');
  const loc = [row.postal_code, row.city].filter(Boolean).join(' ');
  const parts = [line1, loc, row.country].filter(
    (x) => x && String(x).trim().length > 0
  );
  return parts.join(' · ');
}

interface Step4ConfirmProps {
  subtotal: number;
  taxAmount: number;
  total: number;
  lineItemCount: number;
  /** Default from company_profiles.default_payment_days */
  defaultPaymentDays: number;
  missingPrices: boolean;
  isCreating: boolean;
  onConfirm: (values: Step4Values) => void;
  /** Payer's default intro block (pre-selected if exists) */
  payerIntroBlockId?: string | null;
  /** Payer's default outro block (pre-selected if exists) */
  payerOutroBlockId?: string | null;
  /** Katalog-Auflösung (Variante → Familie → Kostenträger) aus der ersten geladenen Fahrt */
  defaultRechnungsempfaengerId?: string | null;
  /** Gleiche ID wie Katalog-Default — für „Manuell überschrieben“ */
  catalogRecipientId?: string | null;
  lineItems: BuilderLineItem[];
  /** Syncs watched fields to the shell PDF preview. */
  onStep4PdfOverlayChange?: (overlay: InvoiceBuilderStep4PdfOverlay) => void;
  /** When false, overlay is not pushed (e.g. Bestätigung section not open). */
  pdfOverlayEnabled?: boolean;
  /** Disable primary action while section is locked or other guard fails. */
  submitDisabled?: boolean;
  /** When true, the submit button is omitted (e.g. submit lives in Step 5). */
  hideSubmitButton?: boolean;
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
  onConfirm,
  payerIntroBlockId,
  payerOutroBlockId,
  defaultRechnungsempfaengerId,
  catalogRecipientId = defaultRechnungsempfaengerId ?? null,
  lineItems,
  onStep4PdfOverlayChange,
  pdfOverlayEnabled = true,
  submitDisabled = false,
  hideSubmitButton = false
}: Step4ConfirmProps) {
  const { data: textBlocks, isLoading: isLoadingTextBlocks } =
    useAllInvoiceTextBlocks();
  const { data: empfaengerOptions, isLoading: isLoadingEmpfaenger } =
    useRechnungsempfaengerOptions();

  const form = useForm<Step4Values>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(step4Schema) as any,
    defaultValues: {
      intro_block_id: payerIntroBlockId || 'none',
      outro_block_id: payerOutroBlockId || 'none',
      payment_due_days: defaultPaymentDays,
      rechnungsempfaenger_id:
        defaultRechnungsempfaengerId != null &&
        defaultRechnungsempfaengerId.length > 0
          ? defaultRechnungsempfaengerId
          : 'none'
    }
  });

  const empSelectRaw = useWatch({
    control: form.control,
    name: 'rechnungsempfaenger_id'
  });

  const paymentDaysWatched = useWatch({
    control: form.control,
    name: 'payment_due_days'
  });

  const introIdW = useWatch({
    control: form.control,
    name: 'intro_block_id'
  });

  const outroIdW = useWatch({
    control: form.control,
    name: 'outro_block_id'
  });

  const effectiveRecipientId =
    empSelectRaw === 'none' || empSelectRaw === undefined || empSelectRaw === ''
      ? catalogRecipientId
      : empSelectRaw;

  const effectiveRow = (empfaengerOptions ?? []).find(
    (r) => r.id === effectiveRecipientId
  );

  const isManualOverride =
    typeof empSelectRaw === 'string' &&
    empSelectRaw !== 'none' &&
    empSelectRaw.length > 0 &&
    (catalogRecipientId == null || empSelectRaw !== catalogRecipientId);

  const paymentDueResolved =
    typeof paymentDaysWatched === 'number' && !Number.isNaN(paymentDaysWatched)
      ? paymentDaysWatched
      : defaultPaymentDays;

  const introContent = useMemo(() => {
    if (!textBlocks || introIdW === 'none' || !introIdW) return null;
    return textBlocks.find((b) => b.id === introIdW)?.content ?? null;
  }, [textBlocks, introIdW]);

  const outroContent = useMemo(() => {
    if (!textBlocks || outroIdW === 'none' || !outroIdW) return null;
    return textBlocks.find((b) => b.id === outroIdW)?.content ?? null;
  }, [textBlocks, outroIdW]);

  const placeholderInvoiceNumber = useMemo(() => {
    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, '0');
    return `RE-${y}-${m}-XXXX`;
  }, []);

  useEffect(() => {
    if (!pdfOverlayEnabled) return;
    onStep4PdfOverlayChange?.({
      paymentDueDays: paymentDueResolved,
      introText: introContent,
      outroText: outroContent,
      recipientRow: effectiveRow
    });
  }, [
    pdfOverlayEnabled,
    onStep4PdfOverlayChange,
    paymentDueResolved,
    introContent,
    outroContent,
    effectiveRow
  ]);

  return (
    <div className='space-y-6'>
      <div className='min-w-0 space-y-6'>
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
            Wird automatisch vergeben ({placeholderInvoiceNumber})
          </p>
        </div>

        {/* Positionen — Preisstrategie (Tooltip) */}
        {lineItems.length > 0 && (
          <div className='space-y-2'>
            <h3 className='text-sm font-medium'>Positionen</h3>
            <div className='max-h-[200px] overflow-y-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-10'>#</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead className='text-right'>Preis</TableHead>
                    <TableHead className='w-10' />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item) => {
                    const srcLabel =
                      PRICE_RESOLUTION_SOURCE_LABELS_DE[
                        item.price_resolution.source
                      ] ?? item.price_resolution.source;
                    const stratLabel = pricingStrategyUsedLabelDe(
                      item.price_resolution.strategy_used
                    );
                    const tip = `Preisstrategie: ${stratLabel} · Quelle: ${srcLabel}`;
                    return (
                      <TableRow key={item.position}>
                        <TableCell className='text-muted-foreground text-xs'>
                          {item.position}
                        </TableCell>
                        <TableCell className='max-w-[200px] truncate text-sm'>
                          {item.description}
                        </TableCell>
                        <TableCell className='text-right text-sm'>
                          {(() => {
                            const net = lineItemNetAmountForDisplay(item);
                            return net !== null ? formatEur(net) : '—';
                          })()}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type='button'
                                  className='text-muted-foreground hover:text-foreground inline-flex'
                                  aria-label='Preisdetails'
                                >
                                  <Info className='h-4 w-4' />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side='left' className='max-w-xs'>
                                <p className='text-xs'>{tip}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Editable meta fields */}
        <FormProvider {...form}>
          <form
            id='invoice-step4-form'
            onSubmit={form.handleSubmit(onConfirm)}
            className='space-y-4'
          >
            {!isLoadingEmpfaenger && (
              <div className='bg-muted/40 space-y-2 rounded-lg border p-4'>
                <h3 className='text-sm font-medium'>Rechnungsempfänger</h3>
                {effectiveRecipientId && effectiveRow ? (
                  <>
                    <div className='flex flex-wrap items-baseline gap-2'>
                      <p className='text-sm font-medium'>{effectiveRow.name}</p>
                      {isManualOverride ? (
                        <span className='text-muted-foreground text-xs'>
                          Manuell überschrieben
                        </span>
                      ) : null}
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      {formatRecipientFullAddress(effectiveRow)}
                    </p>
                  </>
                ) : (
                  <Alert className='border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'>
                    <AlertTriangle className='h-4 w-4 text-amber-600' />
                    <AlertDescription>
                      Kein Rechnungsempfänger — bitte unten wählen oder
                      Stammdaten prüfen.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

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

            <FormField
              control={form.control}
              name='rechnungsempfaenger_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rechnungsempfänger (Anpassung)</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isLoadingEmpfaenger || isCreating}
                    >
                      <SelectTrigger className='w-full max-w-md'>
                        <SelectValue placeholder='Empfänger wählen' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='none'>
                          Automatisch (Katalog — erste Fahrt)
                        </SelectItem>
                        {(empfaengerOptions ?? []).map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    Überschreibt nur diese Rechnung — Katalog-Zuordnungen am
                    Kostenträger bleiben unverändert. Wird mit Adresse
                    eingefroren.
                  </FormDescription>
                </FormItem>
              )}
            />

            {/* Rechnungsvorlagen */}
            <div className='space-y-4'>
              <h3 className='text-sm font-medium'>Rechnungsvorlagen</h3>

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

            {!hideSubmitButton ? (
              <div className='border-border flex justify-end border-t pt-4'>
                <Button
                  type='submit'
                  disabled={isCreating || submitDisabled}
                  className='gap-2'
                >
                  {isCreating ? 'Erstelle Rechnung…' : 'Rechnung erstellen'}
                </Button>
              </div>
            ) : null}
          </form>
        </FormProvider>
      </div>
    </div>
  );
}
