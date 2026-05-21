/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

/**
 * PATCH /api/users/[id]/status — toggle accounts.is_active and mirror to GoTrue ban (no deleteUser).
 *
 * Ban blocks sign-in (and sessions) without deleting the user — reversible via unban on reactivate.
 * Self-deactivation is blocked so you cannot lock yourself out.
 * If the auth ban step fails after we set is_active, we roll back the row so UI and Auth stay aligned.
 */

import {
  AUTH_BAN_DURATION_PERMANENT,
  AUTH_BAN_DURATION_UNBAN
} from '@/lib/auth/ban-constants';
import { requireAdmin } from '@/lib/api/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type PatchBody = {
  is_active: boolean;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) {
      return auth.error;
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Benutzer-ID fehlt' }, { status: 400 });
    }

    if (id === auth.userId) {
      return NextResponse.json(
        { error: 'Eigenes Konto kann nicht deaktiviert werden' },
        { status: 400 }
      );
    }

    const sessionSupabase = await createClient();
    const { data: target, error: targetError } = await sessionSupabase
      .from('accounts')
      .select('company_id, is_active')
      .eq('id', id)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    }
    if (target.company_id !== auth.companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as PatchBody;
    if (typeof body.is_active !== 'boolean') {
      return NextResponse.json(
        { error: 'is_active (boolean) erforderlich' },
        { status: 400 }
      );
    }

    const { is_active: nextActive } = body;
    const previousActive = target.is_active;

    const admin = createAdminClient();

    const { error: dbError } = await admin
      .from('accounts')
      .update({ is_active: nextActive })
      .eq('id', id);

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // ban_duration is valid on GoTrue admin API; typings may omit it in some SDK versions.
    const banAttrs = nextActive
      ? { ban_duration: AUTH_BAN_DURATION_UNBAN }
      : { ban_duration: AUTH_BAN_DURATION_PERMANENT };

    const { error: banError } = await admin.auth.admin.updateUserById(
      id,
      banAttrs as Parameters<typeof admin.auth.admin.updateUserById>[1]
    );

    if (banError) {
      await admin
        .from('accounts')
        .update({ is_active: previousActive })
        .eq('id', id);

      return NextResponse.json(
        { error: `Auth-Sperre fehlgeschlagen: ${banError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, is_active: nextActive });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
