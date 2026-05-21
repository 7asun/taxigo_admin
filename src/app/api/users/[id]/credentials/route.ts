/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

/**
 * PATCH /api/users/[id]/credentials — update Supabase Auth email and/or password (admin-only, tenant-scoped).
 *
 * Auth must succeed before syncing accounts.email — they are not one DB transaction; reversing auth
 * from a partial sync would require another admin call, so we never write the cache if Auth errors.
 * Password is never logged or returned.
 */

import { requireAdmin } from '@/lib/api/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PatchBody = {
  email?: string;
  password?: string;
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

    const sessionSupabase = await createClient();
    const { data: target, error: targetError } = await sessionSupabase
      .from('accounts')
      .select('company_id')
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
    const email =
      typeof body.email === 'string' ? body.email.trim() : undefined;
    const password =
      typeof body.password === 'string' ? body.password : undefined;

    if (!email && !password) {
      return NextResponse.json(
        { error: 'E-Mail oder Passwort angeben' },
        { status: 400 }
      );
    }

    if (email !== undefined && email !== '' && !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'Ungültige E-Mail-Adresse' },
        { status: 400 }
      );
    }

    if (password !== undefined && password !== '') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json(
          {
            error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben`
          },
          { status: 400 }
        );
      }
    }

    const attrs: { email?: string; password?: string } = {};
    if (email !== undefined && email !== '') {
      attrs.email = email;
    }
    if (password !== undefined && password !== '') {
      attrs.password = password;
    }

    if (Object.keys(attrs).length === 0) {
      return NextResponse.json(
        { error: 'E-Mail oder Passwort angeben' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { error: updateAuthError } = await admin.auth.admin.updateUserById(
      id,
      attrs
    );

    if (updateAuthError) {
      return NextResponse.json(
        { error: updateAuthError.message },
        { status: 400 }
      );
    }

    if (attrs.email !== undefined) {
      const { error: cacheError } = await admin
        .from('accounts')
        .update({ email: attrs.email })
        .eq('id', id);

      if (cacheError) {
        return NextResponse.json(
          {
            error: `Auth aktualisiert, Profil-Sync fehlgeschlagen: ${cacheError.message}`
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
