/**
 * @deprecated Use DriverWithProfile from
 * src/features/driver-management/types.ts for roster rows, or
 * AccountRole / RosterRoleFilter for role types.
 * This type is kept for the EditCredentialsDialog bridge and will
 * be removed in a future cleanup pass.
 *
 * Company user row for Benutzerverwaltung — email from live Supabase Auth, not cached `accounts.email`.
 */
export type CompanyUser = {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean | null;
  created_at: string | null;
  phone: string | null;
};
