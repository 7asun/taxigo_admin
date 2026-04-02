/**
 * PDF page 1 — top block: branding + sender line + window address (left),
 * Rechnungsdaten meta grid (right). Uses flex layout from pdf-styles.
 */

import { View, Text, Image } from '@react-pdf/renderer';

import type { InvoiceDetail } from '../../types/invoice.types';

import { formatInvoicePdfDate } from './lib/invoice-pdf-format';
import { styles } from './pdf-styles';

export interface InvoicePdfCoverHeaderProps {
  companyProfile: InvoiceDetail['company_profile'];
  /** From fitSenderLine — empty line means omit the sender row */
  senderFit: { line: string; fontSize: number };
  recipient: {
    companyName: string;
    personName: string;
    displayName: string;
    street: string;
    streetNumber: string;
    zipCode: string;
    city: string;
    phone: string | null;
  };
  invoiceNumber: string;
  invoiceCreatedAtIso: string;
  periodFromIso: string;
  periodToIso: string;
  customerNumber: string | number;
}

export function InvoicePdfCoverHeader({
  companyProfile: cp,
  senderFit,
  recipient,
  invoiceNumber,
  invoiceCreatedAtIso,
  periodFromIso,
  periodToIso,
  customerNumber
}: InvoicePdfCoverHeaderProps) {
  const {
    companyName: recipientCompanyName,
    personName: recipientPersonName,
    displayName: recipientName,
    street: recipientStreet,
    streetNumber: recipientStreetNumber,
    zipCode: recipientZipCode,
    city: recipientCity,
    phone: recipientPhone
  } = recipient;

  return (
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
          {recipientCompanyName && recipientPersonName ? (
            <Text style={styles.addressCompanyName}>
              {recipientCompanyName}
            </Text>
          ) : null}
          <Text
            style={
              recipientCompanyName && recipientPersonName
                ? styles.addressPersonName
                : styles.addressCompanyName
            }
          >
            {recipientName}
          </Text>
          <Text style={styles.addressLine}>
            {recipientStreet} {recipientStreetNumber}
          </Text>
          <Text style={styles.addressLine}>
            {recipientZipCode} {recipientCity}
          </Text>
        </View>
      </View>

      <View style={styles.headerRight}>
        <View style={styles.metaContainer}>
          <Text style={styles.metaHeading}>Rechnungsdaten</Text>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel} wrap={false}>
              Rechnungsnr.
            </Text>
            <Text style={styles.metaValue}>{invoiceNumber}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel} wrap={false}>
              Rechnungsdatum
            </Text>
            <Text style={styles.metaValue}>
              {formatInvoicePdfDate(invoiceCreatedAtIso)}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel} wrap={false}>
              Kundennummer
            </Text>
            <Text style={styles.metaValue}>{customerNumber || '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel} wrap={false}>
              St.-Nr.
            </Text>
            <Text style={styles.metaValue}>{cp?.tax_id ?? '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel} wrap={false}>
              USt-IdNr.
            </Text>
            <Text style={styles.metaValue}>{cp?.vat_id ?? '—'}</Text>
          </View>
          <View style={[styles.metaItem, styles.metaItemLast]}>
            <Text style={styles.metaLabel} wrap={false}>
              Leistungszeitraum
            </Text>
            <Text style={styles.metaValue}>
              {formatInvoicePdfDate(periodFromIso)} –{'\n'}
              {formatInvoicePdfDate(periodToIso)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
