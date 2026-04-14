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
 * underline, bullet/ordered lists). Prose matches `styles.bodyText` in pdf-styles (base 9pt,
 * lineHeight 1.6); line item table cells keep `PDF_FONT_SIZES.sm` separately below. Intro/outro
 * `<Html>` sits in `View` + `styles.htmlBlock` with `wrap` so long prose can paginate.
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
import {
  ANGEBOT_POSITION_COLUMN,
  ANGEBOT_POSITION_COLUMN_ID
} from '../../lib/angebot-auto-columns';
import { ANGEBOT_LEGACY_COLUMN_IDS } from '../../lib/angebot-legacy-column-ids';

/** Intro/outro prose — mirrors `styles.bodyText` (invoice PDF); does not affect the table. */
const HTML_PROSE = {
  fontSize: PDF_FONT_SIZES.base,
  lineHeight: 1.6,
  color: PDF_COLORS.text
} as const;

/**
 * Stylesheet for `react-pdf-html` `<Html>` — intro/outro only (table uses `PDF_FONT_SIZES.sm`).
 */
const ANGEBOT_HTML_STYLESHEET: HtmlStyles = {
  body: { ...HTML_PROSE, marginBottom: 0 },
  div: { ...HTML_PROSE, marginBottom: 0 },
  p: {
    ...HTML_PROSE,
    marginTop: 0,
    marginBottom: 8
  },
  li: {
    ...HTML_PROSE,
    marginBottom: 4
  },
  ul: { marginBottom: 8, paddingLeft: 10 },
  ol: { marginBottom: 8, paddingLeft: 10 },
  strong: { ...HTML_PROSE, fontWeight: 'bold' },
  b: { ...HTML_PROSE, fontWeight: 'bold' },
  em: { ...HTML_PROSE, fontStyle: 'italic' },
  i: { ...HTML_PROSE, fontStyle: 'italic' },
  u: { ...HTML_PROSE, textDecoration: 'underline' },
  span: { ...HTML_PROSE },
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
  outroText
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
      <View style={{ marginTop: 8 }}>
        {subject?.trim() ? (
          <Text style={styles.subject}>{subject.trim()}</Text>
        ) : null}

        <Text style={styles.salutation}>{salutation}</Text>
      </View>

      {introHtml ? (
        <View wrap style={[styles.htmlBlock, { marginBottom: 8 }]}>
          <Html resetStyles stylesheet={ANGEBOT_HTML_STYLESHEET}>
            {introHtml}
          </Html>
        </View>
      ) : null}

      {lineItems.length > 0 && effectiveColumns.length > 0 ? (
        <>
          <View style={styles.tableHeader}>
            {effectiveColumns.map((col) => {
              // minWidth no longer on AngebotColumnDef — using safe floor 20pt
              const w = colWidths[col.id] ?? 20;
              return (
                <View
                  key={col.id}
                  style={{
                    width: w,
                    minWidth: 0,
                    flexWrap: 'wrap',
                    paddingRight: 4,
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
                const w = colWidths[col.id] ?? 20;
                const raw = cellRawValue(item, col, idx);
                return (
                  <View
                    key={col.id}
                    style={{
                      width: w,
                      minWidth: 0,
                      overflow: 'hidden',
                      flexWrap: 'nowrap',
                      paddingRight: 4
                    }}
                  >
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
                  </View>
                );
              })}
            </View>
          ))}
        </>
      ) : null}

      {outroHtml ? (
        <View
          wrap
          style={[styles.bodyOutroSection, styles.htmlBlock, { marginTop: 8 }]}
        >
          <Html resetStyles stylesheet={ANGEBOT_HTML_STYLESHEET}>
            {outroHtml}
          </Html>
        </View>
      ) : null}
    </>
  );
}
