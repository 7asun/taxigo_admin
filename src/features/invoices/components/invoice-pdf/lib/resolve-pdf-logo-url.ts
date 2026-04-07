import { resolveCompanyAssetUrl } from '@/features/storage/resolve-company-asset-url';

/**
 * @react-pdf/renderer fetches images in the browser context.
 *
 * If the Storage bucket is private, `getPublicUrl()` produces a URL that exists but
 * is not accessible (403), which results in a blank image in the PDF.
 *
 * This helper converts a known `company-assets` URL into a signed URL so the PDF renderer
 * can fetch it even when the bucket is private.
 */
export async function resolvePdfLogoUrl(
  logoUrl: string,
  expiresInSeconds = 60 * 60
): Promise<string> {
  const trimmed = logoUrl.trim();
  if (!trimmed) return logoUrl;

  const resolved = await resolveCompanyAssetUrl({
    url: trimmed,
    expiresInSeconds
  });
  return resolved ?? trimmed;
}
