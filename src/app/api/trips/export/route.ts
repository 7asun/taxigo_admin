import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { unparse } from 'papaparse';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

/**
 * Trip CSV export endpoint.
 * Generates CSV with configurable columns, filtered by payer, billing type, and date range.
 * Uses service role client to bypass RLS for bulk export.
 */

/** Column metadata for CSV export */
interface ExportColumn {
  key: string;
  label: string;
  accessor: (trip: Record<string, unknown>) => unknown;
}

/** Zod schema for validating export request body */
const exportRequestSchema = z.object({
  payerId: z.string().uuid().nullable().optional(),
  billingTypeId: z.string().uuid().nullable().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  columns: z.array(z.string()).min(1, 'Mindestens eine Spalte auswählen'),
  includeHeaders: z.boolean().optional().default(true)
});

/**
 * All available columns for CSV export.
 * Keys match database fields or joined data accessors.
 */
const EXPORT_COLUMNS: ExportColumn[] = [
  // Trip Info
  { key: 'id', label: 'ID', accessor: (t) => t.id },
  {
    key: 'scheduled_date',
    label: 'Datum',
    accessor: (t) => formatDate(t.scheduled_at as string | null)
  },
  {
    key: 'scheduled_time',
    label: 'Uhrzeit',
    accessor: (t) => formatTime(t.scheduled_at as string | null)
  },
  {
    key: 'requested_date',
    label: 'Wunschtermin',
    accessor: (t) => t.requested_date ?? ''
  },
  { key: 'status', label: 'Status', accessor: (t) => t.status },
  {
    key: 'is_wheelchair',
    label: 'Rollstuhl',
    accessor: (t) => (t.is_wheelchair ? 'Ja' : 'Nein')
  },
  {
    key: 'return_status',
    label: 'Rückfahrstatus',
    accessor: (t) => t.return_status ?? ''
  },
  {
    key: 'link_type',
    label: 'Verknüpfungstyp',
    accessor: (t) => t.link_type ?? ''
  },
  {
    key: 'canceled_reason_notes',
    label: 'Stornierungsgrund',
    accessor: (t) => t.canceled_reason_notes ?? ''
  },
  {
    key: 'created_at',
    label: 'Erstellt am',
    accessor: (t) => formatDateTime(t.created_at as string | null)
  },

  // Passenger Info
  {
    key: 'client_id',
    label: 'Fahrgast ID',
    accessor: (t) => t.client_id ?? ''
  },
  {
    key: 'client_name',
    label: 'Fahrgast Name',
    accessor: (t) => t.client_name ?? ''
  },
  {
    key: 'client_phone',
    label: 'Fahrgast Telefon',
    accessor: (t) => t.client_phone ?? ''
  },
  {
    key: 'greeting_style',
    label: 'Anrede',
    accessor: (t) => t.greeting_style ?? ''
  },

  // Pickup Address
  {
    key: 'pickup_address',
    label: 'Abholadresse (vollständig)',
    accessor: (t) => t.pickup_address ?? ''
  },
  {
    key: 'pickup_street',
    label: 'Abholung Straße',
    accessor: (t) => t.pickup_street ?? ''
  },
  {
    key: 'pickup_street_number',
    label: 'Abholung Hausnummer',
    accessor: (t) => t.pickup_street_number ?? ''
  },
  {
    key: 'pickup_zip_code',
    label: 'Abholung PLZ',
    accessor: (t) => t.pickup_zip_code ?? ''
  },
  {
    key: 'pickup_city',
    label: 'Abholung Stadt',
    accessor: (t) => t.pickup_city ?? ''
  },
  {
    key: 'pickup_station',
    label: 'Abholung Station',
    accessor: (t) => t.pickup_station ?? ''
  },
  {
    key: 'pickup_lat',
    label: 'Abholung Lat',
    accessor: (t) => t.pickup_lat ?? ''
  },
  {
    key: 'pickup_lng',
    label: 'Abholung Lng',
    accessor: (t) => t.pickup_lng ?? ''
  },

  // Dropoff Address
  {
    key: 'dropoff_address',
    label: 'Zieladresse (vollständig)',
    accessor: (t) => t.dropoff_address ?? ''
  },
  {
    key: 'dropoff_street',
    label: 'Ziel Straße',
    accessor: (t) => t.dropoff_street ?? ''
  },
  {
    key: 'dropoff_street_number',
    label: 'Ziel Hausnummer',
    accessor: (t) => t.dropoff_street_number ?? ''
  },
  {
    key: 'dropoff_zip_code',
    label: 'Ziel PLZ',
    accessor: (t) => t.dropoff_zip_code ?? ''
  },
  {
    key: 'dropoff_city',
    label: 'Ziel Stadt',
    accessor: (t) => t.dropoff_city ?? ''
  },
  {
    key: 'dropoff_station',
    label: 'Ziel Station',
    accessor: (t) => t.dropoff_station ?? ''
  },
  {
    key: 'dropoff_lat',
    label: 'Ziel Lat',
    accessor: (t) => t.dropoff_lat ?? ''
  },
  {
    key: 'dropoff_lng',
    label: 'Ziel Lng',
    accessor: (t) => t.dropoff_lng ?? ''
  },

  // Billing
  {
    key: 'payer_id',
    label: 'Kostenträger ID',
    accessor: (t) => t.payer_id ?? ''
  },
  {
    key: 'payer_name',
    label: 'Kostenträger',
    accessor: (t) => (t.payer as Record<string, string> | null)?.name ?? ''
  },
  {
    key: 'billing_variant_id',
    label: 'Abrechnungsvariante ID',
    accessor: (t) => t.billing_variant_id ?? ''
  },
  {
    key: 'billing_variant_name',
    label: 'Abrechnungsvariante',
    accessor: (t) =>
      (t.billing_variant as Record<string, string> | null)?.name ?? ''
  },
  {
    key: 'billing_family_name',
    label: 'Abrechnungsfamilie',
    accessor: (t) =>
      (
        (t.billing_variant as Record<string, unknown> | null)
          ?.billing_types as Record<string, string> | null
      )?.name ?? ''
  },
  {
    key: 'billing_calling_station',
    label: 'Anrufstation',
    accessor: (t) => t.billing_calling_station ?? ''
  },
  {
    key: 'billing_betreuer',
    label: 'Betreuer',
    accessor: (t) => t.billing_betreuer ?? ''
  },
  {
    key: 'kts_document_applies',
    label: 'KTS (Krankentransportschein)',
    accessor: (t) =>
      t.kts_document_applies === true
        ? 'Ja'
        : t.kts_document_applies === false
          ? 'Nein'
          : ''
  },
  { key: 'price', label: 'Preis', accessor: (t) => t.price ?? '' },

  // Driver & Vehicle
  { key: 'driver_id', label: 'Fahrer ID', accessor: (t) => t.driver_id ?? '' },
  {
    key: 'driver_name',
    label: 'Fahrer',
    accessor: (t) => (t.driver as Record<string, string> | null)?.name ?? ''
  },
  {
    key: 'vehicle_id',
    label: 'Fahrzeug ID',
    accessor: (t) => t.vehicle_id ?? ''
  },

  // Trip Metadata
  { key: 'group_id', label: 'Gruppen ID', accessor: (t) => t.group_id ?? '' },
  {
    key: 'stop_order',
    label: 'Stop Reihenfolge',
    accessor: (t) => t.stop_order ?? ''
  },
  { key: 'notes', label: 'Notizen', accessor: (t) => t.notes ?? '' },
  { key: 'note', label: 'Notiz (Alt)', accessor: (t) => t.note ?? '' },

  // Driving Metrics
  {
    key: 'driving_distance_km',
    label: 'Fahrtstrecke (km)',
    accessor: (t) => t.driving_distance_km ?? ''
  },
  {
    key: 'driving_duration_seconds',
    label: 'Fahrtdauer (Sek)',
    accessor: (t) => t.driving_duration_seconds ?? ''
  },
  {
    key: 'estimated_duration_min',
    label: 'Geschätzte Dauer (Min)',
    accessor: (t) =>
      t.driving_duration_seconds
        ? Math.round((t.driving_duration_seconds as number) / 60)
        : ''
  },
  {
    key: 'actual_pickup_at',
    label: 'Tatsächliche Abholung',
    accessor: (t) => formatDateTime(t.actual_pickup_at as string | null)
  },
  {
    key: 'actual_dropoff_at',
    label: 'Tatsächliche Ankunft',
    accessor: (t) => formatDateTime(t.actual_dropoff_at as string | null)
  },

  // Technical
  {
    key: 'company_id',
    label: 'Unternehmen ID',
    accessor: (t) => t.company_id ?? ''
  },
  {
    key: 'created_by',
    label: 'Erstellt von',
    accessor: (t) => t.created_by ?? ''
  },
  {
    key: 'ingestion_source',
    label: 'Importquelle',
    accessor: (t) => t.ingestion_source ?? ''
  },
  { key: 'rule_id', label: 'Regel ID', accessor: (t) => t.rule_id ?? '' },
  {
    key: 'linked_trip_id',
    label: 'Verknüpfte Fahrt ID',
    accessor: (t) => t.linked_trip_id ?? ''
  },
  {
    key: 'has_missing_geodata',
    label: 'Fehlende Geodaten',
    accessor: (t) => (t.has_missing_geodata ? 'Ja' : 'Nein')
  },
  {
    key: 'needs_driver_assignment',
    label: 'Fahrerzuordnung nötig',
    accessor: (t) => (t.needs_driver_assignment ? 'Ja' : 'Nein')
  }
];

/**
 * Format ISO datetime to German format (DD.MM.YYYY HH:mm).
 * Returns empty string for null/undefined.
 */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function POST(request: Request) {
  try {
    const supabaseUser = await createClient();
    const {
      data: { user },
      error: sessionError
    } = await supabaseUser.auth.getUser();

    if (sessionError || !user) {
      return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
    }

    const { data: account, error: accountError } = await supabaseUser
      .from('accounts')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle();

    if (accountError) {
      return NextResponse.json(
        { error: accountError.message },
        { status: 500 }
      );
    }

    const companyId = account?.company_id;
    if (!companyId) {
      return NextResponse.json(
        { error: 'Kein Unternehmen zugeordnet.' },
        { status: 403 }
      );
    }

    const json = (await request.json().catch(() => null)) as unknown;
    const parseResult = exportRequestSchema.safeParse(json);

    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e) => `${String(e.path[0])}: ${e.message}`)
        .join(', ');
      return NextResponse.json(
        { error: `Ungültige Anfrage: ${errorMessage}` },
        { status: 400 }
      );
    }

    const {
      payerId,
      billingTypeId,
      dateFrom,
      dateTo,
      columns,
      includeHeaders
    } = parseResult.data;

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

    // Build query with date filter using business timezone pattern
    // scheduled_at in range OR (scheduled_at IS NULL AND requested_date in range)
    const { startISO: fromISO } = getZonedDayBoundsIso(dateFrom);
    const { endExclusiveISO: toISO } = getZonedDayBoundsIso(dateTo);

    let query = admin
      .from('trips')
      .select(
        `
        *,
        payer:payers!trips_payer_id_fkey(name),
        billing_variant:billing_variants!trips_billing_variant_id_fkey(name, billing_types!billing_variants_billing_type_id_fkey(name)),
        driver:accounts!trips_driver_id_fkey(name)
      `
      )
      .eq('company_id', companyId)
      .or(
        `and(scheduled_at.gte.${fromISO},scheduled_at.lt.${toISO}),and(scheduled_at.is.null,requested_date.gte.${dateFrom},requested_date.lte.${dateTo})`
      );

    // Apply payer filter if specified
    if (payerId) {
      query = query.eq('payer_id', payerId);
    }

    // Apply billing type filter if specified (filter by billing_variant_id)
    if (billingTypeId) {
      query = query.eq('billing_variant_id', billingTypeId);
    }

    // Order by scheduled_at for consistent output
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

    // Get selected columns
    const selectedColumns = EXPORT_COLUMNS.filter((col) =>
      columns.includes(col.key)
    );

    // Transform trips to CSV rows
    const csvRows = trips.map((trip) => {
      const row: Record<string, unknown> = {};
      selectedColumns.forEach((col) => {
        row[col.label] = col.accessor(trip as Record<string, unknown>);
      });
      return row;
    });

    // Generate CSV
    const csv = unparse({
      fields: selectedColumns.map((col) => col.label),
      data: csvRows
    });

    const filename = `fahrten-export-${dateFrom}-bis-${dateTo}.csv`;

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

/**
 * Get ISO datetime bounds for a date in the business timezone.
 * Used for consistent date filtering across the application.
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

/**
 * Format ISO datetime to German date format (DD.MM.YYYY).
 * Returns empty string for null/undefined.
 */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/**
 * Format ISO datetime to German time format (HH:mm).
 * Returns empty string for null/undefined.
 */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
