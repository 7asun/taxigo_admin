/**
 * controlling.types.ts — TypeScript shapes for Controlling dashboard RPC responses.
 */

export type ControllingPeriodKey =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'custom';

export interface ControllingPeriod {
  key: ControllingPeriodKey;
  /** YYYY-MM-DD, Berlin calendar date */
  dateFrom: string;
  /** YYYY-MM-DD, Berlin calendar date (inclusive) */
  dateTo: string;
  /** German display label */
  label: string;
}

/** One row per Berlin calendar day from get_controlling_operational. */
export interface ControllingOperationalRow {
  trip_date: string;
  total_trips: number;
  completed_trips: number;
  cancelled_trips: number;
  revenue_net: number;
  revenue_gross: number;
  total_km: number;
  avg_price_per_trip: number | null;
  avg_km_per_trip: number | null;
  unpriced_trips: number;
  unassigned_trips: number;
  wheelchair_trips: number;
  kts_trips: number;
  fremdfirma_trips: number;
  fremdfirma_cost: number;
}

/** One breakdown slice from get_controlling_breakdown. */
export interface ControllingBreakdownRow {
  payer_id: string | null;
  payer_name: string | null;
  billing_type_id: string | null;
  billing_type_name: string | null;
  billing_variant_id: string | null;
  billing_variant_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  trip_count: number;
  revenue_net: number;
  revenue_gross: number;
  total_km: number;
  avg_price_per_trip: number | null;
  /** Driver-level working days (same for all rows of that driver). */
  active_days: number | null;
  wheelchair_trips: number;
}

/** One heatmap cell from get_controlling_heatmap. day_of_week: 0=Monday. */
export interface ControllingHeatmapRow {
  day_of_week: number;
  hour_of_day: number;
  trip_count: number;
  revenue_net: number;
}

/** Single-row invoice KPIs from get_controlling_invoice_kpis. */
export interface ControllingInvoiceKpis {
  open_count: number;
  open_amount: number;
  overdue_count: number;
  overdue_amount: number;
  dso_days: number | null;
  invoicing_rate_pct: number;
  period_invoice_count: number;
}

/** One month from get_controlling_monthly_revenue. */
export interface ControllingMonthlyRevenueRow {
  month_start: string;
  revenue_net: number;
  trip_count: number;
}

/** Aggregated driver row for DriverTable (client-side roll-up). */
export interface ControllingDriverSummary {
  driver_id: string | null;
  driver_name: string;
  trip_count: number;
  revenue_net: number;
  total_km: number;
  active_days: number | null;
  wheelchair_trips: number;
}

/** Flat payer roll-up for payer comparison charts (not a billing tree). */
export interface ControllingPayerSummary {
  payer_id: string;
  payer_name: string;
  revenue_net: number;
  revenue_gross: number;
  trip_count: number;
  total_km: number;
}

/** Payer × billing type roll-up for PayerBillingTreemap. */
export interface ControllingPayerTreemapItem {
  payer_id: string;
  payer_name: string;
  billing_types: {
    billing_type_id: string;
    billing_type_name: string;
    revenue_net: number;
    trip_count: number;
  }[];
  total_revenue_net: number;
  total_trip_count: number;
}
