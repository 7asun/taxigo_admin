import { Metadata } from 'next';
import { InvoiceDetailView } from '@/features/invoices/components/invoice-detail';

export const metadata: Metadata = {
  title: 'Rechnungsdetails | Taxigo',
  description: 'Rechnung im Detail ansehen'
};

interface InvoiceDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

/**
 * /dashboard/invoices/[id]
 *
 * Single invoice detail page.
 * Provides the ID to the client component, which fetches the full detail
 * representation (header + lines + joins) via React Query.
 */
export default async function InvoiceDetailPage({
  params
}: InvoiceDetailPageProps) {
  const resolvedParams = await params;
  return (
    <div className='flex min-h-0 w-full flex-1 flex-col overflow-y-auto'>
      <div className='mx-auto w-full max-w-5xl space-y-6 p-8 pt-6'>
        <InvoiceDetailView invoiceId={resolvedParams.id} />
      </div>
    </div>
  );
}
