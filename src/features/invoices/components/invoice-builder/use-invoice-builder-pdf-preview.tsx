'use client';

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

export interface InvoiceBuilderStep4PdfOverlay {
  paymentDueDays: number;
  introText: string | null;
  outroText: string | null;
  recipientRow: RechnungsempfaengerRow | null | undefined;
}

export function useInvoiceBuilderPdfPreview(params: {
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
  /** When true (section 4 unlocked), Step 4 form fields override draft PDF inputs. */
  applyStep4Overlay: boolean;
}): {
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
    applyStep4Overlay
  } = params;

  const { data: textBlocks } = useAllInvoiceTextBlocks();
  const { data: empfaengerOptions } = useRechnungsempfaengerOptions();
  const [pdf, updatePdf] = usePDF();
  /** Same as invoice detail PDF preview: @react-pdf fetches the logo; private bucket needs a signed URL. */
  const [pdfLogoUrl, setPdfLogoUrl] = useState<string | null>(null);

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
      placeholderInvoiceNumber
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
    placeholderInvoiceNumber
  ]);

  useEffect(() => {
    if (!draftInvoice) return undefined;
    const t = window.setTimeout(() => {
      updatePdf(
        <InvoicePdfDocument
          invoice={draftInvoice}
          introText={introText}
          outroText={outroText}
          paymentQrDataUrl={null}
        />
      );
    }, 600);
    return () => window.clearTimeout(t);
  }, [draftInvoice, introText, outroText, updatePdf]);

  return { pdf, draftInvoice, livePreviewActive };
}
