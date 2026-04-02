'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PDFViewer } from '@react-pdf/renderer';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { generatePaymentQrDataUrl } from './generate-payment-qr-data-url';
import { InvoicePdfDocument } from './InvoicePdfDocument';
import { resolveCompanyAssetUrl } from '@/features/storage/resolve-company-asset-url';
import { useInvoiceDetail } from '../../hooks/use-invoice';

interface InvoicePdfPreviewProps {
  invoiceId: string;
}

export function InvoicePdfPreview({ invoiceId }: InvoicePdfPreviewProps) {
  const { data: invoice, isLoading, isError } = useInvoiceDetail(invoiceId);
  const [paymentQrDataUrl, setPaymentQrDataUrl] = useState<string | null>(null);
  const [pdfLogoUrl, setPdfLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) {
      setPaymentQrDataUrl(null);
      setPdfLogoUrl(null);
      return;
    }

    let cancelled = false;
    void generatePaymentQrDataUrl(invoice).then((url) => {
      if (!cancelled) setPaymentQrDataUrl(url);
    });

    void (async () => {
      const logoPath = invoice.company_profile?.logo_path ?? null;
      const legacyUrl = invoice.company_profile?.logo_url ?? null;
      if (!logoPath && !legacyUrl) {
        if (!cancelled) setPdfLogoUrl(null);
        return;
      }

      const resolved = await resolveCompanyAssetUrl({
        path: logoPath,
        url: legacyUrl,
        expiresInSeconds: 60 * 60
      }); // 1h is enough for preview
      if (!cancelled) setPdfLogoUrl(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice]);

  if (isLoading) {
    return (
      <div className='flex min-h-[70vh] items-center justify-center'>
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Loader2 className='h-4 w-4 animate-spin' />
          Lade PDF-Vorschau...
        </div>
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className='flex min-h-[70vh] items-center justify-center'>
        <p className='text-destructive text-sm'>
          PDF-Vorschau konnte nicht geladen werden.
        </p>
      </div>
    );
  }

  const pdfInvoice = pdfLogoUrl
    ? {
        ...invoice,
        company_profile: {
          ...invoice.company_profile,
          logo_url: pdfLogoUrl
        }
      }
    : invoice;

  return (
    <div className='flex h-[calc(100vh-4rem)] flex-col gap-4 p-6'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <h1 className='text-xl font-semibold'>PDF-Vorschau</h1>
          <p className='text-muted-foreground text-sm'>
            Testansicht fuer {invoice.invoice_number}
          </p>
        </div>

        <div className='flex items-center gap-2'>
          <Button asChild variant='outline'>
            <Link href={`/dashboard/invoices/${invoice.id}`}>
              <ArrowLeft className='h-4 w-4' />
              Zur Rechnung
            </Link>
          </Button>
        </div>
      </div>

      <div className='h-[calc(100vh-11rem)] overflow-hidden rounded-xl border'>
        <PDFViewer width='100%' height='100%'>
          <InvoicePdfDocument
            invoice={pdfInvoice}
            paymentQrDataUrl={paymentQrDataUrl}
          />
        </PDFViewer>
      </div>
    </div>
  );
}
