'use client';

/**
 * PrimetimeHeatmap — 7×24 grid for trip volume / revenue by weekday and hour.
 *
 * day_of_week from RPC uses ISO convention (0=Monday). JavaScript Date.getDay()
 * uses 0=Sunday — we never map via getDay(); row order follows RPC values.
 */

import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatEuro,
  formatInteger,
  getWeekdayLabel,
  heatmapIntensity,
  HEATMAP_DAYS,
  HEATMAP_HOURS
} from '../lib/controlling-utils';
import type { ControllingHeatmapRow } from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

type HeatmapMetric = 'trips' | 'revenue';

export interface PrimetimeHeatmapProps {
  heatmap: UseQueryResult<ControllingHeatmapRow[]>;
}

export function PrimetimeHeatmap({ heatmap }: PrimetimeHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>('trips');

  const { grid, maxValue } = useMemo(() => {
    const cells = new Map<string, ControllingHeatmapRow>();
    for (const row of heatmap.data ?? []) {
      cells.set(`${row.day_of_week}-${row.hour_of_day}`, row);
    }

    let max = 0;
    const gridRows: {
      day: number;
      hours: {
        hour: number;
        value: number;
        row: ControllingHeatmapRow | null;
      }[];
    }[] = [];

    for (let day = 0; day < HEATMAP_DAYS; day += 1) {
      const hours = [];
      for (let hour = 0; hour < HEATMAP_HOURS; hour += 1) {
        const row = cells.get(`${day}-${hour}`) ?? null;
        const value =
          metric === 'trips'
            ? (row?.trip_count ?? 0)
            : Number(row?.revenue_net ?? 0);
        max = Math.max(max, value);
        hours.push({ hour, value, row });
      }
      gridRows.push({ day, hours });
    }

    return { grid: gridRows, maxValue: max };
  }, [heatmap.data, metric]);

  if (heatmap.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-40' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-[280px] w-full' />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
        <div>
          <CardTitle>Primetime-Heatmap</CardTitle>
          <CardDescription>Wochentag × Uhrzeit</CardDescription>
        </div>
        <ToggleGroup
          type='single'
          value={metric}
          onValueChange={(value) => {
            if (value) setMetric(value as HeatmapMetric);
          }}
          variant='outline'
          size='sm'
        >
          <ToggleGroupItem value='trips'>Fahrtenanzahl</ToggleGroupItem>
          <ToggleGroupItem value='revenue'>Umsatz</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent>
        <div className='overflow-x-auto'>
          <div className='min-w-[720px]'>
            <div
              className='mb-1 grid gap-1'
              style={{
                gridTemplateColumns: `48px repeat(${HEATMAP_HOURS}, minmax(20px, 1fr))`
              }}
            >
              <div />
              {Array.from({ length: HEATMAP_HOURS }, (_, hour) => (
                <div
                  key={hour}
                  className={cn(
                    'text-muted-foreground text-center text-[10px]',
                    hour % 3 !== 0 && 'opacity-0 sm:opacity-0'
                  )}
                >
                  {hour % 3 === 0 ? hour : ''}
                </div>
              ))}
            </div>

            <TooltipProvider delayDuration={0}>
              {grid.map(({ day, hours }) => (
                <div
                  key={day}
                  className='mb-1 grid gap-1'
                  style={{
                    gridTemplateColumns: `48px repeat(${HEATMAP_HOURS}, minmax(20px, 1fr))`
                  }}
                >
                  <div className='text-muted-foreground flex items-center text-xs font-medium'>
                    {getWeekdayLabel(day)}
                  </div>
                  {hours.map(({ hour, value, row }) => {
                    const intensity = heatmapIntensity(value, maxValue);
                    return (
                      <Tooltip key={`${day}-${hour}`}>
                        <TooltipTrigger asChild>
                          <div
                            className='aspect-square min-h-5 rounded-sm border border-transparent'
                            style={{
                              backgroundColor:
                                intensity === 0
                                  ? 'var(--color-surface-offset, var(--muted))'
                                  : `color-mix(in oklch, var(--primary) ${Math.round(intensity * 100)}%, var(--color-surface-offset, var(--muted)))`
                            }}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className='font-medium'>
                            {getWeekdayLabel(day)} ·{' '}
                            {String(hour).padStart(2, '0')}:00
                          </p>
                          <p>
                            {metric === 'trips'
                              ? `${formatInteger(value)} Fahrten`
                              : formatEuro(value)}
                          </p>
                          {row ? null : (
                            <p className='text-muted-foreground text-xs'>
                              Keine Daten
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
