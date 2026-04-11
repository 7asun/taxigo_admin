'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { AbrechnungKpiCards } from './abrechnung-kpi-cards';
import { AbrechnungRecentInvoices } from './abrechnung-recent-invoices';
import { useAbrechnungKpis } from './use-abrechnung-kpis';

export function AbrechnungOverviewPage() {
  const kpis = useAbrechnungKpis();

  return (
    <div className='flex min-w-0 flex-1 flex-col space-y-6'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
        <h2 className='text-3xl font-bold tracking-tight'>Abrechnung</h2>
        <Button asChild>
          <Link href='/dashboard/invoices/new'>
            <Plus className='mr-2 h-4 w-4' />
            Neue Rechnung
          </Link>
        </Button>
      </div>

      <AbrechnungKpiCards kpis={kpis} />
      <AbrechnungRecentInvoices />
    </div>
  );
}
