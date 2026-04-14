'use client';

/**
 * Drives the live PDF preview in the Angebot builder right panel.
 *
 * Debounce is intentionally 600ms (vs 300ms in invoice builder) because the
 * offer form has more free-text fields (subject, recipient name, intro/outro)
 * where rapid keystroke re-renders would be jarring.
 *
 * Pattern mirrors use-invoice-builder-pdf-preview.tsx exactly:
 * form state → draft AngebotWithLineItems → usePDF(AngebotPdfDocument) → blob URL
 */

import { useEffect, useMemo, useState } from 'react';
import { usePDF } from '@react-pdf/renderer';

import { resolveCompanyAssetUrl } from '@/features/storage/resolve-company-asset-url';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';
import type { AngebotWithLineItems } from '../../types/angebot.types';
import { AngebotPdfDocument } from '../angebot-pdf/AngebotPdfDocument';

export interface UseAngebotBuilderPdfPreviewParams {
  companyProfile: InvoiceDetail['company_profile'] | null;
  /** Draft Angebot assembled from form state — may be partially filled. */
  draftAngebot: AngebotWithLineItems | null;
}

/**
 * Returns a debounced PDF instance for the builder preview panel.
 *
 * @returns pdf handle + livePreviewActive flag
 */
export function useAngebotBuilderPdfPreview({
  companyProfile,
  draftAngebot
}: UseAngebotBuilderPdfPreviewParams): {
  pdf: ReturnType<typeof usePDF>[0];
  livePreviewActive: boolean;
} {
  const [pdf, updatePdf] = usePDF();
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
    if (pdfLogoUrl) return { ...companyProfile, logo_url: pdfLogoUrl };
    return companyProfile;
  }, [companyProfile, pdfLogoUrl]);

  const livePreviewActive = !!draftAngebot && !!companyProfileForDraft;

  useEffect(() => {
    if (!draftAngebot || !companyProfileForDraft) return undefined;

    const t = window.setTimeout(() => {
      updatePdf(
        <AngebotPdfDocument
          angebot={draftAngebot}
          companyProfile={companyProfileForDraft}
        />
      );
    }, 600);

    return () => window.clearTimeout(t);
  }, [draftAngebot, companyProfileForDraft, updatePdf]);

  return { pdf, livePreviewActive };
}
