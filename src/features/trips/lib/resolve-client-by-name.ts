import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

/**
 * Best-effort Stammdaten link by display name.
 *
 * Uses the same normalized full-name equality as the SQL backfill and
 * `resolve_client_id_by_name` (lower(trim(...)) on `concat_ws(' ', first_name, last_name)`),
 * not substring `ILIKE`, so accidental partial matches are avoided.
 *
 * **Contract:** Returns a `client_id` only when exactly one client in the company matches.
 * On zero matches, multiple matches, RPC error, or empty input, returns `null`.
 * **Never throws** — callers proceed with `null` and must not block UX on failure.
 *
 * @see docs/trip-client-linking.md
 */
export async function resolveClientByName(
  name: string,
  companyId: string,
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  const trimmed = (name || '').trim();
  if (!trimmed || !companyId) return null;

  try {
    const { data, error } = await supabase.rpc('resolve_client_id_by_name', {
      p_company_id: companyId,
      p_full_name: trimmed
    });
    if (error) return null;
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
