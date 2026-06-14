import { createClient } from '@/lib/supabase/client';

/** Resolves the admin's company_id from accounts — shared by KTS KPI and handover mutations. */
export async function fetchKtsCompanyId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('accounts')
    .select('company_id')
    .eq('id', user.id)
    .single();

  return profile?.company_id ?? null;
}
