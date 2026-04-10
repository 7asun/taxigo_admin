/**
 * PDF page 1 — top block: branding + sender line + window address (left),
 * Rechnungsdaten meta grid (right). Uses flex layout from pdf-styles.
 *
 * Window addressee is composed in InvoicePdfDocument from frozen snapshots (§14 UStG).
 */

import { View, Text, Image } from '@react-pdf/renderer';

import type { InvoiceDetail } from '../../types/invoice.types';

import { formatInvoicePdfDate } from './lib/invoice-pdf-format';
import {
  collapseWhitespaceForPdf,
  normalizeInvoiceRecipientPhone
} from './lib/rechnungsempfaenger-pdf';
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
    /** Structured fields for proper Briefkopf formatting */
    anrede?: string | null;
    abteilung?: string | null;
    firstName?: string | null;
    lastName?: string | null;
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
  /**
   * True when this document is a Stornorechnung (`invoices.cancels_invoice_id` set).
   * Passed from the parent; do not infer here.
   */
  isStorno?: boolean;
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
  isStorno = false,
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
    phone: rawPhone,
    addressLine2: recipientAddressLine2,
    abteilung: recipientAbteilung,
    firstName: recipientFirstName,
    lastName: recipientLastName,
    anrede: recipientAnrede
  } = recipient;

  const recipientPhone = normalizeInvoiceRecipientPhone(rawPhone);
  const zipCityLine = [recipientZipCode, recipientCity]
    .map((x) => collapseWhitespaceForPdf(x ?? ''))
    .filter((x) => x.length > 0)
    .join(' ');

  // Resolve meta labels — all default to the standard invoice values
  const metaHeading = metaConfig?.heading ?? 'Rechnungsdaten';
  // Storno rows reference the cancelled invoice via cancels_invoice_id (non-null) — label must say Stornorechnungsnr.
  const numberLabel =
    metaConfig?.numberLabel ??
    (isStorno ? 'Stornorechnungsnr.' : 'Rechnungsnr.');
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
            <View>
              <Text
                style={[styles.senderOneLine, { fontSize: senderFit.fontSize }]}
                wrap={false}
              >
                {senderFit.line}
              </Text>
              <View style={styles.senderOneLineRule} />
            </View>
          ) : null}

          <View style={styles.recipientBlock}>
            {/* Briefkopf: Firmenname → First + Lastname → Abteilung → Street → Zip + City → Phone */}

            {/* 1. Firmenname (if exists) */}
            {recipientCompanyName ? (
              <Text style={styles.addressCompanyName}>
                {recipientCompanyName}
              </Text>
            ) : null}

            {/* 2. Anrede + First + Lastname (if exists) */}
            {recipientAnrede || recipientFirstName || recipientLastName ? (
              <Text style={styles.addressPersonName}>
                {[recipientAnrede, recipientFirstName, recipientLastName]
                  .filter(Boolean)
                  .join(' ')}
              </Text>
            ) : recipientPersonName &&
              recipientPersonName !== recipientCompanyName ? (
              <Text style={styles.addressPersonName}>
                {recipientPersonName}
              </Text>
            ) : null}

            {/* 3. Abteilung (if exists) */}
            {recipientAbteilung ? (
              <Text style={styles.addressLine}>{recipientAbteilung}</Text>
            ) : null}

            {/* 4. Streetname + Streetnumber (only show if not already contained in zip/city line) */}
            {(() => {
              // Check if street already contains zip/city (malformed address_line1)
              const streetLower = recipientStreet.toLowerCase();
              const zipLower = recipientZipCode.toLowerCase();
              const cityLower = recipientCity.toLowerCase();
              const hasZipInStreet = zipLower && streetLower.includes(zipLower);
              const hasCityInStreet =
                cityLower && streetLower.includes(cityLower);

              if (hasZipInStreet || hasCityInStreet) {
                // Street already contains zip/city - show only the street part
                // Try to extract just the street part (before any comma or zip)
                let cleanStreet = recipientStreet;
                if (cleanStreet.includes(',')) {
                  cleanStreet = cleanStreet.split(',')[0].trim();
                }
                // Also try to remove zip code if it appears at the end
                if (
                  recipientZipCode &&
                  cleanStreet.includes(recipientZipCode)
                ) {
                  cleanStreet = cleanStreet
                    .replace(recipientZipCode, '')
                    .trim();
                }
                return (
                  <Text style={styles.addressLine}>
                    {cleanStreet}
                    {recipientStreetNumber ? ` ${recipientStreetNumber}` : ''}
                  </Text>
                );
              }

              // Normal case: street is just the street
              return (
                <Text style={styles.addressLine}>
                  {recipientStreet}
                  {recipientStreetNumber ? ` ${recipientStreetNumber}` : ''}
                </Text>
              );
            })()}

            {/* Address Line 2 (optional c/o, etc.) */}
            {recipientAddressLine2 ? (
              <Text style={styles.addressLine}>{recipientAddressLine2}</Text>
            ) : null}

            {/* 5. Zipcode + City (always show on separate line) */}
            {zipCityLine ? (
              <Text style={styles.addressLine} wrap={false}>
                {zipCityLine}
              </Text>
            ) : null}

            {/* 6. Phone number (if exists) */}
            {recipientPhone ? (
              <Text style={styles.addressPhoneLine} wrap={false}>
                {recipientPhone}
              </Text>
            ) : null}
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
