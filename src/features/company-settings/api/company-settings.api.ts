/**
 * company-settings.api.ts
 *
 * Supabase API layer for the company_profiles table.
 * Handles: fetch, upsert, and logo upload to Storage.
 *
 * Logo storage best practice:
 * - Persist a stable Storage path in DB (`company_profiles.logo_path`)
 * - Generate signed URLs at render time (works for private buckets)
 *
 * Called by: use-company-settings.ts (React Query hook)
 * Do NOT call directly from UI components.
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type {
  CompanyProfile,
  CompanyProfileUpsertPayload
} from '../types/company-settings.types';

/** Supabase Storage bucket that holds company logo files. */
const LOGO_BUCKET = 'company-assets';

// Legacy helper: only used to support older DB rows that still store logo_url.
function extractCompanyAssetsPathFromUrl(url: string): string | null {
  // Public URL format:
  //   https://<ref>.supabase.co/storage/v1/object/public/company-assets/<path>
  const publicMarker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const idx = url.indexOf(publicMarker);
  if (idx >= 0) {
    const path = url.slice(idx + publicMarker.length);
    return path ? decodeURIComponent(path) : null;
  }

  // Signed URL format:
  //   https://<ref>.supabase.co/storage/v1/object/sign/company-assets/<path>?token=...
  const signMarker = `/storage/v1/object/sign/${LOGO_BUCKET}/`;
  const idxSign = url.indexOf(signMarker);
  if (idxSign >= 0) {
    const rest = url.slice(idxSign + signMarker.length);
    const path = rest.split('?')[0] ?? '';
    return path ? decodeURIComponent(path) : null;
  }

  // (Older / error-log) URL format:
  //   https://<ref>.supabase.co/storage/v1/object/company-assets/<path>
  const legacyMarker = `/storage/v1/object/${LOGO_BUCKET}/`;
  const idxLegacy = url.indexOf(legacyMarker);
  if (idxLegacy >= 0) {
    const path = url.slice(idxLegacy + legacyMarker.length);
    return path ? decodeURIComponent(path) : null;
  }

  return null;
}

export class CompanySettingsService {
  /**
   * Fetches the company profile for the current authenticated user's company.
   *
   * Flow:
   *   1. Get auth.user → look up their company_id in accounts table
   *   2. Query company_profiles for that company_id
   *   3. Return null if no profile exists yet (first-time setup)
   */
  static async getProfile(): Promise<CompanyProfile | null> {
    const supabase = createClient();

    // Step 1: resolve company_id from the current user's account
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Nicht angemeldet');

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (accountError) {
      console.error(
        '[CompanySettings] Error resolving company_id:',
        accountError
      );
      throw toQueryError(accountError);
    }

    const companyId = account?.company_id;
    if (!companyId) throw new Error('Kein Unternehmen zugeordnet');

    // Step 2: fetch the profile (may not exist yet)
    const { data, error } = await supabase
      .from('company_profiles')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle(); // Returns null instead of error when row not found

    if (error) {
      console.error('[CompanySettings] Error fetching profile:', error);
      throw toQueryError(error);
    }

    return data as CompanyProfile | null;
  }

  /**
   * Upserts (creates or updates) the company profile.
   *
   * Uses onConflict on company_id — safe to call on both
   * first-time save and subsequent updates.
   *
   * Returns the saved profile so the UI can update immediately.
   */
  static async upsertProfile(
    payload: CompanyProfileUpsertPayload
  ): Promise<CompanyProfile> {
    const supabase = createClient();

    // Resolve company_id from the current user
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Nicht angemeldet');

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (accountError) throw toQueryError(accountError);
    const companyId = account?.company_id;
    if (!companyId) throw new Error('Kein Unternehmen zugeordnet');

    // Upsert — conflict target is the UNIQUE(company_id) constraint
    const { data, error } = await supabase
      .from('company_profiles')
      .upsert(
        {
          company_id: companyId,
          ...payload,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'company_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[CompanySettings] Error upserting profile:', error);
      throw toQueryError(error);
    }

    return data as CompanyProfile;
  }

  /**
   * Uploads a logo file to Supabase Storage and returns the public URL.
   *
   * Storage path: company-assets/{company_id}/logo.{ext}
   * Overwrites any existing logo for the same company.
   *
   * Important: we upload with { upsert: true }. For Supabase Storage this requires
   * RLS policies on storage.objects that allow SELECT + INSERT + UPDATE (not INSERT alone),
   * otherwise uploads can fail with an RLS violation.
   *
   * After calling this, the caller should also update company_profiles.logo_path.
   */
  static async uploadLogo(file: File, companyId: string): Promise<string> {
    const supabase = createClient();

    // Use a fixed filename per company so old logos are automatically replaced
    const ext = file.name.split('.').pop() ?? 'png';
    const storagePath = `${companyId}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(storagePath, file, {
        upsert: true, // overwrite existing
        contentType: file.type
      });

    if (uploadError) {
      console.error('[CompanySettings] Logo upload error:', uploadError);
      throw new Error(
        'Logo konnte nicht hochgeladen werden: ' + uploadError.message
      );
    }

    // Return a stable bucket-relative path; callers can generate signed URLs as needed.
    return storagePath;
  }

  /**
   * Updates only `logo_path` — avoids sending a partial upsert that could
   * overwrite other columns depending on PostgREST behaviour.
   */
  static async updateLogoPath(logoPath: string): Promise<CompanyProfile> {
    const supabase = createClient();

    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Nicht angemeldet');

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (accountError) throw toQueryError(accountError);
    const companyId = account?.company_id;
    if (!companyId) throw new Error('Kein Unternehmen zugeordnet');

    const { data, error } = await supabase
      .from('company_profiles')
      .update({
        logo_path: logoPath,
        // Keep legacy column in sync for older code paths / manual inspection.
        // (We still resolve signed URLs from logo_path, not from logo_url.)
        logo_url: null,
        updated_at: new Date().toISOString()
      })
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) {
      console.error('[CompanySettings] Error updating logo URL:', error);
      throw toQueryError(error);
    }

    return data as CompanyProfile;
  }

  /**
   * Deletes the current company's logo file from Storage (best-effort) and clears
   * company_profiles.logo_url.
   *
   * Note: Storage file deletion requires a DELETE policy on storage.objects for the
   * `company-assets` bucket (see `20260402120000_company_assets_storage_rls.sql`).
   */
  static async deleteLogo(args: {
    companyId: string;
    currentLogoPath: string | null;
    legacyLogoUrl: string | null;
  }): Promise<CompanyProfile> {
    const supabase = createClient();

    const pathsToTry = new Set<string>();

    if (args.currentLogoPath?.trim())
      pathsToTry.add(args.currentLogoPath.trim());
    if (args.legacyLogoUrl?.trim()) {
      const extracted = extractCompanyAssetsPathFromUrl(
        args.legacyLogoUrl.trim()
      );
      if (extracted) pathsToTry.add(extracted);
    }

    // Fallbacks: in case the stored URL is not parseable or was manually edited.
    pathsToTry.add(`${args.companyId}/logo.png`);
    pathsToTry.add(`${args.companyId}/logo.jpg`);
    pathsToTry.add(`${args.companyId}/logo.jpeg`);
    pathsToTry.add(`${args.companyId}/logo.webp`);
    pathsToTry.add(`${args.companyId}/logo.svg`);

    // Best-effort remove. If the file doesn't exist, Supabase returns a 200 with an empty array.
    await supabase.storage.from(LOGO_BUCKET).remove(Array.from(pathsToTry));

    // Always clear the DB pointer so invoices stop reserving space for the logo.
    const { data, error } = await supabase
      .from('company_profiles')
      .update({
        logo_path: null,
        logo_url: null,
        updated_at: new Date().toISOString()
      })
      .eq('company_id', args.companyId)
      .select()
      .single();

    if (error) throw toQueryError(error);
    return data as CompanyProfile;
  }
}
