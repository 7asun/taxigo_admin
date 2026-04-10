/**
 * build-draft-invoice-detail-for-pdf.ts
 *
 * Constructs a partial InvoiceDetail object from in-progress builder state
 * (Sections 3–5) for use in the live PDF preview. This draft is never persisted —
 * it exists only to feed InvoicePdfDocument while the dispatcher is still filling
 * in the form.
 *
 * Key difference from a real InvoiceDetail:
 * - invoice_number is a placeholder until createInvoice runs
 * - line_items come from BuilderLineItem[] (not from the DB)
 * - column_profile comes from the builder’s Section 4 (PDF-Vorlage) state
 *
 * Must not write to the database or mutate builder inputs.
 *
 * Phase 6e: InvoicePdfDocument will use column_profile to render dynamic columns.
 * Until then, the PDF keeps static columns and may ignore column_profile.
 */

import { rechnungsempfaengerRowToSnapshot } from '@/features/rechnungsempfaenger/api/rechnungsempfaenger.service';
import type { RechnungsempfaengerRow } from '@/features/rechnungsempfaenger/api/rechnungsempfaenger.service';
import {
  calculateInvoiceTotals,
  frozenPriceResolutionForInsert
} from '@/features/invoices/api/invoice-line-items.api';
import type {
  BuilderLineItem,
  InvoiceDetail,
  InvoiceLineItemRow,
  InvoiceMode
} from '@/features/invoices/types/invoice.types';
import type { PdfColumnProfile } from '@/features/invoices/types/pdf-vorlage.types';
import { parseClientReferenceFieldsFromDb } from '@/features/clients/lib/client-reference-fields.schema';

export interface InvoiceBuilderStep2Snapshot {
  mode: InvoiceMode;
  payer_id: string;
  billing_type_id: string | null;
  billing_variant_id: string | null;
  period_from: string;
  period_to: string;
  client_id: string | null;
}

function builderItemToDraftLineItem(item: BuilderLineItem): InvoiceLineItemRow {
  const frozen = frozenPriceResolutionForInsert(item);
  const u = item.unit_price ?? 0;
  const q = item.quantity;
  return {
    id: `draft-li-${item.position}`,
    invoice_id: '__draft__',
    trip_id: item.trip_id,
    position: item.position,
    line_date: item.line_date,
    description: item.description,
    client_name: item.client_name,
    pickup_address: item.pickup_address,
    dropoff_address: item.dropoff_address,
    distance_km: item.distance_km,
    unit_price: u,
    quantity: q,
    approach_fee_net: item.approach_fee_net ?? null,
    total_price:
      Math.round(
        (u * q + (item.approach_fee_net ?? 0)) * (1 + item.tax_rate) * 100
      ) / 100,
    tax_rate: item.tax_rate,
    billing_variant_code: item.billing_variant_code,
    billing_variant_name: item.billing_variant_name,
    billing_type_name: item.billing_type_name,
    created_at: new Date().toISOString(),
    pricing_strategy_used: frozen.strategy_used,
    pricing_source: frozen.source,
    kts_override: item.kts_override,
    price_resolution_snapshot: frozen as unknown as Record<string, unknown>,
    trip_meta_snapshot: item.trip_meta
      ? (item.trip_meta as unknown as Record<string, unknown>)
      : null
  };
}

/**
 * Builds a synthetic invoice row for @react-pdf preview from builder state.
 *
 * @param params.companyId — tenant scope
 * @param params.columnProfile — resolved PDF columns from Section 4; always stored on the draft
 * @returns InvoiceDetail-shaped object safe for InvoicePdfDocument (not persisted)
 */
export function buildDraftInvoiceDetailForPdf(params: {
  companyId: string;
  companyProfile: InvoiceDetail['company_profile'];
  step2: InvoiceBuilderStep2Snapshot;
  lineItems: BuilderLineItem[];
  payers: NonNullable<InvoiceDetail['payer']>[];
  clients: NonNullable<InvoiceDetail['client']>[];
  paymentDueDays: number;
  introText: string | null;
  outroText: string | null;
  recipientRow: RechnungsempfaengerRow | null | undefined;
  placeholderInvoiceNumber: string;
  /**
   * Resolved PdfColumnProfile for this draft — same object the real invoice will
   * carry after create (unless overridden again server-side).
   */
  columnProfile: PdfColumnProfile;
}): InvoiceDetail {
  const {
    companyId,
    companyProfile,
    step2,
    lineItems,
    payers,
    clients,
    paymentDueDays,
    introText,
    outroText,
    recipientRow,
    placeholderInvoiceNumber,
    columnProfile
  } = params;

  const { subtotal, taxAmount, total } = calculateInvoiceTotals(lineItems);
  const now = new Date().toISOString();

  const payer =
    payers.find((p) => p.id === step2.payer_id) ??
    ({
      id: step2.payer_id,
      name: '—',
      number: '',
      street: null,
      street_number: null,
      zip_code: null,
      city: null,
      contact_person: null,
      email: null
    } as NonNullable<InvoiceDetail['payer']>);

  const client =
    step2.mode === 'per_client' && step2.client_id
      ? (clients.find((c) => c.id === step2.client_id) ??
        ({
          id: step2.client_id,
          first_name: null,
          last_name: null,
          company_name: null,
          greeting_style: null,
          customer_number: null,
          street: '',
          street_number: '',
          zip_code: '',
          city: '',
          email: null,
          phone: null
        } as NonNullable<InvoiceDetail['client']>))
      : null;

  const snap = recipientRow
    ? rechnungsempfaengerRowToSnapshot(recipientRow)
    : null;

  const clientReferenceFieldsSnapshot =
    step2.client_id && client
      ? parseClientReferenceFieldsFromDb(client.reference_fields ?? null)
      : null;

  const draftLineItems = lineItems.map(builderItemToDraftLineItem);

  const base = {
    id: '__pdf_preview__',
    company_id: companyId,
    invoice_number: placeholderInvoiceNumber,
    payer_id: step2.payer_id,
    billing_type_id: step2.billing_type_id,
    billing_variant_id: step2.billing_variant_id,
    mode: step2.mode,
    client_id: step2.client_id,
    period_from: step2.period_from,
    period_to: step2.period_to,
    status: 'draft' as const,
    subtotal,
    tax_amount: taxAmount,
    total,
    notes: null,
    email_subject: null,
    email_body: null,
    payment_due_days: paymentDueDays,
    created_by: null,
    created_at: now,
    updated_at: null,
    sent_at: null,
    paid_at: null,
    cancelled_at: null,
    cancels_invoice_id: null,
    rechnungsempfaenger_id: recipientRow?.id ?? null,
    rechnungsempfaenger_snapshot: snap,
    client_reference_fields_snapshot: clientReferenceFieldsSnapshot,
    payer,
    client,
    line_items: draftLineItems,
    company_profile: companyProfile,
    intro_block: introText ? { id: 'preview-intro', content: introText } : null,
    outro_block: outroText ? { id: 'preview-outro', content: outroText } : null,
    // column_profile: Section 4 resolved profile for preview (Phase 6e table layout).
    column_profile: columnProfile
  };

  return base as InvoiceDetail;
}
