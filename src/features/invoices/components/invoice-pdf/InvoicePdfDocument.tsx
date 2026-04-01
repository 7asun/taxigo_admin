/**
 * InvoicePdfDocument.tsx
 *
 * Root @react-pdf/renderer Document for invoice PDFs — composes cover page,
 * appendix page, and shared footer. Layout detail lives in section components
 * and pdf-styles (DIN-oriented margins, § 14 UStG fields).
 *
 * Data prep: recipient/salutation from payer vs client mode; route grouping
 * and direction labels via buildInvoicePdfSummary; totals via calculateInvoiceTotals.
 */

import { Document, Page } from '@react-pdf/renderer';

import { calculateInvoiceTotals } from '../../api/invoice-line-items.api';
import type { BuilderLineItem, InvoiceDetail } from '../../types/invoice.types';

import { buildInvoicePdfSummary } from './lib/build-invoice-pdf-summary';
import {
  buildInvoicePdfSenderOneLine,
  formatInvoicePdfDate
} from './lib/invoice-pdf-format';
import { InvoicePdfAppendix } from './invoice-pdf-appendix';
import { InvoicePdfCoverBody } from './invoice-pdf-cover-body';
import { InvoicePdfCoverHeader } from './invoice-pdf-cover-header';
import { InvoicePdfFooter } from './invoice-pdf-footer';
import { styles } from './pdf-styles';
import { fitSenderLine } from './resolve-sender-font-size';

export interface InvoicePdfDocumentProps {
  invoice: InvoiceDetail;
  /** PNG data URL from `qrcode` (EPC SCT payload); omit if IBAN missing or generation failed. */
  paymentQrDataUrl?: string | null;
}

export function InvoicePdfDocument({
  invoice,
  paymentQrDataUrl = null
}: InvoicePdfDocumentProps) {
  const cp = invoice.company_profile;
  const payer = invoice.payer;
  const client = invoice.client;

  const isClientBilled =
    (invoice.mode === 'per_client' || invoice.mode === 'single_trip') &&
    !!client;

  const recipientCompanyName = isClientBilled
    ? (client?.company_name?.trim() ?? '')
    : '';
  const recipientPersonName = isClientBilled
    ? `${client?.first_name || ''} ${client?.last_name || ''}`.trim()
    : (payer?.name ?? '—');
  const recipientName = recipientPersonName || recipientCompanyName || '—';

  const recipientStreet = isClientBilled ? client?.street : payer?.street;
  const recipientStreetNumber = isClientBilled
    ? client?.street_number
    : payer?.street_number;
  const recipientZipCode = isClientBilled ? client?.zip_code : payer?.zip_code;
  const recipientCity = isClientBilled ? client?.city : payer?.city;
  const recipientPhone = isClientBilled ? client?.phone : null;

  const customerNumber = isClientBilled
    ? (client?.customer_number ?? '')
    : (payer?.number ?? '');

  let salutation = 'Sehr geehrte Damen und Herren,';
  if (isClientBilled && client?.last_name) {
    if (client.greeting_style === 'Herr') {
      salutation = `Sehr geehrter Herr ${client.last_name},`;
    } else if (client.greeting_style === 'Frau') {
      salutation = `Sehr geehrte Frau ${client.last_name},`;
    }
  }

  const lineItemsForCalc = invoice.line_items.map((li) => ({
    ...li,
    trip_id: null,
    line_date: null,
    description: '',
    client_name: null,
    pickup_address: null,
    dropoff_address: null,
    distance_km: null,
    billing_variant_code: null,
    billing_variant_name: null,
    warnings: [] as const
  }));

  const { subtotal, total, breakdown } = calculateInvoiceTotals(
    lineItemsForCalc as unknown as BuilderLineItem[]
  );

  const { summaryItems, placeHints, routeDirectionLabels } =
    buildInvoicePdfSummary(invoice);

  const dueDateMs =
    new Date(invoice.created_at).getTime() +
    invoice.payment_due_days * 86400000;
  const dueDateFormatted = formatInvoicePdfDate(
    new Date(dueDateMs).toISOString()
  );

  const senderOneLine = buildInvoicePdfSenderOneLine(cp);
  const senderFit = senderOneLine
    ? fitSenderLine(senderOneLine)
    : { line: '', fontSize: 7 };

  return (
    <Document
      title={invoice.invoice_number}
      author={cp?.legal_name ?? 'Taxigo'}
    >
      <Page size='A4' style={styles.page} wrap>
        <InvoicePdfCoverHeader
          companyProfile={cp}
          senderFit={senderFit}
          recipient={{
            companyName: recipientCompanyName,
            personName: recipientPersonName,
            displayName: recipientName,
            street: recipientStreet ?? '',
            streetNumber: recipientStreetNumber ?? '',
            zipCode: recipientZipCode ?? '',
            city: recipientCity ?? '',
            phone: recipientPhone
          }}
          invoiceNumber={invoice.invoice_number}
          invoiceCreatedAtIso={invoice.created_at}
          periodFromIso={invoice.period_from}
          periodToIso={invoice.period_to}
          customerNumber={customerNumber}
        />

        <InvoicePdfCoverBody
          invoiceNumber={invoice.invoice_number}
          salutation={salutation}
          paymentDueDays={invoice.payment_due_days}
          dueDateFormatted={dueDateFormatted}
          companyProfile={cp}
          paymentQrDataUrl={paymentQrDataUrl}
          summaryItems={summaryItems}
          subtotal={subtotal}
          total={total}
          breakdown={breakdown}
        />

        <InvoicePdfFooter companyProfile={cp} notes={invoice.notes} />
      </Page>

      <Page size='A4' style={styles.page} wrap>
        <InvoicePdfAppendix
          invoiceNumber={invoice.invoice_number}
          invoiceCreatedAtIso={invoice.created_at}
          lineItems={invoice.line_items}
          placeHints={placeHints}
          routeDirectionLabels={routeDirectionLabels}
        />

        <InvoicePdfFooter companyProfile={cp} notes={invoice.notes} />
      </Page>
    </Document>
  );
}
