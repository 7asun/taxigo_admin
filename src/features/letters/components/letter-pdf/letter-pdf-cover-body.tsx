/**
 * Letter PDF body — prose only (subject, greeting, HTML body, closing).
 * react-pdf-html matches the Angebot intro/outro approach so dispatchers get the
 * same rich-text subset in PDF as in Tiptap; we keep a local stylesheet copy here
 * (not imported from angebot) to honour the “do not couple features” rule.
 *
 * DIN clearance below the absolute address window is applied once on the parent
 * wrapper in letter-pdf-document.tsx (`PDF_ZONES_LETTER.briefBodyExtraMarginTop`);
 * keep subject band spacing here aligned with Angebot via `subjectMarginTopOffer`.
 */

import { View, Text } from '@react-pdf/renderer';
import Html from 'react-pdf-html';
import type { HtmlStyles } from 'react-pdf-html';

import {
  PDF_COLORS,
  PDF_FONT_SIZES,
  styles
} from '@/features/invoices/components/invoice-pdf/pdf-styles';
import { PDF_ZONES } from '@/features/invoices/lib/pdf-layout-constants';

import type { Letter } from '../../types';

const HTML_PROSE = {
  fontSize: PDF_FONT_SIZES.base,
  lineHeight: 1.6,
  color: PDF_COLORS.text
} as const;

const LETTER_HTML_STYLESHEET: HtmlStyles = {
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

function salutationForLetter(letter: Letter): string {
  const anrede =
    letter.recipientSalutation === 'Herr' ||
    letter.recipientSalutation === 'Frau'
      ? letter.recipientSalutation
      : null;
  const firstName = letter.recipientFirstName?.trim() ?? '';
  const lastName = letter.recipientLastName?.trim() ?? '';
  const last = lastName;
  if (!last) return 'Sehr geehrte Damen und Herren,';

  const lastOnlyForAnrede = lastName
    ? lastName
    : (last.split(/\s+/).slice(-1)[0] ?? last);

  if (anrede === 'Herr') return `Sehr geehrter Herr ${lastOnlyForAnrede},`;
  if (anrede === 'Frau') return `Sehr geehrte Frau ${lastOnlyForAnrede},`;

  const full = [firstName, last].filter(Boolean).join(' ').trim();
  return `Guten Tag ${full},`;
}

export interface LetterPdfCoverBodyProps {
  letter: Letter;
}

export function LetterPdfCoverBody({ letter }: LetterPdfCoverBodyProps) {
  const salutation = salutationForLetter(letter);
  const bodyHtml = letter.bodyHtml?.trim() ?? '';

  return (
    <>
      <View style={{ marginTop: PDF_ZONES.subjectMarginTopOffer }}>
        {letter.subject?.trim() ? (
          <Text style={styles.subject}>{letter.subject.trim()}</Text>
        ) : null}
        <Text style={styles.salutation}>{salutation}</Text>
      </View>

      {bodyHtml ? (
        <View
          wrap
          style={[
            styles.htmlBlock,
            { marginBottom: PDF_ZONES.bodyMarginBottom }
          ]}
        >
          <Html resetStyles stylesheet={LETTER_HTML_STYLESHEET}>
            {bodyHtml}
          </Html>
        </View>
      ) : null}

      <View style={{ marginTop: PDF_ZONES.closingMarginTop }} wrap={false}>
        <Text style={styles.bodyClosing}>Mit freundlichen Grüßen,</Text>
      </View>
    </>
  );
}
