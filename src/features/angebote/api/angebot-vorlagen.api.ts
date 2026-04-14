/**
 * Supabase CRUD for angebot_vorlagen (offer table templates).
 * Mirrors pdf-vorlagen.api.ts: createClient(), toQueryError(), Zod at the boundary.
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import {
  angebotColumnDefArraySchema,
  type AngebotVorlageCreatePayload,
  type AngebotVorlageRow,
  type AngebotVorlageUpdatePayload
} from '../types/angebot.types';
import { normalizeLegacyColumn } from '../lib/angebot-column-presets';

function rowFromDb(raw: Record<string, unknown>): AngebotVorlageRow {
  const colsRaw = raw.columns;
  // PostgREST jsonb may arrive as object or string — coerce through Zod at the API boundary (same idea as pdf-vorlagen rowFromDb + invoice line JSONB).
  let parsed: unknown = colsRaw;
  if (typeof colsRaw === 'string') {
    try {
      parsed = JSON.parse(colsRaw) as unknown;
    } catch {
      parsed = [];
    }
  }
  // Runtime legacy bridge — remove after migration SQL verified on all environments (prod + staging).
  // Track removal with: find src -name '.ts' -exec grep -l 'normalizeLegacyColumn' {} \;
  const normalized = Array.isArray(parsed)
    ? parsed.map(normalizeLegacyColumn)
    : [];
  const columns = angebotColumnDefArraySchema.parse(normalized);
  return {
    id: String(raw.id),
    company_id: String(raw.company_id),
    name: String(raw.name),
    description:
      raw.description === null || raw.description === undefined
        ? null
        : String(raw.description),
    is_default: Boolean(raw.is_default),
    columns,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at)
  };
}

function stripLegacyKeys(
  cols: AngebotVorlageCreatePayload['columns']
): AngebotVorlageCreatePayload['columns'] {
  return cols.map((c) => ({
    id: c.id,
    header: c.header,
    preset: c.preset,
    required: c.required,
    formula: c.formula
  }));
}

export async function listAngebotVorlagen(
  companyId: string
): Promise<AngebotVorlageRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('angebot_vorlagen')
    .select('*')
    .eq('company_id', companyId);

  if (error) throw toQueryError(error);
  const rows = (data ?? []).map((r) => rowFromDb(r as Record<string, unknown>));
  // PostgREST chained .order() is unreliable for multi-column sort here — client-side sort: is_default DESC, name ASC.
  return rows.sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return a.name.localeCompare(b.name, 'de');
  });
}

export async function getAngebotVorlage(
  id: string
): Promise<AngebotVorlageRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('angebot_vorlagen')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw toQueryError(error);
  if (!data) return null;
  return rowFromDb(data as Record<string, unknown>);
}

export async function createAngebotVorlage(
  payload: AngebotVorlageCreatePayload
): Promise<AngebotVorlageRow> {
  const safeCols = stripLegacyKeys(payload.columns);
  angebotColumnDefArraySchema.parse(safeCols);

  const supabase = createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('angebot_vorlagen')
    .insert({
      company_id: payload.companyId,
      name: payload.name,
      description: payload.description ?? null,
      columns: safeCols,
      is_default: false,
      updated_at: now
    })
    .select()
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error('Angebotsvorlage konnte nicht erstellt werden');

  const id = (data as { id: string }).id;
  if (payload.is_default) {
    await setDefaultAngebotVorlage(id, payload.companyId);
  }

  const refreshed = await getAngebotVorlage(id);
  if (!refreshed)
    throw new Error('Angebotsvorlage nach Erstellung nicht lesbar');
  return refreshed;
}

export async function updateAngebotVorlage(
  id: string,
  payload: AngebotVorlageUpdatePayload
): Promise<AngebotVorlageRow> {
  if (payload.columns) {
    angebotColumnDefArraySchema.parse(stripLegacyKeys(payload.columns));
  }

  const supabase = createClient();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (payload.name !== undefined) patch.name = payload.name;
  if (payload.description !== undefined)
    patch.description = payload.description;
  if (payload.columns !== undefined)
    patch.columns = stripLegacyKeys(payload.columns);

  const { data, error } = await supabase
    .from('angebot_vorlagen')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error(`Angebotsvorlage ${id} nicht gefunden`);

  let row = rowFromDb(data as Record<string, unknown>);

  if (payload.is_default === true) {
    await setDefaultAngebotVorlage(id, row.company_id);
    const refreshed = await getAngebotVorlage(id);
    if (!refreshed) throw new Error('Angebotsvorlage nach Update nicht lesbar');
    row = refreshed;
  }

  return row;
}

export async function deleteAngebotVorlage(id: string): Promise<void> {
  const supabase = createClient();

  const existing = await getAngebotVorlage(id);
  if (!existing) return;

  const { count, error: countError } = await supabase
    .from('angebot_vorlagen')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', existing.company_id);

  if (countError) throw toQueryError(countError);
  if (count === 1) {
    throw new Error('Die letzte Angebotsvorlage kann nicht gelöscht werden.');
  }

  const { error } = await supabase
    .from('angebot_vorlagen')
    .delete()
    .eq('id', id);

  if (error) throw toQueryError(error);
}

export async function setDefaultAngebotVorlage(
  id: string,
  companyId: string
): Promise<void> {
  const supabase = createClient();

  const { error: clearError } = await supabase
    .from('angebot_vorlagen')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('company_id', companyId);

  if (clearError) throw toQueryError(clearError);

  const { error } = await supabase
    .from('angebot_vorlagen')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId);

  if (error) throw toQueryError(error);
}
