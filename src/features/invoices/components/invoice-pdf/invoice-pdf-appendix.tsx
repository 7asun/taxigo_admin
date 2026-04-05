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
          <Text style={[styles.appendixColKts, styles.tableHeaderText]}>
            KTS
          </Text>
          <Text style={[styles.appendixColDriver, styles.tableHeaderText]}>
            Fahrer
          </Text>
          <Text style={[styles.appendixColDir, styles.tableHeaderText]}>
            H/R
          </Text>
        </View>
      </View>
      <View style={styles.appendixContentSpacer} />

      {lineItems.map((item, idx) => {
        const tripMeta = parseTripMetaSnapshot(
          item.trip_meta_snapshot as Record<string, unknown> | null | undefined
        );
        const net = lineNetEurForPdfLineItem(item);
        const gross = lineGrossEurForPdfLineItem(item);
        const kts = item.kts_override === true;
        const moneyExtras = kts ? [styles.appendixMoneyMuted] : [];
        const von = truncateInvoicePdfText(item.pickup_address, 35);
        const nach = truncateInvoicePdfText(item.dropoff_address, 35);
        const kmLabel =
          item.distance_km != null && !Number.isNaN(item.distance_km)
            ? `${item.distance_km} km`
            : '';
        const dirLabel = tripMetaDirectionPdfLabel(tripMeta);
        const driverLabel = tripMeta?.driver_name?.trim() ?? '';

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
              <Text style={styles.appendixColAddr}>{von || '—'}</Text>
              <Text style={styles.appendixColAddr}>{nach || '—'}</Text>
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
              <Text style={styles.appendixColKts}>{kts ? '✓' : ''}</Text>
              <Text style={styles.appendixColDriver}>{driverLabel}</Text>
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
