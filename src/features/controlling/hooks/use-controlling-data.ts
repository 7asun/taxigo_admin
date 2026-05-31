/**
 * use-controlling-data.ts — parallel React Query fetches for Controlling sections.
 *
 * Three separate RPC queries (plus invoice + monthly) so each section can show its
 * own skeleton while loading. staleTime is 5 minutes because CFO aggregates do not
 * need real-time refresh on every focus event.
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchControllingBreakdown,
  fetchControllingHeatmap,
  fetchControllingInvoiceKpis,
  fetchControllingMonthlyRevenue,
  fetchControllingOperational
} from '../api/controlling.service';
import {
  buildPreviousControllingPeriod,
  CONTROLLING_STALE_TIME_MS
} from '../lib/controlling-utils';
import type { ControllingPeriod } from '../types/controlling.types';
import { controllingKeys } from '@/query/keys';

export function useControllingData(period: ControllingPeriod) {
  const previousPeriod = buildPreviousControllingPeriod(period);

  const operational = useQuery({
    queryKey: controllingKeys.operational(period),
    queryFn: () => fetchControllingOperational(period),
    staleTime: CONTROLLING_STALE_TIME_MS
  });

  const operationalPrevious = useQuery({
    queryKey: controllingKeys.operationalPrevious(period),
    queryFn: () => fetchControllingOperational(previousPeriod),
    staleTime: CONTROLLING_STALE_TIME_MS
  });

  const breakdown = useQuery({
    queryKey: controllingKeys.breakdown(period),
    queryFn: () => fetchControllingBreakdown(period),
    staleTime: CONTROLLING_STALE_TIME_MS
  });

  // Prior-period breakdown is section-scoped (PayerComparisonChart skeleton only) —
  // excluded from global isLoading, same as operationalPrevious.
  const breakdownPrevious = useQuery({
    queryKey: controllingKeys.breakdownPrevious(period),
    queryFn: () => fetchControllingBreakdown(previousPeriod),
    staleTime: CONTROLLING_STALE_TIME_MS
  });

  const heatmap = useQuery({
    queryKey: controllingKeys.heatmap(period),
    queryFn: () => fetchControllingHeatmap(period),
    staleTime: CONTROLLING_STALE_TIME_MS
  });

  const invoiceKpis = useQuery({
    queryKey: controllingKeys.invoiceKpis(period),
    queryFn: () => fetchControllingInvoiceKpis(period),
    staleTime: CONTROLLING_STALE_TIME_MS
  });

  const monthlyRevenue = useQuery({
    queryKey: controllingKeys.monthlyRevenue(),
    queryFn: () => fetchControllingMonthlyRevenue(),
    staleTime: CONTROLLING_STALE_TIME_MS
  });

  const isLoading =
    operational.isLoading ||
    breakdown.isLoading ||
    heatmap.isLoading ||
    invoiceKpis.isLoading ||
    monthlyRevenue.isLoading;

  const isError =
    operational.isError &&
    breakdown.isError &&
    heatmap.isError &&
    invoiceKpis.isError &&
    monthlyRevenue.isError;

  return {
    operational,
    operationalPrevious,
    breakdown,
    breakdownPrevious,
    heatmap,
    invoiceKpis,
    monthlyRevenue,
    isLoading,
    isError
  };
}
