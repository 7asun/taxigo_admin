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

/** Days without correction response before a trip counts as überfällig (KPI RPC + list filter). */
export const KTS_OVERDUE_DAYS = 10;

export type KtsStatus = Database['public']['Enums']['kts_status'];

export const KTS_STATUS_UNGEPRUEFT = 'ungeprueft' as KtsStatus;
export const KTS_STATUS_KORREKT = 'korrekt' as KtsStatus;
export const KTS_STATUS_FEHLERHAFT = 'fehlerhaft' as KtsStatus;
export const KTS_STATUS_IN_KORREKTUR = 'in_korrektur' as KtsStatus;
export const KTS_STATUS_UEBERGEBEN = 'uebergeben' as KtsStatus;
export const KTS_STATUS_ABGERECHNET = 'abgerechnet' as KtsStatus;

function isKtsErrorStatus(status: KtsStatus): boolean {
  return status === KTS_STATUS_FEHLERHAFT || status === KTS_STATUS_IN_KORREKTUR;
}

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

  // Rule B — KTS OFF clears status (status has no meaning when KTS is disabled).
  if ('kts_document_applies' in patch && patch.kts_document_applies === false) {
    result.kts_status = null;
  }

  // Rule A — KTS enable-only default to ungeprueft.
  // why: callers toggling KTS ON rarely pass explicit status; transition functions pass kts_status and must not be overridden.
  // Enable-only guard: partner sync always includes kts_fehler keys — skip Rule A so partner status is preserved.
  if (
    'kts_document_applies' in patch &&
    patch.kts_document_applies === true &&
    !('kts_status' in patch) &&
    !('kts_fehler' in patch) &&
    !('kts_fehler_beschreibung' in patch)
  ) {
    result.kts_status = KTS_STATUS_UNGEPRUEFT;
  }

  // Rule C — status in patch syncs kts_fehler.
  // why: ~40 read paths depend on kts_fehler; status is workflow source of truth but fehler must stay consistent.
  if (
    'kts_status' in patch &&
    patch.kts_status !== null &&
    patch.kts_status !== undefined
  ) {
    result.kts_fehler = isKtsErrorStatus(patch.kts_status);
  }

  // Rule D — explicit null status clears fehler fields.
  if ('kts_status' in patch && patch.kts_status === null) {
    result.kts_fehler = false;
    result.kts_fehler_beschreibung = null;
  }

  return result;
}

/**
 * New trip inserts must never inherit error/workflow state from a source trip.
 * Preserves kts_document_applies, kts_source, kts_patient_id (identity/catalog, not workflow).
 */
export function normalizeKtsInsert<
  T extends {
    kts_document_applies?: boolean;
    kts_status?: KtsStatus | null;
    kts_fehler?: boolean;
    kts_fehler_beschreibung?: string | null;
  }
>(payload: T): T {
  if (!payload.kts_document_applies) {
    return {
      ...payload,
      kts_status: null,
      kts_fehler: false,
      kts_fehler_beschreibung: null
    };
  }
  return {
    ...payload,
    kts_status: KTS_STATUS_UNGEPRUEFT,
    kts_fehler: false,
    kts_fehler_beschreibung: null
  };
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
  if (ktsAppliesNext !== ktsAppliesWas) {
    rawPatch.kts_document_applies = ktsAppliesNext;
  }
  if (
    ktsAppliesNext !== ktsAppliesWas ||
    input.ktsSourceForSave !== ktsSourceWas
  ) {
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

/**
 * Admin verified document — ready for handover batch (PR3.3).
 * Valid from: `ungeprueft`. Invalid: `in_korrektur` — use receiveKtsCorrection first.
 */
export async function markKtsChecked(tripId: string): Promise<Trip> {
  return updateTripKts(tripId, { kts_status: KTS_STATUS_KORREKT });
}

/**
 * Updates kts_patient_id snapshot on an existing trip.
 * Does not touch kts_status or kts_fehler — patient ID is identity, not workflow.
 */
export async function updateKtsPatientId(
  tripId: string,
  patientId: string | null
): Promise<Trip> {
  return updateTripKts(tripId, { kts_patient_id: patientId || null });
}

/**
 * Record error before sending to issuer.
 * Valid from: `ungeprueft`, `korrekt` (re-open). Invalid: `in_korrektur`.
 */
export async function markKtsFehlerhaft(
  tripId: string,
  beschreibung: string
): Promise<Trip> {
  return updateTripKts(tripId, {
    kts_status: KTS_STATUS_FEHLERHAFT,
    kts_fehler_beschreibung: beschreibung.trim() || null
  });
}

/**
 * Admin cleared a false-positive error — back to ungeprueft for re-check.
 * Valid from: `fehlerhaft`. Do not use markKtsFehlerhaft with empty text (that stays fehlerhaft).
 */
export async function clearKtsMistake(tripId: string): Promise<Trip> {
  return updateTripKts(tripId, {
    kts_status: KTS_STATUS_UNGEPRUEFT,
    kts_fehler: false,
    kts_fehler_beschreibung: null
  });
}

export interface SendKtsCorrectionPayload {
  tripId: string;
  companyId: string;
  sentTo: string;
  sentAt?: Date;
  notes?: string;
}

/**
 * Physical send to issuer — opens correction round and moves document to in_korrektur.
 * Valid from: `fehlerhaft`. Invalid: `ungeprueft` (use markKtsFehlerhaft first).
 * why: correction insert + trip status update belong together — document location is atomic intent.
 */
export async function sendKtsCorrection(
  supabase: SupabaseClient,
  payload: SendKtsCorrectionPayload
): Promise<{ trip: Trip; correction: KtsCorrection }> {
  const sentAt = payload.sentAt ?? new Date();
  const correction = await insertKtsCorrection(supabase, {
    tripId: payload.tripId,
    companyId: payload.companyId,
    sentTo: payload.sentTo,
    sentAt,
    notes: payload.notes
  });

  try {
    const trip = await updateTripKts(payload.tripId, {
      kts_status: KTS_STATUS_IN_KORREKTUR
    });
    return { trip, correction };
  } catch (err) {
    console.error(
      '[sendKtsCorrection] trip status update failed after correction insert',
      { tripId: payload.tripId, correctionId: correction.id, err }
    );
    throw err;
  }
}

export interface ReceiveKtsCorrectionPayload {
  tripId: string;
  correctionId: string;
  receivedAt?: Date;
}

/**
 * Corrected document returned — re-check required before markKtsChecked.
 * Valid from: `in_korrektur` with open round. Invalid: `fehlerhaft` (nothing sent yet).
 * why: returned doc goes to ungeprueft not korrekt — admin must re-verify physical paper.
 */
export async function receiveKtsCorrection(
  supabase: SupabaseClient,
  payload: ReceiveKtsCorrectionPayload
): Promise<{ trip: Trip; correction: KtsCorrection }> {
  const receivedAt = payload.receivedAt ?? new Date();
  const correction = await closeKtsCorrection(
    supabase,
    payload.correctionId,
    receivedAt
  );

  const trip = await updateTripKts(payload.tripId, {
    kts_status: KTS_STATUS_UNGEPRUEFT
  });

  return { trip, correction };
}

/** PR3.3 batch handover — atomic RPC transitions korrekt trips to uebergeben. */
export interface CreateKtsHandoverPayload {
  companyId: string;
  tripIds: string[];
}

export type KtsHandover = Database['public']['Tables']['kts_handovers']['Row'];

/**
 * why: RPC throws English Postgres messages — map known error strings to
 * German UI copy before they reach the actions cell or bulk bar error state.
 */
function mapCreateKtsHandoverError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);

  if (
    msg.includes('not eligible') ||
    (msg.includes('updated') && msg.includes('expected'))
  ) {
    return new Error(
      'Eine oder mehrere Fahrten sind nicht mehr übergabebereit. ' +
        'Bitte die Seite aktualisieren und erneut versuchen.'
    );
  }
  if (msg.includes('unauthorized')) {
    return new Error(
      'Sie haben keine Berechtigung, diese Übergabe durchzuführen.'
    );
  }
  if (msg.includes('must not be empty') || msg.includes('trip list')) {
    return new Error('Es muss mindestens eine Fahrt ausgewählt sein.');
  }
  return new Error('Übergabe fehlgeschlagen. Bitte erneut versuchen.');
}

export async function createKtsHandover(
  supabase: SupabaseClient,
  payload: CreateKtsHandoverPayload
): Promise<{ handoverId: string }> {
  if (payload.tripIds.length === 0) {
    throw new Error('Es muss mindestens ein KTS-Beleg ausgewählt sein.');
  }

  const { data, error } = await supabase.rpc('create_kts_handover', {
    p_company_id: payload.companyId,
    p_trip_ids: payload.tripIds
  });

  if (error) {
    throw mapCreateKtsHandoverError(error);
  }

  if (!data) {
    throw new Error('Übergabe konnte nicht erstellt werden.');
  }

  return { handoverId: data };
}

// --- PR4.1 accountant CSV import ---

/** Trip slice loaded for client-side CSV matching (PR4.1). */
export interface KtsCandidateTrip {
  id: string;
  scheduled_at: string | null;
  kts_patient_id: string | null;
  client_name: string | null;
  client_id: string | null;
  kts_status: KtsStatus | null;
  kts_belegnummer: string | null;
  kts_handover_id: string | null;
  clients: {
    first_name: string | null;
    last_name: string | null;
  } | null;
}

const KTS_CANDIDATE_SELECT = `
  id,
  scheduled_at,
  kts_patient_id,
  client_name,
  client_id,
  kts_status,
  kts_belegnummer,
  kts_handover_id,
  clients(first_name, last_name)
`;

/**
 * why: KTS queue RSC page is paginated — import matching needs the full company backlog,
 * including non-uebergeben trips the admin may still invoice.
 */
export async function fetchKtsCandidateTrips(
  supabase: SupabaseClient,
  companyId: string
): Promise<KtsCandidateTrip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select(KTS_CANDIDATE_SELECT)
    .eq('company_id', companyId)
    .eq('kts_document_applies', true);

  if (error) {
    throw new Error('KTS-Fahrten konnten nicht geladen werden.');
  }

  return (data ?? []).map((row) => {
    const clientsRaw = row.clients as
      | { first_name: string | null; last_name: string | null }
      | { first_name: string | null; last_name: string | null }[]
      | null;

    const clients = Array.isArray(clientsRaw)
      ? (clientsRaw[0] ?? null)
      : clientsRaw;

    return {
      id: row.id,
      scheduled_at: row.scheduled_at,
      kts_patient_id: row.kts_patient_id,
      client_name: row.client_name,
      client_id: row.client_id,
      kts_status: row.kts_status,
      kts_belegnummer: row.kts_belegnummer,
      kts_handover_id: row.kts_handover_id,
      clients
    } satisfies KtsCandidateTrip;
  });
}

export interface ApplyKtsInvoiceImportPayload {
  companyId: string;
  rows: Array<{
    tripId: string;
    belegnummer: string;
    invoiceAmount: number;
    eigenanteil: number;
    patientId?: string | null;
  }>;
  handoverId?: string | null;
  sourceFilename?: string | null;
}

function mapApplyKtsInvoiceImportError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('unauthorized')) {
    return new Error(
      'Sie haben keine Berechtigung, diesen Import durchzuführen.'
    );
  }
  if (msg.includes('must not be empty') || msg.includes('row list')) {
    return new Error('Es muss mindestens eine Fahrt ausgewählt sein.');
  }
  if (msg.includes('not found') || msg.includes('wrong company')) {
    return new Error(
      'Eine oder mehrere Fahrten konnten nicht zugeordnet werden. ' +
        'Bitte die Seite aktualisieren und erneut versuchen.'
    );
  }
  if (msg.includes('not a KTS case')) {
    return new Error('Eine oder mehrere Fahrten sind keine KTS-Fälle.');
  }
  return new Error('Import fehlgeschlagen. Bitte erneut versuchen.');
}

/**
 * why: RPC expects pre-matched rows from PR4.1 preview — client-side cascade, atomic DB commit.
 */
export async function applyKtsInvoiceImport(
  supabase: SupabaseClient,
  payload: ApplyKtsInvoiceImportPayload
): Promise<{ importId: string }> {
  if (payload.rows.length === 0) {
    throw new Error('Es muss mindestens eine Fahrt ausgewählt sein.');
  }

  const pRows = payload.rows.map((row) => ({
    trip_id: row.tripId,
    belegnummer: row.belegnummer,
    invoice_amount: row.invoiceAmount,
    eigenanteil: row.eigenanteil,
    patient_id: row.patientId ?? null
  }));

  const { data, error } = await supabase.rpc('apply_kts_invoice_import', {
    p_company_id: payload.companyId,
    p_rows: pRows,
    p_handover_id: payload.handoverId ?? null,
    p_source_filename: payload.sourceFilename ?? null
  });

  if (error) {
    throw mapApplyKtsInvoiceImportError(error);
  }

  if (!data) {
    throw new Error('Import konnte nicht abgeschlossen werden.');
  }

  return { importId: data };
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
