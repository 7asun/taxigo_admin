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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAllInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';
import { useRechnungsempfaengerOptions } from '@/features/rechnungsempfaenger/hooks/use-rechnungsempfaenger-options';
import {
  adhocRecipientFormToSnapshot,
  type AdhocRecipientFormValues
} from '@/features/rechnungsempfaenger/api/rechnungsempfaenger.service';
import { AddressAutocomplete } from '@/features/trips/components/address-autocomplete';
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
import { cn } from '@/lib/utils';
import { normalizeInvoiceRecipientPhone } from '@/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf';
import type { ConfirmationDisplayRow } from '../../lib/build-confirmation-display-rows';
import type { InvoiceBuilderStep4PdfOverlay } from './use-invoice-builder-pdf-preview';

/** Step 4 local schema — only the invoice meta fields. */
const step4Schema = z
  .object({
    intro_block_id: z.string().optional(),
    outro_block_id: z.string().optional(),
    payment_due_days: z
      .number({ message: 'Bitte eine Zahl eingeben' })
      .int()
      .min(1, 'Mindestens 1 Tag')
      .max(90, 'Maximal 90 Tage'),
    /** `'none'` | UUID | `'adhoc'` */
    rechnungsempfaenger_id: z.string().optional(),
    adhoc_anrede: z.string().optional(),
    adhoc_first_name: z.string().optional(),
    adhoc_last_name: z.string().optional(),
    adhoc_company_name: z.string().optional(),
    adhoc_abteilung: z.string().optional(),
    adhoc_address_line1: z.string().optional(),
    adhoc_address_line2: z.string().optional(),
    adhoc_postal_code: z.string().optional(),
    adhoc_city: z.string().optional(),
    adhoc_phone: z.string().optional()
  })
  .superRefine((data, ctx) => {
    if (data.rechnungsempfaenger_id !== 'adhoc') return;
    const hasName =
      (data.adhoc_company_name?.trim().length ?? 0) > 0 ||
      (data.adhoc_last_name?.trim().length ?? 0) > 0;
    if (!hasName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bitte Firmenname oder Nachname angeben',
        path: ['adhoc_company_name']
      });
    }
    if (!data.adhoc_address_line1?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pflichtfeld',
        path: ['adhoc_address_line1']
      });
    }
    if (!data.adhoc_postal_code?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pflichtfeld',
        path: ['adhoc_postal_code']
      });
    }
    if (!data.adhoc_city?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pflichtfeld',
        path: ['adhoc_city']
      });
    }
  });

type Step4Values = z.infer<typeof step4Schema>;

/** Euro formatter for Germany locale. */
const formatEur = (v: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
    v
  );

interface RecipientRow {
  name: string;
  anrede?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  abteilung?: string | null;
  phone?: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
}

function formatRecipientFullAddress(row: RecipientRow): string {
  const line1 = [row.address_line1, row.address_line2]
    .filter(Boolean)
    .join(', ');
  const loc = [row.postal_code, row.city].filter(Boolean).join(' ');
  const parts = [line1, loc, row.country].filter(
    (x) => x && String(x).trim().length > 0
  );
  return parts.join(' · ');
}

type RecipientMode = 'none' | 'catalog' | 'adhoc';

function recipientModeFromSelect(raw: string | undefined): RecipientMode {
  if (raw === 'adhoc') return 'adhoc';
  if (raw === 'none' || raw === undefined || raw === '') return 'none';
  return 'catalog';
}

function adhocValuesToDisplayRow(
  values: Pick<
    Step4Values,
    | 'adhoc_anrede'
    | 'adhoc_first_name'
    | 'adhoc_last_name'
    | 'adhoc_company_name'
    | 'adhoc_abteilung'
    | 'adhoc_phone'
    | 'adhoc_address_line1'
    | 'adhoc_address_line2'
    | 'adhoc_postal_code'
    | 'adhoc_city'
  >
): RecipientRow | null {
  const address_line1 = values.adhoc_address_line1?.trim() || null;
  const city = values.adhoc_city?.trim() || null;
  if (!address_line1 && !city) return null;
  const company_name = values.adhoc_company_name?.trim() || null;
  const first_name = values.adhoc_first_name?.trim() || null;
  const last_name = values.adhoc_last_name?.trim() || null;
  const name =
    company_name ||
    [first_name, last_name].filter(Boolean).join(' ') ||
    city ||
    '';
  return {
    name,
    anrede: values.adhoc_anrede?.trim() || null,
    first_name,
    last_name,
    company_name,
    abteilung: values.adhoc_abteilung?.trim() || null,
    phone: values.adhoc_phone?.trim() || null,
    address_line1,
    address_line2: values.adhoc_address_line2?.trim() || null,
    postal_code: values.adhoc_postal_code?.trim() || null,
    city,
    country: null
  };
}

function adhocSnapshotFromFormValues(
  values: Step4Values
): Record<string, unknown> | null {
  if (values.rechnungsempfaenger_id !== 'adhoc') return null;
  if (!values.adhoc_address_line1?.trim() || !values.adhoc_city?.trim()) {
    return null;
  }
  return adhocRecipientFormToSnapshot({
    anrede: values.adhoc_anrede || null,
    first_name: values.adhoc_first_name || null,
    last_name: values.adhoc_last_name || null,
    company_name: values.adhoc_company_name || null,
    abteilung: values.adhoc_abteilung || null,
    address_line1: values.adhoc_address_line1,
    address_line2: values.adhoc_address_line2 || null,
    postal_code: values.adhoc_postal_code ?? '',
    city: values.adhoc_city,
    phone: values.adhoc_phone || null
  });
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
  isEditMode?: boolean;
  defaultAdhocValues?: Partial<AdhocRecipientFormValues>;
  onConfirm: (
    values: Step4Values,
    adhocSnapshot: Record<string, unknown> | null
  ) => void;
  /**
   * Phase 10: resolved default intro block (Vorlage → payer → company default).
   * Synced into the form when this value changes.
   */
  resolvedIntroBlockId?: string | null;
  /** Same chain as resolvedIntroBlockId for the outro block. */
  resolvedOutroBlockId?: string | null;
  /** Katalog-Auflösung (Variante → Familie → Kostenträger) aus der ersten geladenen Fahrt */
  defaultRechnungsempfaengerId?: string | null;
  /** Gleiche ID wie Katalog-Default — für „Manuell überschrieben“ */
  catalogRecipientId?: string | null;
  /** Billable display rows — not raw BuilderLineItem[]; cancelled trips are a separate shape. */
  lineItems: ConfirmationDisplayRow[];
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
  isEditMode = false,
  defaultAdhocValues,
  onConfirm,
  resolvedIntroBlockId,
  resolvedOutroBlockId,
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
      intro_block_id: resolvedIntroBlockId || 'none',
      outro_block_id: resolvedOutroBlockId || 'none',
      payment_due_days: defaultPaymentDays,
      rechnungsempfaenger_id: defaultAdhocValues
        ? 'adhoc'
        : defaultRechnungsempfaengerId != null &&
            defaultRechnungsempfaengerId.length > 0
          ? defaultRechnungsempfaengerId
          : 'none',
      adhoc_anrede: defaultAdhocValues?.anrede ?? '',
      adhoc_first_name: defaultAdhocValues?.first_name ?? '',
      adhoc_last_name: defaultAdhocValues?.last_name ?? '',
      adhoc_company_name: defaultAdhocValues?.company_name ?? '',
      adhoc_abteilung: defaultAdhocValues?.abteilung ?? '',
      adhoc_address_line1: defaultAdhocValues?.address_line1 ?? '',
      adhoc_address_line2: defaultAdhocValues?.address_line2 ?? '',
      adhoc_postal_code: defaultAdhocValues?.postal_code ?? '',
      adhoc_city: defaultAdhocValues?.city ?? '',
      adhoc_phone: defaultAdhocValues?.phone ?? ''
    }
  });

  useEffect(() => {
    form.setValue(
      'intro_block_id',
      resolvedIntroBlockId && resolvedIntroBlockId.length > 0
        ? resolvedIntroBlockId
        : 'none'
    );
    form.setValue(
      'outro_block_id',
      resolvedOutroBlockId && resolvedOutroBlockId.length > 0
        ? resolvedOutroBlockId
        : 'none'
    );
  }, [resolvedIntroBlockId, resolvedOutroBlockId, form]);

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

  const adhocWatched = useWatch({
    control: form.control,
    name: [
      'adhoc_anrede',
      'adhoc_first_name',
      'adhoc_last_name',
      'adhoc_company_name',
      'adhoc_abteilung',
      'adhoc_address_line1',
      'adhoc_address_line2',
      'adhoc_postal_code',
      'adhoc_city',
      'adhoc_phone'
    ]
  });

  const [
    adhocAnrede,
    adhocFirstName,
    adhocLastName,
    adhocCompanyName,
    adhocAbteilung,
    adhocAddressLine1,
    adhocAddressLine2,
    adhocPostalCode,
    adhocCity,
    adhocPhone
  ] = adhocWatched ?? [];

  const recipientMode = recipientModeFromSelect(empSelectRaw);
  const isAdhocMode = recipientMode === 'adhoc';
  const isCatalogMode = recipientMode === 'catalog';

  const effectiveRecipientId =
    isAdhocMode ||
    empSelectRaw === 'none' ||
    empSelectRaw === undefined ||
    empSelectRaw === ''
      ? isAdhocMode
        ? null
        : catalogRecipientId
      : empSelectRaw;

  const effectiveRow = isAdhocMode
    ? undefined
    : (empfaengerOptions ?? []).find((r) => r.id === effectiveRecipientId);

  const adhocDisplayRow = useMemo(() => {
    if (!isAdhocMode) return null;
    return adhocValuesToDisplayRow({
      adhoc_anrede: adhocAnrede,
      adhoc_first_name: adhocFirstName,
      adhoc_last_name: adhocLastName,
      adhoc_company_name: adhocCompanyName,
      adhoc_abteilung: adhocAbteilung,
      adhoc_address_line1: adhocAddressLine1,
      adhoc_address_line2: adhocAddressLine2,
      adhoc_postal_code: adhocPostalCode,
      adhoc_city: adhocCity,
      adhoc_phone: adhocPhone
    });
  }, [
    isAdhocMode,
    adhocAnrede,
    adhocFirstName,
    adhocLastName,
    adhocCompanyName,
    adhocAbteilung,
    adhocAddressLine1,
    adhocAddressLine2,
    adhocPostalCode,
    adhocCity,
    adhocPhone
  ]);

  const isManualOverride =
    isCatalogMode &&
    typeof empSelectRaw === 'string' &&
    empSelectRaw.length > 0 &&
    (catalogRecipientId == null || empSelectRaw !== catalogRecipientId);

  const adhocPreviewIncomplete =
    isAdhocMode &&
    (!adhocDisplayRow || !adhocAddressLine1?.trim() || !adhocCity?.trim());

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
    if (isAdhocMode) {
      const adhocSnap =
        adhocAddressLine1?.trim() && adhocCity?.trim()
          ? adhocRecipientFormToSnapshot({
              anrede: adhocAnrede || null,
              first_name: adhocFirstName || null,
              last_name: adhocLastName || null,
              company_name: adhocCompanyName || null,
              abteilung: adhocAbteilung || null,
              address_line1: adhocAddressLine1,
              address_line2: adhocAddressLine2 || null,
              postal_code: adhocPostalCode ?? '',
              city: adhocCity,
              phone: adhocPhone || null
            })
          : null;
      onStep4PdfOverlayChange?.({
        paymentDueDays: paymentDueResolved,
        introText: introContent,
        outroText: outroContent,
        recipientRow: null,
        recipientSnapshot: adhocSnap
      });
      return;
    }
    onStep4PdfOverlayChange?.({
      paymentDueDays: paymentDueResolved,
      introText: introContent,
      outroText: outroContent,
      recipientRow: effectiveRow,
      recipientSnapshot: undefined
    });
  }, [
    pdfOverlayEnabled,
    onStep4PdfOverlayChange,
    paymentDueResolved,
    introContent,
    outroContent,
    effectiveRow,
    isAdhocMode,
    adhocAnrede,
    adhocFirstName,
    adhocLastName,
    adhocCompanyName,
    adhocAbteilung,
    adhocAddressLine1,
    adhocAddressLine2,
    adhocPostalCode,
    adhocCity,
    adhocPhone
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
                  {lineItems.map((row) => {
                    const srcLabel =
                      PRICE_RESOLUTION_SOURCE_LABELS_DE[
                        row.price_resolution.source
                      ] ?? row.price_resolution.source;
                    const stratLabel = pricingStrategyUsedLabelDe(
                      row.price_resolution.strategy_used
                    );
                    const tip = `Preisstrategie: ${stratLabel} · Quelle: ${srcLabel}`;
                    const net = row.price_resolution.net;
                    return (
                      <TableRow
                        key={row.key}
                        className={cn(
                          row.rowType === 'cancelled' && 'text-muted-foreground'
                        )}
                      >
                        <TableCell className='text-muted-foreground text-xs'>
                          {row.position}
                        </TableCell>
                        <TableCell className='max-w-[200px] truncate text-sm'>
                          {row.description}
                        </TableCell>
                        <TableCell className='text-right text-sm'>
                          {net !== null && net !== undefined
                            ? formatEur(net)
                            : '—'}
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
            // why: submit sends step4Values (meta fields) only — persist uses hook state, not this table.
            onSubmit={form.handleSubmit((values) => {
              onConfirm(values, adhocSnapshotFromFormValues(values));
            })}
            className='space-y-4'
          >
            {!isLoadingEmpfaenger && (
              <div className='bg-muted/40 space-y-2 rounded-lg border p-4'>
                <h3 className='text-sm font-medium'>Rechnungsempfänger</h3>
                {isEditMode && isAdhocMode ? (
                  <Alert className='border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'>
                    <AlertTriangle className='h-4 w-4 text-amber-600' />
                    <AlertDescription>
                      Änderungen an der Adresse eines einmaligen Empfängers
                      werden beim Speichern des Entwurfs noch nicht übernommen.
                      Löschen Sie den Entwurf und erstellen Sie eine neue
                      Rechnung, um eine andere Adresse zu verwenden.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {isAdhocMode && adhocDisplayRow ? (
                  <>
                    <div className='flex flex-wrap items-baseline gap-2'>
                      <p className='text-sm font-medium'>
                        {adhocDisplayRow.company_name ||
                          [
                            adhocDisplayRow.anrede,
                            adhocDisplayRow.first_name,
                            adhocDisplayRow.last_name
                          ]
                            .filter(Boolean)
                            .join(' ') ||
                          adhocDisplayRow.name}
                      </p>
                      <span className='text-muted-foreground text-xs'>
                        Einmalig eingeben
                      </span>
                    </div>
                    {adhocDisplayRow.abteilung ? (
                      <p className='text-muted-foreground text-xs'>
                        Abteilung: {adhocDisplayRow.abteilung}
                      </p>
                    ) : null}
                    {(() => {
                      const tel = normalizeInvoiceRecipientPhone(
                        adhocDisplayRow.phone
                      );
                      return tel ? (
                        <p className='text-muted-foreground text-xs'>
                          Tel: {tel}
                        </p>
                      ) : null;
                    })()}
                    <p className='text-muted-foreground text-xs'>
                      {formatRecipientFullAddress(adhocDisplayRow)}
                    </p>
                  </>
                ) : isAdhocMode && adhocPreviewIncomplete ? (
                  <Alert className='border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'>
                    <AlertTriangle className='h-4 w-4 text-amber-600' />
                    <AlertDescription>
                      Bitte die Pflichtfelder für den einmaligen Empfänger
                      ausfüllen (Name, Straße, PLZ, Stadt).
                    </AlertDescription>
                  </Alert>
                ) : effectiveRecipientId && effectiveRow ? (
                  <>
                    <div className='flex flex-wrap items-baseline gap-2'>
                      <p className='text-sm font-medium'>
                        {(() => {
                          if (effectiveRow.company_name) {
                            return effectiveRow.company_name;
                          }
                          const parts = [
                            effectiveRow.anrede,
                            effectiveRow.first_name,
                            effectiveRow.last_name
                          ].filter(Boolean);
                          if (parts.length > 0) {
                            return parts.join(' ');
                          }
                          return effectiveRow.name;
                        })()}
                      </p>
                      {isManualOverride ? (
                        <span className='text-muted-foreground text-xs'>
                          Manuell überschrieben
                        </span>
                      ) : null}
                    </div>
                    {effectiveRow.abteilung && (
                      <p className='text-muted-foreground text-xs'>
                        Abteilung: {effectiveRow.abteilung}
                      </p>
                    )}
                    {(() => {
                      const tel = normalizeInvoiceRecipientPhone(
                        effectiveRow.phone
                      );
                      return tel ? (
                        <p className='text-muted-foreground text-xs'>
                          Tel: {tel}
                        </p>
                      ) : null;
                    })()}
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
                <FormItem className='space-y-3'>
                  <FormLabel>Rechnungsempfänger (Anpassung)</FormLabel>
                  <FormControl>
                    <ToggleGroup
                      type='single'
                      value={recipientModeFromSelect(field.value)}
                      onValueChange={(mode) => {
                        if (!mode) return;
                        if (mode === 'none') {
                          field.onChange('none');
                          return;
                        }
                        if (mode === 'adhoc') {
                          field.onChange('adhoc');
                          return;
                        }
                        const current = field.value;
                        const isUuid =
                          current && current !== 'none' && current !== 'adhoc';
                        if (isUuid) return;
                        const fallback =
                          catalogRecipientId ??
                          empfaengerOptions?.[0]?.id ??
                          'none';
                        field.onChange(fallback);
                      }}
                      variant='outline'
                      aria-label='Rechnungsempfänger-Modus'
                      className='h-9 w-full max-w-md'
                      disabled={isLoadingEmpfaenger || isCreating}
                    >
                      <ToggleGroupItem
                        value='none'
                        className='flex-1 px-2 text-xs sm:text-sm'
                      >
                        Automatisch
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value='catalog'
                        className='flex-1 px-2 text-xs sm:text-sm'
                      >
                        Aus Katalog
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value='adhoc'
                        className='flex-1 px-2 text-xs sm:text-sm'
                      >
                        Einmalig
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </FormControl>
                  {isCatalogMode ? (
                    <Select
                      value={
                        field.value === 'none' || field.value === 'adhoc'
                          ? undefined
                          : field.value
                      }
                      onValueChange={field.onChange}
                      disabled={isLoadingEmpfaenger || isCreating}
                    >
                      <SelectTrigger className='w-full max-w-md'>
                        <SelectValue placeholder='Empfänger wählen' />
                      </SelectTrigger>
                      <SelectContent>
                        {(empfaengerOptions ?? []).map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {isAdhocMode ? (
                    <div className='grid max-w-md gap-3 sm:grid-cols-2'>
                      <FormField
                        control={form.control}
                        name='adhoc_anrede'
                        render={({ field: f }) => (
                          <FormItem className='sm:col-span-2'>
                            <FormLabel>Anrede</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_first_name'
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel>Vorname</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_last_name'
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel>Nachname</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_company_name'
                        render={({ field: f }) => (
                          <FormItem className='sm:col-span-2'>
                            <FormLabel>Firma</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_abteilung'
                        render={({ field: f }) => (
                          <FormItem className='sm:col-span-2'>
                            <FormLabel>Abteilung</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_address_line1'
                        render={({ field: f }) => (
                          <FormItem className='sm:col-span-2'>
                            <FormLabel>Straße und Hausnummer</FormLabel>
                            <FormControl>
                              <AddressAutocomplete
                                value={f.value ?? ''}
                                onChange={(result) => {
                                  if (typeof result === 'string') {
                                    f.onChange(result);
                                    return;
                                  }
                                  f.onChange(result.address);
                                }}
                                onSelectCallback={(result) => {
                                  const line1 = result.street
                                    ? [result.street, result.street_number]
                                        .filter(Boolean)
                                        .join(' ')
                                    : result.address;
                                  f.onChange(line1);
                                  form.setValue('adhoc_address_line1', line1, {
                                    shouldValidate: true
                                  });
                                  if (result.zip_code) {
                                    form.setValue(
                                      'adhoc_postal_code',
                                      result.zip_code,
                                      { shouldValidate: true }
                                    );
                                  }
                                  if (result.city) {
                                    form.setValue('adhoc_city', result.city, {
                                      shouldValidate: true
                                    });
                                  }
                                }}
                                placeholder='Straße und Hausnummer suchen...'
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_address_line2'
                        render={({ field: f }) => (
                          <FormItem className='sm:col-span-2'>
                            <FormLabel>Adresszusatz</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_postal_code'
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel>PLZ</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_city'
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel>Stadt</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='adhoc_phone'
                        render={({ field: f }) => (
                          <FormItem className='sm:col-span-2'>
                            <FormLabel>Telefon</FormLabel>
                            <FormControl>
                              <Input {...f} value={f.value ?? ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  ) : null}
                  <FormDescription>
                    Überschreibt nur diese Rechnung — Katalog-Zuordnungen am
                    Kostenträger bleiben unverändert. Wird mit Adresse
                    eingefroren.
                  </FormDescription>
                  <FormMessage />
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
