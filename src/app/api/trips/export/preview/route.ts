/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api/require-admin';
import {
  flattenTripForExportPreview,
  type TripExportRow
} from '@/features/trips/lib/export-columns.registry';
import {
  applyExportFilters,
  EXPORT_TRIPS_SELECT,
  parseExportFiltersFromPreviewParams,
  validateExportDateRange
} from '@/features/trips/lib/export-query';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/trips/export/preview
 *
 * Returns trip count + up to 5 flattened sample rows for the export wizard preview step.
 * Query params mirror `buildExportPreviewSearchParams` / `parseExportFiltersFromPreviewParams`.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) {
      return auth.error;
    }
    const companyId = auth.companyId;

    const { searchParams } = new URL(request.url);

    let filters;
    try {
      filters = parseExportFiltersFromPreviewParams(searchParams);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Ungültige Filterparameter.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const dateRangeError = validateExportDateRange(filters);
    if (dateRangeError) {
      return NextResponse.json({ error: dateRangeError }, { status: 400 });
    }

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

    let sampleQuery = admin
      .from('trips')
      .select(EXPORT_TRIPS_SELECT)
      .eq('company_id', companyId);

    sampleQuery = applyExportFilters(sampleQuery, filters);
    sampleQuery = sampleQuery.limit(5);

    let countQuery = admin
      .from('trips')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    countQuery = applyExportFilters(countQuery, filters);

    const [
      { data: sampleTrips, error: tripsError },
      { count, error: countError }
    ] = await Promise.all([sampleQuery, countQuery]);

    if (tripsError) {
      return NextResponse.json(
        { error: `Fehler beim Laden der Fahrten: ${tripsError.message}` },
        { status: 500 }
      );
    }

    if (countError) {
      return NextResponse.json(
        { error: `Fehler beim Zählen: ${countError.message}` },
        { status: 500 }
      );
    }

    const flattenedSamples = (sampleTrips ?? []).map((trip) =>
      flattenTripForExportPreview(trip as TripExportRow)
    );

    return NextResponse.json({
      count: count ?? 0,
      sampleTrips: flattenedSamples
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
