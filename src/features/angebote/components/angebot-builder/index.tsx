'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

import { BuilderSectionCard } from '@/components/ui/builder-section-card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InvoiceBuilderPdfPanel } from '@/features/invoices/components/invoice-builder/invoice-builder-pdf-panel';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';
import { AlertTriangle, Eye } from 'lucide-react';

import {
  lineItemsFromAngebotRows,
  useAngebotBuilder
} from '../../hooks/use-angebot-builder';
import {
  ANGEBOT_STANDARD_COLUMN_PROFILE,
  type AngebotWithLineItems,
  type UpdateAngebotPayload
} from '../../types/angebot.types';
import { Step1Empfaenger, type EmpfaengerValues } from './step-1-empfaenger';
import { Step2Positionen } from './step-2-positionen';
import { Step3Details, type DetailsValues } from './step-3-details';
import { useAngebotBuilderPdfPreview } from './use-angebot-builder-pdf-preview';

// ─── Map persisted offer → form state (edit pre-fill) ─────────────────────────

function defaultEmpfaengerValues(): EmpfaengerValues {
  return {
    recipient_company: '',
    recipient_first_name: '',
    recipient_last_name: '',
    recipient_anrede: '',
    recipient_street: '',
    recipient_street_number: '',
    recipient_zip: '',
    recipient_city: '',
    recipient_email: '',
    recipient_phone: '',
    customer_number: ''
  };
}

function empfaengerFromAngebot(a: AngebotWithLineItems): EmpfaengerValues {
  const ar = a.recipient_anrede;
  return {
    recipient_company: a.recipient_company ?? '',
    recipient_first_name: a.recipient_first_name ?? '',
    recipient_last_name: a.recipient_last_name ?? '',
    recipient_anrede: ar === 'Herr' || ar === 'Frau' ? ar : '',
    recipient_street: a.recipient_street ?? '',
    recipient_street_number: a.recipient_street_number ?? '',
    recipient_zip: a.recipient_zip ?? '',
    recipient_city: a.recipient_city ?? '',
    recipient_email: a.recipient_email ?? '',
    recipient_phone: a.recipient_phone ?? '',
    customer_number: a.customer_number ?? ''
  };
}

function defaultDetailsValues(): DetailsValues {
  return {
    subject: '',
    offer_date: format(new Date(), 'yyyy-MM-dd'),
    valid_until: '',
    intro_text: '',
    outro_text: ''
  };
}

function detailsFromAngebot(a: AngebotWithLineItems): DetailsValues {
  const od = a.offer_date?.slice(0, 10) ?? format(new Date(), 'yyyy-MM-dd');
  const vu = a.valid_until?.slice(0, 10) ?? '';
  return {
    subject: a.subject ?? '',
    offer_date: od,
    valid_until: vu,
    intro_text: a.intro_text ?? '',
    outro_text: a.outro_text ?? ''
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AngebotBuilderProps {
  companyId: string;
  companyProfile: InvoiceDetail['company_profile'] | null;
  companyProfileMissing?: boolean;
  /** When set, builder runs in edit mode (update header + replace line items). */
  initialAngebot?: AngebotWithLineItems | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AngebotBuilder({
  companyId,
  companyProfile,
  companyProfileMissing = false,
  initialAngebot = null
}: AngebotBuilderProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const isEdit = !!initialAngebot;

  // Section open/close state
  const [openSections, setOpenSections] = useState({
    empfaenger: true,
    positionen: false,
    details: false
  });
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  // Section refs for scroll-to
  const section1Ref = useRef<HTMLElement | null>(null);
  const section2Ref = useRef<HTMLElement | null>(null);
  const section3Ref = useRef<HTMLElement | null>(null);

  const [empfaengerValues, setEmpfaengerValues] = useState<EmpfaengerValues>(
    () =>
      initialAngebot
        ? empfaengerFromAngebot(initialAngebot)
        : defaultEmpfaengerValues()
  );

  const [detailsValues, setDetailsValues] = useState<DetailsValues>(() =>
    initialAngebot ? detailsFromAngebot(initialAngebot) : defaultDetailsValues()
  );

  const {
    lineItems,
    addLineItem,
    deleteLineItem,
    updateLineItem,
    reorderLineItems,
    createAngebotMutation,
    saveEditMutation,
    isPending
  } = useAngebotBuilder({
    mode: isEdit ? 'edit' : 'create',
    angebotId: initialAngebot?.id,
    initialLineItems: initialAngebot
      ? lineItemsFromAngebotRows(initialAngebot.line_items ?? [])
      : undefined,
    onSuccess: (id) => {
      router.push(`/dashboard/angebote/${id}`);
    }
  });

  // Derived completion states
  const section1Complete = !!(
    empfaengerValues.recipient_company || empfaengerValues.recipient_last_name
  );
  const section2Complete = lineItems.some((i) => i.leistung.trim().length > 0);
  const section3Complete = !!(
    detailsValues.subject.trim() && detailsValues.offer_date
  );
  const canConfirm = section2Complete && detailsValues.offer_date;

  const pdfColumnProfile =
    initialAngebot?.pdf_column_override ?? ANGEBOT_STANDARD_COLUMN_PROFILE;

  // Draft Angebot for live PDF preview
  const draftAngebot: AngebotWithLineItems | null = useMemo(() => {
    if (!companyId) return null;
    const base = initialAngebot;
    return {
      id: base?.id ?? '',
      company_id: companyId,
      angebot_number:
        base?.angebot_number ?? `AG-${format(new Date(), 'yyyy-MM')}-XXXX`,
      status: base?.status ?? 'draft',
      recipient_company: empfaengerValues.recipient_company || null,
      recipient_first_name: empfaengerValues.recipient_first_name || null,
      recipient_last_name: empfaengerValues.recipient_last_name || null,
      recipient_name:
        [
          empfaengerValues.recipient_first_name,
          empfaengerValues.recipient_last_name
        ]
          .filter(Boolean)
          .join(' ') || null,
      recipient_anrede: (empfaengerValues.recipient_anrede || null) as
        | 'Herr'
        | 'Frau'
        | null,
      recipient_street: empfaengerValues.recipient_street || null,
      recipient_street_number: empfaengerValues.recipient_street_number || null,
      recipient_zip: empfaengerValues.recipient_zip || null,
      recipient_city: empfaengerValues.recipient_city || null,
      recipient_email: empfaengerValues.recipient_email || null,
      recipient_phone: empfaengerValues.recipient_phone || null,
      customer_number: empfaengerValues.customer_number || null,
      subject: detailsValues.subject || null,
      valid_until: detailsValues.valid_until || null,
      offer_date: detailsValues.offer_date,
      intro_text: detailsValues.intro_text || null,
      outro_text: detailsValues.outro_text || null,
      pdf_column_override: pdfColumnProfile,
      created_at: base?.created_at ?? new Date().toISOString(),
      updated_at: base?.updated_at ?? new Date().toISOString(),
      line_items: lineItems.map((item, idx) => ({
        id: `draft-${idx}`,
        angebot_id: base?.id ?? '',
        position: idx + 1,
        leistung: item.leistung,
        anfahrtkosten: item.anfahrtkosten,
        price_first_5km: item.price_first_5km,
        price_per_km_after_5: item.price_per_km_after_5,
        notes: item.notes,
        created_at: new Date().toISOString()
      }))
    };
  }, [
    companyId,
    initialAngebot,
    empfaengerValues,
    detailsValues,
    lineItems,
    pdfColumnProfile
  ]);

  const { pdf, livePreviewActive } = useAngebotBuilderPdfPreview({
    companyProfile,
    draftAngebot
  });

  const lineItemsPayload = useCallback(
    () =>
      lineItems.map((item, idx) => ({
        position: idx + 1,
        leistung: item.leistung,
        anfahrtkosten: item.anfahrtkosten,
        price_first_5km: item.price_first_5km,
        price_per_km_after_5: item.price_per_km_after_5,
        notes: item.notes
      })),
    [lineItems]
  );

  // ─── Submit ──────────────────────────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    if (!companyId) return;

    if (isEdit && initialAngebot) {
      const header: UpdateAngebotPayload = {
        recipient_company: empfaengerValues.recipient_company || null,
        recipient_first_name: empfaengerValues.recipient_first_name || null,
        recipient_last_name: empfaengerValues.recipient_last_name || null,
        recipient_name:
          [
            empfaengerValues.recipient_first_name,
            empfaengerValues.recipient_last_name
          ]
            .filter(Boolean)
            .join(' ') || null,
        recipient_anrede: (empfaengerValues.recipient_anrede || null) as
          | 'Herr'
          | 'Frau'
          | null,
        recipient_street: empfaengerValues.recipient_street || null,
        recipient_street_number:
          empfaengerValues.recipient_street_number || null,
        recipient_zip: empfaengerValues.recipient_zip || null,
        recipient_city: empfaengerValues.recipient_city || null,
        recipient_email: empfaengerValues.recipient_email || null,
        recipient_phone: empfaengerValues.recipient_phone || null,
        customer_number: empfaengerValues.customer_number || null,
        subject: detailsValues.subject || null,
        valid_until: detailsValues.valid_until || null,
        offer_date: detailsValues.offer_date,
        intro_text: detailsValues.intro_text || null,
        outro_text: detailsValues.outro_text || null,
        pdf_column_override: pdfColumnProfile
      };
      saveEditMutation({ header, rows: lineItemsPayload() });
      return;
    }

    createAngebotMutation({
      companyId,
      recipient_company: empfaengerValues.recipient_company || null,
      recipient_first_name: empfaengerValues.recipient_first_name || null,
      recipient_last_name: empfaengerValues.recipient_last_name || null,
      recipient_name:
        [
          empfaengerValues.recipient_first_name,
          empfaengerValues.recipient_last_name
        ]
          .filter(Boolean)
          .join(' ') || null,
      recipient_anrede: (empfaengerValues.recipient_anrede || null) as
        | 'Herr'
        | 'Frau'
        | null,
      recipient_street: empfaengerValues.recipient_street || null,
      recipient_street_number: empfaengerValues.recipient_street_number || null,
      recipient_zip: empfaengerValues.recipient_zip || null,
      recipient_city: empfaengerValues.recipient_city || null,
      recipient_email: empfaengerValues.recipient_email || null,
      recipient_phone: empfaengerValues.recipient_phone || null,
      customer_number: empfaengerValues.customer_number || null,
      subject: detailsValues.subject || null,
      valid_until: detailsValues.valid_until || null,
      offer_date: detailsValues.offer_date,
      intro_text: detailsValues.intro_text || null,
      outro_text: detailsValues.outro_text || null,
      pdf_column_override: ANGEBOT_STANDARD_COLUMN_PROFILE,
      line_items: lineItemsPayload()
    });
  }, [
    companyId,
    isEdit,
    initialAngebot,
    empfaengerValues,
    detailsValues,
    pdfColumnProfile,
    lineItemsPayload,
    saveEditMutation,
    createAngebotMutation
  ]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const leftPanel = (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-y-auto p-4'>
        <div className='mx-auto max-w-lg space-y-3'>
          {companyProfileMissing ? (
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                Firmenprofil unvollständig. Bitte zuerst Firmenname und
                Steuernummer hinterlegen.
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Section 1 — Empfänger */}
          <BuilderSectionCard
            id='section-empfaenger'
            sectionRef={section1Ref}
            title='1. Empfänger'
            locked={false}
            completed={section1Complete}
            showFertigBadge={section1Complete}
            summary={
              empfaengerValues.recipient_company ||
              empfaengerValues.recipient_last_name ||
              null
            }
            open={openSections.empfaenger}
            onOpenChange={(o) =>
              setOpenSections((s) => ({ ...s, empfaenger: o }))
            }
          >
            <Step1Empfaenger
              values={empfaengerValues}
              onChange={(patch) =>
                setEmpfaengerValues((v) => ({ ...v, ...patch }))
              }
            />
          </BuilderSectionCard>

          {/* Section 2 — Positionen */}
          <BuilderSectionCard
            id='section-positionen'
            sectionRef={section2Ref}
            title='2. Positionen'
            locked={false}
            completed={section2Complete}
            showFertigBadge={section2Complete}
            summary={section2Complete ? `${lineItems.length} Zeile(n)` : null}
            open={openSections.positionen}
            onOpenChange={(o) =>
              setOpenSections((s) => ({ ...s, positionen: o }))
            }
          >
            <Step2Positionen
              items={lineItems}
              onUpdate={updateLineItem}
              onDelete={deleteLineItem}
              onReorder={reorderLineItems}
              onAdd={addLineItem}
            />
          </BuilderSectionCard>

          {/* Section 3 — Details */}
          <BuilderSectionCard
            id='section-details'
            sectionRef={section3Ref}
            title='3. Details'
            locked={false}
            completed={section3Complete}
            showFertigBadge={section3Complete}
            summary={detailsValues.subject || null}
            open={openSections.details}
            onOpenChange={(o) => setOpenSections((s) => ({ ...s, details: o }))}
          >
            <Step3Details
              values={detailsValues}
              onChange={(patch) =>
                setDetailsValues((v) => ({ ...v, ...patch }))
              }
            />
          </BuilderSectionCard>
        </div>
      </div>

      {/* Footer — confirm button */}
      <div className='border-border bg-background flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3'>
        {isMobile ? (
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setMobilePreviewOpen(true)}
          >
            <Eye className='mr-1.5 h-4 w-4' />
            Vorschau
          </Button>
        ) : (
          <span />
        )}
        <Button
          type='button'
          disabled={!canConfirm || isPending || companyProfileMissing}
          onClick={handleConfirm}
        >
          {isPending
            ? 'Wird gespeichert…'
            : isEdit
              ? 'Änderungen speichern'
              : 'Angebot erstellen'}
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className={cn('flex min-h-0 flex-1 overflow-hidden', 'flex-row gap-0')}
    >
      {/* Left panel */}
      <div className='border-border flex w-full shrink-0 flex-col overflow-hidden border-r lg:w-[480px]'>
        {leftPanel}
      </div>

      {/* Right panel — PDF preview (desktop only). Must be h-full flex-col so
           InvoiceBuilderPdfPanel fills the panel and the iframe fills it too. */}
      <div className='hidden h-full min-w-0 flex-1 flex-col overflow-hidden lg:flex'>
        <InvoiceBuilderPdfPanel
          lineItemCount={lineItems.length}
          isLoadingTrips={false}
          section2Complete={livePreviewActive}
          draftInvoice={livePreviewActive ? ({} as InvoiceDetail) : null}
          pdf={{ loading: pdf.loading, url: pdf.url ?? null }}
        />
      </div>

      {/* Mobile sheet preview */}
      <Sheet open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen}>
        <SheetContent
          side='right'
          className='flex w-full flex-col p-0 sm:max-w-lg'
        >
          <SheetHeader className='shrink-0 px-4 pt-4'>
            <SheetTitle>Vorschau</SheetTitle>
          </SheetHeader>
          <div className='relative min-h-0 flex-1 overflow-hidden'>
            {pdf.url ? (
              <iframe
                title='Angebot Vorschau'
                src={pdf.url}
                className='absolute inset-0 h-full w-full border-0'
              />
            ) : (
              <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
                Vorschau wird geladen…
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
