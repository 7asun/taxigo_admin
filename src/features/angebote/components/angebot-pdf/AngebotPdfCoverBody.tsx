/**
 * Renders the offer body: subject → salutation → intro → line items table → outro.
 *
 * Salutation logic:
 *   Herr  + name → "Sehr geehrter Herr [name],"
 *   Frau  + name → "Sehr geehrte Frau [name],"
 *   null anrede + name → "Sehr geehrte/r [name],"
 *   no name at all  → "Sehr geehrte Damen und Herren,"
 *
 * Intro/outro are Tiptap HTML strings, rendered via `react-pdf-html` `<Html>` (bold, italic,
 * underline, bullet/ordered lists). Line-item cells with `pdfRenderType === 'text'` always use
 * `<Html>` as well: plain values are wrapped in a safe `<p>`, rich HTML is passed through.
 * Table cells use `PDF_FONT_SIZES.sm`; `<strong>` maps to Helvetica-Bold like invoice PDFs.
 * Intro/outro `<Html>` sits in `View` + `styles.htmlBlock` with `wrap` so long prose can paginate.
 *
 * No totals row — offers are informational pricing documents, not tax invoices.
 * Tax calculation (§14 UStG) is the invoice's responsibility, not the offer's.
 */

import { View, Text } from '@react-pdf/renderer';
import Html from 'react-pdf-html';
import type { HtmlStyles } from 'react-pdf-html';

import type { AngebotLineItemRow } from '../../types/angebot.types';
import type { AngebotColumnDef } from '../../types/angebot.types';
import { calcAngebotColumnWidths } from './angebot-pdf-columns';
import { resolveColumnLayout } from '../../lib/angebot-column-presets';
import {
  PDF_COLORS,
  PDF_FONT_SIZES,
  styles
} from '@/features/invoices/components/invoice-pdf/pdf-styles';
import { PDF_ZONES } from '@/features/invoices/lib/pdf-layout-constants';
import {
  ANGEBOT_POSITION_COLUMN,
  ANGEBOT_POSITION_COLUMN_ID
} from '../../lib/angebot-auto-columns';
import { ANGEBOT_LEGACY_COLUMN_IDS } from '../../lib/angebot-legacy-column-ids';
import { angebotTextCellHtmlForPdf } from '../../lib/angebot-rich-text';

/** Intro/outro prose — mirrors `styles.bodyText` (invoice PDF); does not affect the table. */
const HTML_PROSE = {
  fontSize: PDF_FONT_SIZES.base,
  lineHeight: 1.6,
  color: PDF_COLORS.text
} as const;

/**
 * Stylesheet for `react-pdf-html` `<Html>` — intro/outro only (table uses `PDF_FONT_SIZES.sm`).
 *
 * ul / ol / li are intentionally absent: preprocessHtmlForPdf converts list nodes
 * to <div>/<p> with inline hanging-indent styles before reaching react-pdf-html,
 * because listStyleType on ul/ol renders markers inside the first character (library bug).
 */
const ANGEBOT_HTML_STYLESHEET: HtmlStyles = {
  body: { ...HTML_PROSE, marginBottom: 0 },
  div: { ...HTML_PROSE, marginBottom: 0 },
  p: {
    ...HTML_PROSE,
    marginTop: 0,
    marginBottom: 8
  },
  strong: { ...HTML_PROSE, fontWeight: 'bold' },
  b: { ...HTML_PROSE, fontWeight: 'bold' },
  em: { ...HTML_PROSE, fontStyle: 'italic' },
  i: { ...HTML_PROSE, fontStyle: 'italic' },
  u: { ...HTML_PROSE, textDecoration: 'underline' },
  span: { ...HTML_PROSE },
  br: {}
};

/** Table body cells — matches `PDF_FONT_SIZES.sm` used on plain `<Text>` rows. */
const TABLE_CELL_HTML_BASE = {
  fontSize: PDF_FONT_SIZES.sm,
  lineHeight: 1.45,
  color: PDF_COLORS.text
} as const;

const ANGEBOT_TABLE_CELL_HTML_STYLESHEET: HtmlStyles = {
  body: { ...TABLE_CELL_HTML_BASE, marginBottom: 0 },
  div: { ...TABLE_CELL_HTML_BASE, marginBottom: 0 },
  p: { ...TABLE_CELL_HTML_BASE, marginTop: 0, marginBottom: 4 },
  li: { ...TABLE_CELL_HTML_BASE, marginBottom: 2 },
  ul: { marginBottom: 4, paddingLeft: 8 },
  ol: { marginBottom: 4, paddingLeft: 8 },
  // Built-in Helvetica-Bold — matches invoice PDF bold blocks (fontWeight alone can be unreliable in react-pdf-html).
  strong: {
    ...TABLE_CELL_HTML_BASE,
    fontFamily: 'Helvetica-Bold',
    fontWeight: 'normal'
  },
  b: {
    ...TABLE_CELL_HTML_BASE,
    fontFamily: 'Helvetica-Bold',
    fontWeight: 'normal'
  },
  em: { ...TABLE_CELL_HTML_BASE, fontStyle: 'italic' },
  i: { ...TABLE_CELL_HTML_BASE, fontStyle: 'italic' },
  u: { ...TABLE_CELL_HTML_BASE, textDecoration: 'underline' },
  span: { ...TABLE_CELL_HTML_BASE },
  br: {}
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEur(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

function formatEurPerKm(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)} €/km`;
}

function formatDecimalDe(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * PostgREST may return JSONB `data` as a stringified object — same rationale as
 * `coerceLineItemJsonbSnapshots` / `parseJsonbField` in pdf-column-layout.ts (L90–113).
 */
function coerceLineItemData(
  item: AngebotLineItemRow
): Record<string, string | number | null> {
  const raw = item.data;
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const v: unknown = JSON.parse(raw);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, string | number | null>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, string | number | null>;
  }
  return {};
}

/**
 * Temporary bridge: maps well-known column IDs to typed fields on AngebotLineItemRow.
 * Remove once all line items use data jsonb and typed columns are dropped.
 */
function legacyFallback(
  item: AngebotLineItemRow,
  colId: string
): string | number | null {
  switch (colId) {
    case ANGEBOT_LEGACY_COLUMN_IDS.leistung:
      return item.leistung;
    case ANGEBOT_LEGACY_COLUMN_IDS.anfahrtkosten:
      return item.anfahrtkosten;
    case ANGEBOT_LEGACY_COLUMN_IDS.price_first_5km:
      return item.price_first_5km;
    case ANGEBOT_LEGACY_COLUMN_IDS.price_per_km_after_5:
      return item.price_per_km_after_5;
    case ANGEBOT_LEGACY_COLUMN_IDS.notes:
      return item.notes;
    default:
      return null;
  }
}

function cellRawValue(
  item: AngebotLineItemRow,
  col: AngebotColumnDef,
  _rowIndex: number
): string | number | null {
  if (col.id === ANGEBOT_POSITION_COLUMN_ID) return null;
  const data = coerceLineItemData(item);
  const fromData = data[col.id];
  if (fromData !== undefined && fromData !== null && fromData !== '') {
    return fromData;
  }
  return legacyFallback(item, col.id);
}

function renderCell(
  col: AngebotColumnDef,
  raw: string | number | null,
  rowIndex: number
): string {
  // col_position is never in item.data — value is always the 1-based row index.
  if (col.id === ANGEBOT_POSITION_COLUMN_ID) {
    return String(rowIndex + 1);
  }
  const layout = resolveColumnLayout(col);
  switch (layout.pdfRenderType) {
    case 'text': {
      if (raw == null || raw === '') return '—';
      return String(raw);
    }
    case 'integer': {
      if (raw == null || raw === '') return '—';
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      return Number.isFinite(n) ? String(n) : '—';
    }
    case 'decimal': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return formatDecimalDe(Number.isFinite(n) ? n : null);
    }
    case 'currency': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return formatEur(Number.isFinite(n) ? n : null);
    }
    case 'currency_per_km': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return formatEurPerKm(Number.isFinite(n) ? n : null);
    }
    case 'percent': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(n)) return '—';
      return `${n} %`;
    }
    default:
      return '—';
  }
}

function textAlignForCol(col: AngebotColumnDef): 'left' | 'right' | 'center' {
  return resolveColumnLayout(col).align;
}

function buildSalutation(
  anrede: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  legacyName: string | null | undefined
): string {
  const last = (lastName ?? '').trim() || (legacyName ?? '').trim();
  if (!last) return 'Sehr geehrte Damen und Herren,';

  const lastOnlyForAnrede = lastName?.trim()
    ? lastName.trim()
    : (last.split(/\s+/).slice(-1)[0] ?? last);

  if (anrede === 'Herr') return `Sehr geehrter Herr ${lastOnlyForAnrede},`;
  if (anrede === 'Frau') return `Sehr geehrte Frau ${lastOnlyForAnrede},`;

  const full = [firstName, last].filter(Boolean).join(' ').trim();
  return `Guten Tag ${full},`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AngebotPdfCoverBodyProps {
  subject: string | null;
  recipientAnrede: 'Herr' | 'Frau' | null | undefined;
  recipientFirstName: string | null | undefined;
  recipientLastName: string | null | undefined;
  recipientLegacyName: string | null | undefined;
  lineItems: AngebotLineItemRow[];
  columnSchema: AngebotColumnDef[];
  introText: string | null;
  outroText: string | null;
  totalsData: {
    netTotal: number | null;
    taxTotal: number | null;
    grossTotal: number | null;
    labelNet: string;
    labelTax: string;
    labelGross: string;
  } | null;
}

/**
 * react-pdf-html does not support CSS list-style markers reliably — listStyleType
 * on ul/ol renders the bullet inside the first character. This function pre-processes
 * the HTML string before it reaches the <Html> renderer: it injects a Unicode prefix
 * ("• " for ul items, "N. " for ol items) directly into each <li> text node, then
 * wraps each list in a <div> so react-pdf-html treats them as block paragraphs.
 * The result is visually correct hanging-indent bullet/numbered lists in the PDF.
 *
 * Hanging-indent `style` on each synthetic paragraph: `padding-left: 14pt` reserves the
 * gutter where wrapped lines align (marker column + body start); `text-indent: -10pt` pulls
 * only the first line left so the prefix sits in the marker band while wrap lines stay inset.
 *
 * Tiptap emits `<li><p>…</p></li>`; the outer `<p>` is stripped per item so the injected
 * hanging-indent `<p>` is not nested (react-pdf-html would split marker and body across nodes).
 *
 * Each list `<p>` sets `margin-bottom: 3pt` inline so spacing between items is tighter than
 * body paragraphs (`ANGEBOT_HTML_STYLESHEET` `p` still uses marginBottom: 8), while a normal
 * paragraph after a list keeps the full body gap on that following node.
 */
function preprocessHtmlForPdf(html: string): string {
  let olCounter = 0;

  return html
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner: string) => {
      const items = inner.replace(
        /<li[^>]*>([\s\S]*?)<\/li>/gi,
        (_m: string, content: string) => {
          // Tiptap wraps <li> content in <p>...</p>; strip that outer block wrapper
          // so the marker and text land on the same react-pdf-html paragraph node.
          // Inner inline tags (<strong>, <em>, <u>) are preserved by only removing
          // the outermost <p> open/close tags, not all tags.
          const inner = content
            .trim()
            .replace(/^<p[^>]*>([\s\S]*?)<\/p>$/i, '$1');
          return `<p style="padding-left:14pt;text-indent:-10pt;margin-bottom:3pt;">• ${inner}</p>`;
        }
      );
      return `<div>${items}</div>`;
    })
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
      olCounter = 0;
      const items = inner.replace(
        /<li[^>]*>([\s\S]*?)<\/li>/gi,
        (_m: string, content: string) => {
          olCounter += 1;
          // Tiptap wraps <li> content in <p>...</p>; strip that outer block wrapper
          // so the marker and text land on the same react-pdf-html paragraph node.
          // Inner inline tags (<strong>, <em>, <u>) are preserved by only removing
          // the outermost <p> open/close tags, not all tags.
          const inner = content
            .trim()
            .replace(/^<p[^>]*>([\s\S]*?)<\/p>$/i, '$1');
          return `<p style="padding-left:14pt;text-indent:-10pt;margin-bottom:3pt;">${olCounter}. ${inner}</p>`;
        }
      );
      return `<div>${items}</div>`;
    });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AngebotPdfCoverBody({
  subject,
  recipientAnrede,
  recipientFirstName,
  recipientLastName,
  recipientLegacyName,
  lineItems,
  columnSchema,
  introText,
  outroText,
  totalsData
}: AngebotPdfCoverBodyProps) {
  // Strip col_position before prepending — it must never come from the stored schema.
  // Defensive guard: seed data or legacy snapshots may contain it.
  const userColumns = columnSchema.filter(
    (c) => c.id !== ANGEBOT_POSITION_COLUMN_ID
  );
  const effectiveColumns =
    userColumns.length > 0 ? [ANGEBOT_POSITION_COLUMN, ...userColumns] : [];
  const colWidths = calcAngebotColumnWidths(effectiveColumns);
  const salutation = buildSalutation(
    recipientAnrede,
    recipientFirstName,
    recipientLastName,
    recipientLegacyName
  );
  const introHtml = introText?.trim() ?? '';
  const outroHtml = outroText?.trim() ?? '';

  return (
    <>
      <View
        style={{
          marginTop:
            PDF_ZONES.subjectMarginTopOffer /* offer has no reference bar concept — uses fixed 12pt separation from header */
        }}
      >
        {/* DIN 5008 alignment: 12pt matches invoice no-reference-bar default */}
        {subject?.trim() ? (
          <Text style={styles.subject}>{subject.trim()}</Text>
        ) : null}

        <Text style={styles.salutation}>{salutation}</Text>
      </View>

      {introHtml ? (
        <View
          wrap
          style={[
            styles.htmlBlock,
            {
              marginBottom:
                PDF_ZONES.bodyMarginBottom /* spacing from intro prose to table — matches invoice bodyText */
            }
          ]}
        >
          {/* Matches invoice bodyText.marginBottom = 16 — consistent spacing before table */}
          <Html resetStyles stylesheet={ANGEBOT_HTML_STYLESHEET}>
            {preprocessHtmlForPdf(introHtml)}
          </Html>
        </View>
      ) : null}

      {lineItems.length > 0 && effectiveColumns.length > 0 ? (
        <>
          <View style={styles.tableHeader}>
            {effectiveColumns.map((col) => {
              // minWidth no longer on AngebotColumnDef — using safe floor 20pt
              const w =
                colWidths[col.id] ??
                PDF_ZONES.columnWidthFloor; /* minimum flex column width before layout warning */
              return (
                <View
                  key={col.id}
                  style={{
                    width: w,
                    minWidth: 0,
                    flexWrap: 'wrap',
                    paddingRight:
                      PDF_ZONES.tableCellPaddingRight /* consistent column breathing room across tables */,
                    justifyContent: 'center'
                  }}
                >
                  {/* Long admin-defined labels must wrap, not truncate — row height grows to fit. */}
                  <Text
                    style={[
                      styles.tableHeaderText,
                      {
                        // Pos. is always left-aligned and narrowest — never centre or right.
                        textAlign:
                          col.id === ANGEBOT_POSITION_COLUMN_ID
                            ? 'left'
                            : textAlignForCol(col),
                        fontSize: PDF_FONT_SIZES.xs,
                        flexWrap: 'wrap'
                      }
                    ]}
                  >
                    {col.header}
                  </Text>
                </View>
              );
            })}
          </View>

          {lineItems.map((item, idx) => (
            <View
              key={item.id}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {effectiveColumns.map((col) => {
                // minWidth no longer on AngebotColumnDef — using safe floor 20pt
                const w =
                  colWidths[col.id] ??
                  PDF_ZONES.columnWidthFloor; /* minimum flex column width before layout warning */
                const raw = cellRawValue(item, col, idx);
                const layout = resolveColumnLayout(col);
                const rawStr =
                  raw === null || raw === undefined ? '' : String(raw);
                const textHtmlFragment =
                  layout.pdfRenderType === 'text' &&
                  col.id !== ANGEBOT_POSITION_COLUMN_ID
                    ? angebotTextCellHtmlForPdf(rawStr)
                    : null;
                const useHtmlForCell = textHtmlFragment != null;
                return (
                  <View
                    key={col.id}
                    style={{
                      width: w,
                      minWidth: 0,
                      ...(useHtmlForCell
                        ? { flexWrap: 'wrap' as const }
                        : {
                            overflow: 'hidden',
                            flexWrap: 'nowrap' as const
                          }),
                      paddingRight:
                        PDF_ZONES.tableCellPaddingRight /* consistent column breathing room across tables */
                    }}
                  >
                    {useHtmlForCell ? (
                      <Html stylesheet={ANGEBOT_TABLE_CELL_HTML_STYLESHEET}>
                        {textHtmlFragment}
                      </Html>
                    ) : (
                      <Text
                        style={{
                          fontSize: PDF_FONT_SIZES.sm,
                          color: PDF_COLORS.text,
                          // Pos. is always left-aligned and narrowest — never centre or right.
                          textAlign:
                            col.id === ANGEBOT_POSITION_COLUMN_ID
                              ? 'left'
                              : textAlignForCol(col)
                        }}
                      >
                        {renderCell(col, raw, idx)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </>
      ) : null}

      {totalsData ? (
        <View
          style={[
            styles.totalsSection,
            { marginTop: PDF_ZONES.totalsSectionMarginTop }
          ]}
          wrap={false}
        >
          {totalsData.netTotal !== null ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{totalsData.labelNet}</Text>
              <Text style={styles.totalsValue}>
                {formatEur(totalsData.netTotal)}
              </Text>
            </View>
          ) : null}
          {totalsData.taxTotal !== null ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{totalsData.labelTax}</Text>
              <Text style={styles.totalsValue}>
                {formatEur(totalsData.taxTotal)}
              </Text>
            </View>
          ) : null}
          {totalsData.grossTotal !== null ? (
            <>
              <View style={styles.totalsGrandSpacer} />
              <View style={styles.totalsGrandRow} wrap={false}>
                <Text style={styles.totalsGrandLabel}>
                  {totalsData.labelGross}
                </Text>
                <Text style={styles.totalsGrandValue}>
                  {formatEur(totalsData.grossTotal)}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {outroHtml ? (
        <View
          wrap
          style={[
            styles.bodyOutroSection,
            styles.htmlBlock,
            {
              marginTop:
                PDF_ZONES.outroMarginTop /* matches invoice bodyOutroSection.marginTop via PDF_ZONES */
            }
          ]}
        >
          <Html resetStyles stylesheet={ANGEBOT_HTML_STYLESHEET}>
            {preprocessHtmlForPdf(outroHtml)}
          </Html>
        </View>
      ) : null}
    </>
  );
}
