/**
 * TanStack Query key factory for Controlling dashboard RPCs.
 */

import type { ControllingPeriod } from '@/features/controlling/types/controlling.types';

export const controllingKeys = {
  all: ['controlling'] as const,

  operational: (period: ControllingPeriod) =>
    ['controlling', 'operational', period.dateFrom, period.dateTo] as const,

  operationalPrevious: (period: ControllingPeriod) =>
    [
      'controlling',
      'operational-previous',
      period.dateFrom,
      period.dateTo
    ] as const,

  breakdown: (period: ControllingPeriod) =>
    ['controlling', 'breakdown', period.dateFrom, period.dateTo] as const,

  heatmap: (period: ControllingPeriod) =>
    ['controlling', 'heatmap', period.dateFrom, period.dateTo] as const,

  invoiceKpis: (period: ControllingPeriod) =>
    ['controlling', 'invoice-kpis', period.dateFrom, period.dateTo] as const,

  monthlyRevenue: () => ['controlling', 'monthly-revenue'] as const
};
