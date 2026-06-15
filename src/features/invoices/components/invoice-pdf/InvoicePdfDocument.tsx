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

import { Document, Page, Text, View, Font } from '@react-pdf/renderer';

import { calculateInvoiceTotals } from '../../api/invoice-line-items.api';
import type {
  BuilderLineItem,
  CancelledTripRow,
  ExcludedTripRow,
  InvoiceDetail
} from '../../types/invoice.types';
import type { PdfColumnProfile } from '../../types/pdf-vorlage.types';
import type { PriceResolution } from '../../types/pricing.types';

import {
  buildInvoicePdfGroupedByBillingType,
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
import { InvoicePdfAppendixPages } from './invoice-pdf-appendix-pages';
import { InvoicePdfCoverBody } from './invoice-pdf-cover-body';
import {
  InvoicePdfCoverHeader,
  InvoicePdfRecipientBlock
} from './invoice-pdf-cover-header';
import { InvoicePdfCoverHeaderBrief } from './invoice-pdf-cover-header-brief';
import { InvoicePdfReferenceBar } from './invoice-pdf-reference-bar';
import { InvoicePdfFooter } from './invoice-pdf-footer';
import { PDF_COLORS, PDF_DRAFT_WATERMARK, styles } from './pdf-styles';
import type { PdfRenderMode } from '@/features/invoices/lib/pdf-layout-constants';
import {
  PDF_DIN5008,
  PDF_PAGE,
  PDF_ZONES
} from '@/features/invoices/lib/pdf-layout-constants';
import {
  billingIncludedLineItems,
  mainCoverLineItems
} from '@/features/invoices/lib/billing-inclusion';
import { computeInvoiceCoverKm } from '@/features/invoices/lib/compute-invoice-km';
import { parseTripMetaSnapshot } from '@/features/invoices/lib/trip-meta-snapshot';
import { fitSenderLine } from './resolve-sender-font-size';
import { resolvePdfColumnProfile } from '@/features/invoices/lib/resolve-pdf-column-profile';
import { parseClientReferenceFieldsSnapshot } from '@/features/clients/lib/client-reference-fields.schema';

/** Avoid spamming console when the same invoice PDF re-renders. */
const legacyMissingRecipientSnapshotWarned = new Set<string>();

// why: hyphenationCallback disables react-pdf automatic hyphenation globally — without it,
// long words like compound names break mid-word across lines. Document does not accept
// hyphenationCallback in @react-pdf/renderer 4.x; Font.registerHyphenationCallback is
// the supported global registration API (see react-pdf.org/fonts#registerhyphenationcallback).
if (Font.getHyphenationCallback() === null) {
  Font.registerHyphenationCallback((word) => [word]);
}

export interface InvoicePdfDocumentProps {
  invoice: InvoiceDetail;
  /** PNG data URL from `qrcode` (EPC SCT payload); omit if IBAN missing or generation failed. */
  paymentQrDataUrl?: string | null;
  /** Optional intro text override from invoice_text_blocks */
  introText?: string | null;
  /** Optional outro text override from invoice_text_blocks */
  outroText?: string | null;
  // 'brief' triggers DIN 5008 fold marks + fixed header zone. Not yet implemented — falls back to digital with console.warn. Split download button (Digital / Als Brief) enabled once Brief mode is ready.
  renderMode?: PdfRenderMode;
  /**
   * Builder preview: explicit column profile (usually matches invoice.column_profile).
   * Phase 6e: drives dynamic main/appendix columns; until then unused at render time.
   */
  columnProfile?: PdfColumnProfile | null;
  /**
   * Passive cancelled trips (opted-out, €0) for the Stornierte Fahrten appendix block.
   * Gated by `show_cancelled_trips` profile flag.
   * TODO(issued-cancelled-rows): populate from scoped trips fetch for issued invoices.
   */
  cancelledTrips?: CancelledTripRow[];
  /**
   * Opted-out normal trips with exclusion reasons — gated by `show_excluded_trips` profile flag.
   * Builder preview only.
   */
  excludedTrips?: ExcludedTripRow[];
  /**
   * When true, stamps a diagonal "ENTWURF" watermark on every page so a draft PDF
   * can never be mistaken for an issued invoice. Defaults to false so all existing
   * (non-draft) callers render byte-identically to before.
   */
  showDraftWatermark?: boolean;
}

/**
 * Full-page diagonal "ENTWURF" stamp. `fixed` makes @react-pdf repeat it on every
 * wrapped page of the Page it lives in, so multi-page covers/appendices are all
 * watermarked. Rendered first inside each Page so it paints under the content.
 */
function DraftWatermark() {
  return (
    <View style={styles.draftWatermark} fixed>
      <Text style={styles.draftWatermarkText}>{PDF_DRAFT_WATERMARK.label}</Text>
    </View>
  );
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
  renderMode = 'digital',
  columnProfile: columnProfileProp = null,
  cancelledTrips = [],
  excludedTrips = [],
  showDraftWatermark = false
}: InvoicePdfDocumentProps) {
  // Two render paths: 'digital' keeps the existing flow-based header; 'brief' pins the recipient window at 127pt and adds fold marks (Path C: separate Brief header + page-level address window).
  const effectiveProfile =
    columnProfileProp ??
    invoice.column_profile ??
    resolvePdfColumnProfile(null, null, null);

  // why: passive €0 list is still gated by show_cancelled_trips (unchanged semantics)
  const cancelledRowsForPdf: CancelledTripRow[] =
    effectiveProfile.show_cancelled_trips && cancelledTrips.length > 0
      ? cancelledTrips
      : [];
  // why: excluded trips appendix gated by show_excluded_trips
  const excludedRowsForPdf: ExcludedTripRow[] =
    effectiveProfile.show_excluded_trips && excludedTrips.length > 0
      ? excludedTrips
      : [];

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
    // Forward client salutation so Anrede renders in the header recipient block
    anrede: client?.greeting_style ?? null,
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

  // why: Haupttabelle must show only billing-included normal trips — opted-out rows keep price/km
  // snapshots for audit but must not affect cover summary; cancelled billed rows belong in the
  // Stornierte appendix only (see mainCoverLineItems in billing-inclusion.ts).
  const mainLineItems = mainCoverLineItems(invoice.line_items);

  // why: cover KM buckets are derived from the FULL snapshot array (including opted-out and
  // cancelled rows) so the helper can separate normal vs cancelled-billed km correctly.
  // Pre-filtering with mainCoverLineItems would lose the cancelled bucket entirely (K3).
  const { normalBilledKm, cancelledBilledKm } = computeInvoiceCoverKm(
    invoice.line_items
  );

  // Fahrtendetails appendix: all billing-included rows (normal + opted-in cancelled), sorted by date.
  // Opted-in cancelled trips (is_cancelled_trip = true, billing_included = true) slot in by their
  // trip date alongside normal trips — renderLineItemRow adds the amber billing-reason sub-row.
  const appendixLineItems = billingIncludedLineItems(invoice.line_items).sort(
    (a, b) => {
      if (!a.line_date && !b.line_date) return 0;
      if (!a.line_date) return 1;
      if (!b.line_date) return -1;
      return a.line_date.localeCompare(b.line_date);
    }
  );

  // Exclude opted-out lines so PDF footer matches builder totals
  const lineItemsForCalc: BuilderLineItem[] = billingIncludedLineItems(
    invoice.line_items
  ).map((li) => ({
    trip_id: li.trip_id,
    position: li.position,
    line_date: li.line_date,
    description: li.description,
    client_name: li.client_name,
    pickup_address: li.pickup_address,
    dropoff_address: li.dropoff_address,
    distance_km: li.distance_km,
    effective_distance_km: li.effective_distance_km ?? li.distance_km,
    original_distance_km: li.original_distance_km ?? li.distance_km,
    manual_km_enabled: false,
    unit_price: li.unit_price,
    quantity: li.quantity,
    approach_fee_net: li.approach_fee_net ?? null,
    tax_rate: li.tax_rate,
    billing_variant_code: li.billing_variant_code,
    billing_variant_name: li.billing_variant_name,
    billing_type_name: li.billing_type_name ?? null,
    kts_document_applies: li.kts_override,
    no_invoice_warning: false,
    is_wheelchair: false,
    price_resolution: priceResolutionFromLineItem(li),
    kts_override: li.kts_override,
    trip_meta: parseTripMetaSnapshot(
      li.trip_meta_snapshot as Record<string, unknown> | null | undefined
    ),
    price_source: null,
    warnings: [],
    billingInclusion: {
      included: li.billing_included ?? true,
      reason: li.billing_exclusion_reason ?? ''
    }
  }));

  const { subtotal, total, breakdown } =
    calculateInvoiceTotals(lineItemsForCalc);

  // grouped_by_billing_type: one summary row per Abrechnungsfamilie + tax_rate (see invoicePdfBillingCategoryLabel)
  // Splitting by tax_rate ensures no mixed-rate ambiguity — each row is always clean
  // Uses same InvoicePdfSummaryRow shape as grouped — no renderer changes needed
  const summaryItems =
    effectiveProfile.main_layout === 'single_row'
      ? [
          buildInvoicePdfSingleRow(
            mainLineItems,
            [
              invoice.payer?.name ?? 'Abrechnung',
              `${formatInvoicePdfDate(invoice.period_from)} – ${formatInvoicePdfDate(invoice.period_to)}`
            ].join(' · ')
          )
        ]
      : effectiveProfile.main_layout === 'grouped_by_billing_type'
        ? buildInvoicePdfGroupedByBillingType(mainLineItems)
        : buildInvoicePdfSummary({ ...invoice, line_items: mainLineItems })
            .summaryItems;

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
        {showDraftWatermark ? <DraftWatermark /> : null}
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
              <InvoicePdfRecipientBlock
                recipient={coverRecipient}
                secondaryLegalRecipient={secondaryLegal}
              />
            </View>
          </>
        ) : null}

        {/* Path C (chosen over A/B): keep digital header stable and enforce DIN geometry at the Page level via a dedicated Brief header + absolutely positioned address window. */}
        {renderMode === 'brief' ? (
          <InvoicePdfCoverHeaderBrief
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
            renderMode={renderMode}
          />
        ) : (
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
            renderMode={renderMode}
          />
        )}

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
          subjectSectionMarginTop={
            referenceFieldsForPdf.length > 0
              ? PDF_ZONES.subjectMarginTopWithReferenceBar
              : PDF_ZONES.subjectMarginTopOffer // shared 12pt spacing: invoice no-reference-bar matches offer fixed separation
          }
          renderMode={renderMode}
          normalBilledKm={normalBilledKm}
          cancelledBilledKm={cancelledBilledKm}
          showCancelledBilledKmOnCover={
            effectiveProfile.show_cancelled_billed_km_on_cover
          }
          showNormalBilledKmOnCover={
            effectiveProfile.show_normal_billed_km_on_cover
          }
        />

        <InvoicePdfFooter companyProfile={cp} notes={invoice.notes} />
      </Page>

      {/* why: cancelledTrips/excludedTrips are appendix-only — gating stays here, consumption in InvoicePdfAppendixPages */}
      <InvoicePdfAppendixPages
        appendixLineItems={appendixLineItems}
        cancelledTrips={cancelledRowsForPdf}
        excludedTrips={excludedRowsForPdf}
        effectiveProfile={effectiveProfile}
        showDraftWatermark={showDraftWatermark}
        companyProfile={cp}
        notes={invoice.notes}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        invoiceCreatedAtIso={invoice.created_at}
      />
    </Document>
  );
}
