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

import type {
  AngebotLineItemRow,
  AngebotColumnKey
} from '../../types/angebot.types';
import {
  ANGEBOT_COLUMN_MAP,
  calcAngebotColumnWidths
} from './angebot-pdf-columns';
import {
  PDF_COLORS,
  PDF_FONT_SIZES,
  styles
} from '@/features/invoices/components/invoice-pdf/pdf-styles';

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

function renderCellValue(
  item: AngebotLineItemRow,
  key: AngebotColumnKey,
  index: number
): string {
  switch (key) {
    case 'position':
      return String(index + 1);
    case 'leistung':
      return item.leistung || '—';
    case 'anfahrtkosten':
      return formatEur(item.anfahrtkosten);
    case 'price_first_5km':
      return formatEurPerKm(item.price_first_5km);
    case 'price_per_km_after_5':
      return formatEurPerKm(item.price_per_km_after_5);
    case 'notes':
      return item.notes || '—';
    default:
      return '—';
  }
}

function buildSalutation(
  anrede: 'Herr' | 'Frau' | null | undefined,
  name: string | null | undefined
): string {
  const trimName = name?.trim();
  if (!trimName) return 'Sehr geehrte Damen und Herren,';
  if (anrede === 'Herr') return `Sehr geehrter Herr ${trimName},`;
  if (anrede === 'Frau') return `Sehr geehrte Frau ${trimName},`;
  return `Sehr geehrte/r ${trimName},`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AngebotPdfCoverBodyProps {
  subject: string | null;
  recipientAnrede: 'Herr' | 'Frau' | null | undefined;
  recipientName: string | null | undefined;
  lineItems: AngebotLineItemRow[];
  columnKeys: AngebotColumnKey[];
  introText: string | null;
  outroText: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AngebotPdfCoverBody({
  subject,
  recipientAnrede,
  recipientName,
  lineItems,
  columnKeys,
  introText,
  outroText
}: AngebotPdfCoverBodyProps) {
  const colWidths = calcAngebotColumnWidths(columnKeys);
  const salutation = buildSalutation(recipientAnrede, recipientName);
  const introHtml = introText?.trim() ?? '';
  const outroHtml = outroText?.trim() ?? '';

  return (
    <>
      <View style={{ marginTop: 8 }}>
        {/* Subject line */}
        {subject?.trim() ? (
          <Text style={styles.subject}>{subject.trim()}</Text>
        ) : null}

        {/* Salutation */}
        <Text style={styles.salutation}>{salutation}</Text>
      </View>

      {/* Intro — separate wrap-friendly block so Html can break across pages */}
      {introHtml ? (
        <View wrap style={[styles.htmlBlock, { marginBottom: 8 }]}>
          <Html resetStyles stylesheet={ANGEBOT_HTML_STYLESHEET}>
            {introHtml}
          </Html>
        </View>
      ) : null}

      {/* Line items table — no totals row */}
      {lineItems.length > 0 ? (
        <>
          {/* Header */}
          <View style={styles.tableHeader}>
            {columnKeys.map((key) => {
              const def = ANGEBOT_COLUMN_MAP[key];
              if (!def) return null;
              const w = colWidths[key] ?? def.minWidthPt;
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
                        textAlign: def.align,
                        fontSize: PDF_FONT_SIZES.xs
                      }
                    ]}
                  >
                    {def.label}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Rows */}
          {lineItems.map((item, idx) => (
            <View
              key={item.id}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {columnKeys.map((key) => {
                const def = ANGEBOT_COLUMN_MAP[key];
                if (!def) return null;
                const w = colWidths[key] ?? def.minWidthPt;
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
                    <Text
                      style={{
                        fontSize: PDF_FONT_SIZES.sm,
                        color: PDF_COLORS.text,
                        textAlign: def.align
                      }}
                    >
                      {renderCellValue(item, key, idx)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </>
      ) : null}

      {/* Outro — marginTop: 8 overrides bodyOutroSection (16) so invoice PDF spacing stays unchanged */}
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
