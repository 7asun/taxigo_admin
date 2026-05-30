'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatInteger,
  heatmapIntensity,
  HEATMAP_HOURS
} from '../lib/controlling-utils';
import type { ControllingHeatmapRow } from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';

export interface HourlyDistributionProps {
  heatmap: UseQueryResult<ControllingHeatmapRow[]>;
}

export function HourlyDistribution({ heatmap }: HourlyDistributionProps) {
  const { chartData, peakHour, maxTrips } = useMemo(() => {
    const byHour = Array.from({ length: HEATMAP_HOURS }, (_, hour) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      hourNum: hour,
      trips: 0
    }));

    for (const row of heatmap.data ?? []) {
      byHour[row.hour_of_day].trips += row.trip_count;
    }

    const max = Math.max(...byHour.map((item) => item.trips), 0);
    const peak = byHour.reduce(
      (best, item) => (item.trips > best.trips ? item : best),
      byHour[0]
    );

    return { chartData: byHour, peakHour: peak.hour, maxTrips: max };
  }, [heatmap.data]);

  if (heatmap.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-40' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-[220px] w-full' />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stundenverteilung</CardTitle>
        <CardDescription>Spitzenstunde: {peakHour} Uhr</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='h-[220px]'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={chartData} layout='vertical' margin={{ left: 8 }}>
              <CartesianGrid horizontal={false} strokeDasharray='3 3' />
              <XAxis type='number' hide domain={[0, 'auto']} />
              <YAxis
                type='category'
                dataKey='hour'
                width={48}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                formatter={(value) => [formatInteger(Number(value)), 'Fahrten']}
              />
              <Bar dataKey='trips' radius={[0, 4, 4, 0]}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.hourNum}
                    fill={`color-mix(in oklch, var(--primary) ${Math.round(
                      heatmapIntensity(entry.trips, maxTrips) * 100
                    )}%, var(--color-surface-offset, var(--muted)))`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
