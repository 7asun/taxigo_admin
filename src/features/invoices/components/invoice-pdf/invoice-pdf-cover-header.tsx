/**
 * PDF page 1 — top block: branding + sender line + window address (left),
 * Rechnungsdaten meta grid (right). Uses flex layout from pdf-styles.
 *
 * Window addressee is composed in InvoicePdfDocument from frozen snapshots (§14 UStG).
 */

import { View, Text, Image } from '@react-pdf/renderer';

import type { InvoiceDetail } from '../../types/invoice.types';

import { formatInvoicePdfDate } from './lib/invoice-pdf-format';
import { styles } from './pdf-styles';

/**
 * Optional metaConfig prop — all fields default to invoice label values.
 * When not passed (all existing invoice callers), output is identical to before.
 * Used by AngebotPdfDocument to relabel the meta grid without duplicating
 * this component.
 *
 * IMPORTANT: Do not add offer-specific logic to this file. Pass data via
 * metaConfig only. This component belongs to the invoices module —
 * Angebote is a consumer, not an owner.
 */
export interface PdfCoverHeaderMetaConfig {
  /** Section heading in the right meta grid. Default: 'Rechnungsdaten' */
  heading?: string;
  /** Label for the document number row. Default: 'Rechnungsnr.' */
  numberLabel?: string;
  /** Label for the document date row. Default: 'Rechnungsdatum' */
  dateLabel?: string;
  /** When false, hides the St.-Nr. and USt-IdNr. rows. Default: true */
  showTaxIds?: boolean;
  /** Label for the period/validity row. Default: 'Leistungszeitraum' */
  periodLabel?: string;
  /**
   * When set, renders as a single-line period value instead of a from–to range.
   * When omitted, falls back to rendering periodFromIso – periodToIso.
   */
  periodValue?: string;
  /**
   * Optional extra label/value rows below the period row (e.g. recipient E-Mail / Telefon
   * on offer PDFs). Backward-compatible: omit for standard invoice output.
   */
  extraRows?: { label: string; value: string }[];
}

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
    addressLine2?: string | null;
  };
  /** Nur bei `per_client`: zweiter Block unter dem Fahrgast (Snapshot). */
  secondaryLegalRecipient?: {
    label: string;
    displayName: string;
    lines: string[];
  } | null;
  invoiceNumber: string;
  invoiceCreatedAtIso: string;
  periodFromIso: string;
  periodToIso: string;
  customerNumber: string | number;
  /** Optional label overrides for the right meta grid. Omit for standard invoice output. */
  metaConfig?: PdfCoverHeaderMetaConfig;
}

export function InvoicePdfCoverHeader({
  companyProfile: cp,
  senderFit,
  recipient,
  invoiceNumber,
  invoiceCreatedAtIso,
  periodFromIso,
  periodToIso,
  customerNumber,
  secondaryLegalRecipient = null,
  metaConfig
}: InvoicePdfCoverHeaderProps) {
  const {
    companyName: recipientCompanyName,
    personName: recipientPersonName,
    displayName: recipientName,
    street: recipientStreet,
    streetNumber: recipientStreetNumber,
    zipCode: recipientZipCode,
    city: recipientCity,
    phone: recipientPhone,
    addressLine2: recipientAddressLine2
  } = recipient;

  // Resolve meta labels — all default to the standard invoice values
  const metaHeading = metaConfig?.heading ?? 'Rechnungsdaten';
  const numberLabel = metaConfig?.numberLabel ?? 'Rechnungsnr.';
  const dateLabel = metaConfig?.dateLabel ?? 'Rechnungsdatum';
  const showTaxIds = metaConfig?.showTaxIds ?? true;
  const periodLabel = metaConfig?.periodLabel ?? 'Leistungszeitraum';
  const extraRows = (metaConfig?.extraRows ?? []).filter(
    (r) => r.value?.trim().length > 0
  );
  const periodIsLastMetaRow = extraRows.length === 0;

  return (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        {/* TOP: brand identity */}
        <View style={styles.brandStack}>
          {cp?.logo_url ? (
            <>
              {/* Logo: see logoLeft style comment in pdf-styles.ts for sizing rules.
                  Do NOT add height directly here — use maxHeight in the style definition. */}
              <Image src={cp.logo_url} style={styles.logoLeft} />
            </>
          ) : null}
          {cp?.slogan?.trim() ? (
            <Text style={styles.sloganBelowLogo}>{cp.slogan.trim()}</Text>
          ) : null}
        </View>

        {/* BOTTOM: DIN Briefkopf — anchored via space-between */}
        <View>
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
            {recipientAddressLine2 ? (
              <Text style={styles.addressLine}>{recipientAddressLine2}</Text>
            ) : null}
            <Text style={styles.addressLine}>
              {recipientZipCode} {recipientCity}
            </Text>
          </View>

          {secondaryLegalRecipient ? (
            <View style={styles.secondaryLegalBlock}>
              <Text style={styles.secondaryLegalLabel}>
                {secondaryLegalRecipient.label}
              </Text>
              <Text style={styles.secondaryLegalName}>
                {secondaryLegalRecipient.displayName}
              </Text>
              {secondaryLegalRecipient.lines.map((ln, i) => (
                <Text key={`${i}-${ln}`} style={styles.addressLine}>
                  {ln}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.headerRight}>
        <View style={styles.metaContainer}>
          <Text style={styles.metaHeading}>{metaHeading}</Text>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel} wrap={false}>
              {numberLabel}
            </Text>
            <Text style={styles.metaValue}>{invoiceNumber}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel} wrap={false}>
              {dateLabel}
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
          {showTaxIds ? (
            <>
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
            </>
          ) : null}
          <View
            style={[
              styles.metaItem,
              periodIsLastMetaRow ? styles.metaItemLast : {}
            ]}
          >
            <Text style={styles.metaLabel} wrap={false}>
              {periodLabel}
            </Text>
            <Text style={styles.metaValue}>
              {metaConfig?.periodValue !== undefined
                ? metaConfig.periodValue
                : `${formatInvoicePdfDate(periodFromIso)} –\n${formatInvoicePdfDate(periodToIso)}`}
            </Text>
          </View>
          {extraRows.map((row, i) => (
            <View
              key={`${row.label}-${i}`}
              style={[
                styles.metaItem,
                i === extraRows.length - 1 ? styles.metaItemLast : {}
              ]}
            >
              <Text style={styles.metaLabel} wrap={false}>
                {row.label}
              </Text>
              <Text style={styles.metaValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
