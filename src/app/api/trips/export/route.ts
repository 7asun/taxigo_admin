/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { unparse } from 'papaparse';

import { requireAdmin } from '@/lib/api/require-admin';
import {
  EXPORT_COLUMN_DEFS,
  type TripExportRow
} from '@/features/trips/lib/export-columns.registry';
import {
  applyExportFilters,
  exportRequestSchema,
  EXPORT_TRIPS_SELECT,
  validateExportDateRange
} from '@/features/trips/lib/export-query';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

/**
 * Trip CSV export endpoint.
 * Validates `{ filters, columns, includeHeaders }` and uses the shared column registry +
 * `applyExportFilters` so preview and download stay aligned.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) {
      return auth.error;
    }
    const companyId = auth.companyId;

    const json = (await request.json().catch(() => null)) as unknown;
    const parseResult = exportRequestSchema.safeParse(json);

    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      return NextResponse.json(
        { error: `Ungültige Anfrage: ${errorMessage}` },
        { status: 400 }
      );
    }

    const { filters, columns } = parseResult.data;

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

    let query = admin
      .from('trips')
      .select(EXPORT_TRIPS_SELECT)
      .eq('company_id', companyId);

    query = applyExportFilters(query, filters);
    query = query.order('scheduled_at', { ascending: true });

    const { data: trips, error: tripsError } = await query;

    if (tripsError) {
      return NextResponse.json(
        { error: `Fehler beim Laden der Fahrten: ${tripsError.message}` },
        { status: 500 }
      );
    }

    if (!trips || trips.length === 0) {
      return NextResponse.json(
        { error: 'Keine Fahrten für die ausgewählten Filter gefunden.' },
        { status: 404 }
      );
    }

    const selectedColumns = EXPORT_COLUMN_DEFS.filter((col) =>
      columns.includes(col.key)
    );

    if (selectedColumns.length === 0) {
      return NextResponse.json(
        { error: 'Keine gültigen Spalten ausgewählt.' },
        { status: 400 }
      );
    }

    const csvRows = trips.map((trip) => {
      const row: Record<string, unknown> = {};
      selectedColumns.forEach((col) => {
        row[col.label] = col.accessor(trip as TripExportRow);
      });
      return row;
    });

    const csv = unparse({
      fields: selectedColumns.map((col) => col.label),
      data: csvRows
    });

    const filename = `fahrten-export-${filters.dateFrom}-bis-${filters.dateTo}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
    console.error('CSV Export Error:', e);
    return NextResponse.json(
      { error: `Export fehlgeschlagen: ${message}` },
      { status: 500 }
    );
  }
}
