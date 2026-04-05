'use client';

import { useEffect } from 'react';
import { usePDF } from '@react-pdf/renderer';

import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';

import { InvoicePdfDocument } from '../invoice-pdf/InvoicePdfDocument';

interface InvoiceBuilderStep4PdfPreviewProps {
  draftInvoice: InvoiceDetail | null;
  introText: string | null;
  outroText: string | null;
}

export function InvoiceBuilderStep4PdfPreview({
  draftInvoice,
  introText,
  outroText
}: InvoiceBuilderStep4PdfPreviewProps) {
  const [pdf, updatePdf] = usePDF();

  useEffect(() => {
    if (!draftInvoice) return undefined;
    const t = window.setTimeout(() => {
      updatePdf(
        <InvoicePdfDocument
          invoice={draftInvoice}
          introText={introText}
          outroText={outroText}
          paymentQrDataUrl={null}
        />
      );
    }, 600);
    return () => window.clearTimeout(t);
  }, [draftInvoice, introText, outroText, updatePdf]);

  if (!draftInvoice) {
    return (
      <div className='text-muted-foreground rounded-md border p-4 text-sm'>
        Vorschau nicht verfügbar.
      </div>
    );
  }

  return (
    <div className='bg-muted/20 relative min-h-[420px] w-full overflow-hidden rounded-md border'>
      {pdf.loading ? (
        <div className='text-muted-foreground bg-background/60 absolute inset-0 z-10 flex items-center justify-center text-sm'>
          Vorschau wird aktualisiert…
        </div>
      ) : null}
      {pdf.url ? (
        <iframe
          title='Rechnungs-PDF-Vorschau'
          src={pdf.url}
          className='h-[min(72vh,820px)] w-full border-0'
        />
      ) : (
        <div className='text-muted-foreground p-4 text-sm'>
          Vorschau wird geladen…
        </div>
      )}
    </div>
  );
}
