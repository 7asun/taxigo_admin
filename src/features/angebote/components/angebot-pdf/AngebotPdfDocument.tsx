/**
 * Root PDF document for Angebote (offers).
 *
 * Reuses InvoicePdfCoverHeader and InvoicePdfFooter from the invoices module
 * unchanged — metaConfig relabels the meta grid (Angebotsnr., Angebotsdatum,
 * Gültig bis) and hides tax ID rows. Recipient window mapping avoids duplicating
 * Firma when no Ansprechperson is set.
 *
 * The body is fully separate (AngebotPdfCoverBody) — offers have no trip line
 * items, no tax totals, and no SEPA QR block.
 *
 * WHY reuse the invoice header/footer: visual consistency across all PDF
 * documents sent to customers. When company branding changes (logo, slogan,
 * footer legal text), both invoice and offer PDFs update automatically.
 */

import { Document, Page, View } from '@react-pdf/renderer';

import { InvoicePdfCoverHeader } from '@/features/invoices/components/invoice-pdf/invoice-pdf-cover-header';
import { InvoicePdfRecipientBlock } from '@/features/invoices/components/invoice-pdf/invoice-pdf-cover-header';
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
import type { PdfRenderMode } from '@/features/invoices/lib/pdf-layout-constants';
import {
  PDF_DIN5008,
  PDF_PAGE
} from '@/features/invoices/lib/pdf-layout-constants';

import { profileToAngebotColumnDefs } from '../../lib/resolve-angebot-table-schema';
import type {
  AngebotColumnDef,
  AngebotWithLineItems
} from '../../types/angebot.types';
import { ANGEBOT_STANDARD_COLUMN_PROFILE } from '../../types/angebot.types';
import { AngebotPdfCoverBody } from './AngebotPdfCoverBody';

/**
 * Shared by PDF export and detail UI — resolves the same column schema as the document body.
 */
export function resolveAngebotPdfColumnSchema(
  angebot: AngebotWithLineItems
): AngebotColumnDef[] {
  // Precedence: table_schema_snapshot (Phase 2a+) → pdf_column_override (legacy, pre–Phase-2a offers only) → standard profile fallback. Remove step 2 once all offers have a snapshot.
  if (
    angebot.table_schema_snapshot &&
    angebot.table_schema_snapshot.length > 0
  ) {
    return angebot.table_schema_snapshot;
  }
  const legacy = angebot.pdf_column_override;
  if (legacy?.columns?.length) {
    return profileToAngebotColumnDefs(legacy);
  }
  return profileToAngebotColumnDefs(ANGEBOT_STANDARD_COLUMN_PROFILE);
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AngebotPdfDocumentProps {
  angebot: AngebotWithLineItems;
  /** Resolved company profile (same shape as InvoiceDetail['company_profile']). */
  companyProfile: InvoiceDetail['company_profile'];
  /** Optional intro text override */
  introText?: string | null;
  /** Optional outro text override */
  outroText?: string | null;
  // 'brief' triggers DIN 5008 fold marks + fixed header zone. Not yet implemented — falls back to digital with console.warn. Split download button (Digital / Als Brief) enabled once Brief mode is ready.
  renderMode?: PdfRenderMode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAngebotPdfDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch {
    return isoDate;
  }
}

// ─── Document ────────────────────────────────────────────────────────────────

export function AngebotPdfDocument({
  angebot,
  companyProfile: cp,
  introText,
  outroText,
  renderMode = 'digital'
}: AngebotPdfDocumentProps) {
  // Two render paths: 'digital' keeps the existing flow-based header; 'brief' pins the recipient window at 127pt and adds fold marks (Path C: separate Brief header + page-level address window).
  const senderOneLine = buildInvoicePdfSenderOneLine(cp);
  const senderFit = senderOneLine
    ? fitSenderLine(senderOneLine)
    : { line: '', fontSize: PDF_FONT_SIZES.xs };

  const contactDisplayName = angebot.recipient_last_name
    ? [
        angebot.recipient_anrede,
        angebot.recipient_first_name,
        angebot.recipient_last_name
      ]
        .filter(Boolean)
        .join(' ')
        .trim()
    : (angebot.recipient_name?.trim() ?? '');

  const person = contactDisplayName;
  const company = angebot.recipient_company?.trim() ?? '';

  const recipient = {
    companyName: person ? company : '',
    personName: person,
    displayName: person || company || '—',
    street: angebot.recipient_street ?? '',
    streetNumber: angebot.recipient_street_number ?? '',
    zipCode: angebot.recipient_zip ?? '',
    city: angebot.recipient_city ?? '',
    phone: null as string | null,
    addressLine2: null as string | null
  };

  const columnSchema = resolveAngebotPdfColumnSchema(angebot);

  const resolvedIntroText = introText ?? angebot.intro_text ?? null;
  const resolvedOutroText = outroText ?? angebot.outro_text ?? null;

  return (
    <Document
      title={angebot.angebot_number}
      author={cp?.legal_name ?? 'Taxigo'}
    >
      <Page size='A4' style={styles.angebotPage} wrap>
        {renderMode === 'brief' ? (
          <>
            <View
              style={{
                position: 'absolute',
                top: PDF_DIN5008.fold1,
                left: PDF_DIN5008.foldMarkX,
                width: PDF_DIN5008.foldMarkWidth,
                borderTopWidth: PDF_DIN5008.foldMarkStroke,
                borderTopColor: PDF_COLORS.text
              }}
            />{' '}
            {/* DIN 5008 Falzmarke 1 (105mm) — rendered at page level so it never participates in flow layout */}
            <View
              style={{
                position: 'absolute',
                top: PDF_DIN5008.lochmarke,
                left: PDF_DIN5008.foldMarkX,
                width: PDF_DIN5008.foldMarkWidth,
                borderTopWidth: PDF_DIN5008.foldMarkStroke,
                borderTopColor: PDF_COLORS.text
              }}
            />{' '}
            {/* DIN 5008 Lochmarke (148.5mm) — drawn on cover page only */}
            <View
              style={{
                position: 'absolute',
                top: PDF_DIN5008.fold2,
                left: PDF_DIN5008.foldMarkX,
                width: PDF_DIN5008.foldMarkWidth,
                borderTopWidth: PDF_DIN5008.foldMarkStroke,
                borderTopColor: PDF_COLORS.text
              }}
            />{' '}
            {/* DIN 5008 Falzmarke 2 (210mm) — absolute so it doesn't shift with header/content */}
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
              {/* Address window is page-level (top=PDF_DIN5008.addressWindowTop) because flow headers cannot guarantee a fixed 127pt start. */}
              <InvoicePdfRecipientBlock recipient={recipient} />
            </View>
          </>
        ) : null}

        {/* Path C (chosen over A/B): keep digital header stable and enforce DIN geometry at the Page level via a dedicated Brief header + absolutely positioned address window. */}
        {renderMode === 'brief' ? (
          <InvoicePdfCoverHeaderBrief
            companyProfile={cp}
            senderFit={senderFit}
            recipient={recipient}
            invoiceNumber={angebot.angebot_number}
            invoiceCreatedAtIso={angebot.offer_date}
            periodFromIso={angebot.valid_until ?? angebot.offer_date}
            periodToIso={angebot.valid_until ?? angebot.offer_date}
            customerNumber={angebot.customer_number ?? ''}
            renderMode={renderMode}
            metaConfig={{
              heading: 'Angebotsdaten',
              numberLabel: 'Angebotsnr.',
              dateLabel: 'Angebotsdatum',
              showTaxIds: false,
              periodLabel: 'Gültig bis',
              periodValue: angebot.valid_until
                ? formatAngebotPdfDate(angebot.valid_until)
                : '—'
            }}
          />
        ) : (
          <InvoicePdfCoverHeader
            companyProfile={cp}
            senderFit={senderFit}
            recipient={recipient}
            invoiceNumber={angebot.angebot_number}
            invoiceCreatedAtIso={angebot.offer_date}
            periodFromIso={angebot.valid_until ?? angebot.offer_date}
            periodToIso={angebot.valid_until ?? angebot.offer_date}
            customerNumber={angebot.customer_number ?? ''}
            renderMode={renderMode}
            metaConfig={{
              heading: 'Angebotsdaten',
              numberLabel: 'Angebotsnr.',
              dateLabel: 'Angebotsdatum',
              showTaxIds: false,
              periodLabel: 'Gültig bis',
              periodValue: angebot.valid_until
                ? formatAngebotPdfDate(angebot.valid_until)
                : '—'
            }}
          />
        )}

        <View style={styles.angebotPageBody} wrap>
          <AngebotPdfCoverBody
            subject={angebot.subject}
            recipientAnrede={angebot.recipient_anrede}
            recipientFirstName={angebot.recipient_first_name}
            recipientLastName={angebot.recipient_last_name}
            recipientLegacyName={angebot.recipient_name}
            lineItems={angebot.line_items}
            columnSchema={columnSchema}
            introText={resolvedIntroText}
            outroText={resolvedOutroText}
          />
        </View>

        <InvoicePdfFooter companyProfile={cp} notes={null} />
      </Page>
    </Document>
  );
}
