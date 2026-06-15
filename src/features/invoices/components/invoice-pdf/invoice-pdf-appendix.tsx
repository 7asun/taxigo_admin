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
  CancelledTripRow,
  ExcludedTripRow
} from '../../types/invoice.types';
import type { PdfColumnProfile } from '../../types/pdf-vorlage.types';
import {
  CANCELLED_APPENDIX_COLUMN_KEYS,
  CANCELLED_COLUMNS_CONFIG,
  PDF_COLUMN_MAP
} from '../../lib/pdf-column-catalog';
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
  /** Passive cancelled trips (opted-out, €0) — gated by show_cancelled_trips in parent. */
  cancelledTrips?: CancelledTripRow[];
  /** Opted-out normal trips with exclusion reasons — gated by show_excluded_trips in parent. */
  excludedTrips?: ExcludedTripRow[];
  /**
   * When true, Stornierte Fahrten column widths scale to landscape usable width (~754 pt).
   * Set by InvoicePdfDocument on the dedicated cancelled page (always landscape).
   */
  cancelledLandscape?: boolean;
}

const A4_LANDSCAPE = { width: 841.89, height: 595.28 } as const;

const CANCELLED_SECTION_HELPER =
  'Diese Fahrten wurden storniert und sind nicht im Rechnungsbetrag enthalten.';

/**
 * Ausgeschlossene Fahrten appendix columns — explicit default widths for proportional
 * scaling (same usable-width algorithm as calcColumnWidths / Stornierte Fahrten).
 */
const EXCLUDED_APPENDIX_COLUMNS = [
  { key: 'datum', label: 'Datum', defaultWidthPt: 52, minWidthPt: 40 },
  { key: 'fahrgast', label: 'Fahrgast', defaultWidthPt: 110, minWidthPt: 80 },
  { key: 'von', label: 'Von', defaultWidthPt: 110, minWidthPt: 80 },
  { key: 'nach', label: 'Nach', defaultWidthPt: 110, minWidthPt: 80 },
  {
    key: 'begruendung',
    label: 'Begründung',
    defaultWidthPt: 180,
    minWidthPt: 120
  }
] as const;

/** Portrait appendix row usable width — kept in sync with pdf-column-layout.ts. */
const EXCLUDED_TABLE_PORTRAIT_USABLE_PT = 499;
/** Landscape appendix row usable width — kept in sync with pdf-column-layout.ts. */
const EXCLUDED_TABLE_LANDSCAPE_USABLE_PT = 754;

type ExcludedAppendixColumnKey =
  (typeof EXCLUDED_APPENDIX_COLUMNS)[number]['key'];

/** Scales excluded column defaults to portrait/landscape usable width (mirrors calcColumnWidths). */
function calcExcludedColumnWidths(
  isLandscape: boolean
): Record<ExcludedAppendixColumnKey, number> {
  const usable = isLandscape
    ? EXCLUDED_TABLE_LANDSCAPE_USABLE_PT
    : EXCLUDED_TABLE_PORTRAIT_USABLE_PT;
  const totalDefault = EXCLUDED_APPENDIX_COLUMNS.reduce(
    (sum, col) => sum + col.defaultWidthPt,
    0
  );
  const scale = totalDefault > 0 ? usable / totalDefault : 1;
  const result = {} as Record<ExcludedAppendixColumnKey, number>;
  for (const col of EXCLUDED_APPENDIX_COLUMNS) {
    result[col.key] = Math.max(
      Math.round(col.defaultWidthPt * scale),
      col.minWidthPt
    );
  }
  return result;
}

export function InvoicePdfAppendix({
  invoiceNumber,
  invoiceCreatedAtIso,
  lineItems,
  columnProfile,
  mainLayout,
  groupLabel,
  cancelledTrips = [],
  excludedTrips = [],
  cancelledLandscape = false
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
    const hasBillingReason =
      item.is_cancelled_trip === true && !!item.cancelled_billing_reason;

    return (
      <View
        key={item.id}
        style={[{ width: '100%' }, idx % 2 === 1 ? styles.tableRowAlt : {}]}
        wrap={false}
      >
        <View
          style={[
            styles.tableRow,
            // why: suppress the row bottom border when a KTS note follows — the border
            // otherwise reads as a divider between the trip data and its own note.
            hasBillingReason || kts ? { borderBottomWidth: 0 } : {}
          ]}
        >
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
        {hasBillingReason ? (
          <View
            style={{ paddingHorizontal: 8, paddingTop: 0, paddingBottom: 4 }}
          >
            <Text
              style={{
                fontSize: PDF_FONT_SIZES.xs,
                color: PDF_COLORS.billingReason
              }}
            >
              <Text style={{ fontWeight: 'bold' }}>
                {'Abgerechnet trotz Stornierung: '}
              </Text>
              <Text>{item.cancelled_billing_reason}</Text>
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  /**
   * Excluded normal trips — gated by show_excluded_trips in parent.
   * Shows exclusion reason in amber; no amount column (these are €0 impact).
   */
  function renderExcludedSection() {
    if (excludedTrips.length === 0) return null;

    const EM_DASH = '—';
    // why: proportional widths + explicit Begründung minWidth — same defensive layout as
    // renderCancelledSection so long exclusion reasons wrap inside the cell, not the row.
    const excludedColWidths = calcExcludedColumnWidths(landscape);

    function excludedCellValue(
      key: ExcludedAppendixColumnKey,
      row: ExcludedTripRow
    ): string {
      switch (key) {
        case 'datum':
          return row.line_date ? formatInvoicePdfDate(row.line_date) : EM_DASH;
        case 'fahrgast':
          return row.client_name?.trim() || EM_DASH;
        case 'von':
          return row.pickup_address?.trim() || EM_DASH;
        case 'nach':
          return row.dropoff_address?.trim() || EM_DASH;
        case 'begruendung':
          return row.billing_exclusion_reason?.trim() || EM_DASH;
      }
    }

    return (
      <View style={{ marginTop: 14 }}>
        <Text
          style={{
            fontSize: PDF_FONT_SIZES.sm,
            fontWeight: 'bold',
            color: PDF_COLORS.text,
            marginBottom: 4
          }}
        >
          Ausgeschlossene Fahrten
        </Text>
        <Text
          style={{
            fontSize: PDF_FONT_SIZES.xs,
            color: PDF_COLORS.muted,
            marginBottom: 8
          }}
        >
          Diese Fahrten wurden manuell ausgeschlossen und sind nicht im
          Rechnungsbetrag enthalten.
        </Text>

        <View style={styles.tableHeader}>
          {EXCLUDED_APPENDIX_COLUMNS.map((col, idx) => {
            const w = excludedColWidths[col.key];
            const isReasonCol = col.key === 'begruendung';
            return (
              <View
                key={`ex-h-${col.key}-${idx}`}
                style={{
                  // why: Begründung expands to fill remaining row width after fixed cols.
                  ...(isReasonCol
                    ? { minWidth: w, flexGrow: 1, width: undefined }
                    : { width: w, flexGrow: 0, minWidth: 0 }),
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
                    { textAlign: 'left', fontSize: PDF_FONT_SIZES.xs }
                  ]}
                >
                  {col.label}
                </Text>
              </View>
            );
          })}
        </View>

        {excludedTrips.map((row, idx) => (
          <View
            key={`ex-${idx}`}
            style={[{ width: '100%' }, idx % 2 === 1 ? styles.tableRowAlt : {}]}
            wrap={false}
          >
            <View style={styles.tableRow}>
              {EXCLUDED_APPENDIX_COLUMNS.map((col, colIdx) => {
                const w = excludedColWidths[col.key];
                const raw = excludedCellValue(col.key, row);
                const hasNl = raw.includes('\n');
                const isReasonCol = col.key === 'begruendung';
                const reasonEmpty = isReasonCol && raw === EM_DASH;
                const baseText = {
                  fontSize: PDF_FONT_SIZES.xs,
                  textAlign: 'left' as const,
                  color: isReasonCol
                    ? PDF_COLORS.billingReason
                    : PDF_COLORS.text,
                  ...(reasonEmpty ? styles.appendixMoneyMuted : {})
                };

                return (
                  <View
                    key={`ex-${idx}-${col.key}-${colIdx}`}
                    style={{
                      // why: Begründung uses computed width as minWidth + flexGrow so it
                      // expands; fixed cols get explicit width from calcExcludedColumnWidths.
                      ...(isReasonCol
                        ? { minWidth: w, flexGrow: 1 }
                        : { width: w, flexGrow: 0, minWidth: 0 }),
                      // why: overflow:hidden + flexWrap:nowrap clips multi-line reason text in
                      // react-pdf; elastic Begründung cell wraps correctly without them.
                      ...(isReasonCol
                        ? {}
                        : {
                            overflow: 'hidden',
                            flexWrap: 'nowrap' as const
                          }),
                      paddingRight: 4,
                      // why: justifyContent:center causes react-pdf to render overflowing wrapped
                      // text above the cell boundary into the preceding row — flex-start anchors
                      // the text to the top of the cell and wraps downward correctly.
                      justifyContent: isReasonCol
                        ? ('flex-start' as const)
                        : ('center' as const)
                    }}
                  >
                    {hasNl ? (
                      <View
                        style={
                          isReasonCol
                            ? { width: w }
                            : { minWidth: 0, width: '100%' }
                        }
                      >
                        {raw.split('\n').map((line, li) => (
                          <Text
                            key={li}
                            style={
                              isReasonCol
                                ? {
                                    ...baseText,
                                    // why: react-pdf cannot resolve percentage widths against
                                    // flex-computed parent widths — explicit pixel width on Text
                                    // is required to constrain wrapping.
                                    width: w
                                  }
                                : baseText
                            }
                          >
                            {line}
                          </Text>
                        ))}
                      </View>
                    ) : (
                      <Text
                        style={
                          isReasonCol
                            ? {
                                ...baseText,
                                // why: react-pdf cannot resolve percentage widths against
                                // flex-computed parent widths — explicit pixel width on Text
                                // is required to constrain wrapping.
                                width: w
                              }
                            : baseText
                        }
                      >
                        {raw}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    );
  }

  /** Flowing block only — not `fixed` (unlike billed header). Caller passes non-empty trips only where needed. */
  function renderCancelledSection(landscape = false) {
    if (cancelledTrips.length === 0) {
      return null;
    }

    const EM_DASH = '—';
    // why: proportional scaling via calcColumnWidths — same system as normal appendix columns.
    const cancelledColWidths = calcColumnWidths(
      CANCELLED_COLUMNS_CONFIG,
      landscape
    );

    function cellValue(
      key: (typeof CANCELLED_APPENDIX_COLUMN_KEYS)[number],
      row: CancelledTripRow
    ): string {
      switch (key) {
        case 'datum':
          return row.scheduled_at
            ? formatInvoicePdfDate(row.scheduled_at)
            : EM_DASH;
        case 'fahrgast': {
          const c = row.client;
          const joinedName = c
            ? [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
            : '';
          // why: fall back to the denormalized client_name snapshot when the client join
          // is absent — mirrors how normal appendix rows resolve the Fahrgast column.
          return joinedName || row.client_name?.trim() || EM_DASH;
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
          {CANCELLED_APPENDIX_COLUMN_KEYS.map((colKey, idx) => {
            const colDef = PDF_COLUMN_MAP[colKey];
            if (!colDef) return null;
            const w = cancelledColWidths[colKey] ?? colDef.defaultWidthPt;
            const isReasonCol = colKey === 'stornierungsgrund';
            return (
              <View
                key={`cx-h-${colKey}-${idx}`}
                style={{
                  // why: Stornierungsgrund expands to fill remaining row width after fixed cols.
                  ...(isReasonCol
                    ? { minWidth: w, flexGrow: 1, width: undefined }
                    : { width: w, flexGrow: 0, minWidth: 0 }),
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
            );
          })}
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
                {CANCELLED_APPENDIX_COLUMN_KEYS.map((colKey, colIdx) => {
                  const colDef = PDF_COLUMN_MAP[colKey];
                  if (!colDef) return null;
                  const w = cancelledColWidths[colKey] ?? colDef.defaultWidthPt;
                  const raw = cellValue(colKey, cxRow);
                  const hasNl = raw.includes('\n');
                  const isReasonCol = colKey === 'stornierungsgrund';
                  const isFahrgastCol = colKey === 'fahrgast';
                  const reasonEmpty = isReasonCol && raw === EM_DASH;
                  const baseText = {
                    fontSize: PDF_FONT_SIZES.xs,
                    textAlign: 'left' as const,
                    color: PDF_COLORS.text,
                    ...(reasonEmpty ? styles.appendixMoneyMuted : {})
                  };

                  return (
                    <View
                      key={`cx-${cxRow.id}-${colKey}-${colIdx}`}
                      style={{
                        // why: Stornierungsgrund uses computed width as minWidth + flexGrow so it
                        // expands; fixed cols get explicit width from calcColumnWidths.
                        ...(isReasonCol
                          ? { minWidth: w, flexGrow: 1 }
                          : { width: w, flexGrow: 0, minWidth: 0 }),
                        // why: overflow:hidden + flexWrap:nowrap clips multi-line reason text in
                        // react-pdf; elastic cells with flexGrow:1 wrap correctly without them.
                        // why: Fahrgast column wraps instead of clipping — names must be fully
                        // visible even if two lines are needed.
                        ...(isReasonCol || isFahrgastCol
                          ? {}
                          : {
                              overflow: 'hidden',
                              flexWrap: 'nowrap' as const
                            }),
                        paddingRight: 4,
                        // why: justifyContent:center causes react-pdf to render overflowing wrapped
                        // text above the cell boundary into the preceding row — flex-start anchors
                        // the text to the top of the cell and wraps downward correctly.
                        justifyContent: isReasonCol
                          ? ('flex-start' as const)
                          : ('center' as const)
                      }}
                    >
                      {hasNl ? (
                        <View
                          style={
                            isReasonCol || isFahrgastCol
                              ? { width: w }
                              : { minWidth: 0, width: '100%' }
                          }
                        >
                          {raw.split('\n').map((line, li) => (
                            <Text
                              key={li}
                              style={
                                isReasonCol || isFahrgastCol
                                  ? {
                                      ...baseText,
                                      // why: react-pdf cannot resolve percentage widths against
                                      // flex-computed parent widths — explicit pixel width on Text
                                      // is required to constrain wrapping.
                                      width: w
                                    }
                                  : baseText
                              }
                            >
                              {line}
                            </Text>
                          ))}
                        </View>
                      ) : (
                        <Text
                          style={
                            isReasonCol || isFahrgastCol
                              ? {
                                  ...baseText,
                                  // why: react-pdf cannot resolve percentage widths against
                                  // flex-computed parent widths — explicit pixel width on Text
                                  // is required to constrain wrapping.
                                  width: w
                                }
                              : baseText
                          }
                        >
                          {raw}
                        </Text>
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

      {/* Passive cancelled: gated by show_cancelled_trips in parent; €0 informational only. */}
      {renderCancelledSection(cancelledLandscape)}

      {/* Excluded: gated by show_excluded_trips in parent; no amount. */}
      {renderExcludedSection()}
    </>
  );
}

export { A4_LANDSCAPE };
