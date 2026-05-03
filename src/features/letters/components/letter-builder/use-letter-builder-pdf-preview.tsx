'use client';

/**
 * Live PDF preview for the letter builder right panel.
 *
 * Mirrors `use-angebot-builder-pdf-preview.tsx`: form-derived draft → debounced
 * `usePDF` → blob URL for the shared `InvoiceBuilderPdfPanel` iframe.
 *
 * Logo URL resolution is shared with letter PDF downloads via
 * `companyProfileForLetterPdf` (see docs/plans/letters-pdf-preview-vs-download-audit.md).
 */

import { useEffect, useState } from 'react';
import { usePDF } from '@react-pdf/renderer';

import { companyProfileForLetterPdf } from '../../lib/company-profile-for-letter-pdf';

import type { Letter } from '../../types';
import {
  LetterPdfDocument,
  type LetterPdfDocumentProps
} from '../letter-pdf/letter-pdf-document';

const PDF_PREVIEW_DEBOUNCE_MS = 600;

export interface UseLetterBuilderPdfPreviewParams {
  companyProfile: LetterPdfDocumentProps['companyProfile'] | null;
  draftLetter: Letter | null;
}

export function useLetterBuilderPdfPreview({
  companyProfile,
  draftLetter
}: UseLetterBuilderPdfPreviewParams): {
  pdf: ReturnType<typeof usePDF>[0];
} {
  const [pdf, updatePdf] = usePDF();
  const [profileForPdf, setProfileForPdf] = useState<
    LetterPdfDocumentProps['companyProfile'] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    if (!companyProfile) {
      setProfileForPdf(null);
      return undefined;
    }
    setProfileForPdf(companyProfile);
    void companyProfileForLetterPdf(companyProfile).then((p) => {
      if (!cancelled && p) setProfileForPdf(p);
    });
    return () => {
      cancelled = true;
    };
  }, [companyProfile]);

  useEffect(() => {
    if (!draftLetter || !profileForPdf) return undefined;

    const t = window.setTimeout(() => {
      updatePdf(
        <LetterPdfDocument
          letter={draftLetter}
          companyProfile={profileForPdf}
        />
      );
    }, PDF_PREVIEW_DEBOUNCE_MS);

    return () => window.clearTimeout(t);
  }, [draftLetter, profileForPdf, updatePdf]);

  return { pdf };
}
