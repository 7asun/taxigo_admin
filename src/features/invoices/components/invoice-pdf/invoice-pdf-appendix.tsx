/**
 * invoice-pdf-appendix.tsx
 *
 * **Anhang: Fahrtendetails** — always a **flat** table over `invoice.line_items`, independent of
 * `columnProfile.main_layout` (grouped vs flat applies only to the cover page).
 *
 * Columns come from `columnProfile.appendix_columns` + `PDF_COLUMN_MAP`. **`appendix_is_landscape`**
 * is pre-computed in {@link resolvePdfColumnProfile} when `appendix_columns.length > 7`
 * (`APPENDIX_LANDSCAPE_THRESHOLD`). The parent **`InvoicePdfDocument`** sets the second `Page`’s
 * `size` to **`A4_LANDSCAPE`** (`{ width: 841.89, height: 595.28 }` pt) when that flag is true.
 *
 * **`coerceLineItemJsonbSnapshots`** runs once per row before `renderCellValue` (JSONB-as-string).
 */

import { View, Text } from '@react-pdf/renderer';

import type { InvoiceDetail } from '../../types/invoice.types';
import type { PdfColumnProfile } from '../../types/pdf-vorlage.types';
import { PDF_COLUMN_MAP } from '../../lib/pdf-column-catalog';
import {
  calcColumnWidths,
  coerceLineItemJsonbSnapshots,
  renderCellValue
} from './pdf-column-layout';
import { styles, PDF_FONT_SIZES, PDF_COLORS } from './pdf-styles';
export interface InvoicePdfAppendixProps {
  invoiceNumber: string;
  invoiceCreatedAtIso: string;
  lineItems: InvoiceDetail['line_items'];
  columnProfile: PdfColumnProfile;
  /** Backward compat; grouped rendering is handled at Page level in InvoicePdfDocument. */
  mainLayout?: string;
  /** When set, shown in fixed header: "Anhang: Fahrtendetails — {groupLabel}" */
  groupLabel?: string;
}

const A4_LANDSCAPE = { width: 841.89, height: 595.28 } as const;

export function InvoicePdfAppendix({
  invoiceNumber,
  invoiceCreatedAtIso,
  lineItems,
  columnProfile,
  mainLayout,
  groupLabel
}: InvoicePdfAppendixProps) {
  void mainLayout;
  // Drives calcColumnWidths only. Page dimensions live on InvoicePdfDocument (A4 vs A4_LANDSCAPE).
  // appendix_is_landscape is set by resolvePdfColumnProfile when appendix column count > 7.
  const landscape = columnProfile.appendix_is_landscape;
  const colWidths = calcColumnWidths(columnProfile.appendix_columns, landscape);
  const coercedLineItems = lineItems.map(coerceLineItemJsonbSnapshots);

  function renderTableHeader() {
    return (
      <View style={styles.tableHeader}>
        {columnProfile.appendix_columns.map((key) => {
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
                  {
                    textAlign: col.align,
                    fontSize: PDF_FONT_SIZES.xs
                  }
                ]}
              >
                {col.label}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  function renderLineItemRow(
    item: (typeof coercedLineItems)[number],
    idx: number
  ) {
    const kts = item.kts_override === true;

    return (
      <View
        key={item.id}
        style={[{ width: '100%' }, idx % 2 === 1 ? styles.tableRowAlt : {}]}
        wrap={false}
      >
        <View style={styles.tableRow}>
          {columnProfile.appendix_columns.map((key) => {
            const col = PDF_COLUMN_MAP[key];
            if (!col) return null;
            const w = colWidths[key] ?? col.minWidthPt;
            const raw = renderCellValue(item, col, {
              fallbackDateIso: invoiceCreatedAtIso
            });
            const isMoney = col.format === 'currency';
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
                  <View style={{ minWidth: 0, width: '100%' }}>
                    {raw.split('\n').map((line, li) => (
                      <Text
                        key={li}
                        style={{
                          fontSize: PDF_FONT_SIZES.xs,
                          textAlign: col.align,
                          color: li === 0 ? undefined : PDF_COLORS.muted,
                          ...(isMoney && kts ? styles.appendixMoneyMuted : {})
                        }}
                      >
                        {line}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text
                    style={[
                      {
                        fontSize: PDF_FONT_SIZES.xs,
                        textAlign: col.align
                      },
                      isMoney && kts ? styles.appendixMoneyMuted : {}
                    ]}
                  >
                    {raw}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
        {kts ? (
          <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
            <Text style={styles.appendixKtsNote}>Abgerechnet über KTS</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <>
      <View style={styles.appendixHeaderFixed} fixed>
        <Text style={styles.invoiceTitle}>
          {groupLabel
            ? `Anhang: Fahrtendetails — ${groupLabel}`
            : 'Anhang: Fahrtendetails'}
        </Text>
        <Text style={styles.notesLabel}>Zu Rechnung {invoiceNumber}</Text>

        {renderTableHeader()}
      </View>

      {coercedLineItems.map((item, idx) => renderLineItemRow(item, idx))}
    </>
  );
}

export { A4_LANDSCAPE };
