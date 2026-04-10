/**
 * invoices.api.ts
 *
 * Supabase API service for the `invoices` table.
 *
 * Responsibilities:
 *   - List invoices (with optional status/payer/date filters)
 *   - Fetch a single invoice with joins (payer, company_profile, line items)
 *   - Create a new invoice (header row only — line items inserted separately)
 *   - Update invoice status (sent, paid, cancelled)
 *
 * Design rules:
 *   - Never compute totals here — that happens in invoice-line-items.api.ts
 *   - Always throw on error (React Query catches and surfaces via isError)
 *   - All timestamps stored as ISO strings (Supabase default)
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

import { getZonedDayBoundsIso } from '@/features/trips/lib/trip-business-date';
import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { generateNextInvoiceNumber } from '../lib/invoice-number';
import {
  RechnungsempfaengerService,
  rechnungsempfaengerRowToSnapshot
} from '@/features/rechnungsempfaenger/api/rechnungsempfaenger.service';
import { parseClientReferenceFieldsFromDb } from '@/features/clients/lib/client-reference-fields.schema';
import type {
  InvoiceRow,
  InvoiceWithPayer,
  InvoiceDetail,
  InvoiceStatus,
  InvoiceBuilderFormValues
} from '../types/invoice.types';

// ─── List invoices ────────────────────────────────────────────────────────────

export interface InvoiceListParams {
  status?: InvoiceStatus;
  payer_id?: string;
  /** Inclusive start of `created_at` filter (`yyyy-MM-dd`, interpreted in trips business TZ). */
  from?: string;
  /** Inclusive end of `created_at` filter (`yyyy-MM-dd`, same TZ). */
  to?: string;
}

/**
 * Fetches a paginated list of invoices with payer name joined.
 * Used in the invoice list table (/dashboard/invoices).
 *
 * @param params - Optional filters for status, payer, and **Erstellungsdatum** (`created_at`, business TZ).
 */
export async function listInvoices(
  params: InvoiceListParams = {}
): Promise<InvoiceWithPayer[]> {
  const supabase = createClient();

  let query = supabase
    .from('invoices')
    .select(
      `
      *,
      payer:payers(id, name, number),
      client:clients(
        id, first_name, last_name, company_name, greeting_style, customer_number,
        street, street_number, zip_code, city, email, phone, reference_fields
      )
    `
    )
    .order('created_at', { ascending: false });

  // Apply optional filters
  if (params.status) {
    query = query.eq('status', params.status);
  }
  if (params.payer_id) {
    query = query.eq('payer_id', params.payer_id);
  }
  // Presets (“Diese Woche”, “Dieser Monat”, …) match user expectation: **when the row was created**,
  // not the invoice’s Leistungszeitraum (`period_*` — still shown in the “Zeitraum” column).
  if (params.from && params.to) {
    const { startISO } = getZonedDayBoundsIso(params.from);
    const { endExclusiveISO } = getZonedDayBoundsIso(params.to);
    query = query.gte('created_at', startISO);
    query = query.lt('created_at', endExclusiveISO);
  } else if (params.from) {
    const { startISO } = getZonedDayBoundsIso(params.from);
    query = query.gte('created_at', startISO);
  } else if (params.to) {
    const { endExclusiveISO } = getZonedDayBoundsIso(params.to);
    query = query.lt('created_at', endExclusiveISO);
  }

  const { data, error } = await query;

  if (error) throw toQueryError(error);
  return (data ?? []) as InvoiceWithPayer[];
}

// ─── Single invoice (full detail) ─────────────────────────────────────────────

/**
 * Fetches the full invoice detail: header + payer + line items + company profile.
 *
 * Used on the invoice detail page (/dashboard/invoices/[id]) and for PDF generation.
 * The company_profile is joined via a nested select from company_profiles.
 *
 * @param id - Invoice UUID.
 * @throws   If the invoice is not found or the query fails.
 */
export async function getInvoiceDetail(id: string): Promise<InvoiceDetail> {
  const supabase = createClient();

  // Line items: use (*) so PostgREST does not fail when optional columns (e.g. trip_meta_snapshot)
  // are not migrated yet; after migration, (*) still returns those fields.
  const { data, error } = await supabase
    .from('invoices')
    .select(
      `
      *,
      payer:payers(
        id, name, number,
        street, street_number, zip_code, city, contact_person, email,
        pdf_vorlage_id
      ),
      client:clients(
        id, first_name, last_name, company_name, greeting_style, customer_number,
        street, street_number, zip_code, city, email, phone, reference_fields
      ),
      line_items:invoice_line_items(*)
    `
    )
    .eq('id', id)
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error(`Rechnung ${id} nicht gefunden`);

  // Fetch company profile separately using the invoice's company_id
  const { data: profile } = await supabase
    .from('company_profiles')
    .select(
      `
        legal_name, street, street_number, zip_code, city,
        tax_id, vat_id, bank_name, bank_iban, bank_bic,
        logo_path, logo_url, slogan, phone, inhaber, email, website,
        default_payment_days
      `
    )
    .eq('company_id', data.company_id)
    .single();

  // Combine and sort line items by position for consistent PDF output
  const detail = {
    ...data,
    company_profile: profile
  } as unknown as InvoiceDetail;

  if (detail.line_items) {
    detail.line_items.sort((a, b) => a.position - b.position);
  }

  // Fetch text block content for PDF generation
  if (detail.intro_block_id) {
    const { data: introBlock } = await supabase
      .from('invoice_text_blocks')
      .select('id, content')
      .eq('id', detail.intro_block_id)
      .single();
    if (introBlock) {
      detail.intro_block = introBlock;
    }
  }

  if (detail.outro_block_id) {
    const { data: outroBlock } = await supabase
      .from('invoice_text_blocks')
      .select('id, content')
      .eq('id', detail.outro_block_id)
      .single();
    if (outroBlock) {
      detail.outro_block = outroBlock;
    }
  }

  return detail;
}

// ─── Create invoice ───────────────────────────────────────────────────────────

export interface CreateInvoicePayload {
  companyId: string;
  formValues: InvoiceBuilderFormValues;
  /** Pre-calculated totals from the line items. */
  subtotal: number;
  taxAmount: number;
  total: number;
  /** Resolved recipient FK (catalog cascade or step-4 override); snapshot frozen here. */
  rechnungsempfaengerId: string | null;
  /**
   * Per-invoice PDF column override (Step 5). Null = resolve from payer Vorlage /
   * company default / system fallback at PDF time.
   */
  pdfColumnOverride?: Record<string, unknown> | null;
}

/**
 * Creates a new invoice header row in the `invoices` table.
 *
 * IMPORTANT: Line items must be inserted AFTER calling this function
 * using insertLineItems() from invoice-line-items.api.ts.
 *
 * The invoice number is auto-generated using the sequential RE-YYYY-MM-NNNN
 * format (sequence resets each calendar month).
 * If the insert fails with a unique-constraint violation on invoice_number,
 * callers should retry once (race condition if two invoices are created simultaneously).
 *
 * @returns The newly created invoice row.
 */
export async function createInvoice(
  payload: CreateInvoicePayload
): Promise<InvoiceRow> {
  const supabase = createClient();

  // Generate the next sequential invoice number
  const invoiceNumber = await generateNextInvoiceNumber();

  const empId = payload.rechnungsempfaengerId;
  // §14 UStG: snapshot frozen at invoice creation — never mutate after this point
  let rechnungsempfaenger_snapshot: Record<string, unknown> | null = null;
  if (empId) {
    const row = await RechnungsempfaengerService.getById(empId);
    if (row) {
      rechnungsempfaenger_snapshot = rechnungsempfaengerRowToSnapshot(row);
    }
  }

  // §14 UStG: Bezugszeichen frozen at creation from clients.reference_fields (same moment as line items).
  // Source: live clients row at insert time — PDF must never re-read client.reference_fields for issued docs.
  let client_reference_fields_snapshot: ReturnType<
    typeof parseClientReferenceFieldsFromDb
  > = null;
  const clientId = payload.formValues.client_id;
  if (clientId) {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('reference_fields')
      .eq('id', clientId)
      .maybeSingle();
    client_reference_fields_snapshot = parseClientReferenceFieldsFromDb(
      clientRow?.reference_fields ?? null
    );
  }

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      company_id: payload.companyId,
      invoice_number: invoiceNumber,
      payer_id: payload.formValues.payer_id,
      billing_type_id: payload.formValues.billing_type_id,
      // Set when the invoice is scoped to exactly one Unterart (billing_variants.id); NULL otherwise.
      billing_variant_id: payload.formValues.billing_variant_id ?? null,
      mode: payload.formValues.mode,
      client_id: payload.formValues.client_id,
      period_from: payload.formValues.period_from,
      period_to: payload.formValues.period_to,
      intro_block_id: payload.formValues.intro_block_id,
      outro_block_id: payload.formValues.outro_block_id,
      payment_due_days: payload.formValues.payment_due_days,
      subtotal: payload.subtotal,
      tax_amount: payload.taxAmount,
      total: payload.total,
      status: 'draft', // always starts as draft
      rechnungsempfaenger_id: empId,
      // §14 UStG: snapshot frozen at invoice creation — never mutate after this point
      rechnungsempfaenger_snapshot,
      client_reference_fields_snapshot,
      pdf_column_override: payload.pdfColumnOverride ?? null
    })
    .select()
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error('Rechnung konnte nicht erstellt werden');

  return data as unknown as InvoiceRow;
}

// ─── Update invoice status ─────────────────────────────────────────────────────

export type InvoiceStatusTransition = 'sent' | 'paid' | 'cancelled';

/**
 * Updates the status of an invoice and sets the corresponding lifecycle timestamp.
 *
 * Status transitions:
 *   draft → sent      (marks sent_at)
 *   sent  → paid      (marks paid_at)
 *   sent  → cancelled (marks cancelled_at; caller should also create Stornorechnung)
 *
 * @param id     - Invoice UUID.
 * @param status - The new status to transition to.
 */
export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatusTransition
): Promise<InvoiceRow> {
  const supabase = createClient();
  const now = new Date().toISOString();

  // Build the lifecycle timestamp update based on the transition
  const timestampUpdate =
    status === 'sent'
      ? { sent_at: now }
      : status === 'paid'
        ? { paid_at: now }
        : { cancelled_at: now };

  const { data, error } = await supabase
    .from('invoices')
    .update({ status, ...timestampUpdate, updated_at: now })
    .eq('id', id)
    .select()
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error(`Rechnung ${id} nicht gefunden`);

  return data as unknown as InvoiceRow;
}

/**
 * Persists dispatcher-edited email draft text on the invoice row.
 * Mutable like `notes` — not a legal snapshot.
 */
export async function saveInvoiceEmailDraft(
  id: string,
  draft: { email_subject: string; email_body: string }
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('invoices')
    .update({
      email_subject: draft.email_subject,
      email_body: draft.email_body,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw toQueryError(error);
}
