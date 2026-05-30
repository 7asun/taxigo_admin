'use client';

import { useMemo } from 'react';
import {
  aggregateOperationalRows,
  formatEuro,
  formatPercent
} from '../lib/controlling-utils';
import type { ControllingOperationalRow } from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';

export interface OperationalFlagsProps {
  operational: UseQueryResult<ControllingOperationalRow[]>;
}

export function OperationalFlags({ operational }: OperationalFlagsProps) {
  const totals = useMemo(
    () => aggregateOperationalRows(operational.data ?? []),
    [operational.data]
  );

  if (operational.isLoading) {
    return (
      <div className='animate-pulse rounded-lg bg-[var(--color-warning-highlight,var(--muted))] p-4 text-[var(--color-warning,var(--foreground))]'>
        <div className='bg-muted/40 h-4 w-48 rounded' />
      </div>
    );
  }

  const unpricedPct =
    totals.total_trips > 0
      ? (totals.unpriced_trips / totals.total_trips) * 100
      : 0;

  const flags: string[] = [];

  if (totals.unpriced_trips > 0) {
    flags.push(
      `Fahrten ohne Preiszuordnung: ${totals.unpriced_trips} (${formatPercent(unpricedPct)})`
    );
  }
  if (totals.unassigned_trips > 0) {
    flags.push(`Fahrten ohne Fahrer: ${totals.unassigned_trips}`);
  }
  if (totals.fremdfirma_trips > 0) {
    flags.push(
      `Fremdfirma-Fahrten: ${totals.fremdfirma_trips} (Kosten: ${formatEuro(totals.fremdfirma_cost)})`
    );
  }

  if (flags.length === 0) return null;

  return (
    <section
      className='rounded-lg border border-amber-200/60 p-4'
      style={{
        backgroundColor: 'var(--color-warning-highlight, oklch(0.95 0.05 85))',
        color: 'var(--color-warning, oklch(0.45 0.12 65))'
      }}
    >
      <h2 className='mb-2 text-sm font-semibold'>Hinweise zur Datenqualität</h2>
      <ul className='space-y-1 text-sm'>
        {flags.map((flag) => (
          <li key={flag}>{flag}</li>
        ))}
      </ul>
    </section>
  );
}
