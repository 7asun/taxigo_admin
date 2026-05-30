'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
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
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatEuro,
  formatInteger,
  getMonthLabel,
  REVENUE_BAR_CHART_HEIGHT_PX,
  REVENUE_SPARKLINE_HEIGHT_PX
} from '../lib/controlling-utils';
import type {
  ControllingMonthlyRevenueRow,
  ControllingOperationalRow
} from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';

const barChartConfig = {
  revenue: {
    label: 'Netto-Umsatz',
    color: 'var(--primary)'
  },
  revenuePast: {
    label: 'Vormonate',
    color: 'var(--muted-foreground)'
  }
} satisfies ChartConfig;

const sparklineChartConfig = {
  trips: {
    label: 'Fahrten',
    color: 'var(--primary)'
  }
} satisfies ChartConfig;

export interface RevenueTimeSeriesProps {
  operational: UseQueryResult<ControllingOperationalRow[]>;
  monthlyRevenue: UseQueryResult<ControllingMonthlyRevenueRow[]>;
}

export function RevenueTimeSeries({
  operational,
  monthlyRevenue
}: RevenueTimeSeriesProps) {
  const currentMonthPrefix = todayYmdInBusinessTz().slice(0, 7);

  const monthlyChartData = useMemo(() => {
    return (monthlyRevenue.data ?? []).map((row) => {
      const monthIndex = Number(row.month_start.slice(5, 7)) - 1;
      return {
        month: getMonthLabel(monthIndex),
        monthStart: row.month_start,
        revenue: Number(row.revenue_net),
        trips: row.trip_count,
        isCurrent: row.month_start.startsWith(currentMonthPrefix)
      };
    });
  }, [monthlyRevenue.data, currentMonthPrefix]);

  const sparklineData = useMemo(() => {
    return (operational.data ?? []).map((row) => ({
      date: row.trip_date.slice(8, 10),
      trips: row.total_trips
    }));
  }, [operational.data]);

  if (operational.isLoading || monthlyRevenue.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-48' />
          <Skeleton className='h-4 w-64' />
        </CardHeader>
        <CardContent className='space-y-4'>
          <Skeleton
            className='w-full'
            style={{ height: REVENUE_BAR_CHART_HEIGHT_PX }}
          />
          <Skeleton
            className='w-full'
            style={{ height: REVENUE_SPARKLINE_HEIGHT_PX }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Umsatzentwicklung</CardTitle>
        <CardDescription>
          Monatsumsatz (12 Monate) und Tagesverlauf im gewählten Zeitraum
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <ChartContainer
          config={barChartConfig}
          className='aspect-auto w-full'
          style={{ height: REVENUE_BAR_CHART_HEIGHT_PX }}
        >
          <BarChart data={monthlyChartData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} strokeDasharray='3 3' />
            <XAxis dataKey='month' tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={(value) => formatEuro(Number(value))}
              width={80}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              cursor={{ fill: 'var(--primary)', opacity: 0.05 }}
              content={
                <ChartTooltipContent
                  formatter={(value, _name, item) => (
                    <div className='flex w-full justify-between gap-4'>
                      <span className='text-muted-foreground'>
                        {formatEuro(Number(value))}
                      </span>
                      <span className='font-mono tabular-nums'>
                        Fahrten:{' '}
                        {formatInteger(
                          Number(
                            (item.payload as { trips?: number }).trips ?? 0
                          )
                        )}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey='revenue' radius={[4, 4, 0, 0]}>
              {monthlyChartData.map((entry) => (
                <Cell
                  key={entry.monthStart}
                  fill={
                    entry.isCurrent
                      ? 'var(--color-revenue)'
                      : 'var(--color-revenuePast)'
                  }
                  fillOpacity={entry.isCurrent ? 1 : 0.35}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>

        <div>
          <p className='text-muted-foreground mb-2 text-xs'>
            Tagesfahrten im Zeitraum
          </p>
          <ChartContainer
            config={sparklineChartConfig}
            className='aspect-auto w-full'
            style={{ height: REVENUE_SPARKLINE_HEIGHT_PX }}
          >
            <LineChart data={sparklineData} margin={{ left: 0, right: 0 }}>
              <XAxis dataKey='date' hide />
              <YAxis hide domain={[0, 'auto']} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => [
                      formatInteger(Number(value)),
                      'Fahrten'
                    ]}
                  />
                }
              />
              <Line
                type='monotone'
                dataKey='trips'
                stroke='var(--color-trips)'
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
