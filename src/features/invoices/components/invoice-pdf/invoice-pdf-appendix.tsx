/**
 * PDF page 2 — per line-item trip table. Fixed header repeats on overflow pages;
 * appendixContentSpacer clears space under the fixed header for first rows.
 */

import { View, Text } from '@react-pdf/renderer';

import { formatTaxRate } from '../../lib/tax-calculator';
import type { InvoiceDetail } from '../../types/invoice.types';

import {
  calculateInvoicePdfNetAmount,
  type InvoicePdfRouteDirectionLabel
} from './lib/build-invoice-pdf-summary';
import {
  formatInvoicePdfDate,
  formatInvoicePdfEur,
  formatInvoicePdfTime
} from './lib/invoice-pdf-format';
import {
  canonicalizeInvoicePdfPlace,
  type InvoicePdfPlaceHintMap
} from './lib/invoice-pdf-places';
import { styles } from './pdf-styles';

export interface InvoicePdfAppendixProps {
  invoiceNumber: string;
  invoiceCreatedAtIso: string;
  lineItems: InvoiceDetail['line_items'];
  placeHints: InvoicePdfPlaceHintMap;
  routeDirectionLabels: Record<string, InvoicePdfRouteDirectionLabel>;
}

export function InvoicePdfAppendix({
  invoiceNumber,
  invoiceCreatedAtIso,
  lineItems,
  placeHints,
  routeDirectionLabels
}: InvoicePdfAppendixProps) {
  return (
    <>
      <View style={styles.appendixHeaderFixed} fixed>
        <Text style={styles.invoiceTitle}>Anhang: Fahrtendetails</Text>
        <Text style={styles.notesLabel}>Zu Rechnung {invoiceNumber}</Text>

        <View style={[styles.tableHeader, { marginTop: 15 }]}>
          <Text style={[styles.colPos, styles.tableHeaderText]}>#</Text>
          <Text style={[styles.colDate, styles.tableHeaderText]}>Datum</Text>
          <Text style={[styles.colDesc, styles.tableHeaderText]}>
            Fahrtbeschreibung
          </Text>
          <Text style={[styles.colTime, styles.tableHeaderText]}>Uhrzeit</Text>
          <Text style={[styles.colMwst, styles.tableHeaderText]}>
            MwSt.{'\n'}Satz
          </Text>
          <Text style={[styles.colTotal, styles.tableHeaderText]}>
            Netto-{'\n'}betrag
          </Text>
          <Text style={[styles.colGross, styles.tableHeaderText]}>
            Brutto-{'\n'}betrag
          </Text>
        </View>
      </View>
      <View style={styles.appendixContentSpacer} />

      {lineItems.map((item, idx) => {
        const pickup = canonicalizeInvoicePdfPlace(
          item.pickup_address || item.description,
          placeHints
        );
        const dropoff = canonicalizeInvoicePdfPlace(
          item.dropoff_address || item.description,
          placeHints
        );
        const routeKey = `${pickup.key} -> ${dropoff.key} [${item.tax_rate}]`;
        const directionLabel = routeDirectionLabels[routeKey] ?? 'Fahrt';
        const dateLabel = item.line_date
          ? formatInvoicePdfDate(item.line_date)
          : formatInvoicePdfDate(invoiceCreatedAtIso);

        return (
          <View
            key={item.id}
            style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
            wrap={false}
          >
            <Text style={styles.colPos}>{item.position}</Text>
            <Text style={styles.colDate}>
              {item.line_date ? formatInvoicePdfDate(item.line_date) : '—'}
            </Text>
            <View style={styles.colDesc}>
              <Text style={styles.routePrimary}>
                {`Fahrt vom ${dateLabel} - ${directionLabel}`}
              </Text>
              <Text style={styles.routeSecondary}>
                {`${pickup.primary} -> ${dropoff.primary}`}
              </Text>
            </View>
            <Text style={styles.colTime}>
              {item.line_date ? formatInvoicePdfTime(item.line_date) : '—'}
            </Text>
            <Text style={styles.colMwst}>{formatTaxRate(item.tax_rate)}</Text>
            <Text style={styles.colTotal}>
              {formatInvoicePdfEur(
                calculateInvoicePdfNetAmount(item.unit_price, item.quantity)
              )}
            </Text>
            <Text style={styles.colGross}>
              {formatInvoicePdfEur(item.total_price)}
            </Text>
          </View>
        );
      })}
    </>
  );
}
