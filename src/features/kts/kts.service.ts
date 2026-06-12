/**
 * Single write authority for trip-level KTS columns.
 * All cascade rules live in `normalizeKtsPatch` — inline cells, detail sheet, and
 * paired sync must delegate here (see docs/kts-architecture.md).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  tripsService,
  type Trip,
  type UpdateTrip
} from '@/features/trips/api/trips.service';
import type { Database } from '@/types/database.types';

/** Persisted on `trips.kts_source` when the user overrides catalog defaults. */
export const KTS_SOURCE_MANUAL = 'manual' as const;

interface KtsDraftInput {
  trip: Trip;
  ktsDocumentAppliesDraft: boolean;
  ktsFehlerDraft: boolean;
  ktsFehlerBeschreibungDraft: string;
  ktsPatientIdDraft: string | null;
  ktsSourceForSave: string;
}

function trimNotes(s: string): string {
  return s.trim();
}

function normalizeKtsFehlerBeschreibungStored(
  s: string | null | undefined
): string | null {
  const t = trimNotes(s ?? '');
  return t ? t : null;
}

function normalizeKtsPatientIdStored(
  s: string | null | undefined
): string | null {
  const t = trimNotes(s ?? '');
  return t ? t : null;
}

/**
 * Pure normalizer for KTS trip patches — no Supabase, no side effects.
 * Keeps cascade rules testable and in one place for Module A–C extensions.
 */
export function normalizeKtsPatch(
  patch: Partial<UpdateTrip>
): Partial<UpdateTrip> {
  const result: Partial<UpdateTrip> = { ...patch };

  if ('kts_fehler_beschreibung' in patch) {
    const v = patch.kts_fehler_beschreibung;
    // why: NULL in DB means "no description" — empty strings break list filters and future correction queries.
    if (v == null) {
      result.kts_fehler_beschreibung = null;
    } else {
      const t = String(v).trim();
      result.kts_fehler_beschreibung = t ? t : null;
    }
  }

  if ('kts_patient_id' in patch) {
    const v = patch.kts_patient_id;
    if (v == null) {
      result.kts_patient_id = null;
    } else {
      const t = String(v).trim();
      result.kts_patient_id = t ? t : null;
    }
  }

  if ('kts_document_applies' in patch && patch.kts_document_applies === false) {
    result.kts_fehler = false;
    result.kts_fehler_beschreibung = null;
    // why: PR4 CSV matching — patient ID snapshot must survive KTS OFF; do not clear kts_patient_id here.
  }

  if ('kts_fehler' in patch && patch.kts_fehler === false) {
    result.kts_fehler_beschreibung = null;
  }

  if (
    'kts_document_applies' in patch &&
    patch.kts_document_applies === true &&
    !('kts_source' in patch)
  ) {
    // why: user toggle-on without resolver context means intentional override vs catalog cascade tier.
    result.kts_source = KTS_SOURCE_MANUAL;
  }

  return result;
}

/**
 * Builds the KTS slice of a detail-sheet PATCH (diff vs current `trip` row).
 */
export function buildKtsPatchFromDrafts(
  input: KtsDraftInput
): Partial<UpdateTrip> {
  const { trip } = input;
  const rawPatch: Partial<UpdateTrip> = {};

  const ktsAppliesNext = !!input.ktsDocumentAppliesDraft;
  const ktsAppliesWas = !!trip.kts_document_applies;
  const ktsSourceWas = trip.kts_source ?? '';
  if (
    ktsAppliesNext !== ktsAppliesWas ||
    input.ktsSourceForSave !== ktsSourceWas
  ) {
    rawPatch.kts_document_applies = ktsAppliesNext;
    rawPatch.kts_source = input.ktsSourceForSave;
  }

  const ktsFehlerNext = !!input.ktsFehlerDraft;
  const ktsFehlerWas = !!trip.kts_fehler;
  if (ktsFehlerNext !== ktsFehlerWas) {
    rawPatch.kts_fehler = ktsFehlerNext;
  }

  const beschStored = normalizeKtsFehlerBeschreibungStored(
    trip.kts_fehler_beschreibung
  );
  const beschDraft = ktsFehlerNext
    ? normalizeKtsFehlerBeschreibungStored(input.ktsFehlerBeschreibungDraft)
    : null;
  if (!ktsFehlerNext) {
    if (beschStored !== null) {
      rawPatch.kts_fehler_beschreibung = null;
    }
  } else if (beschDraft !== beschStored) {
    rawPatch.kts_fehler_beschreibung = beschDraft;
  }

  const patientStored = normalizeKtsPatientIdStored(trip.kts_patient_id);
  const patientDraft = normalizeKtsPatientIdStored(input.ktsPatientIdDraft);
  const patientDiffers = patientDraft !== patientStored;
  if (
    patientDiffers &&
    (ktsAppliesNext ||
      ktsAppliesWas ||
      patientDraft !== null ||
      patientStored !== null)
  ) {
    rawPatch.kts_patient_id = patientDraft;
  }

  return normalizeKtsPatch(rawPatch);
}

/** Persists KTS fields on a trip after `normalizeKtsPatch`. */
export async function updateTripKts(
  tripId: string,
  patch: Partial<UpdateTrip>
): Promise<Trip> {
  const normalized = normalizeKtsPatch(patch);
  return tripsService.updateTrip(tripId, normalized as UpdateTrip);
}

// --- Correction rounds ---

export type KtsCorrection =
  Database['public']['Tables']['kts_corrections']['Row'];
type KtsCorrectionInsert =
  Database['public']['Tables']['kts_corrections']['Insert'];

/** Loads full correction round history for a trip (detail timeline). */
export async function fetchTripCorrections(
  supabase: SupabaseClient,
  tripId: string
): Promise<KtsCorrection[]> {
  const { data, error } = await supabase
    .from('kts_corrections')
    .select('*')
    .eq('trip_id', tripId)
    .order('sent_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error('Korrekturen konnten nicht geladen werden.');
  }

  return data ?? [];
}

export interface InsertKtsCorrectionPayload {
  tripId: string;
  companyId: string;
  sentTo: string;
  sentAt: Date;
  notes?: string;
}

/** Opens a new append-only correction round when a KTS document is dispatched. */
export async function insertKtsCorrection(
  supabase: SupabaseClient,
  payload: InsertKtsCorrectionPayload
): Promise<KtsCorrection> {
  const sentTo = payload.sentTo.trim();
  if (!sentTo) {
    throw new Error('Empfänger darf nicht leer sein.');
  }

  const notesTrimmed = payload.notes?.trim();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const row: KtsCorrectionInsert = {
    company_id: payload.companyId,
    trip_id: payload.tripId,
    sent_to: sentTo,
    sent_at: payload.sentAt.toISOString(),
    notes: notesTrimmed ? notesTrimmed : null,
    created_by: user?.id ?? null
  };

  const { data, error } = await supabase
    .from('kts_corrections')
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error('Korrektur konnte nicht gespeichert werden.');
  }

  return data;
}

/** Records return of a corrected document; `received_at IS NULL` guard prevents double-close. */
export async function closeKtsCorrection(
  supabase: SupabaseClient,
  correctionId: string,
  receivedAt: Date
): Promise<KtsCorrection> {
  const { data, error } = await supabase
    .from('kts_corrections')
    .update({ received_at: receivedAt.toISOString() })
    .eq('id', correctionId)
    .is('received_at', null)
    .select()
    .single();

  if (!error && !data) {
    throw new Error(
      'Korrektur wurde bereits abgeschlossen oder existiert nicht.'
    );
  }

  if (error) {
    throw new Error('Korrektur konnte nicht abgeschlossen werden.');
  }

  return data;
}
