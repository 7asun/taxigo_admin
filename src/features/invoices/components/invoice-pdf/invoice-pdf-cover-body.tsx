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
 * - **`single_row`** — one aggregated `InvoicePdfSummaryRow` from `buildInvoicePdfSingleRow` (same columns as grouped).
 * - **`flat`** — one row per `invoice.line_items` (`InvoiceLineItemRow`), with JSONB coercion per row.
 *
 * **`mainTableKeys`** — render-time filter: drops `flatOnly` columns in grouped mode and `groupedOnly`
 * in flat mode so legacy Vorlagen (saved before catalog flags) do not produce empty cells. The
 * resolver does not strip these keys; it preserves stored `main_columns` for settings UX and audit.
 *
 * **Rich-text intro/outro (future):** Intro/outro are still plain strings in `<Text>`. If HTML is
 * stored later (e.g. Tiptap), mirror `AngebotPdfCoverBody` using `react-pdf-html` `<Html>` with a
 * stylesheet aligned to `styles.bodyText` (fontSize, lineHeight, color). The npm scope
 * `@react-pdf/html` does not exist; the supported package is `react-pdf-html`.
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
import { PDF_ZONES } from '../../lib/pdf-layout-constants';

export interface InvoicePdfCoverBodyProps {
  invoiceNumber: string;
  salutation: string;
  paymentDueDays: number;
  dueDateFormatted: string;
  companyProfile: InvoiceDetail['company_profile'];
  paymentQrDataUrl: string | null;
  renderMode?: import('@/features/invoices/lib/pdf-layout-constants').PdfRenderMode;
  /** Full invoice — required for flat main_layout (line_items). */
  invoice: InvoiceDetail;
  columnProfile: PdfColumnProfile;
  summaryItems: InvoicePdfSummaryRow[];
  subtotal: number;
  total: number;
  breakdown: { rate: number; tax: number }[];
  introText?: string | null;
  outroText?: string | null;
  /** True when `invoice.cancels_invoice_id` is set (Stornorechnung row). */
  isStorno: boolean;
  /**
   * Margin above the subject block (“Rechnung Nr. …”). Slightly larger when no reference bar
   * keeps no-bar invoices from sitting too tight under the header if `headerRow.marginBottom` is tuned.
   */
  subjectSectionMarginTop?: number;
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
  renderMode: _renderMode,
  invoice,
  columnProfile,
  summaryItems,
  subtotal,
  total,
  breakdown,
  introText,
  outroText,
  isStorno,
  subjectSectionMarginTop = PDF_ZONES.subjectMarginTopDefault // cover body internal fallback — overridden by InvoicePdfDocument conditional
}: InvoicePdfCoverBodyProps) {
  // isStorno is invoice.cancels_invoice_id != null (Storno document); only then use §14 Abs. 9 intro.
  const defaultIntroText = isStorno
    ? 'hiermit stornieren wir die o.g. Rechnung gemäß §14 Abs. 9 UStG. Bitte heben Sie sowohl diese Stornorechnung als auch die ursprüngliche Rechnung zu Ihren Unterlagen auf.'
    : 'vielen Dank für Ihr Vertrauen. Nachfolgend berechnen wir Ihnen die erbrachten Personenbeförderungsleistungen gemäß den vereinbarten Konditionen.';

  const isGroupedMode = columnProfile.main_layout !== 'flat';
  // Render-time safety filter: drop columns that are incompatible with the current
  // layout. This handles Vorlagen saved before flatOnly/groupedOnly flags existed.
  // The resolver intentionally does NOT filter — it preserves saved user data.
  // This filter is the only place layout compatibility is enforced for PDF output.
  const mainTableKeys: PdfColumnKey[] = columnProfile.main_columns.filter(
    (key): key is PdfColumnKey => {
      const col = PDF_COLUMN_MAP[key];
      if (!col) return false;
      if (isGroupedMode && col.flatOnly) return false;
      if (!isGroupedMode && col.groupedOnly) return false;
      return true;
    }
  );
  const colWidths = calcColumnWidths(mainTableKeys, false);
  const coercedFlatLineItems = invoice.line_items.map(
    coerceLineItemJsonbSnapshots
  );

  return (
    <>
      <View style={{ marginTop: subjectSectionMarginTop }}>
        <Text style={styles.subject}>
          {/* §14 UStG: Stornorechnung must be clearly labeled as such */}
          {isStorno ? 'Stornorechnung Nr.' : 'Rechnung Nr.'} {invoiceNumber}
        </Text>
        <Text style={styles.salutation}>{salutation}</Text>
        <Text style={styles.bodyText}>{introText ?? defaultIntroText}</Text>
      </View>

      <View style={styles.tableHeader}>
        {mainTableKeys.map((key, idx) => {
          const col = PDF_COLUMN_MAP[key];
          if (!col) return null;
          const w = colWidths[key] ?? col.minWidthPt;
          return (
            <View
              key={`${key}-${idx}`}
              style={{
                width: w,
                minWidth: 0,
                overflow: 'hidden',
                flexWrap: 'nowrap',
                paddingRight: PDF_ZONES.tableCellPaddingRight, // consistent column breathing room across invoice tables
                justifyContent: 'center'
              }}
            >
              <Text
                // @ts-expect-error @react-pdf Text supports line cap; package types omit numberOfLines
                numberOfLines={1}
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

      {isGroupedMode
        ? summaryItems.map((item, idx) => (
            <View
              key={item.id}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {mainTableKeys.map((key, colIdx) => {
                const col = PDF_COLUMN_MAP[key];
                if (!col) return null;
                const w = colWidths[key] ?? col.minWidthPt;
                if (isGroupedRouteLeistungColumn(col)) {
                  const { primary, secondary } = getGroupedRouteLines(item);
                  return (
                    <View
                      key={`${key}-${colIdx}`}
                      style={{
                        width: w,
                        minWidth: 0,
                        overflow: 'hidden',
                        flexWrap: 'nowrap',
                        paddingRight: PDF_ZONES.tableCellPaddingRight // consistent column breathing room across invoice tables
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
                    key={`${key}-${colIdx}`}
                    style={{
                      width: w,
                      minWidth: 0,
                      overflow: 'hidden',
                      flexWrap: 'nowrap',
                      paddingRight: PDF_ZONES.tableCellPaddingRight, // consistent column breathing room across invoice tables
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
              {mainTableKeys.map((key, colIdx) => {
                const col = PDF_COLUMN_MAP[key];
                if (!col) return null;
                const w = colWidths[key] ?? col.minWidthPt;
                const raw = renderCellValue(lineItem, col);
                const hasNl = raw.includes('\n');
                return (
                  <View
                    key={`${key}-${colIdx}`}
                    style={{
                      width: w,
                      minWidth: 0,
                      overflow: 'hidden',
                      flexWrap: 'nowrap',
                      paddingRight: PDF_ZONES.tableCellPaddingRight, // consistent column breathing room across invoice tables
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

      <View
        style={[
          styles.totalsSection,
          { marginTop: PDF_ZONES.totalsSectionMarginTop } // margin above totals block
        ]}
        wrap={false}
      >
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
        <Text
          style={[
            styles.normalText,
            {
              marginBottom: PDF_ZONES.paymentParaMarginBottom, // payment paragraph bottom spacing
              marginTop: PDF_ZONES.paymentParaMarginTop // payment paragraph top spacing
            }
          ]}
        >
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
            <View
              style={[
                styles.paymentDetailRow,
                { marginTop: PDF_ZONES.paymentFirstRowMarginTop } // first payment detail row override
              ]}
            >
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

      <View style={styles.bodyOutroSection} wrap={false}>
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
