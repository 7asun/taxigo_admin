'use client';

import { useMemo } from 'react';
import { LabelList, RadialBar, RadialBarChart } from 'recharts';
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
  ChartTooltip
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';

export interface RadialBreakdownItem {
  key: string;
  label: string;
  value: number;
  fill: string;
}

export interface RadialBreakdownChartProps {
  data: RadialBreakdownItem[];
  valueLabel: string;
  title: string;
  description: string;
  isLoading?: boolean;
}

export function RadialBreakdownChart({
  data,
  valueLabel,
  title,
  description,
  isLoading
}: RadialBreakdownChartProps) {
  const chartConfig = useMemo(() => {
    const config: ChartConfig = {
      value: { label: valueLabel }
    };
    data.forEach((item, index) => {
      config[item.key] = {
        label: item.label,
        color: `var(--chart-${index + 1})`
      };
    });
    return config;
  }, [data, valueLabel]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-40' />
          <Skeleton className='h-4 w-56' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-[310px] w-full' />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground text-sm'>
            Keine Daten im Zeitraum
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className='mx-auto aspect-square max-h-[250px]'
        >
          <RadialBarChart
            data={data}
            startAngle={-90}
            endAngle={380}
            innerRadius={30}
            outerRadius={110}
          >
            <ChartTooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0];
                return (
                  <div className='bg-background rounded-lg border px-3 py-2 text-sm shadow-md'>
                    <p className='font-medium'>{item.payload.label}</p>
                    <p className='text-muted-foreground'>
                      {item.value} {valueLabel}
                    </p>
                  </div>
                );
              }}
            />
            <RadialBar dataKey='value' background cornerRadius={4}>
              <LabelList
                position='insideStart'
                dataKey='label'
                className='fill-white capitalize mix-blend-luminosity'
                fontSize={11}
              />
            </RadialBar>
          </RadialBarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
