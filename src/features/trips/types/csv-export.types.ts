/**
 * CSV Export Types for Fahrten Page
 *
 * Type definitions for the trip CSV export feature including
 * export configuration, available columns, and step state management.
 */

/** Step identifiers for the export dialog wizard */
export type ExportStep =
  | 'payer'
  | 'date-range'
  | 'column-selector'
  | 'preview'
  | 'downloading';

/** Configuration for a trip CSV export */
export interface CsvExportConfig {
  /** Selected payer ID, or null for all payers */
  payerId: string | null;
  /** Selected billing type ID, or null for all types (only applies when payer is selected) */
  billingTypeId: string | null;
  /** Start date in YYYY-MM-DD format */
  dateFrom: string;
  /** End date in YYYY-MM-DD format */
  dateTo: string;
  /** Selected column keys to include in export */
  columns: string[];
  /** Whether to include header row */
  includeHeaders: boolean;
}

/** Available column definition for the column selector */
export interface ExportColumn {
  /** Unique key for the column (matches database field or joined field) */
  key: string;
  /** Display label in German */
  label: string;
  /** Category for grouping in the UI */
  category:
    | 'trip-info'
    | 'passenger'
    | 'pickup'
    | 'dropoff'
    | 'billing'
    | 'driver'
    | 'metadata'
    | 'technical';
  /** Database field path (for joined fields like payer.name) */
  accessor?: string;
}

/** Response from the export API */
export interface CsvExportResponse {
  /** CSV content as string */
  csv: string;
  /** Suggested filename */
  filename: string;
  /** Number of rows exported */
  rowCount: number;
}

/** Request body for the export API */
export interface CsvExportRequest {
  payerId?: string | null;
  billingTypeId?: string | null;
  dateFrom: string;
  dateTo: string;
  columns: string[];
  includeHeaders?: boolean;
}
