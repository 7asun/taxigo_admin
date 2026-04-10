import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';

export async function getSessionCompanyId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Nicht angemeldet');
  const { data, error } = await supabase
    .from('accounts')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw toQueryError(error);
  if (!data?.company_id) {
    throw new Error('Kein Unternehmen für diesen Benutzer');
  }
  return data.company_id;
}
