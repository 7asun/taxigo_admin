/**
 * Shared CSV export column registry — single source of truth for selector UI and API accessors.
 *
 * WHY one registry: the UI (`csv-export-constants`) and `/api/trips/export` previously drifted
 * (`net_price` vs stale `price`). Both sides import from here so offered columns always serialize.
 *
 * Server-safe: no React, no browser APIs, no Supabase client.
 */

import type { ExportColumn } from '@/features/trips/types/csv-export.types';
import type { Database } from '@/types/database.types';

export type TripExportRow = Database['public']['Tables']['trips']['Row'] & {
  payer?: { name: string } | null;
  billing_variant?: {
    name: string;
    billing_types?: { name: string } | null;
  } | null;
  driver?: { name: string } | null;
  fremdfirma?: { name: string } | null;
};

export interface ExportColumnDef extends ExportColumn {
  accessor: (trip: TripExportRow) => unknown;
}

export const COLUMN_CATEGORIES: Record<string, string> = {
  'trip-info': 'Fahrt Informationen',
  passenger: 'Fahrgast',
  pickup: 'Abholung',
  dropoff: 'Ziel',
  billing: 'Abrechnung',
  driver: 'Fahrer & Fahrzeug',
  metadata: 'Metadaten',
  technical: 'Technisch'
};

export const CATEGORY_ORDER = [
  'trip-info',
  'passenger',
  'pickup',
  'dropoff',
  'billing',
  'driver',
  'metadata',
  'technical'
] as const;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatBoolean(value: boolean | null | undefined): string {
  if (value === true) return 'Ja';
  if (value === false) return 'Nein';
  return '';
}

/** All exportable columns with labels, categories, and CSV accessors. */
export const EXPORT_COLUMN_DEFS: ExportColumnDef[] = [
  { key: 'id', label: 'ID', category: 'trip-info', accessor: (t) => t.id },
  {
    key: 'scheduled_date',
    label: 'Datum',
    category: 'trip-info',
    accessor: (t) => formatDate(t.scheduled_at)
  },
  {
    key: 'scheduled_time',
    label: 'Uhrzeit',
    category: 'trip-info',
    accessor: (t) => formatTime(t.scheduled_at)
  },
  {
    key: 'requested_date',
    label: 'Wunschtermin',
    category: 'trip-info',
    accessor: (t) => t.requested_date ?? ''
  },
  {
    key: 'status',
    label: 'Status',
    category: 'trip-info',
    accessor: (t) => t.status
  },
  {
    key: 'is_wheelchair',
    label: 'Rollstuhl',
    category: 'trip-info',
    accessor: (t) => formatBoolean(t.is_wheelchair)
  },
  {
    key: 'return_status',
    label: 'Rückfahrstatus',
    category: 'trip-info',
    accessor: (t) => t.return_status ?? ''
  },
  {
    key: 'link_type',
    label: 'Verknüpfungstyp',
    category: 'trip-info',
    accessor: (t) => t.link_type ?? ''
  },
  {
    key: 'canceled_reason_notes',
    label: 'Stornierungsgrund',
    category: 'trip-info',
    accessor: (t) => t.canceled_reason_notes ?? ''
  },
  {
    key: 'created_at',
    label: 'Erstellt am',
    category: 'metadata',
    accessor: (t) => formatDateTime(t.created_at)
  },
  {
    key: 'client_id',
    label: 'Fahrgast ID',
    category: 'passenger',
    accessor: (t) => t.client_id ?? ''
  },
  {
    key: 'client_name',
    label: 'Fahrgast Name',
    category: 'passenger',
    accessor: (t) => t.client_name ?? ''
  },
  {
    key: 'client_phone',
    label: 'Fahrgast Telefon',
    category: 'passenger',
    accessor: (t) => t.client_phone ?? ''
  },
  {
    key: 'greeting_style',
    label: 'Anrede',
    category: 'passenger',
    accessor: (t) => t.greeting_style ?? ''
  },
  {
    key: 'pickup_address',
    label: 'Abholadresse (vollständig)',
    category: 'pickup',
    accessor: (t) => t.pickup_address ?? ''
  },
  {
    key: 'pickup_street',
    label: 'Abholung Straße',
    category: 'pickup',
    accessor: (t) => t.pickup_street ?? ''
  },
  {
    key: 'pickup_street_number',
    label: 'Abholung Hausnummer',
    category: 'pickup',
    accessor: (t) => t.pickup_street_number ?? ''
  },
  {
    key: 'pickup_zip_code',
    label: 'Abholung PLZ',
    category: 'pickup',
    accessor: (t) => t.pickup_zip_code ?? ''
  },
  {
    key: 'pickup_city',
    label: 'Abholung Stadt',
    category: 'pickup',
    accessor: (t) => t.pickup_city ?? ''
  },
  {
    key: 'pickup_station',
    label: 'Abholung Station',
    category: 'pickup',
    accessor: (t) => t.pickup_station ?? ''
  },
  {
    key: 'pickup_lat',
    label: 'Abholung Lat',
    category: 'pickup',
    accessor: (t) => t.pickup_lat ?? ''
  },
  {
    key: 'pickup_lng',
    label: 'Abholung Lng',
    category: 'pickup',
    accessor: (t) => t.pickup_lng ?? ''
  },
  {
    key: 'dropoff_address',
    label: 'Zieladresse (vollständig)',
    category: 'dropoff',
    accessor: (t) => t.dropoff_address ?? ''
  },
  {
    key: 'dropoff_street',
    label: 'Ziel Straße',
    category: 'dropoff',
    accessor: (t) => t.dropoff_street ?? ''
  },
  {
    key: 'dropoff_street_number',
    label: 'Ziel Hausnummer',
    category: 'dropoff',
    accessor: (t) => t.dropoff_street_number ?? ''
  },
  {
    key: 'dropoff_zip_code',
    label: 'Ziel PLZ',
    category: 'dropoff',
    accessor: (t) => t.dropoff_zip_code ?? ''
  },
  {
    key: 'dropoff_city',
    label: 'Ziel Stadt',
    category: 'dropoff',
    accessor: (t) => t.dropoff_city ?? ''
  },
  {
    key: 'dropoff_station',
    label: 'Ziel Station',
    category: 'dropoff',
    accessor: (t) => t.dropoff_station ?? ''
  },
  {
    key: 'dropoff_lat',
    label: 'Ziel Lat',
    category: 'dropoff',
    accessor: (t) => t.dropoff_lat ?? ''
  },
  {
    key: 'dropoff_lng',
    label: 'Ziel Lng',
    category: 'dropoff',
    accessor: (t) => t.dropoff_lng ?? ''
  },
  {
    key: 'payer_id',
    label: 'Kostenträger ID',
    category: 'billing',
    accessor: (t) => t.payer_id ?? ''
  },
  {
    key: 'payer_name',
    label: 'Kostenträger',
    category: 'billing',
    accessor: (t) => t.payer?.name ?? ''
  },
  {
    key: 'billing_variant_id',
    label: 'Abrechnungsvariante ID',
    category: 'billing',
    accessor: (t) => t.billing_variant_id ?? ''
  },
  {
    key: 'billing_variant_name',
    label: 'Abrechnungsvariante',
    category: 'billing',
    accessor: (t) => t.billing_variant?.name ?? ''
  },
  {
    key: 'billing_family_name',
    label: 'Abrechnungsfamilie',
    category: 'billing',
    accessor: (t) => t.billing_variant?.billing_types?.name ?? ''
  },
  {
    key: 'billing_calling_station',
    label: 'Anrufstation',
    category: 'billing',
    accessor: (t) => t.billing_calling_station ?? ''
  },
  {
    key: 'billing_betreuer',
    label: 'Betreuer',
    category: 'billing',
    accessor: (t) => t.billing_betreuer ?? ''
  },
  {
    key: 'kts_document_applies',
    label: 'KTS (Krankentransportschein)',
    category: 'billing',
    accessor: (t) => formatBoolean(t.kts_document_applies)
  },
  {
    key: 'net_price',
    label: 'Preis (Netto)',
    category: 'billing',
    accessor: (t) => t.net_price ?? ''
  },
  {
    key: 'driver_id',
    label: 'Fahrer ID',
    category: 'driver',
    accessor: (t) => t.driver_id ?? ''
  },
  {
    key: 'driver_name',
    label: 'Fahrer',
    category: 'driver',
    accessor: (t) => t.driver?.name ?? ''
  },
  {
    key: 'vehicle_id',
    label: 'Fahrzeug ID',
    category: 'driver',
    accessor: (t) => t.vehicle_id ?? ''
  },
  {
    key: 'group_id',
    label: 'Gruppen ID',
    category: 'metadata',
    accessor: (t) => t.group_id ?? ''
  },
  {
    key: 'stop_order',
    label: 'Stop Reihenfolge',
    category: 'metadata',
    accessor: (t) => t.stop_order ?? ''
  },
  {
    key: 'notes',
    label: 'Notizen',
    category: 'metadata',
    accessor: (t) => t.notes ?? ''
  },
  {
    key: 'driving_distance_km',
    label: 'Fahrtstrecke (km)',
    category: 'technical',
    accessor: (t) => t.driving_distance_km ?? ''
  },
  {
    key: 'driving_duration_seconds',
    label: 'Fahrtdauer (Sek)',
    category: 'technical',
    accessor: (t) => t.driving_duration_seconds ?? ''
  },
  {
    key: 'actual_pickup_at',
    label: 'Tatsächliche Abholung',
    category: 'technical',
    accessor: (t) => formatDateTime(t.actual_pickup_at)
  },
  {
    key: 'actual_dropoff_at',
    label: 'Tatsächliche Ankunft',
    category: 'technical',
    accessor: (t) => formatDateTime(t.actual_dropoff_at)
  },
  {
    key: 'company_id',
    label: 'Unternehmen ID',
    category: 'technical',
    accessor: (t) => t.company_id ?? ''
  },
  {
    key: 'ingestion_source',
    label: 'Importquelle',
    category: 'technical',
    accessor: (t) => t.ingestion_source ?? ''
  },
  {
    key: 'rule_id',
    label: 'Regel ID',
    category: 'technical',
    accessor: (t) => t.rule_id ?? ''
  },
  {
    key: 'linked_trip_id',
    label: 'Verknüpfte Fahrt ID',
    category: 'technical',
    accessor: (t) => t.linked_trip_id ?? ''
  },
  {
    key: 'has_missing_geodata',
    label: 'Fehlende Geodaten',
    category: 'technical',
    accessor: (t) => formatBoolean(t.has_missing_geodata)
  },
  {
    key: 'needs_driver_assignment',
    label: 'Fahrerzuordnung nötig',
    category: 'technical',
    accessor: (t) => formatBoolean(t.needs_driver_assignment)
  }
];

const EXPORT_COLUMN_DEF_MAP = new Map(
  EXPORT_COLUMN_DEFS.map((col) => [col.key, col] as const)
);

export function getExportColumnDef(key: string): ExportColumnDef | undefined {
  return EXPORT_COLUMN_DEF_MAP.get(key);
}

/** Flatten a joined trip row into export-keyed preview values. */
export function flattenTripForExportPreview(
  trip: TripExportRow,
  columnKeys?: readonly string[]
): Record<string, unknown> {
  const keys = columnKeys ?? EXPORT_COLUMN_DEFS.map((c) => c.key);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const def = EXPORT_COLUMN_DEF_MAP.get(key);
    if (def) {
      out[key] = def.accessor(trip);
    }
  }
  return out;
}
