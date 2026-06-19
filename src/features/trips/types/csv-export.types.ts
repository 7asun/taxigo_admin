/**
 * CSV Export Types for Fahrten Page
 *
 * Typed filter contract shared by the export wizard, preview route, and download route.
 */

import type { KtsFilterValue } from '@/features/trips/lib/kts-filter';

/** Step identifiers for the export dialog wizard */
export type ExportStep =
  | 'payer'
  | 'date-range'
  | 'column-selector'
  | 'preview'
  | 'downloading';

/** Status tokens offered in the export filter step (matches trips list filter bar). */
export const EXPORT_STATUS_FILTER_VALUES = [
  'pending',
  'assigned',
  'in_progress',
  'completed',
  'cancelled'
] as const;

export type ExportStatusFilterValue =
  (typeof EXPORT_STATUS_FILTER_VALUES)[number];

/** Assignee filter for CSV export — mirrors list semantics without URL encoding. */
export type ExportAssigneeFilter =
  | { type: 'driver'; driverId: string }
  | { type: 'fremdfirma'; fremdfirmaId: string }
  | { type: 'unassigned' };

/**
 * Shared export filter contract used by wizard state, preview query params, and POST body.
 * `payerIds` stays an array so URL prefill can preserve multi-payer list filters even though
 * the wizard payer control is single-select today.
 */
export interface ExportFilters {
  payerIds: string[];
  billingVariantIds: string[];
  assigneeFilter: ExportAssigneeFilter | null;
  statusFilter: ExportStatusFilterValue[];
  ktsFilter: KtsFilterValue[];
  dateFrom: string;
  dateTo: string;
}

/** Re-export KTS tokens so export feature code has one import path. */
export type { KtsFilterValue };

/** Available column definition for the column selector */
export interface ExportColumn {
  key: string;
  label: string;
  category:
    | 'trip-info'
    | 'passenger'
    | 'pickup'
    | 'dropoff'
    | 'billing'
    | 'driver'
    | 'metadata'
    | 'technical';
}

/** POST /api/trips/export request body */
export interface CsvExportRequest {
  filters: ExportFilters;
  columns: string[];
  includeHeaders?: boolean;
}

/** Response from the export API (legacy JSON shape — route returns raw CSV today). */
export interface CsvExportResponse {
  csv: string;
  filename: string;
  rowCount: number;
}

/** @deprecated Use ExportFilters via CsvExportRequest.filters */
export interface CsvExportConfig {
  payerId: string | null;
  billingTypeId: string | null;
  dateFrom: string;
  dateTo: string;
  columns: string[];
  includeHeaders: boolean;
}

function formatDefaultDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Default export filters when the dialog opens without URL prefill. */
export function createDefaultExportFilters(): ExportFilters {
  const today = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);

  return {
    payerIds: [],
    billingVariantIds: [],
    assigneeFilter: null,
    statusFilter: [],
    ktsFilter: [],
    dateFrom: formatDefaultDate(from),
    dateTo: formatDefaultDate(today)
  };
}
