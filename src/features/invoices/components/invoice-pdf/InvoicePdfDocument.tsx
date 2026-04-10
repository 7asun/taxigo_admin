/**
 * InvoicePdfDocument.tsx
 *
 * Root @react-pdf/renderer Document for invoice PDFs — composes cover page,
 * appendix page, and shared footer. Layout detail lives in section components
 * and pdf-styles (DIN-oriented margins, § 14 UStG fields).
 *
 * Recipient layout (Spec C): `per_client` keeps the passenger as primary
 * addressee; optional frozen snapshot block for Rechnungsempfänger.
 * `monthly` / `single_trip` use the snapshot as the sole legal window addressee
 * when present, else legacy payer address.
 *
 * **Phase 6e:** `effectiveProfile` = prop ?? `invoice.column_profile` ?? system default; drives dynamic
 * main + appendix tables and appendix `Page` size (`A4_LANDSCAPE` when `appendix_is_landscape`).
 * Optional `columnProfile` prop supports the builder live preview (draft invoices).
 * Must not perform network I/O.
 */

import { Document, Page } from '@react-pdf/renderer';

import { calculateInvoiceTotals } from '../../api/invoice-line-items.api';
import type { BuilderLineItem, InvoiceDetail } from '../../types/invoice.types';
import type { PdfColumnProfile } from '../../types/pdf-vorlage.types';
import type { PriceResolution } from '../../types/pricing.types';

import {
  buildInvoicePdfGroupedByBillingType,
  groupLineItemsByBillingType,
  buildInvoicePdfSingleRow,
  buildInvoicePdfSummary
} from './lib/build-invoice-pdf-summary';
import {
  buildBriefkopfLines,
  normalizeInvoiceRecipientPhone,
  recipientFromRechnungsempfaengerSnapshot,
  salutationFromSnapshot,
  secondaryLegalFromSnapshot
} from './lib/rechnungsempfaenger-pdf';
import {
  buildInvoicePdfSenderOneLine,
  formatInvoicePdfDate
} from './lib/invoice-pdf-format';
import { A4_LANDSCAPE, InvoicePdfAppendix } from './invoice-pdf-appendix';
import { InvoicePdfCoverBody } from './invoice-pdf-cover-body';
import { InvoicePdfCoverHeader } from './invoice-pdf-cover-header';
import { InvoicePdfReferenceBar } from './invoice-pdf-reference-bar';
import { InvoicePdfFooter } from './invoice-pdf-footer';
import { styles } from './pdf-styles';
import { parseTripMetaSnapshot } from '@/features/invoices/lib/trip-meta-snapshot';
import { fitSenderLine } from './resolve-sender-font-size';
import { resolvePdfColumnProfile } from '@/features/invoices/lib/resolve-pdf-column-profile';
import { parseClientReferenceFieldsSnapshot } from '@/features/clients/lib/client-reference-fields.schema';

/** Avoid spamming console when the same invoice PDF re-renders. */
const legacyMissingRecipientSnapshotWarned = new Set<string>();

export interface InvoicePdfDocumentProps {
  invoice: InvoiceDetail;
  /** PNG data URL from `qrcode` (EPC SCT payload); omit if IBAN missing or generation failed. */
  paymentQrDataUrl?: string | null;
  /** Optional intro text override from invoice_text_blocks */
  introText?: string | null;
  /** Optional outro text override from invoice_text_blocks */
  outroText?: string | null;
  /**
   * Builder preview: explicit column profile (usually matches invoice.column_profile).
   * Phase 6e: drives dynamic main/appendix columns; until then unused at render time.
   */
  columnProfile?: PdfColumnProfile | null;
}

function priceResolutionFromLineItem(
  li: InvoiceDetail['line_items'][number]
): PriceResolution {
  const snap = li.price_resolution_snapshot;
  if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
    const o = snap as Record<string, unknown>;
    const unit =
      typeof o.unit_price_net === 'number' ? o.unit_price_net : li.unit_price;
    const qty = typeof o.quantity === 'number' ? o.quantity : li.quantity;
    const net = typeof o.net === 'number' ? o.net : null;
    const gross = typeof o.gross === 'number' ? o.gross : null;
    const tr = typeof o.tax_rate === 'number' ? o.tax_rate : li.tax_rate;
    const su = o.strategy_used;
    const src = o.source;
    const af = o.approach_fee_net;
    const approachFromSnap =
      typeof af === 'number' && !Number.isNaN(af) ? af : undefined;
    return {
      gross,
      net,
      tax_rate: tr,
      strategy_used: (typeof su === 'string'
        ? su
        : li.pricing_strategy_used) as PriceResolution['strategy_used'],
      source: (typeof src === 'string'
        ? src
        : li.pricing_source) as PriceResolution['source'],
      note: typeof o.note === 'string' ? o.note : undefined,
      unit_price_net: unit,
      quantity: qty,
      approach_fee_net: approachFromSnap ?? li.approach_fee_net ?? undefined
    };
  }
  const u = li.unit_price;
  const q = li.quantity;
  const netTotal = Math.round(u * q * 100) / 100;
  const approach = li.approach_fee_net ?? 0;
  return {
    gross: Math.round((netTotal + approach) * (1 + li.tax_rate) * 100) / 100,
    net: netTotal,
    tax_rate: li.tax_rate,
    strategy_used: (li.pricing_strategy_used ??
      'trip_price_fallback') as PriceResolution['strategy_used'],
    source: (li.pricing_source ?? 'trip_price') as PriceResolution['source'],
    unit_price_net: u,
    quantity: q,
    approach_fee_net: li.approach_fee_net ?? undefined
  };
}

export function InvoicePdfDocument({
  invoice,
  paymentQrDataUrl = null,
  introText = null,
  outroText = null,
  columnProfile: columnProfileProp = null
}: InvoicePdfDocumentProps) {
  const effectiveProfile =
    columnProfileProp ??
    invoice.column_profile ??
    resolvePdfColumnProfile(null, null, null);

  const cp = invoice.company_profile;
  const payer = invoice.payer;
  const client = invoice.client;

  const resolvedIntroText = introText ?? invoice.intro_block?.content ?? null;
  const resolvedOutroText = outroText ?? invoice.outro_block?.content ?? null;

  const isPerClientBilled = invoice.mode === 'per_client' && !!client;

  const recipientCompanyName = isPerClientBilled
    ? (client?.company_name?.trim() ?? '')
    : '';
  const recipientPersonName = isPerClientBilled
    ? `${client?.first_name || ''} ${client?.last_name || ''}`.trim()
    : (payer?.name ?? '—');
  const recipientName = recipientPersonName || recipientCompanyName || '—';

  const recipientStreet = isPerClientBilled ? client?.street : payer?.street;
  const recipientStreetNumber = isPerClientBilled
    ? client?.street_number
    : payer?.street_number;
  const recipientZipCode = isPerClientBilled
    ? client?.zip_code
    : payer?.zip_code;
  const recipientCity = isPerClientBilled ? client?.city : payer?.city;
  const recipientPhone = isPerClientBilled
    ? normalizeInvoiceRecipientPhone(client?.phone ?? null)
    : null;

  const customerNumber = isPerClientBilled
    ? (client?.customer_number ?? '')
    : (payer?.number ?? '');

  const snapPrimary = recipientFromRechnungsempfaengerSnapshot(
    invoice.rechnungsempfaenger_snapshot
  );
  const secondaryLegal =
    isPerClientBilled && !snapPrimary
      ? secondaryLegalFromSnapshot(invoice.rechnungsempfaenger_snapshot)
      : null;

  // Build salutation: priority 1) rechnungsempfaenger snapshot with anrede, 2) client greeting_style
  let salutation = salutationFromSnapshot(
    invoice.rechnungsempfaenger_snapshot,
    'Sehr geehrte Damen und Herren,'
  );

  // Fall back to client greeting_style if snapshot didn't provide a personalized salutation
  if (
    salutation === 'Sehr geehrte Damen und Herren,' &&
    isPerClientBilled &&
    !snapPrimary &&
    client?.last_name
  ) {
    if (client.greeting_style === 'Herr') {
      salutation = `Sehr geehrter Herr ${client.last_name},`;
    } else if (client.greeting_style === 'Frau') {
      salutation = `Sehr geehrte Frau ${client.last_name},`;
    }
  }

  const payerWindowRecipient = {
    companyName: '',
    personName: payer?.name ?? '—',
    displayName: payer?.name ?? '—',
    street: payer?.street ?? '',
    streetNumber: payer?.street_number ?? '',
    zipCode: payer?.zip_code ?? '',
    city: payer?.city ?? '',
    phone: null as string | null,
    addressLine2: null as string | null,
    anrede: null as string | null,
    abteilung: null as string | null,
    firstName: null as string | null,
    lastName: null as string | null
  };

  const clientWindowRecipient = {
    companyName: recipientCompanyName,
    personName: recipientPersonName,
    displayName: recipientName,
    street: client?.street ?? '',
    streetNumber: client?.street_number ?? '',
    zipCode: client?.zip_code ?? '',
    city: client?.city ?? '',
    phone: recipientPhone,
    addressLine2: null as string | null,
    anrede: null as string | null,
    abteilung: null as string | null,
    firstName: null as string | null,
    lastName: null as string | null
  };

  // Build recipient for Briefkopf using structured fields
  const briefkopfLines = buildBriefkopfLines(snapPrimary);

  const snapshotWindowRecipient = snapPrimary
    ? {
        // Use structured company name if available, otherwise empty
        companyName: snapPrimary.companyName || '',
        // Use firstName + lastName if available, otherwise displayName
        personName:
          [snapPrimary.firstName, snapPrimary.lastName]
            .filter(Boolean)
            .join(' ') || snapPrimary.displayName,
        displayName: snapPrimary.displayName,
        street: snapPrimary.street,
        streetNumber: snapPrimary.streetNumber,
        zipCode: snapPrimary.zipCode,
        city: snapPrimary.city,
        phone: snapPrimary.phone,
        addressLine2: snapPrimary.addressLine2,
        // Pass structured fields for proper Briefkopf formatting
        anrede: snapPrimary.anrede,
        abteilung: snapPrimary.abteilung,
        firstName: snapPrimary.firstName,
        lastName: snapPrimary.lastName
      }
    : null;

  if (
    !isPerClientBilled &&
    !snapPrimary &&
    invoice.id &&
    !legacyMissingRecipientSnapshotWarned.has(invoice.id)
  ) {
    legacyMissingRecipientSnapshotWarned.add(invoice.id);
    console.warn(
      '[InvoicePdf] rechnungsempfaenger_snapshot fehlt (monatlich/einzelne Fahrt) — Fallback auf Kostenträger-Adresse (Legacy).'
    );
  }

  let coverRecipient;
  if (isPerClientBilled) {
    // §14 UStG: frozen Rechnungsempfänger snapshot wins the window when present; else Fahrgast.
    coverRecipient = snapPrimary ? snapPrimary : clientWindowRecipient;
  } else {
    // §14 UStG: use frozen snapshot — never read live payer/client data for legal addressee
    coverRecipient = snapshotWindowRecipient ?? payerWindowRecipient;
  }

  const lineItemsForCalc: BuilderLineItem[] = invoice.line_items.map((li) => ({
    trip_id: li.trip_id,
    position: li.position,
    line_date: li.line_date,
    description: li.description,
    client_name: li.client_name,
    pickup_address: li.pickup_address,
    dropoff_address: li.dropoff_address,
    distance_km: li.distance_km,
    unit_price: li.unit_price,
    quantity: li.quantity,
    approach_fee_net: li.approach_fee_net ?? null,
    tax_rate: li.tax_rate,
    billing_variant_code: li.billing_variant_code,
    billing_variant_name: li.billing_variant_name,
    billing_type_name: li.billing_type_name ?? null,
    kts_document_applies: li.kts_override,
    no_invoice_warning: false,
    price_resolution: priceResolutionFromLineItem(li),
    kts_override: li.kts_override,
    trip_meta: parseTripMetaSnapshot(
      li.trip_meta_snapshot as Record<string, unknown> | null | undefined
    ),
    price_source: null,
    warnings: []
  }));

  const { subtotal, total, breakdown } =
    calculateInvoiceTotals(lineItemsForCalc);

  // grouped_by_billing_type: one summary row per Abrechnungsart + tax_rate combination
  // Splitting by tax_rate ensures no mixed-rate ambiguity — each row is always clean
  // Uses same InvoicePdfSummaryRow shape as grouped — no renderer changes needed
  const summaryItems =
    effectiveProfile.main_layout === 'single_row'
      ? [
          buildInvoicePdfSingleRow(
            invoice.line_items,
            [
              invoice.payer?.name ?? 'Abrechnung',
              `${formatInvoicePdfDate(invoice.period_from)} – ${formatInvoicePdfDate(invoice.period_to)}`
            ].join(' · ')
          )
        ]
      : effectiveProfile.main_layout === 'grouped_by_billing_type'
        ? buildInvoicePdfGroupedByBillingType(invoice.line_items)
        : buildInvoicePdfSummary(invoice).summaryItems;

  const dueDateMs =
    new Date(invoice.created_at).getTime() +
    invoice.payment_due_days * 86400000;
  const dueDateFormatted = formatInvoicePdfDate(
    new Date(dueDateMs).toISOString()
  );

  const senderOneLine = buildInvoicePdfSenderOneLine(cp);
  const senderFit = senderOneLine
    ? fitSenderLine(senderOneLine)
    : { line: '', fontSize: 7 };

  const referenceFieldsForPdf =
    parseClientReferenceFieldsSnapshot(
      invoice.client_reference_fields_snapshot ?? null
    ) ?? [];

  // Stornorechnung rows always set cancels_invoice_id (FK to the invoice they cancel).
  const isStorno = invoice.cancels_invoice_id != null;

  return (
    <Document
      title={
        isStorno
          ? `Stornorechnung ${invoice.invoice_number}`
          : invoice.invoice_number
      }
      author={cp?.legal_name ?? 'Taxigo'}
    >
      <Page size='A4' style={styles.page} wrap>
        <InvoicePdfCoverHeader
          companyProfile={cp}
          senderFit={senderFit}
          recipient={coverRecipient}
          secondaryLegalRecipient={secondaryLegal}
          invoiceNumber={invoice.invoice_number}
          invoiceCreatedAtIso={invoice.created_at}
          periodFromIso={invoice.period_from}
          periodToIso={invoice.period_to}
          customerNumber={customerNumber}
          isStorno={isStorno}
        />

        {referenceFieldsForPdf.length > 0 ? (
          <InvoicePdfReferenceBar fields={referenceFieldsForPdf} />
        ) : null}

        <InvoicePdfCoverBody
          invoiceNumber={invoice.invoice_number}
          salutation={salutation}
          paymentDueDays={invoice.payment_due_days}
          dueDateFormatted={dueDateFormatted}
          companyProfile={cp}
          paymentQrDataUrl={paymentQrDataUrl}
          invoice={invoice}
          columnProfile={effectiveProfile}
          summaryItems={summaryItems}
          subtotal={subtotal}
          total={total}
          breakdown={breakdown}
          introText={resolvedIntroText}
          outroText={resolvedOutroText}
          isStorno={isStorno}
          subjectSectionMarginTop={referenceFieldsForPdf.length > 0 ? 6 : 12}
        />

        <InvoicePdfFooter companyProfile={cp} notes={invoice.notes} />
      </Page>

      {/* appendix_is_landscape from resolvePdfColumnProfile when appendix_columns.length > 7 */}
      {effectiveProfile.main_layout === 'grouped_by_billing_type' ? (
        (() => {
          const groups = groupLineItemsByBillingType(invoice.line_items);
          const empty = groups
            .filter((g) => g.items.length === 0)
            .map((g) => g.label);
          if (empty.length && invoice.id) {
            console.warn(
              `[InvoicePdf] Leere Abrechnungsart-Gruppen im Anhang: ${empty.join(', ')} (invoice_id=${invoice.id})`
            );
          }
          return groups.map((group) => (
            <Page
              key={group.label}
              size={
                effectiveProfile.appendix_is_landscape ? A4_LANDSCAPE : 'A4'
              }
              style={
                effectiveProfile.appendix_is_landscape
                  ? styles.appendixPageLandscape
                  : styles.appendixPage
              }
              wrap
            >
              <InvoicePdfAppendix
                invoiceNumber={invoice.invoice_number}
                invoiceCreatedAtIso={invoice.created_at}
                lineItems={group.items.map((item, idx) => ({
                  ...item,
                  position: idx + 1
                }))}
                columnProfile={effectiveProfile}
                groupLabel={group.label}
              />

              <InvoicePdfFooter companyProfile={cp} notes={invoice.notes} />
            </Page>
          ));
        })()
      ) : (
        <Page
          size={effectiveProfile.appendix_is_landscape ? A4_LANDSCAPE : 'A4'}
          style={
            effectiveProfile.appendix_is_landscape
              ? styles.appendixPageLandscape
              : styles.appendixPage
          }
          wrap
        >
          <InvoicePdfAppendix
            invoiceNumber={invoice.invoice_number}
            invoiceCreatedAtIso={invoice.created_at}
            lineItems={invoice.line_items}
            columnProfile={effectiveProfile}
            mainLayout={effectiveProfile.main_layout}
          />

          <InvoicePdfFooter companyProfile={cp} notes={invoice.notes} />
        </Page>
      )}
    </Document>
  );
}
