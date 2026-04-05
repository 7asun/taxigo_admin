/**
 * invoice-pdf-cover-body.tsx
 *
 * Main invoice page **body** (below the DIN header): subject, intro, **dynamic line-items table**,
 * totals, payment block, outro. Letter block, totals logic, and payment QR/IBAN layout are
 * independent of PDF column profiles — change the table only when adjusting Phase 6e columns.
 *
 * **Main table modes**
 * - **`grouped`** — rows from `buildInvoicePdfSummary` (`InvoicePdfSummaryRow`); Route/Leistung is
 *   two lines when `valueSource === grouped_route_leistung`.
 * - **`flat`** — one row per `invoice.line_items` (`InvoiceLineItemRow`), with JSONB coercion per row.
 *
 * **`mainTableKeys`** — render-time filter: drops `flatOnly` columns in grouped mode and `groupedOnly`
 * in flat mode so legacy Vorlagen (saved before catalog flags) do not produce empty cells. The
 * resolver does not strip these keys; it preserves stored `main_columns` for settings UX and audit.
 */

import { View, Text, Image } from '@react-pdf/renderer';

import type { InvoiceDetail } from '../../types/invoice.types';
import type { PdfColumnProfile } from '../../types/pdf-vorlage.types';
import {
  PDF_COLUMN_MAP,
  type PdfColumnKey
} from '../../lib/pdf-column-catalog';
import type { InvoicePdfSummaryRow } from './lib/build-invoice-pdf-summary';
import {
  calcColumnWidths,
  coerceLineItemJsonbSnapshots,
  getGroupedRouteLines,
  isGroupedRouteLeistungColumn,
  renderCellValue,
  renderGroupedCellValue
} from './pdf-column-layout';
import {
  formatInvoicePdfEur,
  formatInvoicePdfIbanDisplay
} from './lib/invoice-pdf-format';
import { PDF_COLORS, PDF_FONT_SIZES, styles } from './pdf-styles';
import { formatTaxRate } from '../../lib/tax-calculator';

export interface InvoicePdfCoverBodyProps {
  invoiceNumber: string;
  salutation: string;
  paymentDueDays: number;
  dueDateFormatted: string;
  companyProfile: InvoiceDetail['company_profile'];
  paymentQrDataUrl: string | null;
  /** Full invoice — required for flat main_layout (line_items). */
  invoice: InvoiceDetail;
  columnProfile: PdfColumnProfile;
  summaryItems: InvoicePdfSummaryRow[];
  subtotal: number;
  total: number;
  breakdown: { rate: number; tax: number }[];
  introText?: string | null;
  outroText?: string | null;
}

function MultilineCellText({
  value,
  fontSize,
  textAlign
}: {
  value: string;
  fontSize: number;
  textAlign: 'left' | 'right' | 'center';
}) {
  const parts = value.split('\n');
  return (
    <View>
      {parts.map((line, i) => (
        <Text
          key={i}
          style={{
            fontSize,
            textAlign,
            color: i === 0 ? undefined : PDF_COLORS.muted
          }}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

export function InvoicePdfCoverBody({
  invoiceNumber,
  salutation,
  paymentDueDays,
  dueDateFormatted,
  companyProfile: cp,
  paymentQrDataUrl,
  invoice,
  columnProfile,
  summaryItems,
  subtotal,
  total,
  breakdown,
  introText,
  outroText
}: InvoicePdfCoverBodyProps) {
  const isGrouped = columnProfile.main_layout === 'grouped';
  // Render-time safety filter: drop columns that are incompatible with the current
  // layout. This handles Vorlagen saved before flatOnly/groupedOnly flags existed.
  // The resolver intentionally does NOT filter — it preserves saved user data.
  // This filter is the only place layout compatibility is enforced for PDF output.
  const mainTableKeys: PdfColumnKey[] = columnProfile.main_columns.filter(
    (key): key is PdfColumnKey => {
      const col = PDF_COLUMN_MAP[key];
      if (!col) return false;
      if (isGrouped && col.flatOnly) return false;
      if (!isGrouped && col.groupedOnly) return false;
      return true;
    }
  );
  const colWidths = calcColumnWidths(mainTableKeys, false);
  const coercedFlatLineItems = invoice.line_items.map(
    coerceLineItemJsonbSnapshots
  );

  return (
    <>
      <View style={{ marginTop: 8 }}>
        <Text style={styles.subject}>Rechnung Nr. {invoiceNumber}</Text>
        <Text style={styles.salutation}>{salutation}</Text>
        <Text style={styles.bodyText}>
          {introText ??
            'vielen Dank für Ihr Vertrauen. Nachfolgend berechnen wir Ihnen die erbrachten Personenbeförderungsleistungen gemäß den vereinbarten Konditionen.'}
        </Text>
      </View>

      <View style={styles.tableHeader}>
        {mainTableKeys.map((key) => {
          const col = PDF_COLUMN_MAP[key];
          if (!col) return null;
          const w = colWidths[key] ?? col.minWidthPt;
          return (
            <View
              key={key}
              style={{
                width: w,
                minWidth: 0,
                overflow: 'hidden',
                flexWrap: 'nowrap',
                paddingRight: 4,
                justifyContent: 'center'
              }}
            >
              <Text
                style={[
                  styles.tableHeaderText,
                  { textAlign: col.align, fontSize: PDF_FONT_SIZES.xs }
                ]}
              >
                {col.label}
              </Text>
            </View>
          );
        })}
      </View>

      {isGrouped
        ? summaryItems.map((item, idx) => (
            <View
              key={item.id}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {mainTableKeys.map((key) => {
                const col = PDF_COLUMN_MAP[key];
                if (!col) return null;
                const w = colWidths[key] ?? col.minWidthPt;
                if (isGroupedRouteLeistungColumn(col)) {
                  const { primary, secondary } = getGroupedRouteLines(item);
                  return (
                    <View
                      key={key}
                      style={{
                        width: w,
                        minWidth: 0,
                        overflow: 'hidden',
                        flexWrap: 'nowrap',
                        paddingRight: 4
                      }}
                    >
                      <Text style={styles.routePrimary}>{primary}</Text>
                      {secondary ? (
                        <Text style={styles.routeSecondary}>{secondary}</Text>
                      ) : null}
                    </View>
                  );
                }
                const cell = renderGroupedCellValue(item, col);
                return (
                  <View
                    key={key}
                    style={{
                      width: w,
                      minWidth: 0,
                      overflow: 'hidden',
                      flexWrap: 'nowrap',
                      paddingRight: 4,
                      justifyContent: 'center'
                    }}
                  >
                    <Text
                      style={{
                        fontSize: PDF_FONT_SIZES.sm,
                        textAlign: col.align
                      }}
                    >
                      {cell}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))
        : coercedFlatLineItems.map((lineItem, idx) => (
            <View
              key={lineItem.id}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {mainTableKeys.map((key) => {
                const col = PDF_COLUMN_MAP[key];
                if (!col) return null;
                const w = colWidths[key] ?? col.minWidthPt;
                const raw = renderCellValue(lineItem, col);
                const hasNl = raw.includes('\n');
                return (
                  <View
                    key={key}
                    style={{
                      width: w,
                      minWidth: 0,
                      overflow: 'hidden',
                      flexWrap: 'nowrap',
                      paddingRight: 4,
                      justifyContent: 'center'
                    }}
                  >
                    {hasNl ? (
                      <MultilineCellText
                        value={raw}
                        fontSize={PDF_FONT_SIZES.sm}
                        textAlign={col.align}
                      />
                    ) : (
                      <Text
                        style={{
                          fontSize: PDF_FONT_SIZES.sm,
                          textAlign: col.align
                        }}
                      >
                        {raw}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}

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
          {outroText ??
            'Wir bedanken uns herzlich für Ihr Vertrauen in unsere Dienstleistungen und stehen Ihnen bei Fragen oder Anliegen gerne zur Verfügung.'}
          {cp?.phone && (
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>
              {' '}
              Bitte kontaktieren Sie uns gerne hierzu unter {cp.phone.trim()}.
            </Text>
          )}
        </Text>
        <Text style={styles.bodyClosing}>Mit freundlichen Grüßen,</Text>
      </View>
    </>
  );
}
