'use client';

import { useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { StatsCard } from '@/features/dashboard/components/stats-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  aggregateOperationalRows,
  formatInteger,
  formatPercent,
  formatPercentDelta
} from '../lib/controlling-utils';
import type {
  ControllingBreakdownRow,
  ControllingOperationalRow
} from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  RadialBreakdownChart,
  type RadialBreakdownItem
} from './RadialBreakdownChart';

export interface WheelchairStatsProps {
  operational: UseQueryResult<ControllingOperationalRow[]>;
  operationalPrevious: UseQueryResult<ControllingOperationalRow[]>;
  breakdown: UseQueryResult<ControllingBreakdownRow[]>;
}

export function WheelchairStats({
  operational,
  operationalPrevious,
  breakdown
}: WheelchairStatsProps) {
  const totals = useMemo(
    () => aggregateOperationalRows(operational.data ?? []),
    [operational.data]
  );
  const prevTotals = useMemo(
    () => aggregateOperationalRows(operationalPrevious.data ?? []),
    [operationalPrevious.data]
  );

  const wheelchairShare =
    totals.total_trips > 0
      ? (totals.wheelchair_trips / totals.total_trips) * 100
      : 0;
  const ktsShare =
    totals.total_trips > 0 ? (totals.kts_trips / totals.total_trips) * 100 : 0;

  const wheelchairDelta = formatPercentDelta(
    totals.wheelchair_trips,
    prevTotals.wheelchair_trips
  );
  const ktsDelta = formatPercentDelta(totals.kts_trips, prevTotals.kts_trips);

  // Breakdown RPC exposes wheelchair_trips per slice, not kts_trips — payer split uses wheelchair counts.
  const wheelchairPayerData = useMemo((): RadialBreakdownItem[] => {
    const byPayer = new Map<string, { label: string; value: number }>();
    for (const row of breakdown.data ?? []) {
      if (!row.payer_id || row.wheelchair_trips === 0) continue;
      const existing = byPayer.get(row.payer_id);
      if (existing) {
        existing.value += row.wheelchair_trips;
      } else {
        byPayer.set(row.payer_id, {
          label: row.payer_name ?? 'Unbekannt',
          value: row.wheelchair_trips
        });
      }
    }
    return Array.from(byPayer.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((item, index) => ({
        key: `payer-${index}`,
        label: item.label,
        value: item.value,
        fill: `var(--chart-${index + 1})`
      }));
  }, [breakdown.data]);

  if (operational.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-48' />
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
            <div className='flex flex-col gap-4'>
              <Skeleton className='h-28' />
              <Skeleton className='h-28' />
            </div>
            <Skeleton className='h-[310px] w-full' />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rollstuhl & KTS</CardTitle>
        <CardDescription>Spezialfahrten im gewählten Zeitraum</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          <div className='flex flex-col gap-4'>
            <StatsCard
              title='Rollstuhl-Fahrten'
              value={formatInteger(totals.wheelchair_trips)}
              description={formatPercent(wheelchairShare)}
              trend={{
                value: wheelchairDelta.label,
                isUp: wheelchairDelta.isUp
              }}
            />
            <StatsCard
              title='KTS-Fahrten'
              value={formatInteger(totals.kts_trips)}
              description={formatPercent(ktsShare)}
              trend={{
                value: ktsDelta.label,
                isUp: ktsDelta.isUp
              }}
            />
          </div>
          <RadialBreakdownChart
            data={wheelchairPayerData}
            valueLabel='Rollstuhl-Fahrten'
            title='Rollstuhl nach Kostenträger'
            description='Anteil je Auftraggeber im Zeitraum'
            isLoading={breakdown.isLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
}
