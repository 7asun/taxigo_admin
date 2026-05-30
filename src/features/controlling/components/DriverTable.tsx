'use client';

import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatEuro,
  formatKm,
  formatTripsPerDay
} from '../lib/controlling-utils';
import type {
  ControllingBreakdownRow,
  ControllingDriverSummary
} from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

type SortKey =
  | 'driver_name'
  | 'trip_count'
  | 'revenue_net'
  | 'total_km'
  | 'euro_per_km'
  | 'utilization'
  | 'wheelchair_trips';

function aggregateDrivers(
  rows: ControllingBreakdownRow[]
): ControllingDriverSummary[] {
  const map = new Map<string, ControllingDriverSummary>();

  for (const row of rows) {
    const key = row.driver_id ?? '__unassigned__';
    const existing = map.get(key);
    if (existing) {
      existing.trip_count += row.trip_count;
      existing.revenue_net += row.revenue_net;
      existing.total_km += row.total_km;
      existing.wheelchair_trips += row.wheelchair_trips;
    } else {
      map.set(key, {
        driver_id: row.driver_id,
        driver_name:
          row.driver_id == null ? 'Nicht zugewiesen' : (row.driver_name ?? '—'),
        trip_count: row.trip_count,
        revenue_net: row.revenue_net,
        total_km: row.total_km,
        active_days: row.active_days,
        wheelchair_trips: row.wheelchair_trips
      });
    }
  }

  return Array.from(map.values());
}

export interface DriverTableProps {
  breakdown: UseQueryResult<ControllingBreakdownRow[]>;
}

export function DriverTable({ breakdown }: DriverTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue_net');
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo(() => {
    const drivers = aggregateDrivers(breakdown.data ?? []);
    return drivers.sort((a, b) => {
      const direction = sortAsc ? 1 : -1;
      switch (sortKey) {
        case 'driver_name':
          return a.driver_name.localeCompare(b.driver_name, 'de') * direction;
        case 'trip_count':
          return (a.trip_count - b.trip_count) * direction;
        case 'revenue_net':
          return (a.revenue_net - b.revenue_net) * direction;
        case 'total_km':
          return (a.total_km - b.total_km) * direction;
        case 'euro_per_km': {
          const aRate = a.total_km > 0 ? a.revenue_net / a.total_km : 0;
          const bRate = b.total_km > 0 ? b.revenue_net / b.total_km : 0;
          return (aRate - bRate) * direction;
        }
        case 'utilization': {
          const aUtil =
            a.active_days && a.active_days > 0
              ? a.trip_count / a.active_days
              : 0;
          const bUtil =
            b.active_days && b.active_days > 0
              ? b.trip_count / b.active_days
              : 0;
          return (aUtil - bUtil) * direction;
        }
        case 'wheelchair_trips':
          return (a.wheelchair_trips - b.wheelchair_trips) * direction;
        default:
          return 0;
      }
    });
  }, [breakdown.data, sortAsc, sortKey]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((value) => !value);
    } else {
      setSortKey(key);
      setSortAsc(key === 'driver_name');
    }
  }

  if (breakdown.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-48 w-full' />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fahrer</CardTitle>
        <CardDescription>
          Auslastungsindex = Fahrten / aktive Arbeitstage
        </CardDescription>
      </CardHeader>
      <CardContent className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead
                label='Fahrer'
                active={sortKey === 'driver_name'}
                onClick={() => toggleSort('driver_name')}
              />
              <SortHead
                label='Fahrten'
                active={sortKey === 'trip_count'}
                onClick={() => toggleSort('trip_count')}
              />
              <SortHead
                label='Netto-Umsatz'
                active={sortKey === 'revenue_net'}
                onClick={() => toggleSort('revenue_net')}
              />
              <SortHead
                label='Gesamt-km'
                active={sortKey === 'total_km'}
                onClick={() => toggleSort('total_km')}
                className='hidden md:table-cell'
              />
              <SortHead
                label='Ø €/km'
                active={sortKey === 'euro_per_km'}
                onClick={() => toggleSort('euro_per_km')}
                className='hidden md:table-cell'
              />
              <SortHead
                label='Auslastungsindex'
                active={sortKey === 'utilization'}
                onClick={() => toggleSort('utilization')}
                className='hidden lg:table-cell'
              />
              <SortHead
                label='Rollstuhl'
                active={sortKey === 'wheelchair_trips'}
                onClick={() => toggleSort('wheelchair_trips')}
                className='hidden lg:table-cell'
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const euroPerKm =
                row.total_km > 0 ? row.revenue_net / row.total_km : 0;
              return (
                <TableRow key={row.driver_id ?? 'unassigned'}>
                  <TableCell className='font-medium'>
                    {row.driver_name}
                  </TableCell>
                  <TableCell>{row.trip_count}</TableCell>
                  <TableCell>{formatEuro(row.revenue_net)}</TableCell>
                  <TableCell className='hidden md:table-cell'>
                    {formatKm(row.total_km)}
                  </TableCell>
                  <TableCell className='hidden md:table-cell'>
                    {formatEuro(euroPerKm)}
                  </TableCell>
                  <TableCell className='hidden lg:table-cell'>
                    {row.active_days
                      ? formatTripsPerDay(row.trip_count, row.active_days)
                      : '—'}
                  </TableCell>
                  <TableCell className='hidden lg:table-cell'>
                    {row.wheelchair_trips}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SortHead({
  label,
  active,
  onClick,
  className
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type='button'
        onClick={onClick}
        className={cn(
          'hover:text-foreground text-left font-medium',
          active && 'text-foreground'
        )}
      >
        {label}
      </button>
    </TableHead>
  );
}
