'use client';

import { useMemo } from 'react';
import { Bar, BarChart, XAxis, YAxis } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { aggregateDrivers, formatEuro } from '../lib/controlling-utils';
import type { ControllingBreakdownRow } from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';

const chartConfig = {
  current: { label: 'Aktueller Zeitraum', color: 'var(--chart-1)' },
  previous: { label: 'Vorperiode', color: 'var(--chart-2)' }
} satisfies ChartConfig;

export interface DriverRevenueChartProps {
  breakdown: UseQueryResult<ControllingBreakdownRow[]>;
  breakdownPrevious: UseQueryResult<ControllingBreakdownRow[]>;
}

export function DriverRevenueChart({
  breakdown,
  breakdownPrevious
}: DriverRevenueChartProps) {
  const drivers = useMemo(
    () => aggregateDrivers(breakdown.data ?? []),
    [breakdown.data]
  );

  const previousMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const driver of aggregateDrivers(breakdownPrevious.data ?? [])) {
      const key = driver.driver_id ?? '__unassigned__';
      map.set(key, driver.revenue_net);
    }
    return map;
  }, [breakdownPrevious.data]);

  // Descending sort: highest revenue driver appears first (left) on the X axis.
  const chartData = useMemo(
    () =>
      [...drivers]
        .sort((a, b) => b.revenue_net - a.revenue_net)
        .map((driver) => {
          const key = driver.driver_id ?? '__unassigned__';
          return {
            name: driver.driver_name ?? 'Nicht zugewiesen',
            current: driver.revenue_net,
            previous: previousMap.get(key) ?? 0
          };
        }),
    [drivers, previousMap]
  );

  const isLoading = breakdown.isLoading || breakdownPrevious.isLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-48' />
          <Skeleton className='h-4 w-56' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-[220px] w-full' />
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Umsatz nach Fahrer</CardTitle>
          <CardDescription>Aktueller Zeitraum vs. Vorperiode</CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground py-8 text-center text-sm'>
            Keine Fahrerdaten im gewählten Zeitraum
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Umsatz nach Fahrer</CardTitle>
        <CardDescription>Aktueller Zeitraum vs. Vorperiode</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className='aspect-auto w-full'
          style={{ height: 280 }}
        >
          <BarChart data={chartData} margin={{ left: 12, right: 12 }}>
            <XAxis
              dataKey='name'
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(value) => formatEuro(Number(value))}
              tickLine={false}
              axisLine={false}
              tick={{ className: 'tabular-nums' }}
              width={80}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator='dashed' />}
            />
            <Bar
              dataKey='current'
              fill='var(--color-current)'
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey='previous'
              fill='var(--color-previous)'
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
        <div className='text-muted-foreground mt-4 flex flex-wrap gap-4 text-xs'>
          <div className='flex items-center gap-1.5'>
            <div
              className='h-3 w-3 rounded-sm'
              style={{ backgroundColor: 'var(--chart-1)' }}
            />
            <span>Aktueller Zeitraum</span>
          </div>
          <div className='flex items-center gap-1.5'>
            <div
              className='h-3 w-3 rounded-sm'
              style={{ backgroundColor: 'var(--chart-2)' }}
            />
            <span>Vorperiode</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
