import type { Metadata } from 'next';
import { InvoicePdfPreview } from '@/features/invoices/components/invoice-pdf/invoice-pdf-preview';

interface InvoicePdfPreviewPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({
  params
}: InvoicePdfPreviewPageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `PDF-Vorschau ${id} | Taxigo`,
    description: 'Browser-Vorschau fuer Rechnungs-PDFs'
  };
}

export default async function InvoicePdfPreviewPage({
  params
}: InvoicePdfPreviewPageProps) {
  const { id } = await params;
  return <InvoicePdfPreview invoiceId={id} />;
}
