/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api/require-admin';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/trips/export/preview
 *
 * Returns a preview count of trips matching the specified filters.
 * Used to show users how many trips will be exported before they confirm.
 *
 * Query Parameters:
 * - payer_id: Optional payer filter
 * - billing_variant_id: Optional billing variant filter
 * - date_from: Start date (YYYY-MM-DD)
 * - date_to: End date (YYYY-MM-DD)
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) {
      return auth.error;
    }
    const companyId = auth.companyId;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const payerId = searchParams.get('payer_id');
    const billingVariantId = searchParams.get('billing_variant_id');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    // Validate required parameters
    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'date_from und date_to sind erforderlich.' },
        { status: 400 }
      );
    }

    // Validate date range
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    if (fromDate > toDate) {
      return NextResponse.json(
        { error: 'Das Startdatum darf nicht nach dem Enddatum liegen.' },
        { status: 400 }
      );
    }

    // Initialize admin client for bypassing RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            'Server: SUPABASE_SERVICE_ROLE_KEY fehlt. Bitte in der Umgebung setzen.'
        },
        { status: 500 }
      );
    }

    const admin = createAdminClient<Database>(supabaseUrl, serviceRoleKey);

    // Build date filter using business timezone pattern
    const { startISO: fromISO } = getZonedDayBoundsIso(dateFrom);
    const { endExclusiveISO: toISO } = getZonedDayBoundsIso(dateTo);

    // Fetch sample trips for preview (limit to 5 rows)
    let query = admin
      .from('trips')
      .select(
        `
        *,
        payer:payers!trips_payer_id_fkey(name),
        billing_variant:billing_variants!trips_billing_variant_id_fkey(name, billing_type_id),
        driver:accounts!trips_driver_id_fkey(name)
      `
      )
      .eq('company_id', companyId)
      .or(
        `and(scheduled_at.gte.${fromISO},scheduled_at.lt.${toISO}),and(scheduled_at.is.null,requested_date.gte.${dateFrom},requested_date.lte.${dateTo})`
      )
      .limit(5);

    // Apply optional filters
    if (payerId) {
      query = query.eq('payer_id', payerId);
    }
    if (billingVariantId) {
      query = query.eq('billing_variant_id', billingVariantId);
    }

    const { data: sampleTrips, error: tripsError } = await query;

    if (tripsError) {
      return NextResponse.json(
        { error: `Fehler beim Laden der Fahrten: ${tripsError.message}` },
        { status: 500 }
      );
    }

    // Get total count
    let countQuery = admin
      .from('trips')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .or(
        `and(scheduled_at.gte.${fromISO},scheduled_at.lt.${toISO}),and(scheduled_at.is.null,requested_date.gte.${dateFrom},requested_date.lte.${dateTo})`
      );

    if (payerId) {
      countQuery = countQuery.eq('payer_id', payerId);
    }
    if (billingVariantId) {
      countQuery = countQuery.eq('billing_variant_id', billingVariantId);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      return NextResponse.json(
        { error: `Fehler beim Zählen: ${countError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      count: count ?? 0,
      sampleTrips: sampleTrips ?? []
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
    console.error('CSV Export Preview Error:', e);
    return NextResponse.json(
      { error: `Vorschau fehlgeschlagen: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * Get ISO datetime bounds for a date in the business timezone.
 * Mirrors the logic in the main export endpoint for consistency.
 */
function getZonedDayBoundsIso(ymd: string): {
  startISO: string;
  endExclusiveISO: string;
} {
  // Parse YYYY-MM-DD
  const [year, month, day] = ymd.split('-').map(Number);

  // Create dates in local timezone (Europe/Berlin) by appending time
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);

  // Convert to ISO strings
  return {
    startISO: start.toISOString(),
    endExclusiveISO: new Date(end.getTime() + 1).toISOString()
  };
}
