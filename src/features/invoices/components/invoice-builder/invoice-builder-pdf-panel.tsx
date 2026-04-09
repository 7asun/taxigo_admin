'use client';

import { Panel, PanelHeader, PanelBody } from '@/components/panels';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';

interface InvoiceBuilderPdfPanelProps {
  lineItemCount: number;
  isLoadingTrips: boolean;
  section2Complete: boolean;
  draftInvoice: InvoiceDetail | null;
  pdf: {
    loading: boolean;
    url: string | null;
  };
  pdfTitle?: string;
}

export function InvoiceBuilderPdfPanel({
  lineItemCount,
  isLoadingTrips,
  section2Complete,
  draftInvoice,
  pdf,
  pdfTitle
}: InvoiceBuilderPdfPanelProps) {
  if (isLoadingTrips) {
    return (
      <Panel className='flex h-full min-h-0 flex-col overflow-hidden'>
        <PanelHeader title='Vorschau' />
        <PanelBody padded={false} className='relative min-h-0 flex-1'>
          <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
            Fahrten werden geladen…
          </div>
        </PanelBody>
      </Panel>
    );
  }

  if (!section2Complete || lineItemCount === 0) {
    return (
      <Panel className='flex h-full min-h-0 flex-col overflow-hidden'>
        <PanelHeader title='Vorschau' />
        <PanelBody padded={false} className='relative min-h-0 flex-1'>
          <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
            Fahrten laden um die Vorschau zu starten
          </div>
        </PanelBody>
      </Panel>
    );
  }

  if (!draftInvoice) {
    return (
      <Panel className='flex h-full min-h-0 flex-col overflow-hidden'>
        <PanelHeader title='Vorschau' />
        <PanelBody padded={false} className='relative min-h-0 flex-1'>
          <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
            Vorschau nicht verfügbar.
          </div>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel className='flex h-full min-h-0 flex-col overflow-hidden'>
      <PanelHeader title='Vorschau' className='shrink-0' />
      <PanelBody
        padded={false}
        className='relative min-h-0 flex-1 overflow-hidden'
      >
        {pdf.loading ? (
          <div className='text-muted-foreground flex h-full min-h-0 items-center justify-center text-sm'>
            Vorschau wird aktualisiert…
          </div>
        ) : pdf.url ? (
          <iframe
            title={pdfTitle || 'Vorschau'}
            src={pdf.url}
            className='absolute inset-0 h-full w-full border-0'
          />
        ) : (
          <div className='text-muted-foreground flex h-full min-h-0 items-center justify-center text-sm'>
            Vorschau wird geladen…
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
