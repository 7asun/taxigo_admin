'use client';

/**
 * use-invoice-builder-pdf-preview.tsx
 *
 * Debounced @react-pdf hook for the invoice builder’s live preview. Composes
 * draft InvoiceDetail from trips + Step 2 snapshot + optional Step 5 meta overlay.
 *
 * Must not call createInvoice or mutate TanStack Query caches — read-only hooks only.
 *
 * Related: {@link build-draft-invoice-detail-for-pdf.ts}, {@link InvoicePdfDocument.tsx}.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePDF } from '@react-pdf/renderer';

import { resolveCompanyAssetUrl } from '@/features/storage/resolve-company-asset-url';
import { useAllInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';
import { useRechnungsempfaengerOptions } from '@/features/rechnungsempfaenger/hooks/use-rechnungsempfaenger-options';
import type { RechnungsempfaengerRow } from '@/features/rechnungsempfaenger/api/rechnungsempfaenger.service';
import {
  buildDraftInvoiceDetailForPdf,
  type InvoiceBuilderStep2Snapshot
} from '@/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf';
import { InvoicePdfDocument } from '@/features/invoices/components/invoice-pdf/InvoicePdfDocument';
import type {
  BuilderLineItem,
  InvoiceDetail
} from '@/features/invoices/types/invoice.types';
import type { PdfColumnProfile } from '@/features/invoices/types/pdf-vorlage.types';

export interface InvoiceBuilderStep4PdfOverlay {
  paymentDueDays: number;
  introText: string | null;
  outroText: string | null;
  recipientRow: RechnungsempfaengerRow | null | undefined;
}

export interface UseInvoiceBuilderPdfPreviewParams {
  companyId: string;
  companyProfile: InvoiceDetail['company_profile'] | null;
  step2Values: InvoiceBuilderStep2Snapshot | null;
  lineItems: BuilderLineItem[];
  payers: NonNullable<InvoiceDetail['payer']>[];
  clients: NonNullable<InvoiceDetail['client']>[];
  defaultPaymentDays: number;
  catalogRecipientId: string | null;
  payerIntroBlockId?: string | null;
  payerOutroBlockId?: string | null;
  step4Overlay: InvoiceBuilderStep4PdfOverlay | null;
  /** When true, Step 5 (Bestätigung) form fields override draft PDF meta inputs. */
  applyStep4Overlay: boolean;
  /**
   * columnProfile — resolved PDF column profile from Section 4 (PDF-Vorlage).
   * Passed into buildDraftInvoiceDetailForPdf so the live preview reflects
   * the dispatcher’s Vorlage/column selection in real time.
   * Initialized to system default in index.tsx so this value is never null.
   */
  columnProfile: PdfColumnProfile;
}

/**
 * Returns a debounced PDF instance and the current draft invoice for the builder preview.
 *
 * @param params — builder snapshot + overlay flags + column profile
 * @returns pdf handle, draft row or null when preview inactive, livePreviewActive flag
 */
export function useInvoiceBuilderPdfPreview(
  params: UseInvoiceBuilderPdfPreviewParams
): {
  pdf: ReturnType<typeof usePDF>[0];
  draftInvoice: InvoiceDetail | null;
  livePreviewActive: boolean;
} {
  const {
    companyId,
    companyProfile,
    step2Values,
    lineItems,
    payers,
    clients,
    defaultPaymentDays,
    catalogRecipientId,
    payerIntroBlockId,
    payerOutroBlockId,
    step4Overlay,
    applyStep4Overlay,
    columnProfile
  } = params;

  const { data: textBlocks } = useAllInvoiceTextBlocks();
  const { data: empfaengerOptions } = useRechnungsempfaengerOptions();
  const [pdf, updatePdf] = usePDF();
  /** Same as invoice detail PDF preview: @react-pdf fetches the logo; private bucket needs a signed URL. */
  const [pdfLogoUrl, setPdfLogoUrl] = useState<string | null>(null);

  // Reacts to company logo path/url: resolves a short-lived signed URL for the PDF renderer.
  useEffect(() => {
    if (!companyProfile) {
      setPdfLogoUrl(null);
      return;
    }
    const logoPath = companyProfile.logo_path ?? null;
    const legacyUrl = companyProfile.logo_url ?? null;
    if (!logoPath && !legacyUrl) {
      setPdfLogoUrl(null);
      return;
    }
    let cancelled = false;
    void resolveCompanyAssetUrl({
      path: logoPath,
      url: legacyUrl,
      expiresInSeconds: 60 * 60
    }).then((resolved) => {
      if (!cancelled) setPdfLogoUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [companyProfile?.logo_path, companyProfile?.logo_url]);

  const companyProfileForDraft = useMemo(() => {
    if (!companyProfile) return null;
    if (pdfLogoUrl) {
      return { ...companyProfile, logo_url: pdfLogoUrl };
    }
    return companyProfile;
  }, [companyProfile, pdfLogoUrl]);

  const placeholderInvoiceNumber = useMemo(() => {
    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, '0');
    return `RE-${y}-${m}-XXXX`;
  }, []);

  const introDefault = useMemo(() => {
    if (!textBlocks || !payerIntroBlockId) return null;
    return textBlocks.find((b) => b.id === payerIntroBlockId)?.content ?? null;
  }, [textBlocks, payerIntroBlockId]);

  const outroDefault = useMemo(() => {
    if (!textBlocks || !payerOutroBlockId) return null;
    return textBlocks.find((b) => b.id === payerOutroBlockId)?.content ?? null;
  }, [textBlocks, payerOutroBlockId]);

  const defaultRecipientRow = useMemo(() => {
    if (!catalogRecipientId || !empfaengerOptions?.length) return undefined;
    return empfaengerOptions.find((r) => r.id === catalogRecipientId);
  }, [catalogRecipientId, empfaengerOptions]);

  const livePreviewActive =
    lineItems.length > 0 && !!step2Values && !!companyProfile;

  const useStep4Overlay = applyStep4Overlay && step4Overlay !== null;

  const paymentDueDays = useStep4Overlay
    ? step4Overlay!.paymentDueDays
    : defaultPaymentDays;

  const introText = useStep4Overlay ? step4Overlay!.introText : introDefault;

  const outroText = useStep4Overlay ? step4Overlay!.outroText : outroDefault;

  const recipientRow = useStep4Overlay
    ? step4Overlay!.recipientRow
    : defaultRecipientRow;

  const draftInvoice = useMemo(() => {
    if (!livePreviewActive || !companyProfileForDraft || !step2Values)
      return null;
    return buildDraftInvoiceDetailForPdf({
      companyId,
      companyProfile: companyProfileForDraft,
      step2: step2Values,
      lineItems,
      payers,
      clients,
      paymentDueDays,
      introText,
      outroText,
      recipientRow,
      placeholderInvoiceNumber,
      columnProfile
    });
  }, [
    livePreviewActive,
    companyId,
    companyProfileForDraft,
    step2Values,
    lineItems,
    payers,
    clients,
    paymentDueDays,
    introText,
    outroText,
    recipientRow,
    placeholderInvoiceNumber,
    columnProfile
  ]);

  const [paymentQrDataUrl, setPaymentQrDataUrl] = useState<string | null>(null);

  // Reacts to draft invoice changes: generates a SEPA QR data URL for the payment block.
  useEffect(() => {
    if (!draftInvoice) {
      setPaymentQrDataUrl(null);
      return;
    }
    let cancelled = false;
    import(
      '@/features/invoices/components/invoice-pdf/generate-payment-qr-data-url'
    ).then(({ generatePaymentQrDataUrl }) => {
      void generatePaymentQrDataUrl(draftInvoice).then((url) => {
        if (!cancelled) setPaymentQrDataUrl(url);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [draftInvoice]);

  // Reacts to draft invoice or text overlay changes: debounces updatePdf so the worker is not flooded.
  useEffect(() => {
    if (!draftInvoice) return undefined;
    const t = window.setTimeout(() => {
      updatePdf(
        <InvoicePdfDocument
          invoice={draftInvoice}
          introText={introText}
          outroText={outroText}
          paymentQrDataUrl={paymentQrDataUrl}
          columnProfile={columnProfile}
        />
      );
    }, 600);
    return () => window.clearTimeout(t);
  }, [
    draftInvoice,
    introText,
    outroText,
    columnProfile,
    updatePdf,
    paymentQrDataUrl
  ]);

  return { pdf, draftInvoice, livePreviewActive };
}
