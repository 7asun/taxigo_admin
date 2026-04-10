/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

/**
 * POST /api/drivers/create — Create a new driver (auth user + accounts row + driver_profiles).
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY to call auth.admin.createUser.
 * company_id is taken from the authenticated admin's session.
 */

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/api/require-admin';
import { NextResponse } from 'next/server';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

type CreateDriverBody = {
  email: string;
  password: string;
  name?: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  role?: 'driver' | 'admin';
  license_number?: string | null;
  default_vehicle_id?: string | null;
};

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) {
      return auth.error;
    }
    const companyId = auth.companyId;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Missing Supabase configuration' },
        { status: 500 }
      );
    }

    const body = (await request.json()) as CreateDriverBody;
    const {
      email,
      password,
      name,
      first_name,
      last_name,
      phone,
      role = 'driver'
    } = body;

    const fromNames =
      [first_name, last_name].filter(Boolean).join(' ').trim() || null;
    const displayName = name ?? fromNames;
    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password are required' },
        { status: 400 }
      );
    }
    if (!displayName && !first_name) {
      return NextResponse.json(
        { error: 'name or first_name is required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: newAuthUser, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    if (!newAuthUser.user) {
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      );
    }

    const { error: userError } = await supabaseAdmin.from('accounts').insert({
      id: newAuthUser.user.id,
      name: displayName ?? [first_name, last_name].filter(Boolean).join(' '),
      first_name: first_name ?? null,
      last_name: last_name ?? null,
      email: newAuthUser.user.email ?? null,
      phone: phone ?? null,
      role,
      company_id: companyId,
      is_active: true
    });

    if (userError) {
      await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
      return NextResponse.json(
        { error: `Failed to create user profile: ${userError.message}` },
        { status: 500 }
      );
    }

    if (role === 'driver') {
      const { error: profileError } = await supabaseAdmin
        .from('driver_profiles')
        .insert({
          user_id: newAuthUser.user.id,
          license_number: body.license_number ?? null,
          default_vehicle_id: body.default_vehicle_id ?? null
        });

      if (profileError) {
        await supabaseAdmin
          .from('accounts')
          .delete()
          .eq('id', newAuthUser.user.id);
        await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
        return NextResponse.json(
          { error: `Failed to create driver profile: ${profileError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      id: newAuthUser.user.id,
      email: newAuthUser.user.email,
      name: displayName ?? [first_name, last_name].filter(Boolean).join(' '),
      first_name: first_name ?? null,
      last_name: last_name ?? null,
      role
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
