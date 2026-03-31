import { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { InvoiceListTable } from '@/features/invoices/components/invoice-list-table';

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
 */
export default async function InvoicesPage() {
  const supabase = await createClient();

  // Fetch lightweight payers list for the filter dropdown
  const { data: payers } = await supabase
    .from('payers')
    .select('id, name')
    .order('name');

  return (
    <div className='flex-1 space-y-6 p-8 pt-6'>
      <div className='flex items-center justify-between space-y-2'>
        <h2 className='text-3xl font-bold tracking-tight'>Rechnungen</h2>
      </div>

      {/* The table handles its own data fetching via React Query */}
      <InvoiceListTable payers={payers ?? []} />
    </div>
  );
}
