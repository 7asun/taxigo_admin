/**
 * company-settings.api.ts
 *
 * Supabase API layer for the company_profiles table.
 * Handles: fetch, upsert, and logo upload to Storage.
 *
 * All functions are static methods on CompanySettingsService,
 * following the same pattern as PayersService.
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
   * After calling this, the caller should also update company_profiles.logo_url
   * via upsertProfile({ logo_url: url }).
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

    // Get the permanent public URL
    const { data: urlData } = supabase.storage
      .from(LOGO_BUCKET)
      .getPublicUrl(storagePath);

    return urlData.publicUrl;
  }

  /**
   * Updates only `logo_url` — avoids sending a partial upsert that could
   * overwrite other columns depending on PostgREST behaviour.
   */
  static async updateLogoUrl(logoUrl: string): Promise<CompanyProfile> {
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
        logo_url: logoUrl,
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
}
