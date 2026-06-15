'use client';

/**
 * invoice-builder/index.tsx
 *
 * Invoice builder shell — orchestrates all five sections as a single
 * progressive-disclosure scroll form with a sticky PDF preview on the right.
 *
 * Section order and unlock conditions:
 *   ① Abrechnungsmodus  — always unlocked
 *   ② Parameter         — unlocks when billingMode is selected
 *   ③ Positionen        — unlocks when payer_id + date_range are set
 *   ④ PDF-Vorlage       — unlocks when Section 3 is complete (line items loaded, admin confirmed)
 *   ⑤ Bestätigung       — unlocks after the user clicks “Weiter zur Bestätigung” on Section 4
 *
 * Auto-scroll: 300ms after each section’s unlock condition becomes true for the first time,
 * scrolling the next section into view with smooth behavior (left column only).
 *
 * State lifted here (not in child components):
 *   builderColumnProfile — resolved PdfColumnProfile from Section 4 (`Step4Vorlage` →
 *                          `onColumnProfileChange`). Read by `useInvoiceBuilderPdfPreview` as
 *                          `columnProfile` for `InvoicePdfDocument` / draft detail. Initialized to
 *                          the system default so the preview is valid before Section 4 opens.
 *
 * Must not embed pricing or Supabase calls — children and hooks own domain logic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PdfColumnOverridePayload,
  PdfColumnProfile,
  PdfVorlageRow
} from '@/features/invoices/types/pdf-vorlage.types';
import { resolvePdfColumnProfile } from '@/features/invoices/lib/resolve-pdf-column-profile';
import { resolveDefaultTextBlockIds } from '@/features/invoices/lib/resolve-default-text-blocks';
import { useAllInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { BuilderSectionCard } from '@/components/ui/builder-section-card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { parseYmdToLocalDate } from '@/lib/date-ymd';
import { cn } from '@/lib/utils';

import {
  isInvoiceBuilderSection1Complete,
  isInvoiceBuilderSection2Complete,
  isInvoiceBuilderSection3Complete,
  isInvoiceBuilderSection4Unlocked,
  isInvoiceBuilderSection5Unlocked
} from '@/features/invoices/lib/invoice-builder-section-guards';
import { buildConfirmationDisplayRows } from '../../lib/build-confirmation-display-rows';
import {
  useInvoiceBuilder,
  type UseInvoiceBuilderOptions
} from '../../hooks/use-invoice-builder';
import { Step1Mode } from './step-1-mode';
import { Step2Params } from './step-2-params';
import { Step3LineItems } from './step-3-line-items';
import { TripSyncFailureDialog } from './trip-sync-failure-dialog';
import { Step4Confirm } from './step-4-confirm';
import { Step4Vorlage } from './step-4-vorlage';
import { InvoiceBuilderPdfPanel } from './invoice-builder-pdf-panel';
import {
  useInvoiceBuilderPdfPreview,
  MANUAL_PREVIEW_TRIP_THRESHOLD,
  type InvoiceBuilderStep4PdfOverlay
} from './use-invoice-builder-pdf-preview';
import type {
  ExcludedTripRow,
  InvoiceDetail,
  InvoiceMode
} from '../../types/invoice.types';
import type { InvoiceBuilderStep2Snapshot } from '../invoice-pdf/build-draft-invoice-detail-for-pdf';

type Payer = NonNullable<InvoiceDetail['payer']> & {
  rechnungsempfaenger_id?: string | null;
  billing_types?: {
    id: string;
    name: string;
    rechnungsempfaenger_id?: string | null;
  }[];
  default_intro_block_id?: string | null;
  default_outro_block_id?: string | null;
  pdf_vorlage_id?: string | null;
};

type Client = NonNullable<InvoiceDetail['client']>;

type SectionNum = 1 | 2 | 3 | 4 | 5;

interface InvoiceBuilderProps {
  companyId: string;
  payers: Payer[];
  clients: Client[];
  defaultPaymentDays: number;
  companyProfile: InvoiceDetail['company_profile'] | null;
  companyProfileMissing?: boolean;
  /**
   * When set, the builder re-opens this existing DRAFT invoice for editing
   * (hydrates from the persisted invoice, locks payer/mode). Undefined = create
   * mode (unchanged). No live route passes this yet — the edit route is deferred.
   */
  invoiceId?: string;
}

const SECTION_SCROLL_IDS: Record<SectionNum, string> = {
  1: 'invoice-builder-section-1',
  2: 'invoice-builder-section-2',
  3: 'invoice-builder-section-3',
  4: 'invoice-builder-section-4',
  5: 'invoice-builder-section-5'
};

function formatEurDe(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

function modeLabelDe(mode: InvoiceMode | null): string {
  if (!mode) return '';
  const labels: Record<InvoiceMode, string> = {
    monthly: 'Monatlich',
    single_trip: 'Einzelfahrt',
    per_client: 'Fahrgast'
  };
  return labels[mode];
}

function buildSection2Summary(
  periodFrom: string | undefined,
  periodTo: string | undefined,
  payerName: string | undefined
): string {
  if (!periodFrom || !periodTo || !payerName) return '';
  const d1 = parseYmdToLocalDate(periodFrom);
  const d2 = parseYmdToLocalDate(periodTo);
  if (!d1 || !d2) return '';
  return `${format(d1, 'dd.MM.')} – ${format(d2, 'dd.MM.yyyy', { locale: de })} · ${payerName}`;
}

export function InvoiceBuilder({
  companyId,
  payers,
  clients,
  defaultPaymentDays,
  companyProfile,
  companyProfileMissing,
  invoiceId
}: InvoiceBuilderProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [step4Overlay, setStep4Overlay] =
    useState<InvoiceBuilderStep4PdfOverlay | null>(null);
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState<Record<SectionNum, boolean>>({
    1: true,
    2: false,
    3: false,
    4: false,
    5: false
  });

  /** True after “Weiter zur Bestätigung” on PDF-Vorlage; unlocks Section 5 and drives dot 5. */
  const [pdfStepAcknowledged, setPdfStepAcknowledged] = useState(false);
  /**
   * Lifted from Section 4 (PDF-Vorlage). Initialized to the system default so
   * the preview has a valid profile before the dispatcher opens Section 4.
   * Updated via Step4Vorlage whenever Vorlage or custom columns change.
   */
  const [builderColumnProfile, setBuilderColumnProfile] =
    useState<PdfColumnProfile>(() => resolvePdfColumnProfile(null, null, null));
  /** Phase 10: Vorlage row from Section 4 dropdown — drives Brieftext default resolution. */
  const [builderResolvedVorlage, setBuilderResolvedVorlage] =
    useState<PdfVorlageRow | null>(null);
  const [pdfColumnReorderGeneration, setPdfColumnReorderGeneration] =
    useState(0);
  const pdfOverrideRef = useRef<PdfColumnOverridePayload | null>(null);
  /** Edit mode: tier-1 snapshot from the invoice row — passed to Step4 so emit does not clobber hydration. */
  const [editHydratedPdfOverride, setEditHydratedPdfOverride] =
    useState<PdfColumnOverridePayload | null>(null);

  const handleEditPdfColumnOverrideHydrated = useCallback<
    NonNullable<UseInvoiceBuilderOptions['onEditPdfColumnOverrideHydrated']>
  >((profile, override) => {
    setBuilderColumnProfile(profile);
    pdfOverrideRef.current = override;
    setEditHydratedPdfOverride(override);
  }, []);

  const section1Ref = useRef<HTMLElement | null>(null);
  const section2Ref = useRef<HTMLElement | null>(null);
  const section3Ref = useRef<HTMLElement | null>(null);
  const section4Ref = useRef<HTMLElement | null>(null);
  const section5Ref = useRef<HTMLElement | null>(null);
  /** Scrollable column — never use scrollIntoView on sections; it scrolls dashboard ancestors. */
  const leftColumnScrollRef = useRef<HTMLDivElement | null>(null);

  const prevSection1Complete = useRef(false);
  const prevSection2Complete = useRef(false);
  const prevSection3Complete = useRef(false);
  const prevPdfStepAcknowledged = useRef(false);

  const {
    step2Values,
    lineItems,
    cancelledTrips,
    section3Confirmed,
    totals,
    missingPrices,
    isLoadingTrips,
    isTripsError,
    handleStep1Complete,
    handleStep2Complete,
    confirmSection3,
    applyGrossOverride,
    resetLineItemOverride,
    applyKmOverride,
    resetKmOverride,
    applyTaxRateOverride,
    resetTaxRateOverride,
    syncFailedItems,
    clearSyncFailedItems,
    retrySyncFailedItems,
    createInvoice,
    isCreating,
    catalogRecipientId,
    defaultAdhocValues,
    excludedTripCount,
    hasInclusionErrors,
    handleLineItemInclusionChange,
    handleCancelledTripInclusionChange,
    handleCancelledTripGrossOverride,
    handleCancelledTripKmOverride,
    handleCancelledTripApproachFeeChange,
    isEditMode,
    editInvoiceNumber,
    updateInvoice,
    isSaving
  } = useInvoiceBuilder(
    companyId,
    (newId) => {
      router.push(`/dashboard/invoices/${newId}`);
    },
    invoiceId,
    { onEditPdfColumnOverrideHydrated: handleEditPdfColumnOverrideHydrated }
  );

  // why: edit mode submits via updateInvoice, create via createInvoice — a single
  // flag drives the shared submit button's loading + disabled state.
  const isSubmitting = isCreating || isSaving;

  const selectedPayer = step2Values?.payer_id
    ? payers.find((p) => p.id === step2Values.payer_id)
    : null;

  const { data: allTextBlocks = [] } = useAllInvoiceTextBlocks();
  const groupedTextBlocks = useMemo(
    () => ({
      intro: allTextBlocks.filter((b) => b.type === 'intro'),
      outro: allTextBlocks.filter((b) => b.type === 'outro')
    }),
    [allTextBlocks]
  );

  const {
    introBlockId: resolvedIntroBlockId,
    outroBlockId: resolvedOutroBlockId
  } = useMemo(
    () =>
      resolveDefaultTextBlockIds(
        builderResolvedVorlage,
        selectedPayer
          ? {
              default_intro_block_id:
                selectedPayer.default_intro_block_id ?? null,
              default_outro_block_id:
                selectedPayer.default_outro_block_id ?? null
            }
          : null,
        groupedTextBlocks
      ),
    [builderResolvedVorlage, selectedPayer, groupedTextBlocks]
  );

  const handleResolvedVorlageRowChange = useCallback(
    (row: PdfVorlageRow | null) => {
      setBuilderResolvedVorlage(row);
    },
    []
  );

  const selectedMode = (step2Values?.mode as InvoiceMode) ?? null;

  const section1Complete = isInvoiceBuilderSection1Complete(step2Values);
  const section2Complete = isInvoiceBuilderSection2Complete(step2Values);
  const section3Complete = isInvoiceBuilderSection3Complete(
    section2Complete,
    lineItems,
    isLoadingTrips,
    isTripsError,
    section3Confirmed
  );
  const section4Unlocked = isInvoiceBuilderSection4Unlocked(section3Complete);
  const section5Unlocked =
    isInvoiceBuilderSection5Unlocked(pdfStepAcknowledged);

  const isLocked = useCallback(
    (n: SectionNum) => {
      if (n === 1) return false;
      if (n === 2) return !section1Complete;
      if (n === 3) return !section2Complete;
      if (n === 4) return !section3Complete;
      return !section5Unlocked;
    },
    [section1Complete, section2Complete, section3Complete, section5Unlocked]
  );

  const setSection = useCallback((n: SectionNum, open: boolean) => {
    setSectionOpen((s) => ({ ...s, [n]: open }));
  }, []);

  const scrollSectionElementIntoLeftColumn = useCallback(
    (element: HTMLElement | null, behavior: ScrollBehavior = 'smooth') => {
      const container = leftColumnScrollRef.current;
      if (!container || !element) return;
      const cRect = container.getBoundingClientRect();
      const chRect = element.getBoundingClientRect();
      const padding = 12;
      const nextTop = container.scrollTop + (chRect.top - cRect.top) - padding;
      container.scrollTo({ top: Math.max(0, nextTop), behavior });
    },
    []
  );

  const step2Snapshot = useMemo((): InvoiceBuilderStep2Snapshot | null => {
    if (
      !step2Values?.payer_id ||
      !step2Values.period_from ||
      !step2Values.period_to
    ) {
      return null;
    }
    return {
      mode: step2Values.mode as InvoiceBuilderStep2Snapshot['mode'],
      payer_id: step2Values.payer_id,
      billing_type_id: step2Values.billing_type_id ?? null,
      billing_type_ids: step2Values.billing_type_ids ?? null,
      billing_variant_id: step2Values.billing_variant_id ?? null,
      billing_variant_ids: step2Values.billing_variant_ids ?? null,
      period_from: step2Values.period_from,
      period_to: step2Values.period_to,
      client_id: step2Values.client_id ?? null
    };
  }, [step2Values]);

  useEffect(() => {
    if (!section4Unlocked) {
      setStep4Overlay(null);
    }
  }, [section4Unlocked]);

  // Reacts to Section 3 becoming incomplete: close downstream sections and clear override ack.
  useEffect(() => {
    if (!section3Complete) {
      setPdfStepAcknowledged(false);
      setSectionOpen((s) => ({ ...s, 4: false, 5: false }));
      pdfOverrideRef.current = null;
    }
  }, [section3Complete]);

  // Payer change: reset PDF step ack, clear override ref, and reset column profile to system default
  // until Step4Vorlage re-resolves for the new payer / Vorlage.
  useEffect(() => {
    setPdfStepAcknowledged(false);
    pdfOverrideRef.current = null;
    setEditHydratedPdfOverride(null);
    setBuilderColumnProfile(resolvePdfColumnProfile(null, null, null));
    setBuilderResolvedVorlage(null);
  }, [step2Values?.payer_id]);

  const handleStep4PdfOverlay = useCallback(
    (overlay: InvoiceBuilderStep4PdfOverlay) => {
      setStep4Overlay(overlay);
    },
    []
  );

  const handlePdfOverridePersist = useCallback(
    (o: PdfColumnOverridePayload | null) => {
      pdfOverrideRef.current = o;
    },
    []
  );

  /** Meta fields (Zahlungsziel, Textblöcke) apply only while Bestätigung (Section 5) is open. */
  const applyStep4PdfOverlay =
    section4Unlocked && pdfStepAcknowledged && sectionOpen[5];

  // why: useMemo so the derived array keeps a stable reference between renders —
  // an inline .filter().map() produces a new array every render, firing the
  // preview hook's useEffect dependency comparison and causing an infinite reload loop.
  // why: EXCLUDED appendix slice — negation of isBillingIncludedRow (see billing-inclusion.ts).
  // Do not use billingIncludedLineItems here; this list is intentionally the inverse for the PDF appendix.
  const excludedTripsForPdf: ExcludedTripRow[] = useMemo(
    () =>
      lineItems
        .filter((li) => !li.billingInclusion.included)
        .map((li) => ({
          line_date: li.line_date,
          client_name: li.client_name,
          pickup_address: li.pickup_address,
          dropoff_address: li.dropoff_address,
          billing_exclusion_reason: li.billingInclusion.reason
        })),
    [lineItems]
  );

  // why: pre-split here with useMemo so the preview hook receives stable arrays —
  // filtering inside the hook's useEffect/render path would also re-fire on every render.
  const billedCancelledTripsForPdf = useMemo(
    () => cancelledTrips.filter((t) => t.billingInclusion.included),
    [cancelledTrips]
  );

  const passiveCancelledTripsForPdf = useMemo(
    () => cancelledTrips.filter((t) => !t.billingInclusion.included),
    [cancelledTrips]
  );

  // why: Step 4 table/count must mirror calculateInvoiceTotals input — same filter as
  // use-invoice-builder.ts L903–919 (billingIncludedLineItems + priced opted-in cancelled).
  const confirmationRows = useMemo(
    () => buildConfirmationDisplayRows(lineItems, cancelledTrips),
    [lineItems, cancelledTrips]
  );

  const { pdf, draftInvoice, isDirty, requestPreviewUpdate } =
    useInvoiceBuilderPdfPreview({
      companyId,
      companyProfile,
      step2Values: step2Snapshot,
      lineItems,
      passiveCancelledTrips: passiveCancelledTripsForPdf,
      billedCancelledTrips: billedCancelledTripsForPdf,
      excludedTrips: excludedTripsForPdf,
      payers,
      clients,
      defaultPaymentDays,
      catalogRecipientId,
      payerIntroBlockId: resolvedIntroBlockId,
      payerOutroBlockId: resolvedOutroBlockId,
      step4Overlay,
      applyStep4Overlay: applyStep4PdfOverlay,
      columnProfile: builderColumnProfile,
      columnReorderGeneration: pdfColumnReorderGeneration
    });

  const isLargeInvoice = lineItems.length >= MANUAL_PREVIEW_TRIP_THRESHOLD;

  const section2SummaryText = useMemo(
    () =>
      buildSection2Summary(
        step2Values?.period_from,
        step2Values?.period_to,
        selectedPayer?.name
      ),
    [step2Values?.period_from, step2Values?.period_to, selectedPayer?.name]
  );

  const section3SummaryText = useMemo(() => {
    // why: subtotal already reflects the billable slice; raw lineItems.length counted opted-out rows.
    if (confirmationRows.length === 0) return '';
    return `${confirmationRows.length} Positionen · ${formatEurDe(totals.subtotal)}`;
  }, [confirmationRows.length, totals.subtotal]);

  useEffect(() => {
    if (section1Complete && !prevSection1Complete.current) {
      setSectionOpen((s) => ({ ...s, 1: false, 2: true }));
      const id = window.setTimeout(() => {
        scrollSectionElementIntoLeftColumn(section2Ref.current, 'smooth');
      }, 300);
      return () => window.clearTimeout(id);
    }
    prevSection1Complete.current = section1Complete;
  }, [section1Complete, scrollSectionElementIntoLeftColumn]);

  useEffect(() => {
    if (section2Complete && !prevSection2Complete.current) {
      setSectionOpen((s) => ({ ...s, 2: false, 3: true }));
      const id = window.setTimeout(() => {
        scrollSectionElementIntoLeftColumn(section3Ref.current, 'smooth');
      }, 300);
      return () => window.clearTimeout(id);
    }
    prevSection2Complete.current = section2Complete;
  }, [section2Complete, scrollSectionElementIntoLeftColumn]);

  // Reacts to Section 3 first completing: open PDF-Vorlage (Section 4) and scroll it into view.
  useEffect(() => {
    if (!section3Complete) {
      prevSection3Complete.current = false;
      return undefined;
    }
    if (prevSection3Complete.current) return undefined;
    prevSection3Complete.current = true;
    setSectionOpen((s) => ({ ...s, 3: false, 4: true }));
    const id = window.setTimeout(() => {
      scrollSectionElementIntoLeftColumn(section4Ref.current, 'smooth');
    }, 300);
    return () => window.clearTimeout(id);
  }, [section3Complete, scrollSectionElementIntoLeftColumn]);

  // Reacts to user advancing from PDF-Vorlage: open Bestätigung (Section 5) and scroll it into view.
  useEffect(() => {
    if (!pdfStepAcknowledged) {
      prevPdfStepAcknowledged.current = false;
      return undefined;
    }
    if (prevPdfStepAcknowledged.current) return undefined;
    prevPdfStepAcknowledged.current = true;
    setSectionOpen((s) => ({ ...s, 4: false, 5: true }));
    const id = window.setTimeout(() => {
      scrollSectionElementIntoLeftColumn(section5Ref.current, 'smooth');
    }, 300);
    return () => window.clearTimeout(id);
  }, [pdfStepAcknowledged, scrollSectionElementIntoLeftColumn]);

  const sectionCompletionDots = [
    section1Complete,
    section2Complete,
    section3Complete,
    section4Unlocked,
    pdfStepAcknowledged
  ] as const;

  const scrollToSection = useCallback(
    (n: SectionNum) => {
      const el = document.getElementById(SECTION_SCROLL_IDS[n]);
      scrollSectionElementIntoLeftColumn(el, 'smooth');
    },
    [scrollSectionElementIntoLeftColumn]
  );

  if (companyProfileMissing) {
    return (
      <Alert>
        <AlertTriangle className='h-4 w-4' />
        <AlertDescription className='space-y-2'>
          <p>
            <strong>Unternehmenseinstellungen fehlen.</strong> Bitte
            vervollständigen Sie Ihr Unternehmensprofil, bevor Sie eine Rechnung
            erstellen.
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => router.push('/dashboard/settings/company')}
          >
            Zu den Einstellungen
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className='flex h-full min-h-0 gap-0 overflow-hidden'>
      {/* Left: scrollable form column */}
      <div className='border-border flex h-full w-[480px] shrink-0 flex-col overflow-hidden border-r'>
        {/* Page title / breadcrumb row */}
        <div className='border-border shrink-0 border-b px-6 py-4'>
          <h1 className='text-lg font-semibold'>
            {isEditMode ? 'Rechnung bearbeiten' : 'Neue Rechnung'}
          </h1>
          {/* why: visible edit-mode indicator so the admin always knows they are
              editing an existing draft (same invoice number is preserved). */}
          {isEditMode && editInvoiceNumber ? (
            <p className='text-muted-foreground mt-1 text-xs font-medium'>
              Bearbeitung — Rechnung {editInvoiceNumber}
            </p>
          ) : null}
        </div>
        {/* Scrollable area containing all five BuilderSectionCards */}
        <div
          ref={leftColumnScrollRef}
          className='min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4'
        >
          <div
            className={cn(
              'bg-muted/30 supports-[backdrop-filter]:bg-muted/30',
              'border-border flex justify-center gap-3 rounded-xl border py-2.5 backdrop-blur-sm'
            )}
          >
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button
                key={n}
                type='button'
                className={cn(
                  'focus-visible:ring-ring rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  'h-3 w-3',
                  sectionCompletionDots[n - 1]
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/35 bg-background hover:border-muted-foreground/60',
                  isLocked(n) && 'cursor-not-allowed opacity-40'
                )}
                aria-label={`Zu Abschnitt ${n} scrollen`}
                disabled={isLocked(n)}
                onClick={() => {
                  if (isLocked(n)) return;
                  setSectionOpen((s) => ({ ...s, [n]: true }));
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => scrollToSection(n));
                  });
                }}
              />
            ))}
          </div>

          <BuilderSectionCard
            id={SECTION_SCROLL_IDS[1]}
            sectionRef={section1Ref}
            title='Abrechnungsmodus'
            locked={false}
            completed={section1Complete}
            showFertigBadge
            summary={modeLabelDe(selectedMode) || null}
            open={sectionOpen[1]}
            onOpenChange={(o) => setSection(1, o)}
          >
            <Step1Mode
              selectedMode={selectedMode}
              onSelect={handleStep1Complete}
              locked={isEditMode}
            />
          </BuilderSectionCard>

          <BuilderSectionCard
            id={SECTION_SCROLL_IDS[2]}
            sectionRef={section2Ref}
            title='Parameter'
            locked={isLocked(2)}
            completed={section2Complete}
            showFertigBadge
            summary={section2SummaryText || null}
            open={sectionOpen[2]}
            onOpenChange={(o) => setSection(2, o)}
          >
            <Step2Params
              mode={(step2Values?.mode as InvoiceMode) ?? 'monthly'}
              payers={payers}
              clients={clients}
              isLoadingTrips={isLoadingTrips}
              locked={isEditMode}
              onNext={handleStep2Complete}
            />
          </BuilderSectionCard>

          <BuilderSectionCard
            id={SECTION_SCROLL_IDS[3]}
            sectionRef={section3Ref}
            title='Positionen'
            locked={isLocked(3)}
            completed={section3Complete}
            showFertigBadge
            summary={section3SummaryText || null}
            open={sectionOpen[3]}
            onOpenChange={(o) => setSection(3, o)}
            footer={
              section4Unlocked ? (
                <div className='border-border flex justify-end border-t pt-4'>
                  <Button
                    type='button'
                    onClick={() => {
                      setSectionOpen((s) => ({ ...s, 3: false, 4: true }));
                      window.setTimeout(() => {
                        scrollSectionElementIntoLeftColumn(
                          section4Ref.current,
                          'smooth'
                        );
                      }, 300);
                    }}
                  >
                    Weiter zu PDF-Vorlage
                  </Button>
                </div>
              ) : null
            }
          >
            <Step3LineItems
              lineItems={lineItems}
              cancelledTrips={cancelledTrips}
              subtotal={totals.subtotal}
              taxAmount={totals.taxAmount}
              total={totals.total}
              missingPrices={missingPrices}
              hasInclusionErrors={hasInclusionErrors}
              isLoadingTrips={isLoadingTrips}
              onConfirm={confirmSection3}
              onApplyGrossOverride={applyGrossOverride}
              onResetOverride={resetLineItemOverride}
              onApplyKmOverride={applyKmOverride}
              onResetKmOverride={resetKmOverride}
              onApplyTaxRateOverride={applyTaxRateOverride}
              onResetTaxRateOverride={resetTaxRateOverride}
              onLineItemInclusionChange={handleLineItemInclusionChange}
              onCancelledTripInclusionChange={
                handleCancelledTripInclusionChange
              }
              onCancelledTripGrossOverride={handleCancelledTripGrossOverride}
              onCancelledTripKmOverride={handleCancelledTripKmOverride}
              onCancelledTripApproachFeeChange={
                handleCancelledTripApproachFeeChange
              }
            />
          </BuilderSectionCard>

          <BuilderSectionCard
            id={SECTION_SCROLL_IDS[4]}
            sectionRef={section4Ref}
            title='PDF-Vorlage'
            locked={isLocked(4)}
            completed={false}
            showFertigBadge={false}
            summary={null}
            open={sectionOpen[4]}
            onOpenChange={(o) => setSection(4, o)}
            footer={
              section4Unlocked && !pdfStepAcknowledged ? (
                <div className='border-border flex justify-end border-t pt-4'>
                  <Button
                    type='button'
                    onClick={() => {
                      setPdfStepAcknowledged(true);
                    }}
                  >
                    Weiter zur Bestätigung
                  </Button>
                </div>
              ) : null
            }
          >
            <Step4Vorlage
              key={step2Values?.payer_id ?? '__no-payer__'}
              companyId={companyId}
              payerPdfVorlageId={selectedPayer?.pdf_vorlage_id}
              unlocked={section4Unlocked}
              excludedTripCount={excludedTripCount}
              hydratedPdfColumnOverride={
                isEditMode ? editHydratedPdfOverride : null
              }
              onColumnProfileChange={setBuilderColumnProfile}
              onPdfOverrideChange={handlePdfOverridePersist}
              onPdfColumnsReordered={() =>
                setPdfColumnReorderGeneration((g) => g + 1)
              }
              onResolvedVorlageRowChange={handleResolvedVorlageRowChange}
            />
          </BuilderSectionCard>

          <BuilderSectionCard
            id={SECTION_SCROLL_IDS[5]}
            sectionRef={section5Ref}
            title='Bestätigung'
            locked={isLocked(5)}
            completed={false}
            showFertigBadge={false}
            summary={null}
            open={sectionOpen[5]}
            onOpenChange={(o) => setSection(5, o)}
            footer={
              pdfStepAcknowledged ? (
                <div className='border-border flex justify-end border-t pt-4'>
                  <Button
                    type='submit'
                    form='invoice-step4-form'
                    disabled={isSubmitting || !section4Unlocked}
                  >
                    {/* why: edit mode saves an existing draft; create mode issues a
                        new one. Loading labels are verb-first to match each other. */}
                    {isEditMode
                      ? isSaving
                        ? 'Speichere Änderungen…'
                        : 'Änderungen speichern'
                      : isCreating
                        ? 'Erstelle Rechnung…'
                        : 'Rechnung erstellen'}
                  </Button>
                </div>
              ) : null
            }
          >
            <Step4Confirm
              subtotal={totals.subtotal}
              taxAmount={totals.taxAmount}
              total={totals.total}
              lineItemCount={confirmationRows.length}
              defaultPaymentDays={defaultPaymentDays}
              missingPrices={missingPrices}
              isCreating={isSubmitting}
              submitDisabled={isSubmitting || !section4Unlocked}
              hideSubmitButton
              onConfirm={(step4Values, adhocSnapshot) => {
                const snapshotOverride: PdfColumnOverridePayload = {
                  main_columns:
                    pdfOverrideRef.current?.main_columns ??
                    builderColumnProfile.main_columns,
                  appendix_columns:
                    pdfOverrideRef.current?.appendix_columns ??
                    builderColumnProfile.appendix_columns,
                  main_layout: builderColumnProfile.main_layout,
                  show_cancelled_trips: Boolean(
                    builderColumnProfile.show_cancelled_trips
                  ),
                  show_excluded_trips: Boolean(
                    builderColumnProfile.show_excluded_trips
                  ),
                  show_cancelled_billed_km_on_cover: Boolean(
                    builderColumnProfile.show_cancelled_billed_km_on_cover
                  ),
                  show_normal_billed_km_on_cover: Boolean(
                    builderColumnProfile.show_normal_billed_km_on_cover
                  )
                };
                if (isEditMode) {
                  updateInvoice(step4Values, snapshotOverride, adhocSnapshot);
                } else {
                  createInvoice(step4Values, snapshotOverride, adhocSnapshot);
                }
              }}
              isEditMode={isEditMode}
              defaultAdhocValues={defaultAdhocValues}
              resolvedIntroBlockId={resolvedIntroBlockId}
              resolvedOutroBlockId={resolvedOutroBlockId}
              defaultRechnungsempfaengerId={catalogRecipientId}
              catalogRecipientId={catalogRecipientId}
              lineItems={confirmationRows}
              onStep4PdfOverlayChange={handleStep4PdfOverlay}
              pdfOverlayEnabled={applyStep4PdfOverlay}
            />
          </BuilderSectionCard>

          {isMobile ? (
            <div className='flex justify-end pt-2 lg:hidden'>
              <Button
                type='button'
                variant='default'
                size='sm'
                onClick={() => setPreviewSheetOpen(true)}
              >
                Vorschau anzeigen
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {/* Right: PDF preview column — fills all remaining width */}
      <div className='hidden h-full min-w-0 flex-1 flex-col overflow-hidden lg:flex'>
        <InvoiceBuilderPdfPanel
          lineItemCount={lineItems.length}
          isLoadingTrips={isLoadingTrips}
          section2Complete={section2Complete}
          draftInvoice={draftInvoice}
          pdf={pdf}
          isDirty={isDirty}
          isLargeInvoice={isLargeInvoice}
          onRequestPreviewUpdate={requestPreviewUpdate}
        />
      </div>
      <Sheet
        open={previewSheetOpen}
        onOpenChange={(open) => {
          setPreviewSheetOpen(open);
          if (open) {
            // why: mobile sheet opening is the admin's explicit signal to view
            // the PDF. Trigger one render with the latest state so the panel
            // is not blank on open.
            requestPreviewUpdate();
          }
        }}
      >
        <SheetContent side='bottom' className='h-[88vh] overflow-hidden'>
          <SheetHeader>
            <SheetTitle>PDF-Vorschau</SheetTitle>
          </SheetHeader>
          <div className='mt-4 h-[calc(88vh-5rem)] overflow-auto'>
            <InvoiceBuilderPdfPanel
              lineItemCount={lineItems.length}
              isLoadingTrips={isLoadingTrips}
              section2Complete={section2Complete}
              draftInvoice={draftInvoice}
              pdf={pdf}
              isDirty={isDirty}
              isLargeInvoice={isLargeInvoice}
              onRequestPreviewUpdate={requestPreviewUpdate}
            />
          </div>
        </SheetContent>
      </Sheet>
      <TripSyncFailureDialog
        open={syncFailedItems.length > 0}
        items={syncFailedItems}
        onRetry={retrySyncFailedItems}
        onClose={clearSyncFailedItems}
      />
    </div>
  );
}
