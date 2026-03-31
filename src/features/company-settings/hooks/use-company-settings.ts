/**
 * use-company-settings.ts
 *
 * React Query hook for fetching and saving the company profile.
 *
 * Follows the same pattern as use-payers.ts:
 *   - useQuery for data fetch
 *   - useMutation for save (upsert)
 *   - useMutation for logo upload
 *   - invalidateQueries on success
 *
 * Query key: companyKeys.profile() from src/query/keys
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { companyKeys } from '@/query/keys';
import { CompanySettingsService } from '../api/company-settings.api';
import type { CompanyProfileUpsertPayload } from '../types/company-settings.types';

export function useCompanySettings() {
  const queryClient = useQueryClient();

  // ── Fetch ──────────────────────────────────────────────────────────────────
  // Returns null if no profile exists yet (first-time setup).
  const query = useQuery({
    queryKey: companyKeys.profile(),
    queryFn: () => CompanySettingsService.getProfile(),
    staleTime: 1000 * 60 * 5 // 5 minutes — profile changes rarely
  });

  // ── Save (upsert) ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (payload: CompanyProfileUpsertPayload) =>
      CompanySettingsService.upsertProfile(payload),
    onSuccess: () => {
      // Refetch the profile so the UI reflects what was saved
      queryClient.invalidateQueries({ queryKey: companyKeys.profile() });
    }
  });

  // ── Logo upload ────────────────────────────────────────────────────────────
  // Uploads to Supabase Storage, then saves the returned URL to the profile.
  const logoMutation = useMutation({
    mutationFn: async ({
      file,
      companyId
    }: {
      file: File;
      companyId: string;
    }) => {
      const logoUrl = await CompanySettingsService.uploadLogo(file, companyId);
      await CompanySettingsService.updateLogoUrl(logoUrl);
      return logoUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyKeys.profile() });
    }
  });

  return {
    // Query state
    profile: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,

    // Save action
    saveProfile: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,

    // Logo upload action
    uploadLogo: logoMutation.mutateAsync,
    isUploadingLogo: logoMutation.isPending
  };
}
