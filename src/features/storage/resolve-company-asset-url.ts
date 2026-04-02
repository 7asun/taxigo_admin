import { createClient } from '@/lib/supabase/client';

const COMPANY_ASSETS_BUCKET = 'company-assets';

function extractCompanyAssetsPathFromUrl(url: string): string | null {
  // Public URL format:
  //   https://<ref>.supabase.co/storage/v1/object/public/company-assets/<path>
  const publicMarker = `/storage/v1/object/public/${COMPANY_ASSETS_BUCKET}/`;
  const idx = url.indexOf(publicMarker);
  if (idx >= 0) {
    const path = url.slice(idx + publicMarker.length);
    return path ? decodeURIComponent(path) : null;
  }

  // Signed URL format:
  //   https://<ref>.supabase.co/storage/v1/object/sign/company-assets/<path>?token=...
  const signMarker = `/storage/v1/object/sign/${COMPANY_ASSETS_BUCKET}/`;
  const idxSign = url.indexOf(signMarker);
  if (idxSign >= 0) {
    const rest = url.slice(idxSign + signMarker.length);
    const path = rest.split('?')[0] ?? '';
    return path ? decodeURIComponent(path) : null;
  }

  // (Older / error-log) URL format:
  //   https://<ref>.supabase.co/storage/v1/object/company-assets/<path>
  const legacyMarker = `/storage/v1/object/${COMPANY_ASSETS_BUCKET}/`;
  const idxLegacy = url.indexOf(legacyMarker);
  if (idxLegacy >= 0) {
    const path = url.slice(idxLegacy + legacyMarker.length);
    return path ? decodeURIComponent(path) : null;
  }

  return null;
}

export interface ResolveCompanyAssetUrlArgs {
  /** Bucket-relative path like "<company_id>/logo.png" */
  path?: string | null;
  /** Legacy stored URL, used only for backward compatibility */
  url?: string | null;
  expiresInSeconds?: number;
}

/**
 * Returns a URL that the browser can actually fetch for a `company-assets` object.
 *
 * - If the bucket is private, this returns a signed URL.
 * - If `path` is provided, it is used directly (preferred best practice).
 * - If only `url` is provided, we try to extract the object path from it (legacy support).
 */
export async function resolveCompanyAssetUrl({
  path,
  url,
  expiresInSeconds = 60 * 60
}: ResolveCompanyAssetUrlArgs): Promise<string | null> {
  const normalizedPath = path?.trim() || null;
  const normalizedUrl = url?.trim() || null;

  // If we were already given a signed URL, keep it.
  if (normalizedUrl && normalizedUrl.includes('/storage/v1/object/sign/')) {
    return normalizedUrl;
  }

  const objectPath =
    normalizedPath ??
    (normalizedUrl ? extractCompanyAssetsPathFromUrl(normalizedUrl) : null);
  if (!objectPath) return normalizedUrl;

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(COMPANY_ASSETS_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error || !data?.signedUrl) return normalizedUrl;
  return data.signedUrl;
}
