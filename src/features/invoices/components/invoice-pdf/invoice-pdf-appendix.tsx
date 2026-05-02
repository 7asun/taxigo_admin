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

import type {
  InvoiceDetail,
  CancelledTripRow
} from '../../types/invoice.types';
import type { PdfColumnProfile } from '../../types/pdf-vorlage.types';
import { PDF_COLUMN_MAP } from '../../lib/pdf-column-catalog';
import {
  calcColumnWidths,
  coerceLineItemJsonbSnapshots,
  renderCellValue
} from './pdf-column-layout';
import { formatInvoicePdfDate } from '@/features/invoices/components/invoice-pdf/lib/invoice-pdf-format';
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
  /** Display-only canceled trips; empty on billed appendix pages — see InvoicePdfDocument. */
  cancelledTrips?: CancelledTripRow[];
}

const A4_LANDSCAPE = { width: 841.89, height: 595.28 } as const;

const CANCELLED_SECTION_HELPER =
  'Diese Fahrten wurden storniert und sind nicht im Rechnungsbetrag enthalten.';

export function InvoicePdfAppendix({
  invoiceNumber,
  invoiceCreatedAtIso,
  lineItems,
  columnProfile,
  mainLayout,
  groupLabel,
  cancelledTrips = []
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
        {columnProfile.appendix_columns.map((key, idx) => {
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
                paddingRight: 4,
                justifyContent: 'center'
              }}
            >
              <Text
                // @ts-expect-error @react-pdf Text supports line cap; package types omit numberOfLines
                numberOfLines={1}
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
          {columnProfile.appendix_columns.map((key, colIdx) => {
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
                key={`${key}-${colIdx}`}
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

  /** Flowing block only — not `fixed` (unlike billed header). Caller passes non-empty trips only where needed. */
  function renderCancelledSection() {
    if (cancelledTrips.length === 0) {
      return null;
    }

    const EM_DASH = '—';
    const CANCELLED_COLUMNS = [
      { key: 'datum', label: 'Datum', widthPt: 52 },
      { key: 'fahrgast', label: 'Fahrgast', widthPt: 100 },
      { key: 'von', label: 'Von', widthPt: 130 },
      { key: 'nach', label: 'Nach', widthPt: 130 },
      { key: 'stornierungsgrund', label: 'Stornierungsgrund', widthPt: null }
    ] as const;

    function cellValue(
      key: (typeof CANCELLED_COLUMNS)[number]['key'],
      row: CancelledTripRow
    ): string {
      switch (key) {
        case 'datum':
          return row.scheduled_at
            ? formatInvoicePdfDate(row.scheduled_at)
            : EM_DASH;
        case 'fahrgast': {
          const c = row.client;
          const name = c
            ? [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
            : '';
          return name || EM_DASH;
        }
        case 'von':
          return row.pickup_address?.trim() || EM_DASH;
        case 'nach':
          return row.dropoff_address?.trim() || EM_DASH;
        case 'stornierungsgrund':
          return row.canceled_reason_notes?.trim() || EM_DASH;
      }
    }

    const globalRowOffset = coercedLineItems.length;

    return (
      <View
        style={{ marginTop: coercedLineItems.length > 0 ? 14 : 0 }}
        wrap={false}
      >
        <Text
          style={{
            fontSize: PDF_FONT_SIZES.sm,
            color: PDF_COLORS.text,
            marginBottom: 8,
            lineHeight: 1.45
          }}
        >
          {CANCELLED_SECTION_HELPER}
        </Text>

        <View style={styles.tableHeader}>
          {CANCELLED_COLUMNS.map((colDef, idx) => (
            <View
              key={`cx-h-${colDef.key}-${idx}`}
              style={{
                width: colDef.widthPt ?? undefined,
                flexGrow: colDef.widthPt == null ? 1 : 0,
                minWidth: 0,
                overflow: 'hidden',
                flexWrap: 'nowrap',
                paddingRight: 4,
                justifyContent: 'center'
              }}
            >
              <Text
                // @ts-expect-error @react-pdf Text supports line cap; package types omit numberOfLines
                numberOfLines={1}
                style={[
                  styles.tableHeaderText,
                  {
                    textAlign: 'left',
                    fontSize: PDF_FONT_SIZES.xs
                  }
                ]}
              >
                {colDef.label}
              </Text>
            </View>
          ))}
        </View>

        {cancelledTrips.map((cxRow, idx) => {
          const zebraIdx = globalRowOffset + idx;
          return (
            <View
              key={`cx-${cxRow.id}`}
              style={[
                { width: '100%' },
                zebraIdx % 2 === 1 ? styles.tableRowAlt : {}
              ]}
              wrap={false}
            >
              <View style={styles.tableRow}>
                {CANCELLED_COLUMNS.map((colDef, colIdx) => {
                  const raw = cellValue(colDef.key, cxRow);
                  const hasNl = raw.includes('\n');
                  const isReasonCol = colDef.key === 'stornierungsgrund';
                  const reasonEmpty = isReasonCol && raw === EM_DASH;
                  const baseText = {
                    fontSize: PDF_FONT_SIZES.xs,
                    textAlign: 'left' as const,
                    color: PDF_COLORS.text,
                    ...(reasonEmpty ? styles.appendixMoneyMuted : {})
                  };

                  return (
                    <View
                      key={`cx-${cxRow.id}-${colDef.key}-${colIdx}`}
                      style={{
                        width: colDef.widthPt ?? undefined,
                        flexGrow: colDef.widthPt == null ? 1 : 0,
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
                            <Text key={li} style={baseText}>
                              {line}
                            </Text>
                          ))}
                        </View>
                      ) : (
                        <Text style={baseText}>{raw}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
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

        {coercedLineItems.length > 0 ? renderTableHeader() : null}
      </View>

      {coercedLineItems.map((item, idx) => renderLineItemRow(item, idx))}

      {/* Cancelled block: length-only here; document parent enforces show_cancelled_trips + passes [] on billed appendix pages. */}
      {renderCancelledSection()}
    </>
  );
}

export { A4_LANDSCAPE };
