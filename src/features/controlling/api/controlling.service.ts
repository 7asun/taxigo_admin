/**
 * controlling.service.ts — Supabase RPC calls for the Controlling dashboard.
 *
 * We use PostgreSQL RPCs instead of client-side table scans because CFO KPIs require
 * aggregations over thousands of trips; pushing GROUP BY to the database keeps
 * payloads small and guarantees Berlin TZ bucketing matches SQL migrations.
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { CONTROLLING_MONTHLY_CHART_MONTHS } from '../lib/controlling-utils';
import type {
  ControllingBreakdownRow,
  ControllingHeatmapRow,
  ControllingInvoiceKpis,
  ControllingMonthlyRevenueRow,
  ControllingOperationalRow,
  ControllingPeriod
} from '../types/controlling.types';

async function resolveCompanyId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('Nicht authentifiziert');
  }

  const { data: account, error: accError } = await supabase
    .from('accounts')
    .select('company_id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (accError) throw toQueryError(accError);
  if (account?.role !== 'admin' || !account.company_id) {
    throw new Error('Keine Berechtigung');
  }

  return account.company_id;
}

function mapOperationalRow(
  row: Record<string, unknown>
): ControllingOperationalRow {
  return {
    trip_date: String(row.trip_date),
    total_trips: Number(row.total_trips),
    completed_trips: Number(row.completed_trips),
    cancelled_trips: Number(row.cancelled_trips),
    revenue_net: Number(row.revenue_net),
    revenue_gross: Number(row.revenue_gross),
    total_km: Number(row.total_km),
    avg_price_per_trip:
      row.avg_price_per_trip == null ? null : Number(row.avg_price_per_trip),
    avg_km_per_trip:
      row.avg_km_per_trip == null ? null : Number(row.avg_km_per_trip),
    unpriced_trips: Number(row.unpriced_trips),
    unassigned_trips: Number(row.unassigned_trips),
    wheelchair_trips: Number(row.wheelchair_trips),
    kts_trips: Number(row.kts_trips),
    fremdfirma_trips: Number(row.fremdfirma_trips),
    fremdfirma_cost: Number(row.fremdfirma_cost)
  };
}

export async function fetchControllingOperational(
  period: ControllingPeriod
): Promise<ControllingOperationalRow[]> {
  const supabase = createClient();
  const companyId = await resolveCompanyId();

  const { data, error } = await supabase.rpc('get_controlling_operational', {
    p_company_id: companyId,
    p_date_from: period.dateFrom,
    p_date_to: period.dateTo
  });

  if (error) throw toQueryError(error);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((row) => mapOperationalRow(row));
}

export async function fetchControllingBreakdown(
  period: ControllingPeriod
): Promise<ControllingBreakdownRow[]> {
  const supabase = createClient();
  const companyId = await resolveCompanyId();

  const { data, error } = await supabase.rpc('get_controlling_breakdown', {
    p_company_id: companyId,
    p_date_from: period.dateFrom,
    p_date_to: period.dateTo
  });

  if (error) throw toQueryError(error);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((row) => ({
    payer_id: row.payer_id == null ? null : String(row.payer_id),
    payer_name: row.payer_name == null ? null : String(row.payer_name),
    billing_type_id:
      row.billing_type_id == null ? null : String(row.billing_type_id),
    billing_type_name:
      row.billing_type_name == null ? null : String(row.billing_type_name),
    billing_variant_id:
      row.billing_variant_id == null ? null : String(row.billing_variant_id),
    billing_variant_name:
      row.billing_variant_name == null
        ? null
        : String(row.billing_variant_name),
    driver_id: row.driver_id == null ? null : String(row.driver_id),
    driver_name: row.driver_name == null ? null : String(row.driver_name),
    trip_count: Number(row.trip_count),
    revenue_net: Number(row.revenue_net),
    revenue_gross: Number(row.revenue_gross),
    total_km: Number(row.total_km),
    avg_price_per_trip:
      row.avg_price_per_trip == null ? null : Number(row.avg_price_per_trip),
    active_days: row.active_days == null ? null : Number(row.active_days),
    wheelchair_trips: Number(row.wheelchair_trips)
  }));
}

export async function fetchControllingHeatmap(
  period: ControllingPeriod
): Promise<ControllingHeatmapRow[]> {
  const supabase = createClient();
  const companyId = await resolveCompanyId();

  const { data, error } = await supabase.rpc('get_controlling_heatmap', {
    p_company_id: companyId,
    p_date_from: period.dateFrom,
    p_date_to: period.dateTo
  });

  if (error) throw toQueryError(error);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((row) => ({
    day_of_week: Number(row.day_of_week),
    hour_of_day: Number(row.hour_of_day),
    trip_count: Number(row.trip_count),
    revenue_net: Number(row.revenue_net)
  }));
}

export async function fetchControllingInvoiceKpis(
  period: ControllingPeriod
): Promise<ControllingInvoiceKpis> {
  const supabase = createClient();
  const companyId = await resolveCompanyId();

  const { data, error } = await supabase.rpc('get_controlling_invoice_kpis', {
    p_company_id: companyId,
    p_date_from: period.dateFrom,
    p_date_to: period.dateTo
  });

  if (error) throw toQueryError(error);
  const row = (data?.[0] ?? data) as Record<string, unknown> | undefined;
  if (!row) {
    return {
      open_count: 0,
      open_amount: 0,
      overdue_count: 0,
      overdue_amount: 0,
      dso_days: null,
      invoicing_rate_pct: 0,
      period_invoice_count: 0
    };
  }

  return {
    open_count: Number(row.open_count),
    open_amount: Number(row.open_amount),
    overdue_count: Number(row.overdue_count),
    overdue_amount: Number(row.overdue_amount),
    dso_days: row.dso_days == null ? null : Number(row.dso_days),
    invoicing_rate_pct: Number(row.invoicing_rate_pct),
    period_invoice_count: Number(row.period_invoice_count)
  };
}

export async function fetchControllingMonthlyRevenue(): Promise<
  ControllingMonthlyRevenueRow[]
> {
  const supabase = createClient();
  const companyId = await resolveCompanyId();

  const { data, error } = await supabase.rpc(
    'get_controlling_monthly_revenue',
    {
      p_company_id: companyId,
      p_months: CONTROLLING_MONTHLY_CHART_MONTHS
    }
  );

  if (error) throw toQueryError(error);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((row) => ({
    month_start: String(row.month_start),
    revenue_net: Number(row.revenue_net),
    trip_count: Number(row.trip_count)
  }));
}
