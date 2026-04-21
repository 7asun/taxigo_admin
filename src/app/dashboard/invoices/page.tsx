import { Metadata } from 'next';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { InvoiceListTable } from '@/features/invoices/components/invoice-list-table';
import { Skeleton } from '@/components/ui/skeleton';
import { InvoiceKpiSection } from '@/features/invoices/components/invoice-kpi-section';

export const metadata: Metadata = {
  title: 'Rechnungen | Taxigo',
  description: 'Rechnungsverwaltung und Übersicht'
};

/**
 * /dashboard/invoices
 *
 * Invoice list page.
 * Fetches the list of payers for the filter dropdown, then renders
 * the client-side InvoiceListTable containing TanStack Table logic.
 * KPI cards (billing stats) are shown at the top of the page.
 */
export default async function InvoicesPage() {
  const supabase = await createClient();

  // Fetch lightweight payers list for the filter dropdown
  const { data: payers } = await supabase
    .from('payers')
    .select('id, name')
    .order('name');

  return (
    <div className='flex min-h-0 w-full flex-1 flex-col overflow-y-auto'>
      <div className='space-y-6 p-8 pt-6'>
        <div className='flex items-center justify-between space-y-2'>
          <h2 className='text-3xl font-bold tracking-tight'>Rechnungen</h2>
        </div>

        {/* Billing KPI stats (moved from /dashboard/abrechnung) */}
        <InvoiceKpiSection />

        <Suspense fallback={<Skeleton className='h-96 w-full' />}>
          <InvoiceListTable payers={payers ?? []} />
        </Suspense>
      </div>
    </div>
  );
}
