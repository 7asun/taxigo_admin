'use client';

import { PDFViewer } from '@react-pdf/renderer';

import { InvoicePdfDocument } from '@/features/invoices/components/invoice-pdf/InvoicePdfDocument';
import { EXAMPLE_INVOICE_REHA_ZENTRUM } from '@/features/invoices/components/invoice-pdf/example/example-invoice-reha-zentrum';
import { resolvePdfColumnProfile } from '@/features/invoices/lib/resolve-pdf-column-profile';

export default function ExampleInvoicePage() {
  return (
    <PDFViewer style={{ width: '100%', height: '100vh' }}>
      <InvoicePdfDocument
        invoice={EXAMPLE_INVOICE_REHA_ZENTRUM}
        columnProfile={{
          ...resolvePdfColumnProfile(null, null, null),
          main_layout: 'grouped_by_billing_type'
        }}
      />
    </PDFViewer>
  );
}
