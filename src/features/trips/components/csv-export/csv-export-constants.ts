/**
 * CSV Export Constants
 *
 * Available columns and configuration for the trip CSV export feature.
 */

import type { ExportColumn } from '@/features/trips/types/csv-export.types';

/**
 * All available columns for CSV export.
 * Organized by category for the column selector UI.
 */
export const EXPORT_COLUMNS: ExportColumn[] = [
  // Trip Info
  { key: 'id', label: 'ID', category: 'trip-info' },
  { key: 'scheduled_date', label: 'Datum', category: 'trip-info' },
  { key: 'scheduled_time', label: 'Uhrzeit', category: 'trip-info' },
  { key: 'requested_date', label: 'Wunschtermin', category: 'trip-info' },
  { key: 'status', label: 'Status', category: 'trip-info' },
  { key: 'is_wheelchair', label: 'Rollstuhl', category: 'trip-info' },
  { key: 'return_status', label: 'Rückfahrstatus', category: 'trip-info' },
  { key: 'link_type', label: 'Verknüpfungstyp', category: 'trip-info' },
  {
    key: 'canceled_reason_notes',
    label: 'Stornierungsgrund',
    category: 'trip-info'
  },
  { key: 'created_at', label: 'Erstellt am', category: 'metadata' },

  // Passenger Info
  { key: 'client_id', label: 'Fahrgast ID', category: 'passenger' },
  { key: 'client_name', label: 'Fahrgast Name', category: 'passenger' },
  { key: 'client_phone', label: 'Fahrgast Telefon', category: 'passenger' },
  { key: 'greeting_style', label: 'Anrede', category: 'passenger' },

  // Pickup Address
  {
    key: 'pickup_address',
    label: 'Abholadresse (vollständig)',
    category: 'pickup'
  },
  { key: 'pickup_street', label: 'Abholung Straße', category: 'pickup' },
  {
    key: 'pickup_street_number',
    label: 'Abholung Hausnummer',
    category: 'pickup'
  },
  { key: 'pickup_zip_code', label: 'Abholung PLZ', category: 'pickup' },
  { key: 'pickup_city', label: 'Abholung Stadt', category: 'pickup' },
  { key: 'pickup_station', label: 'Abholung Station', category: 'pickup' },
  { key: 'pickup_lat', label: 'Abholung Lat', category: 'pickup' },
  { key: 'pickup_lng', label: 'Abholung Lng', category: 'pickup' },

  // Dropoff Address
  {
    key: 'dropoff_address',
    label: 'Zieladresse (vollständig)',
    category: 'dropoff'
  },
  { key: 'dropoff_street', label: 'Ziel Straße', category: 'dropoff' },
  {
    key: 'dropoff_street_number',
    label: 'Ziel Hausnummer',
    category: 'dropoff'
  },
  { key: 'dropoff_zip_code', label: 'Ziel PLZ', category: 'dropoff' },
  { key: 'dropoff_city', label: 'Ziel Stadt', category: 'dropoff' },
  { key: 'dropoff_station', label: 'Ziel Station', category: 'dropoff' },
  { key: 'dropoff_lat', label: 'Ziel Lat', category: 'dropoff' },
  { key: 'dropoff_lng', label: 'Ziel Lng', category: 'dropoff' },

  // Billing
  { key: 'payer_id', label: 'Kostenträger ID', category: 'billing' },
  { key: 'payer_name', label: 'Kostenträger', category: 'billing' },
  {
    key: 'billing_variant_id',
    label: 'Abrechnungsvariante ID',
    category: 'billing'
  },
  {
    key: 'billing_variant_name',
    label: 'Abrechnungsvariante',
    category: 'billing'
  },
  {
    key: 'billing_family_name',
    label: 'Abrechnungsfamilie',
    category: 'billing'
  },
  {
    key: 'billing_calling_station',
    label: 'Anrufstation',
    category: 'billing'
  },
  { key: 'billing_betreuer', label: 'Betreuer', category: 'billing' },
  {
    key: 'kts_document_applies',
    label: 'KTS (Krankentransportschein)',
    category: 'billing'
  },
  { key: 'net_price', label: 'Preis (Netto)', category: 'billing' },

  // Driver & Vehicle
  { key: 'driver_id', label: 'Fahrer ID', category: 'driver' },
  { key: 'driver_name', label: 'Fahrer', category: 'driver' },
  { key: 'vehicle_id', label: 'Fahrzeug ID', category: 'driver' },

  // Trip Metadata
  { key: 'group_id', label: 'Gruppen ID', category: 'metadata' },
  { key: 'stop_order', label: 'Stop Reihenfolge', category: 'metadata' },
  { key: 'notes', label: 'Notizen', category: 'metadata' },

  // Driving Metrics
  {
    key: 'driving_distance_km',
    label: 'Fahrtstrecke (km)',
    category: 'technical'
  },
  {
    key: 'driving_duration_seconds',
    label: 'Fahrtdauer (Sek)',
    category: 'technical'
  },
  {
    key: 'actual_pickup_at',
    label: 'Tatsächliche Abholung',
    category: 'technical'
  },
  {
    key: 'actual_dropoff_at',
    label: 'Tatsächliche Ankunft',
    category: 'technical'
  },

  // Technical
  { key: 'company_id', label: 'Unternehmen ID', category: 'technical' },
  { key: 'ingestion_source', label: 'Importquelle', category: 'technical' },
  { key: 'rule_id', label: 'Regel ID', category: 'technical' },
  {
    key: 'linked_trip_id',
    label: 'Verknüpfte Fahrt ID',
    category: 'technical'
  },
  {
    key: 'has_missing_geodata',
    label: 'Fehlende Geodaten',
    category: 'technical'
  },
  {
    key: 'needs_driver_assignment',
    label: 'Fahrerzuordnung nötig',
    category: 'technical'
  }
];

/** Column categories with German labels for UI grouping */
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

/** Category order for display */
export const CATEGORY_ORDER = [
  'trip-info',
  'passenger',
  'pickup',
  'dropoff',
  'billing',
  'driver',
  'metadata',
  'technical'
];
