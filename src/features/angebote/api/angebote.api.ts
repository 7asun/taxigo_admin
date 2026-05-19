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
import { angebotColumnDefArraySchema } from '../types/angebot.types';
import { normalizeLegacyColumn } from '../lib/angebot-column-presets';
import type {
  AngebotRow,
  AngebotStatus,
  AngebotWithLineItems,
  CreateAngebotPayload,
  DraftSchemaRefreshPayload,
  UpdateAngebotPayload
} from '../types/angebot.types';

function mapLineItemFromDb(
  raw: Record<string, unknown>
): AngebotWithLineItems['line_items'][number] {
  const dataRaw = raw.data;
  let data: Record<string, string | number | null> = {};
  if (
    dataRaw != null &&
    typeof dataRaw === 'object' &&
    !Array.isArray(dataRaw)
  ) {
    data = dataRaw as Record<string, string | number | null>;
  } else if (typeof dataRaw === 'string') {
    try {
      const parsed: unknown = JSON.parse(dataRaw);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        data = parsed as Record<string, string | number | null>;
      }
    } catch {
      data = {};
    }
  }
  return {
    id: String(raw.id),
    angebot_id: String(raw.angebot_id),
    position: Number(raw.position),
    data,
    leistung: raw.leistung != null ? String(raw.leistung) : '',
    anfahrtkosten:
      raw.anfahrtkosten === null || raw.anfahrtkosten === undefined
        ? null
        : Number(raw.anfahrtkosten),
    price_first_5km:
      raw.price_first_5km === null || raw.price_first_5km === undefined
        ? null
        : Number(raw.price_first_5km),
    price_per_km_after_5:
      raw.price_per_km_after_5 === null ||
      raw.price_per_km_after_5 === undefined
        ? null
        : Number(raw.price_per_km_after_5),
    notes:
      raw.notes === null || raw.notes === undefined ? null : String(raw.notes),
    created_at: String(raw.created_at)
  };
}

function mapAngebotHeaderFromDb(raw: Record<string, unknown>): AngebotRow {
  const snap = raw.table_schema_snapshot;
  let table_schema_snapshot = null;
  if (snap != null) {
    const parsed =
      typeof snap === 'string'
        ? (() => {
            try {
              return JSON.parse(snap) as unknown;
            } catch {
              return null;
            }
          })()
        : snap;
    if (parsed != null) {
      // Runtime legacy bridge — remove after migration SQL verified on all environments (prod + staging).
      // Track removal with: find src -name '.ts' -exec grep -l 'normalizeLegacyColumn' {} \;
      const normalized = Array.isArray(parsed)
        ? parsed.map(normalizeLegacyColumn)
        : parsed;
      const z = angebotColumnDefArraySchema.safeParse(normalized);
      if (z.success) table_schema_snapshot = z.data;
    }
  }
  return {
    id: String(raw.id),
    company_id: String(raw.company_id),
    angebot_number: String(raw.angebot_number),
    status: raw.status as AngebotStatus,
    // WHY: defensive coercion — if DB has unexpected values, default to 'net' to preserve legacy behaviour.
    input_mode: (raw.input_mode === 'gross' ? 'gross' : 'net') as
      | 'net'
      | 'gross',
    // WHY: opt-in totals block must default to false for legacy rows and preserve existing quote PDFs.
    show_totals_block: raw.show_totals_block === true,
    totals_label_net:
      raw.totals_label_net == null ? null : String(raw.totals_label_net),
    totals_label_tax:
      raw.totals_label_tax == null ? null : String(raw.totals_label_tax),
    totals_label_gross:
      raw.totals_label_gross == null ? null : String(raw.totals_label_gross),
    default_tax_rate: (() => {
      const x = raw.default_tax_rate;
      if (x === null || x === undefined) return null;
      const n = typeof x === 'number' ? x : Number(x);
      return isFinite(n) ? n : null;
    })(),
    recipient_company:
      raw.recipient_company == null ? null : String(raw.recipient_company),
    recipient_name:
      raw.recipient_name == null ? null : String(raw.recipient_name),
    recipient_first_name:
      raw.recipient_first_name == null
        ? null
        : String(raw.recipient_first_name),
    recipient_last_name:
      raw.recipient_last_name == null ? null : String(raw.recipient_last_name),
    recipient_anrede:
      raw.recipient_anrede === 'Herr' || raw.recipient_anrede === 'Frau'
        ? raw.recipient_anrede
        : null,
    recipient_street:
      raw.recipient_street == null ? null : String(raw.recipient_street),
    recipient_street_number:
      raw.recipient_street_number == null
        ? null
        : String(raw.recipient_street_number),
    recipient_zip: raw.recipient_zip == null ? null : String(raw.recipient_zip),
    recipient_city:
      raw.recipient_city == null ? null : String(raw.recipient_city),
    recipient_email:
      raw.recipient_email == null ? null : String(raw.recipient_email),
    recipient_phone:
      raw.recipient_phone == null ? null : String(raw.recipient_phone),
    customer_number:
      raw.customer_number == null ? null : String(raw.customer_number),
    subject: raw.subject == null ? null : String(raw.subject),
    valid_until: raw.valid_until == null ? null : String(raw.valid_until),
    offer_date: String(raw.offer_date),
    intro_text: raw.intro_text == null ? null : String(raw.intro_text),
    outro_text: raw.outro_text == null ? null : String(raw.outro_text),
    angebot_vorlage_id:
      raw.angebot_vorlage_id == null ? null : String(raw.angebot_vorlage_id),
    table_schema_snapshot,
    pdf_column_override:
      raw.pdf_column_override == null
        ? null
        : (raw.pdf_column_override as AngebotRow['pdf_column_override']),
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at)
  };
}

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
  return (data ?? []).map((r) =>
    mapAngebotHeaderFromDb(r as Record<string, unknown>)
  );
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

  const raw = data as Record<string, unknown>;
  const lineRaw = raw.line_items;
  const header = mapAngebotHeaderFromDb(raw);
  const lineItems = Array.isArray(lineRaw)
    ? lineRaw.map((li) => mapLineItemFromDb(li as Record<string, unknown>))
    : [];
  lineItems.sort((a, b) => a.position - b.position);

  return {
    ...header,
    line_items: lineItems
  };
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

  angebotColumnDefArraySchema.parse(
    payload.tableSchemaSnapshot.map((c) => ({
      id: c.id,
      header: c.header,
      preset: c.preset,
      required: c.required,
      formula: c.formula,
      role: c.role
    }))
  );

  const angebotNumber = await generateNextAngebotNumber();

  const { data: headerData, error: headerError } = await supabase
    .from('angebote')
    .insert({
      company_id: payload.companyId,
      angebot_number: angebotNumber,
      status: 'draft',
      input_mode: payload.inputMode ?? 'net',
      // WHY: default false keeps existing behavior; totals only appear when explicitly enabled per quote.
      show_totals_block: payload.showTotalsBlock ?? false,
      // WHY: nullable DB columns allow changing default labels in the app without rewriting existing rows.
      totals_label_net: payload.totalsLabelNet ?? null,
      totals_label_tax: payload.totalsLabelTax ?? null,
      totals_label_gross: payload.totalsLabelGross ?? null,
      default_tax_rate:
        payload.defaultTaxRate === undefined || payload.defaultTaxRate === null
          ? null
          : isFinite(payload.defaultTaxRate)
            ? payload.defaultTaxRate
            : null,
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
      angebot_vorlage_id: payload.angebotVorlageId ?? null,
      table_schema_snapshot: payload.tableSchemaSnapshot.map((c) => ({
        id: c.id,
        header: c.header,
        preset: c.preset,
        required: c.required,
        formula: c.formula,
        role: c.role
      })),
      // Explicitly null — new offers use table_schema_snapshot. pdf_column_override is a legacy field for pre-Phase-2a rows only.
      pdf_column_override: null
    })
    .select('*')
    .single();

  if (headerError) throw toQueryError(headerError);
  if (!headerData) throw new Error('Angebot konnte nicht erstellt werden');

  const angebotId = (headerData as { id: string }).id;

  if (payload.line_items.length > 0) {
    const lineItemRows = payload.line_items.map((item) => ({
      angebot_id: angebotId,
      position: item.position,
      data: item.data,
      // Deprecated typed columns — not written for new rows; DB still accepts empty / null-compatible values.
      leistung: '',
      anfahrtkosten: null,
      price_first_5km: null,
      price_per_km_after_5: null,
      notes: null
    }));

    // Write to data jsonb only. Deprecated typed columns (leistung, anfahrtkosten, price_first_5km, price_per_km_after_5, notes) are not written for new rows.
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
 *
 * Template and schema snapshot are immutable after creation. Only line item data and metadata fields (subject, dates, text blocks, status) are updated here. Never overwrite angebot_vorlage_id, table_schema_snapshot, or pdf_column_override.
 */
export async function updateAngebot(
  id: string,
  payload: UpdateAngebotPayload
): Promise<AngebotRow> {
  const supabase = createClient();

  // WHY: Supabase updates must never receive UI-only camelCase keys (e.g. showTotalsBlock, defaultTaxRate),
  // otherwise PostgREST tries to update a non-existent column and the request fails.
  const {
    showTotalsBlock,
    inputMode,
    totalsLabelNet,
    totalsLabelTax,
    totalsLabelGross,
    defaultTaxRate,
    ...rest
  } = payload;
  const updatePayload = {
    ...rest,
    ...(showTotalsBlock !== undefined && {
      show_totals_block: showTotalsBlock
    }),
    ...(inputMode !== undefined && { input_mode: inputMode }),
    ...(totalsLabelNet !== undefined && { totals_label_net: totalsLabelNet }),
    ...(totalsLabelTax !== undefined && { totals_label_tax: totalsLabelTax }),
    ...(totalsLabelGross !== undefined && {
      totals_label_gross: totalsLabelGross
    }),
    ...(defaultTaxRate !== undefined && {
      default_tax_rate:
        defaultTaxRate === null || !isFinite(defaultTaxRate)
          ? null
          : defaultTaxRate
    }),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('angebote')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw toQueryError(error);
  return mapAngebotHeaderFromDb(data as Record<string, unknown>);
}

/**
 * Refreshes table_schema_snapshot for draft offers only.
 * Must never be called for non-draft status offers.
 * Separate from updateAngebot to make the draft-only constraint explicit and auditable.
 */
export async function updateDraftAngebotSchema(
  id: string,
  snapshot: DraftSchemaRefreshPayload['table_schema_snapshot']
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('angebote')
    .update({
      table_schema_snapshot: snapshot.map((c) => ({
        id: c.id,
        header: c.header,
        preset: c.preset,
        required: c.required,
        formula: c.formula,
        role: c.role
      })),
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('status', 'draft'); // hard safety guard: only ever updates a draft row

  if (error) throw toQueryError(error);
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
  lineItems: CreateAngebotPayload['line_items']
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
      data: item.data,
      leistung: '',
      anfahrtkosten: null,
      price_first_5km: null,
      price_per_km_after_5: null,
      notes: null
    }));

    const { error: insertError } = await supabase
      .from('angebot_line_items')
      .insert(rows);

    if (insertError) throw toQueryError(insertError);
  }
}
