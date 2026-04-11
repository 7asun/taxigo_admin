/**
 * pdf-vorlagen.api.ts
 *
 * Supabase CRUD for pdf_vorlagen (PDF column profile templates).
 * Mirrors invoices.api.ts: createClient(), toQueryError(), throw on failure.
 *
 * Must not import React or run in the browser without createClient() — same
 * constraints as other feature API modules.
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import {
  pdfColumnKeyArraySchema,
  type PdfVorlageCreatePayload,
  type PdfVorlageRow,
  type PdfVorlageUpdatePayload
} from '@/features/invoices/types/pdf-vorlage.types';

function rowFromDb(raw: Record<string, unknown>): PdfVorlageRow {
  const main = pdfColumnKeyArraySchema.parse(raw.main_columns);
  const appendix = pdfColumnKeyArraySchema.parse(raw.appendix_columns);
  const layoutRaw = raw.main_layout;
  // Preserve all four known layout values; fall back to 'grouped' for legacy rows
  // that pre-date Phase 9 (null or any other unexpected value from older migrations).
  const main_layout: PdfVorlageRow['main_layout'] =
    layoutRaw === 'flat'
      ? 'flat'
      : layoutRaw === 'single_row'
        ? 'single_row'
        : layoutRaw === 'grouped_by_billing_type'
          ? 'grouped_by_billing_type'
          : 'grouped';
  const introRaw = raw.intro_block_id;
  const outroRaw = raw.outro_block_id;
  return {
    id: String(raw.id),
    company_id: String(raw.company_id),
    name: String(raw.name),
    description:
      raw.description === null || raw.description === undefined
        ? null
        : String(raw.description),
    main_columns: main,
    appendix_columns: appendix,
    main_layout,
    is_default: Boolean(raw.is_default),
    intro_block_id:
      introRaw === null || introRaw === undefined ? null : String(introRaw),
    outro_block_id:
      outroRaw === null || outroRaw === undefined ? null : String(outroRaw),
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at)
  };
}

/**
 * Lists all Vorlagen for a company, ordered by name.
 */
export async function listPdfVorlagen(
  companyId: string
): Promise<PdfVorlageRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('pdf_vorlagen')
    .select('*')
    .eq('company_id', companyId)
    .order('name');

  if (error) throw toQueryError(error);
  return (data ?? []).map((r) => rowFromDb(r as Record<string, unknown>));
}

/**
 * Fetches a single Vorlage by id, or null if missing.
 */
export async function getPdfVorlage(id: string): Promise<PdfVorlageRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('pdf_vorlagen')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw toQueryError(error);
  if (!data) return null;
  return rowFromDb(data as Record<string, unknown>);
}

/**
 * Returns the Vorlage marked default for the company, if any.
 */
export async function getDefaultVorlageForCompany(
  companyId: string
): Promise<PdfVorlageRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('pdf_vorlagen')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle();

  if (error) throw toQueryError(error);
  if (!data) return null;
  return rowFromDb(data as Record<string, unknown>);
}

/**
 * Inserts a new Vorlage; validates column arrays at the boundary.
 *
 * Phase 10: `intro_block_id` and `outro_block_id` are always inserted as `null`;
 * assign Brieftext defaults later via {@link updatePdfVorlage}.
 */
export async function createPdfVorlage(
  payload: PdfVorlageCreatePayload
): Promise<PdfVorlageRow> {
  pdfColumnKeyArraySchema.parse(payload.main_columns);
  pdfColumnKeyArraySchema.parse(payload.appendix_columns);

  const supabase = createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('pdf_vorlagen')
    .insert({
      company_id: payload.companyId,
      name: payload.name,
      description: payload.description ?? null,
      main_columns: payload.main_columns,
      appendix_columns: payload.appendix_columns,
      main_layout: 'grouped',
      intro_block_id: null,
      outro_block_id: null,
      is_default: false,
      updated_at: now
    })
    .select()
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error('PDF-Vorlage konnte nicht erstellt werden');

  const id = (data as { id: string }).id;
  if (payload.is_default) {
    await setDefaultVorlage(id, payload.companyId);
  }

  const refreshed = await getPdfVorlage(id);
  if (!refreshed) throw new Error('PDF-Vorlage nach Erstellung nicht lesbar');
  return refreshed;
}

/**
 * Updates an existing Vorlage (partial payload).
 *
 * Phase 10: optional `intro_block_id` / `outro_block_id` set builder defaults for
 * intro/outro text blocks (nullable FKs to `invoice_text_blocks`). Omitted keys
 * leave the column unchanged; pass `null` to clear and fall back to payer/company.
 */
export async function updatePdfVorlage(
  id: string,
  payload: PdfVorlageUpdatePayload
): Promise<PdfVorlageRow> {
  if (payload.main_columns) {
    pdfColumnKeyArraySchema.parse(payload.main_columns);
  }
  if (payload.appendix_columns) {
    pdfColumnKeyArraySchema.parse(payload.appendix_columns);
  }

  const supabase = createClient();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (payload.name !== undefined) patch.name = payload.name;
  if (payload.description !== undefined)
    patch.description = payload.description;
  if (payload.main_columns !== undefined) {
    patch.main_columns = payload.main_columns;
  }
  if (payload.appendix_columns !== undefined) {
    patch.appendix_columns = payload.appendix_columns;
  }
  if (payload.main_layout !== undefined) {
    patch.main_layout = payload.main_layout;
  }
  if (payload.intro_block_id !== undefined) {
    patch.intro_block_id = payload.intro_block_id;
  }
  if (payload.outro_block_id !== undefined) {
    patch.outro_block_id = payload.outro_block_id;
  }

  const { data, error } = await supabase
    .from('pdf_vorlagen')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error(`PDF-Vorlage ${id} nicht gefunden`);

  let row = rowFromDb(data as Record<string, unknown>);

  if (payload.is_default === true) {
    await setDefaultVorlage(id, row.company_id);
    const refreshed = await getPdfVorlage(id);
    if (!refreshed) throw new Error('PDF-Vorlage nach Update nicht lesbar');
    row = refreshed;
  }

  return row;
}

/**
 * Deletes a Vorlage. Throws if any payer still references it.
 */
export async function deletePdfVorlage(id: string): Promise<void> {
  const supabase = createClient();

  const { count, error: countError } = await supabase
    .from('payers')
    .select('id', { count: 'exact', head: true })
    .eq('pdf_vorlage_id', id);

  if (countError) throw toQueryError(countError);
  if (count && count > 0) {
    throw new Error(
      'Vorlage ist noch einem Kostenträger zugeordnet und kann nicht gelöscht werden.'
    );
  }

  const { error } = await supabase.from('pdf_vorlagen').delete().eq('id', id);

  if (error) throw toQueryError(error);
}

/**
 * Marks one Vorlage as the company default; clears is_default on all others.
 */
export async function setDefaultVorlage(
  id: string,
  companyId: string
): Promise<void> {
  const supabase = createClient();

  const { error: clearError } = await supabase
    .from('pdf_vorlagen')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('company_id', companyId);

  if (clearError) throw toQueryError(clearError);

  const { error } = await supabase
    .from('pdf_vorlagen')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId);

  if (error) throw toQueryError(error);
}
