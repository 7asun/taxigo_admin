/**
 * SECURITY: Layer 3 — authenticated session only (any role).
 * Use for low-sensitivity routes where the caller must be logged in but need not be admin.
 * See docs/access-control.md for the full access control architecture.
 */

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { Database } from '@/types/database.types';

export type RequireSessionResult =
  | { error: NextResponse }
  | { user: User; supabase: SupabaseClient<Database> };

export async function requireSession(): Promise<RequireSessionResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: sessionError
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    };
  }

  return { user, supabase };
}
