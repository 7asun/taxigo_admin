/**
 * angebote.api.ts
 *
 * Supabase API service for the `angebote` and `angebot_line_items` tables.
 *
 * Responsibilities:
 *   - List Angebote (with optional status filter)
 *   - Fetch a single Angebot with line items + company profile
 *   - Create a new Angebot (header + line items in sequence)
 *   - Update Angebot fields
 *   - Delete an Angebot
 *   - Update Angebot status
 *
 * Design rules:
 *   - Always throw on error (React Query catches and surfaces via isError)
 *   - All timestamps stored as ISO strings (Supabase default)
 *   - Mirror pattern from src/features/invoices/api/invoices.api.ts
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { generateNextAngebotNumber } from '../lib/angebot-number';
import type {
  AngebotRow,
  AngebotStatus,
  AngebotWithLineItems,
  CreateAngebotPayload,
  UpdateAngebotPayload
} from '../types/angebot.types';

// ─── List Angebote ────────────────────────────────────────────────────────────

export interface AngebotListParams {
  status?: AngebotStatus;
}

/**
 * Fetches all Angebote for the current company, newest first.
 */
export async function listAngebote(
  params: AngebotListParams = {}
): Promise<AngebotRow[]> {
  const supabase = createClient();

  let query = supabase
    .from('angebote')
    .select('*')
    .order('created_at', { ascending: false });

  if (params.status) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) throw toQueryError(error);
  return (data ?? []) as AngebotRow[];
}

// ─── Single Angebot (full detail) ─────────────────────────────────────────────

/**
 * Fetches a single Angebot with its line items and the company profile.
 *
 * @param id - Angebot UUID.
 * @throws If the Angebot is not found or the query fails.
 */
export async function getAngebot(id: string): Promise<AngebotWithLineItems> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('angebote')
    .select(
      `
      *,
      line_items:angebot_line_items(*)
    `
    )
    .eq('id', id)
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error(`Angebot ${id} nicht gefunden`);

  const angebot = data as unknown as AngebotWithLineItems;
  if (angebot.line_items) {
    angebot.line_items.sort((a, b) => a.position - b.position);
  }

  return angebot;
}

// ─── Create Angebot ───────────────────────────────────────────────────────────

/**
 * Creates a new Angebot: generates the number, inserts the header row, then
 * inserts all line items.
 *
 * company_id comes from payload.companyId only — same contract as
 * createInvoice() in invoices.api.ts (no auth lookup in this function).
 * The server page loads accounts.company_id (→ companies.id) and passes it
 * into the builder, which forwards it in the payload.
 *
 * On UNIQUE violation for angebot_number (race condition), callers should retry once.
 */
export async function createAngebot(
  payload: CreateAngebotPayload
): Promise<AngebotWithLineItems> {
  const supabase = createClient();

  if (!payload.companyId) {
    throw new Error('companyId fehlt — Angebot kann nicht erstellt werden.');
  }

  const angebotNumber = await generateNextAngebotNumber();

  const { data: headerData, error: headerError } = await supabase
    .from('angebote')
    .insert({
      company_id: payload.companyId,
      angebot_number: angebotNumber,
      status: 'draft',
      recipient_company: payload.recipient_company ?? null,
      recipient_first_name: payload.recipient_first_name ?? null,
      recipient_last_name: payload.recipient_last_name ?? null,
      recipient_name:
        [payload.recipient_first_name, payload.recipient_last_name]
          .filter(Boolean)
          .join(' ') || null,
      recipient_anrede: payload.recipient_anrede ?? null,
      recipient_street: payload.recipient_street ?? null,
      recipient_street_number: payload.recipient_street_number ?? null,
      recipient_zip: payload.recipient_zip ?? null,
      recipient_city: payload.recipient_city ?? null,
      recipient_email: payload.recipient_email ?? null,
      recipient_phone: payload.recipient_phone ?? null,
      customer_number: payload.customer_number ?? null,
      subject: payload.subject ?? null,
      valid_until: payload.valid_until ?? null,
      offer_date: payload.offer_date,
      intro_text: payload.intro_text ?? null,
      outro_text: payload.outro_text ?? null,
      pdf_column_override: payload.pdf_column_override ?? null
    })
    .select('*')
    .single();

  if (headerError) throw toQueryError(headerError);
  if (!headerData) throw new Error('Angebot konnte nicht erstellt werden');

  const angebotId = (headerData as AngebotRow).id;

  if (payload.line_items.length > 0) {
    const lineItemRows = payload.line_items.map((item) => ({
      angebot_id: angebotId,
      position: item.position,
      leistung: item.leistung,
      anfahrtkosten: item.anfahrtkosten ?? null,
      price_first_5km: item.price_first_5km ?? null,
      price_per_km_after_5: item.price_per_km_after_5 ?? null,
      notes: item.notes ?? null
    }));

    const { error: lineItemsError } = await supabase
      .from('angebot_line_items')
      .insert(lineItemRows);

    if (lineItemsError) throw toQueryError(lineItemsError);
  }

  return getAngebot(angebotId);
}

// ─── Update Angebot ───────────────────────────────────────────────────────────

/**
 * Partially updates an Angebot header row.
 * Does not touch line items — use replaceAngebotLineItems for that.
 */
export async function updateAngebot(
  id: string,
  payload: UpdateAngebotPayload
): Promise<AngebotRow> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('angebote')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw toQueryError(error);
  return data as AngebotRow;
}

// ─── Update status ────────────────────────────────────────────────────────────

/**
 * Updates the status of an Angebot.
 * Allowed transitions: draft → sent → accepted | declined
 */
export async function updateAngebotStatus(
  id: string,
  status: AngebotStatus
): Promise<AngebotRow> {
  return updateAngebot(id, { status });
}

// ─── Delete Angebot ───────────────────────────────────────────────────────────

/**
 * Deletes an Angebot and all its line items (cascade via FK).
 */
export async function deleteAngebot(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from('angebote').delete().eq('id', id);
  if (error) throw toQueryError(error);
}

// ─── Replace line items ───────────────────────────────────────────────────────

/**
 * Replaces all line items for an Angebot (delete-insert pattern).
 * Used when editing an existing offer.
 */
export async function replaceAngebotLineItems(
  angebotId: string,
  lineItems: Omit<CreateAngebotPayload['line_items'][number], never>[]
): Promise<void> {
  const supabase = createClient();

  const { error: deleteError } = await supabase
    .from('angebot_line_items')
    .delete()
    .eq('angebot_id', angebotId);

  if (deleteError) throw toQueryError(deleteError);

  if (lineItems.length > 0) {
    const rows = lineItems.map((item) => ({
      angebot_id: angebotId,
      position: item.position,
      leistung: item.leistung,
      anfahrtkosten: item.anfahrtkosten ?? null,
      price_first_5km: item.price_first_5km ?? null,
      price_per_km_after_5: item.price_per_km_after_5 ?? null,
      notes: item.notes ?? null
    }));

    const { error: insertError } = await supabase
      .from('angebot_line_items')
      .insert(rows);

    if (insertError) throw toQueryError(insertError);
  }
}
