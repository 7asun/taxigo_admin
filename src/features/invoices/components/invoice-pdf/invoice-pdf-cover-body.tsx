/**
 * PDF page 1 — letter block, grouped route table, VAT totals, payment section.
 * minPresenceAhead avoids awkward page breaks before totals. Payment block uses
 * `wrap={false}` only on the payment detail row (+ QR), not on the whole
 * Zahlungsblock — so heading/intro can stay on page 1 while the outro is a separate section.
 */

import { View, Text, Image } from '@react-pdf/renderer';

import { formatTaxRate } from '../../lib/tax-calculator';
import type { InvoiceDetail } from '../../types/invoice.types';

import type { InvoicePdfSummaryRow } from './lib/build-invoice-pdf-summary';
import {
  formatInvoicePdfEur,
  formatInvoicePdfIbanDisplay
} from './lib/invoice-pdf-format';
import { styles } from './pdf-styles';

export interface InvoicePdfCoverBodyProps {
  invoiceNumber: string;
  salutation: string;
  paymentDueDays: number;
  dueDateFormatted: string;
  companyProfile: InvoiceDetail['company_profile'];
  /** PNG data URL for SEPA QR; omit when unavailable */
  paymentQrDataUrl: string | null;
  summaryItems: InvoicePdfSummaryRow[];
  subtotal: number;
  total: number;
  breakdown: { rate: number; tax: number }[];
}

export function InvoicePdfCoverBody({
  invoiceNumber,
  salutation,
  paymentDueDays,
  dueDateFormatted,
  companyProfile: cp,
  paymentQrDataUrl,
  summaryItems,
  subtotal,
  total,
  breakdown
}: InvoicePdfCoverBodyProps) {
  return (
    <>
      <View style={{ marginTop: 8 }}>
        <Text style={styles.subject}>Rechnung Nr. {invoiceNumber}</Text>
        <Text style={styles.salutation}>{salutation}</Text>
        <Text style={styles.bodyText}>
          vielen Dank für Ihr Vertrauen. Nachfolgend berechnen wir Ihnen die
          erbrachten Personenbeförderungsleistungen gemäß den vereinbarten
          Konditionen.
        </Text>
      </View>

      {/* Grouped routes (cover table) */}
      <View style={styles.tableHeader}>
        <Text style={[styles.colPos, styles.tableHeaderText]}>#</Text>
        <Text style={[styles.colRoute, styles.tableHeaderText]}>
          Route / Leistung
        </Text>
        <Text style={[styles.colQty, styles.tableHeaderText]}>Menge</Text>
        <Text style={[styles.colMwst, styles.tableHeaderText]}>MwSt-Satz</Text>
        <Text style={[styles.colTotal, styles.tableHeaderText]}>Betrag</Text>
      </View>

      {summaryItems.map((item, idx) => (
        <View
          key={item.id}
          style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
          wrap={false}
        >
          <Text style={styles.colPos}>{item.position}</Text>
          <View style={styles.colRoute}>
            <Text style={styles.routePrimary}>{item.descriptionPrimary}</Text>
            {item.descriptionSecondary ? (
              <Text style={styles.routeSecondary}>
                {item.descriptionSecondary}
              </Text>
            ) : null}
          </View>
          <Text style={styles.colQty}>{item.quantity}x</Text>
          <Text style={styles.colMwst}>{formatTaxRate(item.tax_rate)}</Text>
          <Text style={styles.colTotal}>
            {formatInvoicePdfEur(item.total_price)}
          </Text>
        </View>
      ))}

      {/* Totals — minPresenceAhead keeps block from splitting at page bottom */}
      <View style={styles.totalsSection} minPresenceAhead={88}>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Summe Nettobeträge</Text>
          <Text style={styles.totalsValue}>
            {formatInvoicePdfEur(subtotal)}
          </Text>
        </View>
        {breakdown.map((b) => (
          <View key={b.rate} style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>
              zzgl. Umsatzsteuer {formatTaxRate(b.rate)}
            </Text>
            <Text style={styles.totalsValue}>{formatInvoicePdfEur(b.tax)}</Text>
          </View>
        ))}
        <View style={styles.totalsGrandSpacer} />
        <View style={styles.totalsGrandRow} wrap={false}>
          <Text style={styles.totalsGrandLabel}>
            Bruttobetrag (Zahlungsbetrag)
          </Text>
          <Text style={styles.totalsGrandValue}>
            {formatInvoicePdfEur(total)}
          </Text>
        </View>
      </View>

      {/* Zahlungsinformation: heading + text flow normally; only the detail+QR row is non-splittable */}
      <View style={styles.paymentInstructions}>
        <Text style={styles.boldText}>Zahlungsinformation</Text>
        <Text style={[styles.normalText, { marginBottom: 4, marginTop: 2 }]}>
          Zahlungsziel: {paymentDueDays} Tage netto — fällig zum{' '}
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>
            {dueDateFormatted}
          </Text>
          . Bitte überweisen Sie den ausgewiesenen Zahlungsbetrag (
          {formatInvoicePdfEur(total)}) unter Angabe der IBAN und des
          Verwendungszwecks (oder per QR-Code).
        </Text>

        <View style={styles.paymentContentRow} wrap={false}>
          <View style={styles.paymentDetailsCol} wrap={false}>
            <View style={[styles.paymentDetailRow, { marginTop: 0 }]}>
              <Text style={styles.paymentLabel}>Begünstigter</Text>
              <Text style={styles.paymentValue}>
                {cp?.legal_name?.trim() || '—'}
              </Text>
            </View>
            <View style={styles.paymentDetailRow}>
              <Text style={styles.paymentLabel}>Bank</Text>
              <Text style={styles.paymentValue}>
                {cp?.bank_name?.trim() || '—'}
              </Text>
            </View>
            <View style={styles.paymentDetailRow}>
              <Text style={styles.paymentLabel}>IBAN</Text>
              <Text style={styles.paymentValue}>
                {formatInvoicePdfIbanDisplay(cp?.bank_iban ?? undefined) || '—'}
              </Text>
            </View>
            {cp?.bank_bic?.trim() ? (
              <View style={styles.paymentDetailRow}>
                <Text style={styles.paymentLabel}>BIC</Text>
                <Text style={styles.paymentValue}>{cp.bank_bic}</Text>
              </View>
            ) : null}
            <View style={styles.paymentDetailRow}>
              <Text style={styles.paymentLabel}>Verwendungszweck</Text>
              <Text
                style={[styles.paymentValue, { fontFamily: 'Helvetica-Bold' }]}
              >
                {invoiceNumber}
              </Text>
            </View>
          </View>
          {paymentQrDataUrl ? (
            <View style={styles.paymentQrCol} wrap={false}>
              <Image src={paymentQrDataUrl} style={styles.paymentQr} />
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.bodyOutroSection}>
        <Text style={styles.bodyOutro}>
          Wir bedanken uns herzlich für Ihr Vertrauen in unsere Dienstleistungen
          und stehen Ihnen bei Fragen oder Anliegen gerne zur Verfügung. Bitte
          kontaktieren Sie uns gerne hierzu unter{' '}
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>
            {cp?.phone?.trim() || '0441 350 17475'}
          </Text>
          .
        </Text>
        <Text style={styles.bodyClosing}>Mit freundlichen Grüßen,</Text>
      </View>
    </>
  );
}
