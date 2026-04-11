/**
 * AbrechnungKpiCards
 *
 * Four KPI cards for the Abrechnung overview.
 * Uses StatsCard with optional countLabel (top-right on the title row) plus
 * currency as the main value and a one-line description.
 */

'use client';

import { StatsCard } from '@/features/dashboard/components/stats-card';
import {
  formatCurrency,
  formatNumber
} from '@/features/dashboard/lib/stats-utils';

import type { AbrechnungKpis } from './use-abrechnung-kpis';

interface AbrechnungKpiCardsProps {
  kpis: AbrechnungKpis;
}

export function AbrechnungKpiCards({ kpis }: AbrechnungKpiCardsProps) {
  const {
    openCount,
    openTotal,
    overdueCount,
    overdueTotal,
    thisMonthCount,
    thisMonthTotal,
    pendingAngeboteCount,
    isLoading
  } = kpis;

  const count = (n: number) => (isLoading ? '…' : formatNumber(n));

  return (
    <div className='*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card hidden grid-cols-2 gap-3 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-4'>
      <StatsCard
        className='min-w-0'
        title='Offene Rechnungen'
        countLabel={count(openCount)}
        value={isLoading ? '…' : formatCurrency(openTotal)}
        description='Summe versendeter Rechnungen, die noch nicht überfällig sind.'
        isLoading={isLoading}
      />
      <StatsCard
        className='min-w-0'
        title='Überfällig'
        countLabel={count(overdueCount)}
        value={isLoading ? '…' : formatCurrency(overdueTotal)}
        description='Summe versendeter Rechnungen mit überschrittenem Zahlungsziel.'
        isLoading={isLoading}
      />
      <StatsCard
        className='min-w-0'
        title='Diesen Monat'
        countLabel={count(thisMonthCount)}
        value={isLoading ? '…' : formatCurrency(thisMonthTotal)}
        description='Summe aller Rechnungen mit Versand- oder Erstellungsdatum in diesem Kalendermonat.'
        isLoading={isLoading}
      />
      <StatsCard
        className='min-w-0'
        title='Angebote ausstehend'
        countLabel={count(pendingAngeboteCount)}
        value={isLoading ? '…' : formatNumber(pendingAngeboteCount)}
        description='Gesendete Angebote ohne Annahme oder Ablehnung.'
        isLoading={isLoading}
      />
    </div>
  );
}
