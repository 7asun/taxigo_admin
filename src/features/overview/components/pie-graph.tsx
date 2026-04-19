'use client';

import * as React from 'react';
import { IconTrendingUp } from '@tabler/icons-react';
import { Label, Pie, PieChart } from 'recharts';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { usePayers } from '@/features/payers/hooks/use-payers';
import { getPayerDistribution } from '@/features/dashboard/lib/payer-utils';
import { Skeleton } from '@/components/ui/skeleton';
import { tripsService } from '@/features/trips/api/trips.service';
import { calculateTrend } from '@/features/dashboard/lib/stats-utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

type TimePreset = 'all' | 'thisMonth' | 'lastMonth';

export function PieGraph() {
  const [timePreset, setTimePreset] = React.useState<TimePreset>('thisMonth');
  const [trips, setTrips] = React.useState<any[]>([]);
  const [previousMonthTrips, setPreviousMonthTrips] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const { data: payers, isLoading: payersLoading } = usePayers();

  // Fetch trips with date filter and billing_variant data
  React.useEffect(() => {
    const fetchTrips = async () => {
      try {
        setIsLoading(true);
        // Convert preset to date range
        let range: { from: Date; to: Date } | undefined;
        let previousRange: { from: Date; to: Date } | undefined;

        if (timePreset === 'thisMonth') {
          const now = new Date();
          range = {
            from: startOfMonth(now),
            to: endOfMonth(now)
          };
          const lastMonth = subMonths(now, 1);
          previousRange = {
            from: startOfMonth(lastMonth),
            to: endOfMonth(lastMonth)
          };
        } else if (timePreset === 'lastMonth') {
          const lastMonth = subMonths(new Date(), 1);
          range = {
            from: startOfMonth(lastMonth),
            to: endOfMonth(lastMonth)
          };
          const twoMonthsAgo = subMonths(new Date(), 2);
          previousRange = {
            from: startOfMonth(twoMonthsAgo),
            to: endOfMonth(twoMonthsAgo)
          };
        }
        // 'all' keeps both range and previousRange as undefined (no date filter)

        // Fetch current and previous data
        const [currentData, previousData] = await Promise.all([
          tripsService.getTripsForAnalytics(range),
          previousRange
            ? tripsService.getTripsForAnalytics(previousRange)
            : Promise.resolve([])
        ]);
        setTrips(currentData || []);
        setPreviousMonthTrips(previousData || []);
      } catch (error) {
        console.error('Error fetching trips:', error);
        setTrips([]);
        setPreviousMonthTrips([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTrips();
  }, [timePreset]);

  // Calculate month-over-month trend
  const trend = React.useMemo(() => {
    if (timePreset === 'all') return null;
    const currentCount = trips.length;
    const previousCount = previousMonthTrips.length;
    return calculateTrend(currentCount, previousCount, 'gegenüber Vormonat');
  }, [trips.length, previousMonthTrips.length, timePreset]);

  const chartData = React.useMemo(() => {
    if (!trips.length) return [];

    // Always use payer grouping
    if (!payers) return [];
    return getPayerDistribution(trips, payers);
  }, [trips, payers]);

  const totalTrips = React.useMemo(() => {
    return chartData.reduce((acc, curr) => acc + curr.count, 0);
  }, [chartData]);

  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {
      count: {
        label: 'Fahrten'
      }
    };
    chartData.forEach((item) => {
      config[item.name] = {
        label: item.name,
        color: item.fill
      };
    });
    return config;
  }, [chartData]);

  const topItem = chartData[0];

  if (isLoading || payersLoading) {
    return (
      <Card className='@container/card'>
        <CardHeader className='pb-2'>
          <Skeleton className='h-6 w-1/3' />
          <Skeleton className='h-4 w-1/4' />
        </CardHeader>
        <CardContent>
          <div className='flex h-[250px] items-center justify-center'>
            <Skeleton className='h-40 w-40 rounded-full' />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className='@container/card'>
      <CardHeader className='space-y-3'>
        <div>
          <CardTitle>Kostenträger-Verteilung</CardTitle>
          <CardDescription>
            <span className='hidden @[540px]/card:block'>
              Übersicht der Fahrten nach Kostenträger
            </span>
            <span className='@[540px]/card:hidden'>
              Kostenträger-Verteilung
            </span>
          </CardDescription>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Select
            value={timePreset}
            onValueChange={(v) => setTimePreset(v as TimePreset)}
          >
            <SelectTrigger className='h-8 w-[140px] text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Insgesamt</SelectItem>
              <SelectItem value='thisMonth'>Diesen Monat</SelectItem>
              <SelectItem value='lastMonth'>Letzten Monat</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className='px-2 pt-4 sm:px-6 sm:pt-6'>
        <ChartContainer
          config={chartConfig}
          className='mx-auto aspect-square h-[250px]'
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey='count'
              nameKey='name'
              innerRadius={60}
              strokeWidth={2}
              stroke='var(--background)'
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor='middle'
                        dominantBaseline='middle'
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className='fill-foreground text-3xl font-bold'
                        >
                          {totalTrips.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className='fill-muted-foreground text-sm'
                        >
                          Gesamt Fahrten
                        </tspan>
                      </text>
                    );
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className='flex-col gap-2 text-sm'>
        {topItem && (
          <div className='flex items-center gap-2 leading-none font-medium'>
            {topItem.name} ist Spitzenreiter mit{' '}
            {((topItem.count / totalTrips) * 100).toFixed(1)}%{' '}
            <IconTrendingUp className='text-primary h-4 w-4' />
          </div>
        )}
        {trend && (
          <div className='flex items-center gap-2 leading-none font-medium'>
            <span className={trend.isUp ? 'text-emerald-600' : 'text-red-600'}>
              {trend.value}
            </span>
            <span className='text-muted-foreground'>{trend.label}</span>
            {trend.isUp ? (
              <IconTrendingUp className='h-4 w-4 text-emerald-600' />
            ) : (
              <IconTrendingUp className='h-4 w-4 rotate-180 text-red-600' />
            )}
          </div>
        )}
        <div className='text-muted-foreground leading-none'>
          {timePreset === 'all'
            ? 'Basierend auf allen im System erfassten Fahrten'
            : timePreset === 'thisMonth'
              ? 'Basierend auf Fahrten in diesem Monat'
              : 'Basierend auf Fahrten im letzten Monat'}
        </div>
      </CardFooter>
    </Card>
  );
}
