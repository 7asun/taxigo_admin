'use client';

/**
 * Invoice builder — long-form layout, sticky PDF column in page scroll,
 * per-section Collapsible open state (only locked sections are forced closed).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle, Check, ChevronDown, Lock } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
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
  isInvoiceBuilderSection4Unlocked
} from '@/features/invoices/lib/invoice-builder-section-guards';
import { useInvoiceBuilder } from '../../hooks/use-invoice-builder';
import { Step1Mode } from './step-1-mode';
import { Step2Params } from './step-2-params';
import { Step3LineItems } from './step-3-line-items';
import { Step4Confirm } from './step-4-confirm';
import { InvoiceBuilderPdfPanel } from './invoice-builder-pdf-panel';
import {
  useInvoiceBuilderPdfPreview,
  type InvoiceBuilderStep4PdfOverlay
} from './use-invoice-builder-pdf-preview';
import type { InvoiceDetail, InvoiceMode } from '../../types/invoice.types';
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
};

type Client = NonNullable<InvoiceDetail['client']>;

type SectionNum = 1 | 2 | 3 | 4;

interface InvoiceBuilderProps {
  companyId: string;
  payers: Payer[];
  clients: Client[];
  defaultPaymentDays: number;
  companyProfile: InvoiceDetail['company_profile'] | null;
  companyProfileMissing?: boolean;
}

const SECTION_SCROLL_IDS: Record<SectionNum, string> = {
  1: 'invoice-builder-section-1',
  2: 'invoice-builder-section-2',
  3: 'invoice-builder-section-3',
  4: 'invoice-builder-section-4'
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

interface BuilderSectionCardProps {
  id: string;
  sectionRef: RefObject<HTMLElement | null>;
  title: string;
  locked: boolean;
  completed: boolean;
  showFertigBadge: boolean;
  summary: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function BuilderSectionCard({
  id,
  sectionRef,
  title,
  locked,
  completed,
  showFertigBadge,
  summary,
  open,
  onOpenChange,
  children,
  footer
}: BuilderSectionCardProps) {
  const isOpen = locked ? false : open;

  return (
    <section ref={sectionRef} id={id} className='scroll-mt-3'>
      <Collapsible
        open={isOpen}
        onOpenChange={locked ? undefined : onOpenChange}
      >
        <div
          className={cn(
            'bg-card border-border overflow-hidden rounded-xl border shadow-sm'
          )}
        >
          <CollapsibleTrigger asChild disabled={locked}>
            <button
              type='button'
              className={cn(
                'hover:bg-muted/40 flex w-full items-start justify-between gap-3 p-6 text-left transition-colors',
                locked && 'cursor-not-allowed opacity-80 hover:bg-transparent'
              )}
            >
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-semibold'>{title}</p>
                {completed && !isOpen && summary ? (
                  <p className='text-muted-foreground mt-1 text-sm'>
                    {summary}
                  </p>
                ) : null}
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {completed && showFertigBadge ? (
                  <Badge
                    variant='outline'
                    className='border-green-200 bg-green-500/10 text-green-800 dark:border-green-800 dark:bg-green-500/15 dark:text-green-300'
                  >
                    <Check className='h-3 w-3' aria-hidden />
                    Fertig
                  </Badge>
                ) : null}
                {locked ? (
                  <span className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                    <Lock className='h-3.5 w-3.5 shrink-0' aria-hidden />
                    Gesperrt
                  </span>
                ) : null}
                {!locked ? (
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200',
                      isOpen && 'rotate-180'
                    )}
                    aria-hidden
                  />
                ) : null}
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent
            className={cn(
              'data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down'
            )}
          >
            <div className='border-border space-y-4 border-t px-6 pt-4 pb-6'>
              {children}
              {footer}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </section>
  );
}

export function InvoiceBuilder({
  companyId,
  payers,
  clients,
  defaultPaymentDays,
  companyProfile,
  companyProfileMissing
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
    4: false
  });

  const section1Ref = useRef<HTMLElement | null>(null);
  const section2Ref = useRef<HTMLElement | null>(null);
  const section3Ref = useRef<HTMLElement | null>(null);
  const section4Ref = useRef<HTMLElement | null>(null);
  /** Scrollable column — never use scrollIntoView on sections; it scrolls dashboard ancestors. */
  const leftColumnScrollRef = useRef<HTMLDivElement | null>(null);

  const prevSection1Complete = useRef(false);
  const prevSection2Complete = useRef(false);

  const {
    step2Values,
    lineItems,
    totals,
    missingPrices,
    isLoadingTrips,
    isTripsError,
    handleStep1Complete,
    handleStep2Complete,
    updateLineItemPrice,
    createInvoice,
    isCreating,
    catalogRecipientId
  } = useInvoiceBuilder(companyId, (newId) => {
    router.push(`/dashboard/invoices/${newId}`);
  });

  const selectedPayer = step2Values?.payer_id
    ? payers.find((p) => p.id === step2Values.payer_id)
    : null;

  const selectedMode = (step2Values?.mode as InvoiceMode) ?? null;

  const section1Complete = isInvoiceBuilderSection1Complete(step2Values);
  const section2Complete = isInvoiceBuilderSection2Complete(step2Values);
  const section3Complete = isInvoiceBuilderSection3Complete(
    section2Complete,
    lineItems,
    isLoadingTrips,
    isTripsError
  );
  const section4Unlocked = isInvoiceBuilderSection4Unlocked(section3Complete);

  const isLocked = useCallback(
    (n: SectionNum) => {
      if (n === 1) return false;
      if (n === 2) return !section1Complete;
      if (n === 3) return !section2Complete;
      return !section3Complete;
    },
    [section1Complete, section2Complete, section3Complete]
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

  const handleStep4PdfOverlay = useCallback(
    (overlay: InvoiceBuilderStep4PdfOverlay) => {
      setStep4Overlay(overlay);
    },
    []
  );

  const applyStep4PdfOverlay = section4Unlocked && sectionOpen[4];

  const { pdf, draftInvoice } = useInvoiceBuilderPdfPreview({
    companyId,
    companyProfile,
    step2Values: step2Snapshot,
    lineItems,
    payers,
    clients,
    defaultPaymentDays,
    catalogRecipientId,
    payerIntroBlockId: selectedPayer?.default_intro_block_id,
    payerOutroBlockId: selectedPayer?.default_outro_block_id,
    step4Overlay,
    applyStep4Overlay: applyStep4PdfOverlay
  });

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
    if (lineItems.length === 0) return '';
    return `${lineItems.length} Positionen · ${formatEurDe(totals.subtotal)}`;
  }, [lineItems.length, totals.subtotal]);

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

  const sectionCompletionDots = [
    section1Complete,
    section2Complete,
    section3Complete,
    section4Unlocked
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
          <h1 className='text-lg font-semibold'>Neue Rechnung</h1>
        </div>
        {/* Scrollable area containing all four BuilderSectionCards */}
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
            {([1, 2, 3, 4] as const).map((n) => (
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
                    Weiter zur Bestätigung
                  </Button>
                </div>
              ) : null
            }
          >
            <Step3LineItems
              lineItems={lineItems}
              subtotal={totals.subtotal}
              taxAmount={totals.taxAmount}
              total={totals.total}
              missingPrices={missingPrices}
              isLoadingTrips={isLoadingTrips}
              onUpdatePrice={updateLineItemPrice}
            />
          </BuilderSectionCard>

          <BuilderSectionCard
            id={SECTION_SCROLL_IDS[4]}
            sectionRef={section4Ref}
            title='Bestätigung'
            locked={isLocked(4)}
            completed={false}
            showFertigBadge={false}
            summary={null}
            open={sectionOpen[4]}
            onOpenChange={(o) => setSection(4, o)}
          >
            <Step4Confirm
              subtotal={totals.subtotal}
              taxAmount={totals.taxAmount}
              total={totals.total}
              lineItemCount={lineItems.length}
              defaultPaymentDays={defaultPaymentDays}
              missingPrices={missingPrices}
              isCreating={isCreating}
              submitDisabled={isCreating || !section4Unlocked}
              onConfirm={(step4Values) => createInvoice(step4Values)}
              payerIntroBlockId={selectedPayer?.default_intro_block_id}
              payerOutroBlockId={selectedPayer?.default_outro_block_id}
              defaultRechnungsempfaengerId={catalogRecipientId}
              catalogRecipientId={catalogRecipientId}
              lineItems={lineItems}
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
        />
      </div>
      <Sheet open={previewSheetOpen} onOpenChange={setPreviewSheetOpen}>
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
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
