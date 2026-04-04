/**
 * InvoicePdfDocument.tsx
 *
 * Root @react-pdf/renderer Document for invoice PDFs — composes cover page,
 * appendix page, and shared footer. Layout detail lives in section components
 * and pdf-styles (DIN-oriented margins, § 14 UStG fields).
 *
 * Recipient layout (Spec C): `per_client` keeps the passenger as primary
 * addressee; optional frozen snapshot block for Rechnungsempfänger.
 * `monthly` / `single_trip` use the snapshot as the sole legal window addressee
 * when present, else legacy payer address.
 */

import { Document, Page } from '@react-pdf/renderer';

import { calculateInvoiceTotals } from '../../api/invoice-line-items.api';
import type { BuilderLineItem, InvoiceDetail } from '../../types/invoice.types';
import type { PriceResolution } from '../../types/pricing.types';

import { buildInvoicePdfSummary } from './lib/build-invoice-pdf-summary';
import {
  recipientFromRechnungsempfaengerSnapshot,
  secondaryLegalFromSnapshot
} from './lib/rechnungsempfaenger-pdf';
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
  /** Optional intro text override from invoice_text_blocks */
  introText?: string | null;
  /** Optional outro text override from invoice_text_blocks */
  outroText?: string | null;
}

function priceResolutionFromLineItem(
  li: InvoiceDetail['line_items'][number]
): PriceResolution {
  const snap = li.price_resolution_snapshot;
  if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
    const o = snap as Record<string, unknown>;
    const unit =
      typeof o.unit_price_net === 'number' ? o.unit_price_net : li.unit_price;
    const qty = typeof o.quantity === 'number' ? o.quantity : li.quantity;
    const net = typeof o.net === 'number' ? o.net : null;
    const gross = typeof o.gross === 'number' ? o.gross : null;
    const tr = typeof o.tax_rate === 'number' ? o.tax_rate : li.tax_rate;
    const su = o.strategy_used;
    const src = o.source;
    return {
      gross,
      net,
      tax_rate: tr,
      strategy_used: (typeof su === 'string'
        ? su
        : li.pricing_strategy_used) as PriceResolution['strategy_used'],
      source: (typeof src === 'string'
        ? src
        : li.pricing_source) as PriceResolution['source'],
      note: typeof o.note === 'string' ? o.note : undefined,
      unit_price_net: unit,
      quantity: qty
    };
  }
  const u = li.unit_price;
  const q = li.quantity;
  const netTotal = Math.round(u * q * 100) / 100;
  return {
    gross: Math.round(netTotal * (1 + li.tax_rate) * 100) / 100,
    net: netTotal,
    tax_rate: li.tax_rate,
    strategy_used: (li.pricing_strategy_used ??
      'trip_price_fallback') as PriceResolution['strategy_used'],
    source: (li.pricing_source ?? 'trip_price') as PriceResolution['source'],
    unit_price_net: u,
    quantity: q
  };
}

export function InvoicePdfDocument({
  invoice,
  paymentQrDataUrl = null,
  introText = null,
  outroText = null
}: InvoicePdfDocumentProps) {
  const cp = invoice.company_profile;
  const payer = invoice.payer;
  const client = invoice.client;

  const resolvedIntroText = introText ?? invoice.intro_block?.content ?? null;
  const resolvedOutroText = outroText ?? invoice.outro_block?.content ?? null;

  const isPerClientBilled = invoice.mode === 'per_client' && !!client;

  const recipientCompanyName = isPerClientBilled
    ? (client?.company_name?.trim() ?? '')
    : '';
  const recipientPersonName = isPerClientBilled
    ? `${client?.first_name || ''} ${client?.last_name || ''}`.trim()
    : (payer?.name ?? '—');
  const recipientName = recipientPersonName || recipientCompanyName || '—';

  const recipientStreet = isPerClientBilled ? client?.street : payer?.street;
  const recipientStreetNumber = isPerClientBilled
    ? client?.street_number
    : payer?.street_number;
  const recipientZipCode = isPerClientBilled
    ? client?.zip_code
    : payer?.zip_code;
  const recipientCity = isPerClientBilled ? client?.city : payer?.city;
  const recipientPhone = isPerClientBilled ? client?.phone : null;

  const customerNumber = isPerClientBilled
    ? (client?.customer_number ?? '')
    : (payer?.number ?? '');

  let salutation = 'Sehr geehrte Damen und Herren,';
  if (isPerClientBilled && client?.last_name) {
    if (client.greeting_style === 'Herr') {
      salutation = `Sehr geehrter Herr ${client.last_name},`;
    } else if (client.greeting_style === 'Frau') {
      salutation = `Sehr geehrte Frau ${client.last_name},`;
    }
  }

  const snapPrimary = recipientFromRechnungsempfaengerSnapshot(
    invoice.rechnungsempfaenger_snapshot
  );
  const secondaryLegal = isPerClientBilled
    ? secondaryLegalFromSnapshot(invoice.rechnungsempfaenger_snapshot)
    : null;

  const payerWindowRecipient = {
    companyName: '',
    personName: payer?.name ?? '—',
    displayName: payer?.name ?? '—',
    street: payer?.street ?? '',
    streetNumber: payer?.street_number ?? '',
    zipCode: payer?.zip_code ?? '',
    city: payer?.city ?? '',
    phone: null as string | null,
    addressLine2: null as string | null
  };

  const clientWindowRecipient = {
    companyName: recipientCompanyName,
    personName: recipientPersonName,
    displayName: recipientName,
    street: client?.street ?? '',
    streetNumber: client?.street_number ?? '',
    zipCode: client?.zip_code ?? '',
    city: client?.city ?? '',
    phone: recipientPhone,
    addressLine2: null as string | null
  };

  const snapshotWindowRecipient = snapPrimary
    ? {
        companyName: '',
        personName: snapPrimary.displayName,
        displayName: snapPrimary.displayName,
        street: snapPrimary.street,
        streetNumber: snapPrimary.streetNumber,
        zipCode: snapPrimary.zipCode,
        city: snapPrimary.city,
        phone: snapPrimary.phone,
        addressLine2: snapPrimary.addressLine2
      }
    : null;

  const coverRecipient = isPerClientBilled
    ? clientWindowRecipient
    : (snapshotWindowRecipient ?? payerWindowRecipient);

  const lineItemsForCalc: BuilderLineItem[] = invoice.line_items.map((li) => ({
    trip_id: li.trip_id,
    position: li.position,
    line_date: li.line_date,
    description: li.description,
    client_name: li.client_name,
    pickup_address: li.pickup_address,
    dropoff_address: li.dropoff_address,
    distance_km: li.distance_km,
    unit_price: li.unit_price,
    quantity: li.quantity,
    tax_rate: li.tax_rate,
    billing_variant_code: li.billing_variant_code,
    billing_variant_name: li.billing_variant_name,
    kts_document_applies: li.kts_override,
    no_invoice_warning: false,
    price_resolution: priceResolutionFromLineItem(li),
    kts_override: li.kts_override,
    price_source: null,
    warnings: []
  }));

  const { subtotal, total, breakdown } =
    calculateInvoiceTotals(lineItemsForCalc);

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
          recipient={coverRecipient}
          secondaryLegalRecipient={secondaryLegal}
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
          introText={resolvedIntroText}
          outroText={resolvedOutroText}
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
