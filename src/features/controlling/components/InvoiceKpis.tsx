'use client';

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
  formatEuro,
  formatInteger,
  formatPercent
} from '../lib/controlling-utils';
import type { ControllingInvoiceKpis } from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';

export interface InvoiceKpisProps {
  invoiceKpis: UseQueryResult<ControllingInvoiceKpis>;
}

export function InvoiceKpis({ invoiceKpis }: InvoiceKpisProps) {
  if (invoiceKpis.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-40' />
        </CardHeader>
        <CardContent>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className='h-28' />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const data = invoiceKpis.data;
  if (!data || data.period_invoice_count === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rechnungs-KPIs</CardTitle>
          <CardDescription>Forderungsmanagement</CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground text-sm'>
            Keine Rechnungen im gewählten Zeitraum
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rechnungs-KPIs</CardTitle>
        <CardDescription>Forderungsmanagement</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <StatsCard
            title='Offene Forderungen'
            value={formatEuro(data.open_amount)}
            description={`${formatInteger(data.open_count)} Rechnungen`}
          />
          <StatsCard
            title='Überfällige'
            value={formatEuro(data.overdue_amount)}
            description={`${formatInteger(data.overdue_count)} Rechnungen`}
          />
          <StatsCard
            title='DSO in Tagen'
            value={
              data.dso_days == null
                ? '—'
                : `${formatInteger(Math.round(data.dso_days))} Tage`
            }
            description='Bezahlte Rechnungen'
          />
          <StatsCard
            title='Fakturierungsgrad'
            value={formatPercent(data.invoicing_rate_pct)}
            description='Fahrten mit Rechnungsposition'
          />
        </div>
      </CardContent>
    </Card>
  );
}
