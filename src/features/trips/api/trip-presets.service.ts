import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  TripPreset,
  TripPresetParams,
  TripPresetUpdate
} from '@/features/trips/types/trip-preset.types';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { Json } from '@/types/database.types';

async function resolveCompanyId(
  supabase: SupabaseClient
): Promise<string | null> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data: profile } = await supabase
    .from('accounts')
    .select('company_id')
    .eq('id', user.id)
    .single();
  return profile?.company_id ?? null;
}

export async function fetchTripPresets(
  supabase: SupabaseClient
): Promise<TripPreset[]> {
  const { data, error } = await supabase
    .from('trip_presets')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw toQueryError(error);
  return (data ?? []) as TripPreset[];
}

export async function createTripPreset(
  supabase: SupabaseClient,
  input: {
    name: string;
    params: TripPresetParams;
    column_visibility: Record<string, boolean>;
    column_order: string[];
    /** New presets use `0` and appear first; existing rows are shifted down (+1). */
    sort_order?: number;
  }
): Promise<TripPreset> {
  const companyId = await resolveCompanyId(supabase);
  if (!companyId) {
    throw new Error('Keine Firma gefunden.');
  }

  const now = new Date().toISOString();
  const { data: existing, error: fetchErr } = await supabase
    .from('trip_presets')
    .select('id, sort_order')
    .eq('company_id', companyId);

  if (fetchErr) throw toQueryError(fetchErr);

  if (existing?.length) {
    const results = await Promise.all(
      existing.map((row) =>
        supabase
          .from('trip_presets')
          .update({ sort_order: row.sort_order + 1, updated_at: now })
          .eq('id', row.id)
      )
    );
    for (const { error } of results) {
      if (error) throw toQueryError(error);
    }
  }

  const { data, error } = await supabase
    .from('trip_presets')
    .insert({
      company_id: companyId,
      name: input.name.trim(),
      params: input.params as unknown as Json,
      column_visibility: input.column_visibility as unknown as Json,
      column_order: input.column_order as unknown as Json,
      sort_order: 0
    })
    .select()
    .single();

  if (error) throw toQueryError(error);
  return data as TripPreset;
}

export async function updateTripPreset(
  supabase: SupabaseClient,
  id: string,
  patch: TripPresetUpdate
): Promise<TripPreset> {
  const { data, error } = await supabase
    .from('trip_presets')
    .update({
      ...patch,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw toQueryError(error);
  return data as TripPreset;
}

export async function deleteTripPreset(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.from('trip_presets').delete().eq('id', id);
  if (error) throw toQueryError(error);
}

export async function reorderTripPresets(
  supabase: SupabaseClient,
  orderedIds: string[]
): Promise<void> {
  const now = new Date().toISOString();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('trip_presets')
        .update({ sort_order: index, updated_at: now })
        .eq('id', id)
    )
  );
  for (const { error } of results) {
    if (error) throw toQueryError(error);
  }
}
