/**
 * Letter PDF — always DIN Brief layout: fold marks + absolute address window + Brief header.
 * We reuse InvoicePdfCoverHeaderBrief (not the flow header) so the meta grid stays aligned
 * with invoices/offers while the legal address sits at PDF_DIN5008.addressWindowTop like Path C.
 */

import { Document, Page, View } from '@react-pdf/renderer';

import { InvoicePdfRecipientBlock } from '@/features/invoices/components/invoice-pdf/invoice-pdf-cover-header';
import type { InvoicePdfCoverHeaderProps } from '@/features/invoices/components/invoice-pdf/invoice-pdf-cover-header';
import { InvoicePdfCoverHeaderBrief } from '@/features/invoices/components/invoice-pdf/invoice-pdf-cover-header-brief';
import { InvoicePdfFooter } from '@/features/invoices/components/invoice-pdf/invoice-pdf-footer';
import {
  PDF_COLORS,
  PDF_FONT_SIZES,
  styles
} from '@/features/invoices/components/invoice-pdf/pdf-styles';
import { buildInvoicePdfSenderOneLine } from '@/features/invoices/components/invoice-pdf/lib/invoice-pdf-format';
import { fitSenderLine } from '@/features/invoices/components/invoice-pdf/resolve-sender-font-size';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';
import {
  PDF_DIN5008,
  PDF_PAGE,
  PDF_ZONES_LETTER
} from '@/features/invoices/lib/pdf-layout-constants';

import type { Letter } from '../../types';
import { LetterPdfCoverBody } from './letter-pdf-cover-body';

export interface LetterPdfDocumentProps {
  letter: Letter;
  companyProfile: InvoiceDetail['company_profile'];
}

function letterDateAsIso(letterDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(letterDate)) {
    return `${letterDate}T12:00:00.000Z`;
  }
  return letterDate;
}

function buildWindowRecipient(
  letter: Letter
): InvoicePdfCoverHeaderProps['recipient'] {
  const first = letter.recipientFirstName?.trim() ?? '';
  const last = letter.recipientLastName?.trim() ?? '';
  const person = [first, last].filter(Boolean).join(' ').trim();
  const company = letter.recipientCompany?.trim() ?? '';
  const sal = letter.recipientSalutation?.trim() ?? '';
  const anrede =
    sal === 'Herr' || sal === 'Frau' ? sal : sal.length > 0 ? sal : null;

  const cityLine = letter.recipientCountry?.trim()
    ? [letter.recipientCity?.trim(), letter.recipientCountry.trim()]
        .filter(Boolean)
        .join(', ')
    : (letter.recipientCity?.trim() ?? '');

  return {
    companyName: company,
    personName: person,
    displayName: person || company || '—',
    street: letter.recipientStreet?.trim() ?? '',
    streetNumber: '',
    zipCode: letter.recipientZip?.trim() ?? '',
    city: cityLine,
    phone: null,
    addressLine2: null,
    anrede,
    abteilung: null,
    firstName: first || null,
    lastName: last || null
  };
}

export function LetterPdfDocument({
  letter,
  companyProfile: cp
}: LetterPdfDocumentProps) {
  const renderMode = 'brief' as const;
  const senderOneLine = buildInvoicePdfSenderOneLine(cp);
  const senderFit = senderOneLine
    ? fitSenderLine(senderOneLine)
    : { line: '', fontSize: PDF_FONT_SIZES.xs };

  const recipient = buildWindowRecipient(letter);
  const dateIso = letterDateAsIso(letter.letterDate);
  const docTitle =
    letter.letterNumber?.trim() || `Brief-${letter.id.slice(0, 8)}`;

  return (
    <Document title={docTitle} author={cp?.legal_name ?? 'Taxigo'}>
      <Page size='A4' style={styles.angebotPage} wrap>
        <View
          style={{
            position: 'absolute',
            top: PDF_DIN5008.fold1,
            left: PDF_DIN5008.foldMarkX,
            width: PDF_DIN5008.foldMarkWidth,
            borderTopWidth: PDF_DIN5008.foldMarkStroke,
            borderTopColor: PDF_COLORS.text
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: PDF_DIN5008.lochmarke,
            left: PDF_DIN5008.foldMarkX,
            width: PDF_DIN5008.foldMarkWidth,
            borderTopWidth: PDF_DIN5008.foldMarkStroke,
            borderTopColor: PDF_COLORS.text
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: PDF_DIN5008.fold2,
            left: PDF_DIN5008.foldMarkX,
            width: PDF_DIN5008.foldMarkWidth,
            borderTopWidth: PDF_DIN5008.foldMarkStroke,
            borderTopColor: PDF_COLORS.text
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: PDF_DIN5008.addressWindowTop,
            left: PDF_PAGE.marginLeft,
            width: '52%',
            maxHeight: PDF_DIN5008.addressWindowHeight,
            overflow: 'hidden'
          }}
        >
          <InvoicePdfRecipientBlock recipient={recipient} />
        </View>

        <InvoicePdfCoverHeaderBrief
          companyProfile={cp}
          senderFit={senderFit}
          recipient={recipient}
          invoiceNumber={letter.letterNumber?.trim() || '—'}
          invoiceCreatedAtIso={dateIso}
          periodFromIso={dateIso}
          periodToIso={dateIso}
          customerNumber=''
          renderMode={renderMode}
          metaConfig={{
            heading: 'Briefdaten',
            dateLabel: 'Datum',
            showTaxIds: false,
            // Only Datum in the preview/PDF meta card during composition; Brief-Nr./Kunde/Status stay in the form.
            metaGridLayout: 'date_only'
          }}
        />

        {/* Push flow body (Betreff/Anrede/prose) below the absolute DIN window band so it does not paint over the recipient. Letter-only margin: PDF_ZONES_LETTER (see docs/plans/letters-pdf-din-alignment-audit.md, docs/plans/letters-pdf-layout-audit.md). */}
        <View
          style={[
            styles.angebotPageBody,
            { marginTop: PDF_ZONES_LETTER.briefBodyExtraMarginTop }
          ]}
          wrap
        >
          <LetterPdfCoverBody letter={letter} />
        </View>

        <InvoicePdfFooter companyProfile={cp} notes={null} />
      </Page>
    </Document>
  );
}
