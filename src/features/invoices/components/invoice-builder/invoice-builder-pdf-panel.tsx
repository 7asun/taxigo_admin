'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Panel, PanelHeader, PanelBody } from '@/components/panels';
import { Button } from '@/components/ui/button';
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
  isDirty?: boolean;
  onRequestPreviewUpdate?: () => void;
}

export function InvoiceBuilderPdfPanel({
  lineItemCount,
  isLoadingTrips,
  section2Complete,
  draftInvoice,
  pdf,
  isDirty = false,
  onRequestPreviewUpdate = () => {}
}: InvoiceBuilderPdfPanelProps) {
  // why: iframe binds to this URL — kept across pdf.loading=true so the previous PDF
  // stays visible while react-pdf generates the next blob (usePDF keeps url until complete).
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const displayedPdfUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (draftInvoice) return;
    if (displayedPdfUrlRef.current) {
      URL.revokeObjectURL(displayedPdfUrlRef.current);
      displayedPdfUrlRef.current = null;
    }
    setIframeSrc(null);
  }, [draftInvoice]);

  // why: usePDF sets url + loading:false in one setState (react-pdf.browser.js L325–330) —
  // only swap iframe src when the new render is fully complete, then revoke the superseded blob.
  useEffect(() => {
    if (!pdf.url || pdf.loading) return;
    if (pdf.url === displayedPdfUrlRef.current) return;

    if (displayedPdfUrlRef.current) {
      URL.revokeObjectURL(displayedPdfUrlRef.current);
    }
    displayedPdfUrlRef.current = pdf.url;
    setIframeSrc(pdf.url);
  }, [pdf.url, pdf.loading]);

  useEffect(() => {
    return () => {
      if (displayedPdfUrlRef.current) {
        URL.revokeObjectURL(displayedPdfUrlRef.current);
        displayedPdfUrlRef.current = null;
      }
    };
  }, []);

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

  const showFirstLoadSpinner = !iframeSrc && pdf.loading;
  const showFirstLoadIdle = !iframeSrc && !pdf.loading && !isDirty;
  const showFirstLoadButton = !iframeSrc && !pdf.loading && isDirty;

  return (
    <Panel className='flex h-full min-h-0 flex-col overflow-hidden'>
      <PanelHeader title='Vorschau' className='shrink-0' />
      <PanelBody
        padded={false}
        className='relative min-h-0 flex-1 overflow-hidden'
      >
        {showFirstLoadSpinner ? (
          <div className='text-muted-foreground flex h-full min-h-0 items-center justify-center text-sm'>
            Vorschau wird aktualisiert…
          </div>
        ) : showFirstLoadButton ? (
          <div className='flex h-full min-h-0 items-center justify-center'>
            <Button type='button' onClick={onRequestPreviewUpdate}>
              Vorschau laden
            </Button>
          </div>
        ) : showFirstLoadIdle ? (
          <div className='text-muted-foreground flex h-full min-h-0 items-center justify-center text-sm'>
            Vorschau wird geladen…
          </div>
        ) : iframeSrc ? (
          <>
            <iframe
              title='Rechnungs-PDF-Vorschau'
              src={iframeSrc}
              className='absolute inset-0 h-full w-full border-0'
            />
            {pdf.loading ? (
              <div className='bg-background/90 border-border pointer-events-none absolute top-3 right-3 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm'>
                <Loader2 className='h-3.5 w-3.5 animate-spin' />
                Wird aktualisiert…
              </div>
            ) : null}
            {isDirty && !pdf.loading ? (
              <div className='bg-background/95 border-border absolute top-3 right-3 left-3 z-10 flex items-center justify-between gap-3 rounded-md border px-3 py-2 shadow-sm'>
                <span className='text-sm font-medium'>Vorschau veraltet</span>
                <Button
                  type='button'
                  size='sm'
                  variant='secondary'
                  onClick={onRequestPreviewUpdate}
                >
                  <RefreshCw className='mr-1.5 h-3.5 w-3.5' />
                  Aktualisieren
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className='text-muted-foreground flex h-full min-h-0 items-center justify-center text-sm'>
            Vorschau wird geladen…
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
