/**
 * invoice-pdf-appendix-pages.tsx
 *
 * Owns all appendix `<Page>` shells (Fahrtendetails, passive Stornierte, Ausgeschlossene).
 * Extracted from InvoicePdfDocument so cancelledTrips/excludedTrips are consumed here only
 * and ~130 lines of duplicated watermark + footer boilerplate leave the root orchestrator.
 *
 * No React.memo — @react-pdf/renderer layout runs outside React's reconciler; memo has no
 * effect inside a `<Document>` tree.
 *
 * ── Rendering parity invariants (manual trace) ───────────────────────────────
 *
 * Scenario A — grouped_by_billing_type, 2 billing groups, landscape appendix,
 * showDraftWatermark true:
 *   → 2 appendix Pages, each: DraftWatermark + InvoicePdfAppendix (groupLabel) + Footer.
 *
 * Scenario B — single Fahrtendetails page, cancelledTrips.length > 0 (parent already gated
 * show_cancelled_trips):
 *   → 1 Fahrtendetails Page + 1 Stornierte Fahrten Page.
 *
 * Scenario C — excludedTrips non-empty at source but parent passes [] because
 * show_excluded_trips is false on effectiveProfile:
 *   → Fahrtendetails page(s) only; no Ausgeschlossene Page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Page, Text, View } from '@react-pdf/renderer';

import type {
  CancelledTripRow,
  ExcludedTripRow,
  InvoiceDetail
} from '../../types/invoice.types';
import type { PdfColumnProfile } from '../../types/pdf-vorlage.types';

import { groupLineItemsByBillingType } from './lib/build-invoice-pdf-summary';
import { A4_LANDSCAPE, InvoicePdfAppendix } from './invoice-pdf-appendix';
import { InvoicePdfFooter } from './invoice-pdf-footer';
import { PDF_DRAFT_WATERMARK, styles } from './pdf-styles';

export interface InvoicePdfAppendixPagesProps {
  appendixLineItems: InvoiceDetail['line_items'];
  /** Already gated by show_cancelled_trips in parent — passive €0 rows only */
  cancelledTrips: CancelledTripRow[];
  /** Already gated by show_excluded_trips in parent */
  excludedTrips: ExcludedTripRow[];
  effectiveProfile: PdfColumnProfile;
  showDraftWatermark: boolean;
  companyProfile: InvoiceDetail['company_profile'];
  notes: string | null;
  /** Null in draft preview synthetic InvoiceDetail — console.warn guard checks truthiness */
  invoiceId: string | null;
  invoiceNumber: string;
  invoiceCreatedAtIso: string;
}

/** Duplicated from InvoicePdfDocument — cover page still needs its own copy (3-file refactor scope). */
function DraftWatermark() {
  return (
    <View style={styles.draftWatermark} fixed>
      <Text style={styles.draftWatermarkText}>{PDF_DRAFT_WATERMARK.label}</Text>
    </View>
  );
}

export function InvoicePdfAppendixPages({
  appendixLineItems,
  cancelledTrips,
  excludedTrips,
  effectiveProfile,
  showDraftWatermark,
  companyProfile,
  notes,
  invoiceId,
  invoiceNumber,
  invoiceCreatedAtIso
}: InvoicePdfAppendixPagesProps) {
  return (
    <>
      {/* appendix_is_landscape from resolvePdfColumnProfile when appendix_columns.length > 7 */}
      {effectiveProfile.main_layout === 'grouped_by_billing_type' ? (
        (() => {
          // why: appendixLineItems includes opted-in cancelled rows (is_cancelled_trip = true,
          // billing_included = true) so they appear in the correct billing-type group,
          // sorted by date. renderLineItemRow adds the amber billing-reason sub-row.
          const groups = groupLineItemsByBillingType(appendixLineItems);
          const empty = groups
            .filter((g) => g.items.length === 0)
            .map((g) => g.label);
          if (empty.length && invoiceId) {
            console.warn(
              `[InvoicePdf] Leere Abrechnungsart-Gruppen im Anhang: ${empty.join(', ')} (invoice_id=${invoiceId})`
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
              {showDraftWatermark ? <DraftWatermark /> : null}
              <InvoicePdfAppendix
                invoiceNumber={invoiceNumber}
                invoiceCreatedAtIso={invoiceCreatedAtIso}
                lineItems={group.items.map((item, idx) => ({
                  ...item,
                  position: idx + 1
                }))}
                columnProfile={effectiveProfile}
                groupLabel={group.label}
              />

              <InvoicePdfFooter companyProfile={companyProfile} notes={notes} />
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
          {showDraftWatermark ? <DraftWatermark /> : null}
          <InvoicePdfAppendix
            invoiceNumber={invoiceNumber}
            invoiceCreatedAtIso={invoiceCreatedAtIso}
            lineItems={appendixLineItems}
            columnProfile={effectiveProfile}
            mainLayout={effectiveProfile.main_layout}
          />

          <InvoicePdfFooter companyProfile={companyProfile} notes={notes} />
        </Page>
      )}

      {/*
        Appendix 2: passive cancelled trips (Stornierte Fahrten) — own page.
        Gated by show_cancelled_trips. Opted-in cancelled rows are already in
        appendixLineItems above; this page is the passive €0 transparency list only.
        TODO(issued-cancelled-rows): populate cancelledTrips from scoped fetch for issued invoices.
       */}
      {cancelledTrips.length > 0 ? (
        <Page
          size={
            (effectiveProfile.appendix_is_landscape ?? false)
              ? A4_LANDSCAPE
              : 'A4'
          }
          style={
            (effectiveProfile.appendix_is_landscape ?? false)
              ? styles.appendixPageLandscape
              : styles.appendixPage
          }
          wrap
        >
          {showDraftWatermark ? <DraftWatermark /> : null}
          <InvoicePdfAppendix
            invoiceNumber={invoiceNumber}
            invoiceCreatedAtIso={invoiceCreatedAtIso}
            lineItems={[]}
            columnProfile={effectiveProfile}
            cancelledTrips={cancelledTrips}
            groupLabel='Stornierte Fahrten'
            // why: Cancelled section follows the same orientation as the main appendix —
            // controlled by the payer's PDF Vorlage, not hardcoded.
            cancelledLandscape={effectiveProfile.appendix_is_landscape ?? false}
          />

          <InvoicePdfFooter companyProfile={companyProfile} notes={notes} />
        </Page>
      ) : null}

      {/*
        Appendix 3: excluded trips (Ausgeschlossene Fahrten) — own independent page.
        Gated by show_excluded_trips. Independent of Stornierte Fahrten to ensure
        the section title renders at top-level heading hierarchy, not as a sub-section.
       */}
      {excludedTrips.length > 0 ? (
        <Page
          size={effectiveProfile.appendix_is_landscape ? A4_LANDSCAPE : 'A4'}
          style={
            effectiveProfile.appendix_is_landscape
              ? styles.appendixPageLandscape
              : styles.appendixPage
          }
          wrap
        >
          {showDraftWatermark ? <DraftWatermark /> : null}
          <InvoicePdfAppendix
            invoiceNumber={invoiceNumber}
            invoiceCreatedAtIso={invoiceCreatedAtIso}
            lineItems={[]}
            columnProfile={effectiveProfile}
            excludedTrips={excludedTrips}
            groupLabel='Ausgeschlossene Fahrten'
          />

          <InvoicePdfFooter companyProfile={companyProfile} notes={notes} />
        </Page>
      ) : null}
    </>
  );
}
