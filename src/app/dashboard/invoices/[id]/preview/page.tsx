import type { Metadata } from 'next';

import { InvoicePdfPreview } from '@/features/invoices/components/invoice-pdf/invoice-pdf-preview';

export const metadata: Metadata = {
  title: 'PDF-Vorschau | Taxigo',
  description: 'Browser-Vorschau fuer Rechnungs-PDFs'
};

interface InvoicePdfPreviewPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function InvoicePdfPreviewPage({
  params
}: InvoicePdfPreviewPageProps) {
  const resolvedParams = await params;

  return <InvoicePdfPreview invoiceId={resolvedParams.id} />;
}
