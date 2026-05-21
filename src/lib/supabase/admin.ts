/**
 * Supabase client with service-role key — bypasses RLS.
 *
 * Server-only. Never import from client components or feature modules.
 * Keeping this file outside any barrel re-export prevents accidental client bundles.
 * Route handlers and scripts must gate calls with requireAdmin() or equivalent secrets.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase admin configuration');
  }

  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
