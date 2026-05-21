/**
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
