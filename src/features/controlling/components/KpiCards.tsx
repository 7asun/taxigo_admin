'use client';

import { useMemo } from 'react';
import { StatsCard } from '@/features/dashboard/components/stats-card';
import {
  aggregateOperationalRows,
  formatEuro,
  formatInteger,
  formatKm,
  formatPercentDelta
} from '../lib/controlling-utils';
import type { ControllingOperationalRow } from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';

export interface KpiCardsProps {
  operational: UseQueryResult<ControllingOperationalRow[]>;
  operationalPrevious: UseQueryResult<ControllingOperationalRow[]>;
}

export function KpiCards({ operational, operationalPrevious }: KpiCardsProps) {
  const totals = useMemo(
    () => aggregateOperationalRows(operational.data ?? []),
    [operational.data]
  );
  const prevTotals = useMemo(
    () => aggregateOperationalRows(operationalPrevious.data ?? []),
    [operationalPrevious.data]
  );

  const isTrendLoading = operational.isLoading || operationalPrevious.isLoading;

  const revenueDelta = formatPercentDelta(
    totals.revenue_net,
    prevTotals.revenue_net
  );
  const tripsDelta = formatPercentDelta(
    totals.total_trips,
    prevTotals.total_trips
  );
  const avgPriceDelta = formatPercentDelta(
    totals.total_trips > 0 ? totals.revenue_net / totals.total_trips : 0,
    prevTotals.total_trips > 0
      ? prevTotals.revenue_net / prevTotals.total_trips
      : 0
  );
  const kmDelta = formatPercentDelta(totals.total_km, prevTotals.total_km);
  const eurPerKmDelta = formatPercentDelta(
    totals.total_km > 0 ? totals.revenue_net / totals.total_km : 0,
    prevTotals.total_km > 0 ? prevTotals.revenue_net / prevTotals.total_km : 0
  );

  const prevAvgPrice =
    prevTotals.total_trips > 0
      ? prevTotals.revenue_net / prevTotals.total_trips
      : 0;
  const prevEurPerKm =
    prevTotals.total_km > 0 ? prevTotals.revenue_net / prevTotals.total_km : 0;

  return (
    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5'>
      <StatsCard
        title='Netto-Umsatz'
        value={formatEuro(totals.revenue_net)}
        trend={{
          value: revenueDelta.label,
          isUp: revenueDelta.isUp
        }}
        trendTooltip={`Vorperiode: ${formatEuro(prevTotals.revenue_net)}`}
        isLoading={isTrendLoading}
      />
      <StatsCard
        title='Fahrtenanzahl'
        value={String(totals.total_trips)}
        description={
          totals.cancelled_trips > 0
            ? `${totals.cancelled_trips} storniert`
            : undefined
        }
        trend={{
          value: tripsDelta.label,
          isUp: tripsDelta.isUp
        }}
        trendTooltip={`Vorperiode: ${formatInteger(prevTotals.total_trips)} Fahrten`}
        isLoading={isTrendLoading}
      />
      <StatsCard
        title='Ø Preis / Fahrt'
        value={
          totals.total_trips > 0
            ? formatEuro(totals.revenue_net / totals.total_trips)
            : '—'
        }
        trend={{
          value: avgPriceDelta.label,
          isUp: avgPriceDelta.isUp
        }}
        trendTooltip={`Vorperiode: ${formatEuro(prevAvgPrice)}`}
        isLoading={isTrendLoading}
      />
      <StatsCard
        title='Gesamt-km'
        value={formatKm(totals.total_km)}
        description={
          totals.total_trips > 0
            ? `Ø ${formatKm(totals.total_km / totals.total_trips)} / Fahrt`
            : undefined
        }
        trend={{
          value: kmDelta.label,
          isUp: kmDelta.isUp
        }}
        trendTooltip={`Vorperiode: ${formatKm(prevTotals.total_km)}`}
        isLoading={isTrendLoading}
      />
      <StatsCard
        title='Ø €/km'
        value={
          totals.total_km > 0
            ? formatEuro(totals.revenue_net / totals.total_km)
            : '—'
        }
        trend={{
          value: eurPerKmDelta.label,
          isUp: eurPerKmDelta.isUp
        }}
        trendTooltip={`Vorperiode: ${formatEuro(prevEurPerKm)}`}
        isLoading={isTrendLoading}
      />
    </div>
  );
}
