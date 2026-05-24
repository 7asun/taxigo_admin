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

type StepError = {
  message?: string;
  code?: string;
  details?: string;
};

function logStepError(step: string, error: unknown): void {
  const err = error as StepError;
  console.error(`[drivers/create] ${step}`, {
    step,
    message: err.message,
    code: err.code,
    details: err.details
  });
}

function stepErrorResponse(
  step: string,
  error: unknown,
  status: number
): NextResponse {
  logStepError(step, error);
  const err = error as StepError;
  return NextResponse.json(
    {
      error: err.message ?? 'Unknown error',
      step,
      code: err.code ?? null,
      details: err.details ?? null
    },
    { status }
  );
}

export async function POST(request: Request) {
  try {
    let auth: Awaited<ReturnType<typeof requireAdmin>>;
    try {
      auth = await requireAdmin();
    } catch (err: unknown) {
      return stepErrorResponse('requireAdmin', err, 500);
    }

    if ('error' in auth) {
      return auth.error;
    }
    const companyId = auth.companyId;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Missing Supabase configuration', step: 'config' },
        { status: 500 }
      );
    }

    let body: CreateDriverBody;
    try {
      body = (await request.json()) as CreateDriverBody;
    } catch (err: unknown) {
      return stepErrorResponse('parseBody', err, 400);
    }

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

    let newAuthUser: Awaited<
      ReturnType<typeof supabaseAdmin.auth.admin.createUser>
    >['data'];
    try {
      const { data, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true
        });

      if (createError) {
        return stepErrorResponse('auth.admin.createUser', createError, 400);
      }

      newAuthUser = data;
    } catch (err: unknown) {
      return stepErrorResponse('auth.admin.createUser', err, 500);
    }

    if (!newAuthUser.user) {
      return NextResponse.json(
        { error: 'Failed to create user', step: 'auth.admin.createUser' },
        { status: 500 }
      );
    }

    try {
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
        try {
          await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
        } catch (rollbackErr: unknown) {
          logStepError('rollback.auth.admin.deleteUser', rollbackErr);
        }
        return stepErrorResponse('accounts.insert', userError, 500);
      }
    } catch (err: unknown) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
      } catch (rollbackErr: unknown) {
        logStepError('rollback.auth.admin.deleteUser', rollbackErr);
      }
      return stepErrorResponse('accounts.insert', err, 500);
    }

    if (role === 'driver') {
      try {
        const { error: profileError } = await supabaseAdmin
          .from('driver_profiles')
          .insert({
            user_id: newAuthUser.user.id,
            license_number: body.license_number ?? null,
            default_vehicle_id: body.default_vehicle_id ?? null
          });

        if (profileError) {
          try {
            await supabaseAdmin
              .from('accounts')
              .delete()
              .eq('id', newAuthUser.user.id);
          } catch (rollbackErr: unknown) {
            logStepError('rollback.accounts.delete', rollbackErr);
          }
          try {
            await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
          } catch (rollbackErr: unknown) {
            logStepError('rollback.auth.admin.deleteUser', rollbackErr);
          }
          return stepErrorResponse('driver_profiles.insert', profileError, 500);
        }
      } catch (err: unknown) {
        try {
          await supabaseAdmin
            .from('accounts')
            .delete()
            .eq('id', newAuthUser.user.id);
        } catch (rollbackErr: unknown) {
          logStepError('rollback.accounts.delete', rollbackErr);
        }
        try {
          await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
        } catch (rollbackErr: unknown) {
          logStepError('rollback.auth.admin.deleteUser', rollbackErr);
        }
        return stepErrorResponse('driver_profiles.insert', err, 500);
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
    logStepError('unexpected', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: message, step: 'unexpected' },
      { status: 500 }
    );
  }
}
