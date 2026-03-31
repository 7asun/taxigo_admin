/**
 * InvoicePdfDocument.tsx
 *
 * Root @react-pdf/renderer Document for invoice PDFs.
 *
 * Layout (DIN 5008–orientiert, § 14 UStG):
 *   1. Links: Logo, Slogan darunter, Absenderzeile, Empfängeranschrift
 *   2. Rechts: Rechnungsmeta, St.-Nr. / USt-IdNr.
 *   3. Betreff + Anrede, Positionstabelle, Summen
 *   4. Zahlungsinformation: Begünstigter, Bankdaten, Verwendungszweck; optional SEPA-QR (EPC)
 *   5. Fußzeile; Anhang Fahrtendetails (Seite 2)
 */

import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { styles } from './pdf-styles';
import { fitSenderLine } from './resolve-sender-font-size';
import { calculateInvoiceTotals } from '../../api/invoice-line-items.api';
import { formatTaxRate } from '../../lib/tax-calculator';
import type { InvoiceDetail } from '../../types/invoice.types';

const eur = (v: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
    v
  );

const fmtDate = (iso: string) =>
  format(new Date(iso), 'dd.MM.yyyy', { locale: de });

/** Groups IBAN for readability (DE… 4er-Blöcke). */
function formatIbanDisplay(iban: string | null | undefined): string {
  if (!iban?.trim()) return '';
  const compact = iban.replace(/\s/g, '').toUpperCase();
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

/** Absenderzeile: name | Straße Nr. | PLZ Ort | Telefon */
function buildSenderOneLine(cp: InvoiceDetail['company_profile']): string {
  if (!cp) return '';
  const streetPart = [cp.street, cp.street_number]
    .filter(Boolean)
    .join(' ')
    .trim();
  const cityPart = [cp.zip_code, cp.city].filter(Boolean).join(' ').trim();
  const parts = [cp.legal_name, streetPart, cityPart, cp.phone?.trim()].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );
  return parts.join(' | ');
}

interface InvoicePdfDocumentProps {
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

  const recipientName = isClientBilled
    ? (
        client?.company_name ||
        `${client?.first_name || ''} ${client?.last_name || ''}`
      ).trim()
    : (payer?.name ?? '—');

  const recipientStreet = isClientBilled ? client?.street : payer?.street;
  const recipientStreetNumber = isClientBilled
    ? client?.street_number
    : payer?.street_number;
  const recipientZipCode = isClientBilled ? client?.zip_code : payer?.zip_code;
  const recipientCity = isClientBilled ? client?.city : payer?.city;

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

  const { subtotal, taxAmount, total, breakdown } = calculateInvoiceTotals(
    lineItemsForCalc as any
  );

  // Group line items for Summary page
  const routeGroups: Record<
    string,
    {
      count: number;
      description: string;
      tax_rate: number;
      total_price: number;
    }
  > = {};

  invoice.line_items.forEach((item) => {
    const pAddr = (item.pickup_address || '').trim().replace(/\s+/g, ' ');
    const dAddr = (item.dropoff_address || '').trim().replace(/\s+/g, ' ');
    const rate = item.tax_rate;

    // key normalization
    const isRouteItem = pAddr && dAddr;
    const routeKey = isRouteItem
      ? `${pAddr.toLowerCase()} -> ${dAddr.toLowerCase()} [${rate}]`
      : `spec-${item.description.toLowerCase().trim().replace(/\s+/g, ' ')} [${rate}]`;

    if (!routeGroups[routeKey]) {
      routeGroups[routeKey] = {
        count: 0,
        description: isRouteItem ? `${pAddr} nach ${dAddr}` : item.description,
        tax_rate: rate,
        total_price: 0
      };
    }

    routeGroups[routeKey].count += item.quantity || 1;
    routeGroups[routeKey].total_price += item.total_price;
  });

  const summaryItems = Object.values(routeGroups).map((g, idx) => ({
    id: `summary-${idx}`,
    position: idx + 1,
    description: g.description,
    tax_rate: g.tax_rate,
    total_price: g.total_price,
    quantity: g.count
  }));

  const dueDateMs =
    new Date(invoice.created_at).getTime() +
    invoice.payment_due_days * 86400000;
  const dueDate = fmtDate(new Date(dueDateMs).toISOString());

  const senderOneLine = buildSenderOneLine(cp);
  const senderFit = senderOneLine
    ? fitSenderLine(senderOneLine)
    : { line: '', fontSize: 7 };

  const renderFooter = () => (
    <View style={styles.footer} fixed>
      <View style={styles.footerColThird}>
        <Text style={styles.footerBold}>{cp?.legal_name ?? '—'}</Text>
        {cp?.inhaber?.trim() ? (
          <Text style={styles.footerText}>Inhaber: {cp.inhaber}</Text>
        ) : null}
        {cp?.street ? (
          <Text style={styles.footerText}>
            {cp.street} {cp.street_number}
          </Text>
        ) : null}
        {cp?.zip_code ? (
          <Text style={styles.footerText}>
            {cp.zip_code} {cp.city}
          </Text>
        ) : null}
      </View>
      <View style={styles.footerColThird}>
        <Text style={styles.footerKontaktHeading}>Kontakt</Text>
        {cp?.phone?.trim() ? (
          <Text style={styles.footerText}>Tel.: {cp.phone}</Text>
        ) : null}
        {cp?.email?.trim() ? (
          <Text style={styles.footerText}>E-Mail: {cp.email}</Text>
        ) : null}
        {cp?.website?.trim() ? (
          <Text style={styles.footerText}>Web: {cp.website}</Text>
        ) : null}
        {invoice.notes?.trim() ? (
          <Text style={styles.footerNote}>Hinweis: {invoice.notes}</Text>
        ) : null}
      </View>
      <View style={styles.footerColThird}>
        {cp?.bank_name?.trim() ? (
          <Text style={styles.footerText}>{cp.bank_name}</Text>
        ) : null}
        {cp?.bank_iban?.trim() ? (
          <Text style={styles.footerText}>
            IBAN: {formatIbanDisplay(cp.bank_iban)}
          </Text>
        ) : null}
        {cp?.tax_id ? (
          <Text style={styles.footerText}>St.-Nr.: {cp.tax_id}</Text>
        ) : null}
        {cp?.vat_id ? (
          <Text style={styles.footerText}>USt-IdNr.: {cp.vat_id}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <Document
      title={invoice.invoice_number}
      author={cp?.legal_name ?? 'Taxigo'}
    >
      {/* ── Page 1: Clean Summary ────────────────────────────────────────────── */}
      <Page size='A4' style={styles.page} wrap>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.brandStack}>
              {cp?.logo_url ? (
                <Image src={cp.logo_url} style={styles.logoLeft} />
              ) : null}
              {cp?.slogan?.trim() ? (
                <Text style={styles.sloganBelowLogo}>{cp.slogan.trim()}</Text>
              ) : null}
            </View>

            {senderFit.line ? (
              <Text
                style={[styles.senderOneLine, { fontSize: senderFit.fontSize }]}
                wrap={false}
              >
                {senderFit.line}
              </Text>
            ) : null}

            <View style={styles.recipientBlock}>
              <Text style={styles.addressCompanyName}>{recipientName}</Text>
              <Text style={styles.addressLine}>
                {recipientStreet ?? ''} {recipientStreetNumber ?? ''}
              </Text>
              <Text style={styles.addressLine}>
                {recipientZipCode ?? ''} {recipientCity ?? ''}
              </Text>
            </View>
          </View>

          <View style={styles.headerRight}>
            <View style={styles.metaContainer}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Rechnungsnr.</Text>
                <Text style={styles.metaValue}>{invoice.invoice_number}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Kundennummer</Text>
                <Text style={styles.metaValue}>{customerNumber || '—'}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Rechnungsdatum</Text>
                <Text style={styles.metaValue}>
                  {fmtDate(invoice.created_at)}
                </Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Leistungszeitraum</Text>
                <Text style={styles.metaValue}>
                  {fmtDate(invoice.period_from)} – {fmtDate(invoice.period_to)}
                </Text>
              </View>
            </View>
            <View style={styles.rightTaxBlock}>
              {cp?.tax_id ? (
                <Text style={styles.rightTaxLine}>St.-Nr.: {cp.tax_id}</Text>
              ) : null}
              {cp?.vat_id ? (
                <Text style={styles.rightTaxLine}>USt-IdNr.: {cp.vat_id}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={{ marginTop: 8 }}>
          <Text style={styles.subject}>
            Rechnung Nr. {invoice.invoice_number}
          </Text>
          <Text style={styles.salutation}>
            {salutation}
            {'\n\n'}
            vielen Dank für Ihr Vertrauen. Nachfolgend berechnen wir Ihnen die
            erbrachten Personenbeförderungsleistungen gemäß den vereinbarten
            Konditionen.
          </Text>
        </View>

        {/* Summary Table */}
        <View style={styles.tableHeader}>
          <Text style={[styles.colPos, styles.tableHeaderText]}>#</Text>
          <Text style={[styles.colRoute, styles.tableHeaderText]}>
            Route / Leistung
          </Text>
          <Text style={[styles.colQty, styles.tableHeaderText]}>Menge</Text>
          <Text style={[styles.colMwst, styles.tableHeaderText]}>
            MwSt-Satz
          </Text>
          <Text style={[styles.colTotal, styles.tableHeaderText]}>Betrag</Text>
        </View>

        {summaryItems.map((item, idx) => (
          <View
            key={item.id}
            style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
            wrap={false}
          >
            <Text style={styles.colPos}>{item.position}</Text>
            <Text style={styles.colRoute}>{item.description}</Text>
            <Text style={styles.colQty}>{item.quantity}x</Text>
            <Text style={styles.colMwst}>{formatTaxRate(item.tax_rate)}</Text>
            <Text style={styles.colTotal}>{eur(item.total_price)}</Text>
          </View>
        ))}

        {/* Totals block */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Summe Nettobeträge</Text>
            <Text style={styles.totalsValue}>{eur(subtotal)}</Text>
          </View>
          {breakdown.map((b) => (
            <View key={b.rate} style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>
                zzgl. Umsatzsteuer {formatTaxRate(b.rate)}
              </Text>
              <Text style={styles.totalsValue}>{eur(b.tax)}</Text>
            </View>
          ))}
          <View style={styles.totalsDivider} />
          <View style={styles.totalsRow}>
            <Text style={styles.totalsGrandLabel}>
              Bruttobetrag (Zahlungsbetrag)
            </Text>
            <Text style={styles.totalsGrandValue}>{eur(total)}</Text>
          </View>
        </View>

        <View style={styles.paymentInstructions}>
          <Text style={styles.boldText}>Zahlungsinformation</Text>
          <View minPresenceAhead={120}>
            <Text style={[styles.normalText, { marginBottom: 4 }]}>
              Zahlungsziel: {invoice.payment_due_days} Tage netto — fällig zum{' '}
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>{dueDate}</Text>.
              Bitte überweisen Sie den ausgewiesenen Zahlungsbetrag (
              {eur(total)}) unter Angabe der IBAN und des Verwendungszwecks
              (oder per QR-Code).
            </Text>

            <View style={styles.paymentContentRow}>
              <View style={styles.paymentTextCol}>
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
                    {formatIbanDisplay(cp?.bank_iban ?? undefined) || '—'}
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
                    style={[
                      styles.paymentValue,
                      { fontFamily: 'Helvetica-Bold' }
                    ]}
                  >
                    {invoice.invoice_number}
                  </Text>
                </View>
              </View>
              {paymentQrDataUrl ? (
                <View style={styles.paymentQrWrap}>
                  <Image src={paymentQrDataUrl} style={styles.paymentQr} />
                  <Text style={styles.paymentQrCaption}>SEPA-QR (EPC)</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {renderFooter()}
      </Page>

      {/* Appendix Page */}
      <Page size='A4' style={styles.page} wrap>
        <Text style={styles.invoiceTitle}>Anhang: Fahrtendetails</Text>
        <Text style={styles.notesLabel}>
          Zu Rechnung {invoice.invoice_number}
        </Text>

        <View style={[styles.tableHeader, { marginTop: 15 }]}>
          <Text style={[styles.colPos, styles.tableHeaderText]}>#</Text>
          <Text style={[styles.colDate, styles.tableHeaderText]}>Datum</Text>
          <Text style={[styles.colDesc, styles.tableHeaderText]}>
            Fahrtbeschreibung
          </Text>
          <Text style={[styles.colKm, styles.tableHeaderText]}>km</Text>
          <Text style={[styles.colMwst, styles.tableHeaderText]}>
            MwSt-Satz
          </Text>
          <Text style={[styles.colTotal, styles.tableHeaderText]}>Betrag</Text>
        </View>

        {invoice.line_items.map((item, idx) => (
          <View
            key={item.id}
            style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
            wrap={false}
          >
            <Text style={styles.colPos}>{item.position}</Text>
            <Text style={styles.colDate}>
              {item.line_date ? fmtDate(item.line_date) : '—'}
            </Text>
            <Text style={styles.colDesc}>{item.description}</Text>
            <Text style={styles.colKm}>
              {item.distance_km !== null ? item.distance_km.toFixed(1) : '—'}
            </Text>
            <Text style={styles.colMwst}>{formatTaxRate(item.tax_rate)}</Text>
            <Text style={styles.colTotal}>{eur(item.total_price)}</Text>
          </View>
        ))}

        {renderFooter()}
      </Page>
    </Document>
  );
}
