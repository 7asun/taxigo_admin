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

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { generateNextInvoiceNumber } from '../lib/invoice-number';
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
  from?: string; // ISO date string, filters period_from
  to?: string; // ISO date string, filters period_to
}

/**
 * Fetches a paginated list of invoices with payer name joined.
 * Used in the invoice list table (/dashboard/invoices).
 *
 * @param params - Optional filters for status, payer, and date range.
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
        street, street_number, zip_code, city, email
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
  if (params.from) {
    query = query.gte('period_from', params.from);
  }
  if (params.to) {
    query = query.lte('period_to', params.to);
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

  const { data, error } = await supabase
    .from('invoices')
    .select(
      `
      *,
      payer:payers(
        id, name, number,
        street, street_number, zip_code, city, contact_person, email
      ),
      client:clients(
        id, first_name, last_name, company_name, greeting_style, customer_number,
        street, street_number, zip_code, city, email, phone
      ),
      line_items:invoice_line_items(
        id, invoice_id, trip_id, position, line_date, description,
        client_name, pickup_address, dropoff_address, distance_km,
        unit_price, quantity, total_price, tax_rate,
        billing_variant_code, billing_variant_name, created_at
      )
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
        logo_url, slogan, phone, inhaber, email, website,
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

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      company_id: payload.companyId,
      invoice_number: invoiceNumber,
      payer_id: payload.formValues.payer_id,
      billing_type_id: payload.formValues.billing_type_id,
      mode: payload.formValues.mode,
      client_id: payload.formValues.client_id,
      period_from: payload.formValues.period_from,
      period_to: payload.formValues.period_to,
      notes: payload.formValues.notes,
      payment_due_days: payload.formValues.payment_due_days,
      subtotal: payload.subtotal,
      tax_amount: payload.taxAmount,
      total: payload.total,
      status: 'draft' // always starts as draft
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
