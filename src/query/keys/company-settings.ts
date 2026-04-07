/**
 * company-settings.ts
 *
 * TanStack Query key factory for company profile / settings data.
 * Import via `src/query/keys/index.ts`.
 *
 * Usage:
 *   import { companyKeys } from '@/query/keys';
 *   useQuery({ queryKey: companyKeys.profile() });
 *   queryClient.invalidateQueries({ queryKey: companyKeys.profile() });
 */

export const companyKeys = {
  /** Root key — invalidates everything under company settings. */
  all: ['company-settings'] as const,

  /**
   * The single company profile row.
   * Matches the 1:1 relationship in company_profiles table.
   */
  profile: () => [...companyKeys.all, 'profile'] as const
};
