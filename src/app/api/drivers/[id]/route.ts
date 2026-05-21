/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

/**
 * PATCH /api/drivers/[id] — Update a driver (users + driver_profiles).
 * Uses update_driver() RPC (SECURITY DEFINER) to bypass RLS. Caller must be authenticated.
 */

import { requireAdmin } from '@/lib/api/require-admin';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type UpdateDriverBody = {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  role?: 'driver' | 'admin';
  license_number?: string | null;
  default_vehicle_id?: string | null;
  street?: string | null;
  street_number?: string | null;
  zip_code?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
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

    const serverSupabase = await createClient();

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: 'Driver ID required' },
        { status: 400 }
      );
    }

    // Tenant guard: update_driver() is SECURITY DEFINER and bypasses RLS — without this,
    // any tenant admin could mutate another company's accounts (see user-management audit).
    const { data: targetAccount, error: targetError } = await serverSupabase
      .from('accounts')
      .select('company_id')
      .eq('id', id)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 });
    }
    if (!targetAccount) {
      return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    }
    if (targetAccount.company_id !== auth.companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as UpdateDriverBody;

    const { data, error } = await serverSupabase.rpc('update_driver', {
      p_driver_id: id,
      p_name: body.name ?? null,
      p_first_name: body.first_name ?? null,
      p_last_name: body.last_name ?? null,
      p_phone: body.phone ?? null,
      p_role: body.role ?? null,
      p_license_number: body.license_number ?? null,
      p_default_vehicle_id: body.default_vehicle_id ?? null,
      p_street: body.street ?? null,
      p_street_number: body.street_number ?? null,
      p_zip_code: body.zip_code ?? null,
      p_city: body.city ?? null,
      p_lat: body.lat ?? null,
      p_lng: body.lng ?? null
    });

    if (error) {
      return NextResponse.json(
        { error: `Benutzer-Update fehlgeschlagen: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
