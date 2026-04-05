/**
 * PDF page 2 — per line-item trip table. Fixed header repeats on overflow pages;
 * appendixContentSpacer clears space under the fixed header for first rows.
 */

import { View, Text } from '@react-pdf/renderer';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

import { formatTaxRate } from '../../lib/tax-calculator';
import type { InvoiceDetail } from '../../types/invoice.types';

import {
  formatInvoicePdfEur,
  truncateInvoicePdfText
} from './lib/invoice-pdf-format';
import {
  lineGrossEurForPdfLineItem,
  lineNetEurForPdfLineItem
} from './lib/invoice-pdf-line-amounts';
import {
  parseTripMetaSnapshot,
  tripMetaDirectionPdfLabel
} from '@/features/invoices/lib/trip-meta-snapshot';
import { styles } from './pdf-styles';

export interface InvoicePdfAppendixProps {
  invoiceNumber: string;
  invoiceCreatedAtIso: string;
  lineItems: InvoiceDetail['line_items'];
}

function formatAppendixDate(
  iso: string | null | undefined,
  fallbackIso: string
): string {
  const raw = iso ?? fallbackIso;
  try {
    return format(
      parseISO(raw.includes('T') ? raw : `${raw}T12:00:00`),
      'dd.MM.yyyy',
      { locale: de }
    );
  } catch {
    return format(new Date(raw), 'dd.MM.yyyy', { locale: de });
  }
}

function robustAddressSplit(raw: string | null | undefined): {
  street: string;
  city: string | null;
} {
  if (!raw?.trim()) return { street: '—', city: null };
  const trimmed = raw.trim();

  // Find the first occurrence of a German zip code (5 digits) followed by a space
  const zipRegex = /\b\d{5}\s/;
  const match = trimmed.match(zipRegex);

  if (match && match.index !== undefined) {
    let street = trimmed.slice(0, match.index).trim();
    const cityLine = trimmed.slice(match.index).trim();

    // Clean up trailing comma from street if present
    if (street.endsWith(',')) {
      street = street.slice(0, -1).trim();
    }

    return { street: street || '—', city: cityLine };
  }

  return { street: trimmed, city: null };
}

export function InvoicePdfAppendix({
  invoiceNumber,
  invoiceCreatedAtIso,
  lineItems
}: InvoicePdfAppendixProps) {
  return (
    <>
      <View style={styles.appendixHeaderFixed} fixed>
        <Text style={styles.invoiceTitle}>Anhang: Fahrtendetails</Text>
        <Text style={styles.notesLabel}>Zu Rechnung {invoiceNumber}</Text>

        <View style={[styles.tableHeader, { marginTop: 15 }]}>
          <Text style={[styles.appendixColPos, styles.tableHeaderText]}>#</Text>
          <Text style={[styles.appendixColDate, styles.tableHeaderText]}>
            Datum
          </Text>
          <Text style={[styles.appendixColClient, styles.tableHeaderText]}>
            Fahrgast
          </Text>
          <Text style={[styles.appendixColAddr, styles.tableHeaderText]}>
            Von
          </Text>
          <Text style={[styles.appendixColAddr, styles.tableHeaderText]}>
            Nach
          </Text>
          <Text style={[styles.appendixColKm, styles.tableHeaderText]}>
            Strecke
          </Text>
          <Text style={[styles.appendixColNet, styles.tableHeaderText]}>
            Netto
          </Text>
          <Text style={[styles.appendixColTax, styles.tableHeaderText]}>
            MwSt.
          </Text>
          <Text style={[styles.appendixColGross, styles.tableHeaderText]}>
            Brutto
          </Text>
          <Text style={[styles.appendixColDir, styles.tableHeaderText]}>
            H/R
          </Text>
        </View>
      </View>

      {lineItems.map((item, idx) => {
        const tripMeta = parseTripMetaSnapshot(
          item.trip_meta_snapshot as Record<string, unknown> | null | undefined
        );
        const net = lineNetEurForPdfLineItem(item);
        const gross = lineGrossEurForPdfLineItem(item);
        const kts = item.kts_override === true;
        const moneyExtras = kts ? [styles.appendixMoneyMuted] : [];
        const von = robustAddressSplit(item.pickup_address);
        const nach = robustAddressSplit(item.dropoff_address);
        const roundedKm =
          item.distance_km != null
            ? Math.round(Number(item.distance_km) * 100) / 100
            : null;
        const kmLabel =
          roundedKm != null && !Number.isNaN(roundedKm)
            ? `${roundedKm.toString().replace('.', ',')} km`
            : '';
        const dirLabel = tripMetaDirectionPdfLabel(tripMeta);

        return (
          <View
            key={item.id}
            style={[idx % 2 === 1 ? styles.tableRowAlt : {}]}
            wrap={false}
          >
            <View style={styles.tableRow}>
              <Text style={styles.appendixColPos}>{item.position}</Text>
              <Text style={styles.appendixColDate}>
                {formatAppendixDate(item.line_date, invoiceCreatedAtIso)}
              </Text>
              <Text style={styles.appendixColClient}>
                {item.client_name?.trim() || '—'}
              </Text>
              <View style={styles.appendixColAddr}>
                <Text>{von.street}</Text>
                {von.city && (
                  <Text style={styles.appendixColAddrCity}>{von.city}</Text>
                )}
              </View>
              <View style={styles.appendixColAddr}>
                <Text>{nach.street}</Text>
                {nach.city && (
                  <Text style={styles.appendixColAddrCity}>{nach.city}</Text>
                )}
              </View>
              <Text style={styles.appendixColKm}>{kmLabel}</Text>
              <Text style={[styles.appendixColNet, ...moneyExtras]}>
                {formatInvoicePdfEur(net)}
              </Text>
              <Text style={styles.appendixColTax}>
                {formatTaxRate(item.tax_rate)}
              </Text>
              <Text style={[styles.appendixColGross, ...moneyExtras]}>
                {formatInvoicePdfEur(gross)}
              </Text>
              <Text style={styles.appendixColDir}>{dirLabel}</Text>
            </View>
            {kts ? (
              <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
                <Text style={styles.appendixKtsNote}>Abgerechnet über KTS</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </>
  );
}
