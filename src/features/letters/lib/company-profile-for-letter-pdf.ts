/**
 * Shared company profile resolution for letter PDFs (preview + downloads).
 *
 * Private `company-assets` logos need a signed URL for @react-pdf to fetch them.
 * Preview already did this; downloads used raw `company_profile` and could render
 * a different header height (DIN body offset). See
 * docs/plans/letters-pdf-preview-vs-download-audit.md.
 */

import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';
import { resolveCompanyAssetUrl } from '@/features/storage/resolve-company-asset-url';

export type CompanyProfileForLetterPdf = InvoiceDetail['company_profile'];

export async function companyProfileForLetterPdf(
  companyProfile: CompanyProfileForLetterPdf | null
): Promise<CompanyProfileForLetterPdf | null> {
  if (!companyProfile) return null;

  const logoPath = companyProfile.logo_path ?? null;
  const legacyUrl = companyProfile.logo_url ?? null;
  if (!logoPath && !legacyUrl) {
    return companyProfile;
  }

  const resolved = await resolveCompanyAssetUrl({
    path: logoPath,
    url: legacyUrl,
    expiresInSeconds: 60 * 60
  });

  if (resolved) {
    return { ...companyProfile, logo_url: resolved };
  }
  return companyProfile;
}
