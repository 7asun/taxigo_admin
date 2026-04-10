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

// Reused from invoices module — do not modify invoice-side types
import { InvoicePdfCoverHeader } from '@/features/invoices/components/invoice-pdf/invoice-pdf-cover-header';
import { InvoicePdfFooter } from '@/features/invoices/components/invoice-pdf/invoice-pdf-footer';
import {
  PDF_FONT_SIZES,
  styles
} from '@/features/invoices/components/invoice-pdf/pdf-styles';
import { buildInvoicePdfSenderOneLine } from '@/features/invoices/components/invoice-pdf/lib/invoice-pdf-format';
import { fitSenderLine } from '@/features/invoices/components/invoice-pdf/resolve-sender-font-size';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';

import type { AngebotWithLineItems } from '../../types/angebot.types';
import { ANGEBOT_STANDARD_COLUMN_PROFILE } from '../../types/angebot.types';
import { AngebotPdfCoverBody } from './AngebotPdfCoverBody';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AngebotPdfDocumentProps {
  angebot: AngebotWithLineItems;
  /** Resolved company profile (same shape as InvoiceDetail['company_profile']). */
  companyProfile: InvoiceDetail['company_profile'];
  /** Optional intro text override */
  introText?: string | null;
  /** Optional outro text override */
  outroText?: string | null;
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
  outroText
}: AngebotPdfDocumentProps) {
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

  // Window address only (DIN 5008): name + postal lines — no E-Mail/Telefon here.
  // companyName line 1 only when both Firma and Ansprechperson exist (avoids duplicate
  // when only Firma is set — header would otherwise show the same string twice).
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

  const columnProfile =
    angebot.pdf_column_override ?? ANGEBOT_STANDARD_COLUMN_PROFILE;

  const resolvedIntroText = introText ?? angebot.intro_text ?? null;
  const resolvedOutroText = outroText ?? angebot.outro_text ?? null;

  return (
    <Document
      title={angebot.angebot_number}
      author={cp?.legal_name ?? 'Taxigo'}
    >
      <Page size='A4' style={styles.angebotPage} wrap>
        {/* Header — reused unchanged; metaConfig overrides labels for offer context */}
        <InvoicePdfCoverHeader
          companyProfile={cp}
          senderFit={senderFit}
          recipient={recipient}
          invoiceNumber={angebot.angebot_number}
          invoiceCreatedAtIso={angebot.offer_date}
          periodFromIso={angebot.valid_until ?? angebot.offer_date}
          periodToIso={angebot.valid_until ?? angebot.offer_date}
          customerNumber={angebot.customer_number ?? ''}
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

        {/* Body — flex column, wrap so long Html intro/outro can paginate (no minHeight). */}
        <View style={styles.angebotPageBody} wrap>
          <AngebotPdfCoverBody
            subject={angebot.subject}
            recipientAnrede={angebot.recipient_anrede}
            recipientFirstName={angebot.recipient_first_name}
            recipientLastName={angebot.recipient_last_name}
            recipientLegacyName={angebot.recipient_name}
            lineItems={angebot.line_items}
            columnKeys={columnProfile.columns}
            introText={resolvedIntroText}
            outroText={resolvedOutroText}
          />
        </View>

        {/* Footer — reused unchanged; shows company legal info + bank details */}
        <InvoicePdfFooter companyProfile={cp} notes={null} />
      </Page>
    </Document>
  );
}
