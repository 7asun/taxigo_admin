/**
 * Pure helpers for KTS accountant CSV import (PR4.1).
 * No Supabase — matching runs client-side against candidate trips from the hook layer.
 */

import { clientDisplayNameFromParts } from '@/features/trips/trip-detail-sheet/lib/build-trip-details-patch';
import { parseScheduledAtOrFallback } from '@/features/trips/lib/trip-time';
import type { KtsCandidateTrip } from '@/features/kts/kts.service';
import type { KtsStatus } from '@/features/kts/kts.service';

export const KTS_ACCOUNTANT_CSV_HEADERS = [
  'Transportdatum',
  'Patient',
  'Belegnummer',
  'Gesamtpreis',
  'Eigenanteil'
] as const;

export const INVALID_KTS_ACCOUNTANT_CSV_MESSAGE =
  'Die Datei konnte nicht verarbeitet werden. Bitte prüfen Sie, ob es sich um die korrekte KTS-Abrechnungsdatei handelt.';

export class InvalidKtsAccountantCsvError extends Error {
  constructor(message = INVALID_KTS_ACCOUNTANT_CSV_MESSAGE) {
    super(message);
    this.name = 'InvalidKtsAccountantCsvError';
  }
}

export type KtsCsvRow = {
  rowIndex: number;
  transportdatum: string;
  patient: string;
  belegnummer: string;
  gesamtpreis: number;
  eigenanteil: number;
};

export type KtsMatchPreviewRow = {
  rowKey: string;
  csvRowIndex: number;
  tripId: string | null;
  transportdatum: string;
  patient: string;
  belegnummer: string;
  gesamtpreis: number;
  eigenanteil: number;
  tripScheduledAt: string | null;
  tripPassengerName: string | null;
  ktsStatus: KtsStatus | null;
  notUebergebenHint: boolean;
  lowConfidenceReason: string | null;
  existingBelegnummer: string | null;
  /** Schein-ID from CSV — written back to trip on commit when admin checks the row (PR4.1.1). */
  patientId: string | null;
};

export type KtsMatchResult = {
  matched: KtsMatchPreviewRow[];
  lowConfidence: KtsMatchPreviewRow[];
  unmatched: KtsMatchPreviewRow[];
  bereitsImportiert: KtsMatchPreviewRow[];
};

/**
 * why: bank CSVs and Fahrten exports share .csv extension but wrong columns produce nonsense
 * buckets — fail fast before matching instead of silent wrong trip links.
 */
export function validateKtsAccountantCsvHeaders(
  fields: string[] | undefined
): void {
  if (!fields?.length) {
    throw new InvalidKtsAccountantCsvError();
  }
  for (const header of KTS_ACCOUNTANT_CSV_HEADERS) {
    if (!fields.includes(header)) {
      throw new InvalidKtsAccountantCsvError();
    }
  }
}

/**
 * why: accountant CSV stores "Nachname, Vorname … (Schein-ID)" but trips.client_name is
 * always "Vorname Nachname" — inversion + Schein-ID extraction must happen before compare.
 * Schein-ID 0 is a sentinel meaning "no ID" in the accountant export.
 */
export function normalizeCsvPatientName(raw: string): {
  lastName: string;
  firstName: string;
  normalized: string;
  scheinId: string | null;
} {
  const trimmed = raw.trim();
  const scheinMatch = trimmed.match(/\((\d+)\)\s*$/);
  const scheinIdRaw = scheinMatch?.[1] ?? null;
  const scheinId = scheinIdRaw && scheinIdRaw !== '0' ? scheinIdRaw : null;

  const withoutSchein = scheinMatch
    ? trimmed.slice(0, scheinMatch.index).trim()
    : trimmed;

  const commaIdx = withoutSchein.indexOf(',');
  let lastName = '';
  let firstName = '';

  if (commaIdx >= 0) {
    lastName = withoutSchein.slice(0, commaIdx).trim();
    const rest = withoutSchein.slice(commaIdx + 1).trim();
    firstName = rest.split(/\s+/)[0]?.trim() ?? '';
  } else {
    const parts = withoutSchein.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts[0] ?? '';
      lastName = parts[parts.length - 1] ?? '';
    } else if (parts.length === 1) {
      lastName = parts[0] ?? '';
    }
  }

  return {
    lastName,
    firstName,
    normalized: clientDisplayNameFromParts(firstName, lastName),
    scheinId
  };
}

/**
 * why: accountant amounts use German formatting (€, comma decimal) — parseFloat on raw
 * strings silently misreads "12,50" as 12.
 */
export function parseGermanAmount(raw: string): number | null {
  const normalized = raw
    .trim()
    .replace(/[€\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  if (!normalized) return null;
  const value = parseFloat(normalized);
  return Number.isNaN(value) ? null : value;
}

/**
 * why: Transportdatum is a Berlin calendar day — must align with parseScheduledAtOrFallback
 * on trips.scheduled_at, not UTC date math or naive ISO prefix compare.
 */
export function parseGermanDate(raw: string): string | null {
  const trimmed = raw.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);

  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12 ||
    year < 1900
  ) {
    return null;
  }

  const ymd = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return ymd;
}

function normalizeCompareName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tripDisplayName(trip: KtsCandidateTrip): string {
  if (trip.client_id && trip.clients) {
    return clientDisplayNameFromParts(
      trip.clients.first_name ?? '',
      trip.clients.last_name ?? ''
    );
  }
  return trip.client_name?.trim() ?? '';
}

function tripBerlinYmd(trip: KtsCandidateTrip): string | null {
  if (!trip.scheduled_at) return null;
  return parseScheduledAtOrFallback(trip.scheduled_at)?.ymd ?? null;
}

function tripsOnDate(
  trips: KtsCandidateTrip[],
  ymd: string
): KtsCandidateTrip[] {
  return trips.filter((t) => tripBerlinYmd(t) === ymd);
}

function allShareSameBelegnummer(trips: KtsCandidateTrip[]): boolean {
  if (trips.length <= 1) return true;
  const belegSet = new Set(trips.map((t) => t.kts_belegnummer?.trim() ?? ''));
  return belegSet.size <= 1;
}

function hasPartialNameMatch(normalized: string, candidate: string): boolean {
  const a = normalizeCompareName(normalized);
  const b = normalizeCompareName(candidate);
  if (!a || !b) return false;
  if (a === b) return false;
  const aTokens = a.split(' ').filter(Boolean);
  const bTokens = b.split(' ').filter(Boolean);
  return aTokens.some((t) => bTokens.includes(t));
}

function buildPreviewRow(
  csvRow: KtsCsvRow,
  trip: KtsCandidateTrip | null,
  opts: {
    lowConfidenceReason?: string | null;
    existingBelegnummer?: string | null;
  } = {}
): KtsMatchPreviewRow {
  const tripId = trip?.id ?? null;
  const rowKey = tripId
    ? `${csvRow.rowIndex}-${tripId}`
    : `${csvRow.rowIndex}-unmatched`;
  const { scheinId } = normalizeCsvPatientName(csvRow.patient);

  return {
    rowKey,
    csvRowIndex: csvRow.rowIndex,
    tripId,
    transportdatum: csvRow.transportdatum,
    patient: csvRow.patient,
    belegnummer: csvRow.belegnummer,
    gesamtpreis: csvRow.gesamtpreis,
    eigenanteil: csvRow.eigenanteil,
    tripScheduledAt: trip?.scheduled_at ?? null,
    tripPassengerName: trip ? tripDisplayName(trip) : null,
    ktsStatus: trip?.kts_status ?? null,
    notUebergebenHint: !!trip && trip.kts_status !== 'uebergeben',
    lowConfidenceReason: opts.lowConfidenceReason ?? null,
    existingBelegnummer: opts.existingBelegnummer ?? null,
    patientId: scheinId
  };
}

function dedupeTripsById(trips: KtsCandidateTrip[]): KtsCandidateTrip[] {
  const seen = new Set<string>();
  const out: KtsCandidateTrip[] = [];
  for (const trip of trips) {
    if (seen.has(trip.id)) continue;
    seen.add(trip.id);
    out.push(trip);
  }
  return out;
}

function previewDedupeKey(csvRowIndex: number, tripId: string | null): string {
  return `${csvRowIndex}:${tripId ?? 'unmatched'}`;
}

function pushUniquePreviewRow(
  bucket: KtsMatchPreviewRow[],
  seen: Set<string>,
  row: KtsMatchPreviewRow
): void {
  const key = previewDedupeKey(row.csvRowIndex, row.tripId);
  if (seen.has(key)) return;
  seen.add(key);
  bucket.push(row);
}

function partitionByImportStatus(
  csvRow: KtsCsvRow,
  trips: KtsCandidateTrip[],
  bucket: 'matched' | 'lowConfidence',
  lowConfidenceReason: string | null,
  result: KtsMatchResult,
  seen: Set<string>
): void {
  const uniqueTrips = dedupeTripsById(trips);
  const alreadyImported = uniqueTrips.filter((t) => t.kts_belegnummer != null);
  const fresh = uniqueTrips.filter((t) => t.kts_belegnummer == null);

  for (const trip of alreadyImported) {
    pushUniquePreviewRow(
      result.bereitsImportiert,
      seen,
      buildPreviewRow(csvRow, trip, {
        existingBelegnummer: trip.kts_belegnummer
      })
    );
  }

  for (const trip of fresh) {
    const row = buildPreviewRow(csvRow, trip, {
      lowConfidenceReason:
        bucket === 'lowConfidence' ? lowConfidenceReason : null
    });
    if (bucket === 'matched') {
      pushUniquePreviewRow(result.matched, seen, row);
    } else {
      pushUniquePreviewRow(result.lowConfidence, seen, row);
    }
  }
}

function sortTripsByScheduledAtAsc(
  trips: KtsCandidateTrip[]
): KtsCandidateTrip[] {
  return [...trips].sort((a, b) => {
    const aTime = a.scheduled_at ?? '';
    const bTime = b.scheduled_at ?? '';
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });
}

function matchSingleRow(
  csvRow: KtsCsvRow,
  trips: KtsCandidateTrip[],
  transportYmd: string,
  result: KtsMatchResult,
  seen: Set<string>,
  consumedTripIds: Set<string>
): void {
  const { normalized, scheinId } = normalizeCsvPatientName(csvRow.patient);
  const dateCandidates = dedupeTripsById(
    tripsOnDate(trips, transportYmd).filter((t) => !consumedTripIds.has(t.id))
  );

  if (scheinId) {
    const idMatches = dedupeTripsById(
      dateCandidates.filter(
        (t) => (t.kts_patient_id?.trim() ?? '') === scheinId
      )
    );

    if (idMatches.length > 0) {
      if (idMatches.length > 1 && !allShareSameBelegnummer(idMatches)) {
        const claimed = sortTripsByScheduledAtAsc(idMatches)[0]!;
        consumedTripIds.add(claimed.id);
        partitionByImportStatus(
          csvRow,
          [claimed],
          'lowConfidence',
          'Mehrere mögliche Fahrten',
          result,
          seen
        );
      } else {
        const claimed = sortTripsByScheduledAtAsc(idMatches)[0]!;
        consumedTripIds.add(claimed.id);
        partitionByImportStatus(
          csvRow,
          [claimed],
          'matched',
          null,
          result,
          seen
        );
      }
      return;
    }
  }

  if (dateCandidates.length === 0) {
    pushUniquePreviewRow(result.unmatched, seen, buildPreviewRow(csvRow, null));
    return;
  }

  const exactMatches: KtsCandidateTrip[] = [];
  const partialMatches: KtsCandidateTrip[] = [];
  const exactIds = new Set<string>();
  const partialIds = new Set<string>();

  for (const trip of dateCandidates) {
    const display = tripDisplayName(trip);
    if (!display) continue;

    if (normalizeCompareName(display) === normalizeCompareName(normalized)) {
      if (!exactIds.has(trip.id)) {
        exactIds.add(trip.id);
        exactMatches.push(trip);
      }
    } else if (
      !exactIds.has(trip.id) &&
      hasPartialNameMatch(normalized, display) &&
      !partialIds.has(trip.id)
    ) {
      partialIds.add(trip.id);
      partialMatches.push(trip);
    }
  }

  if (exactMatches.length > 1 && !allShareSameBelegnummer(exactMatches)) {
    const claimed = sortTripsByScheduledAtAsc(exactMatches)[0]!;
    consumedTripIds.add(claimed.id);
    partitionByImportStatus(
      csvRow,
      [claimed],
      'lowConfidence',
      'Mehrere mögliche Fahrten',
      result,
      seen
    );
    return;
  }

  if (exactMatches.length >= 1) {
    // One trip per CSV row: accountant files list outbound and return as separate
    // lines with identical patient/date/belegnummer. Assigning all date-matches to
    // every CSV row produces N×M duplicates. Sorting by scheduled_at and claiming the
    // earliest unclaimed trip ensures row 0 → 07:30 trip, row 1 → 09:00 trip.
    const claimed = sortTripsByScheduledAtAsc(exactMatches)[0]!;
    consumedTripIds.add(claimed.id);
    partitionByImportStatus(csvRow, [claimed], 'matched', null, result, seen);
    return;
  }

  if (partialMatches.length >= 1) {
    // WHY: same one-trip-per-CSV-row rule applies to low-confidence matches — without
    // consuming, the same ambiguous trip is offered to every subsequent CSV row that
    // also fails exact match.
    const claimedPartial = sortTripsByScheduledAtAsc(partialMatches)[0]!;
    consumedTripIds.add(claimedPartial.id);
    partitionByImportStatus(
      csvRow,
      [claimedPartial],
      'lowConfidence',
      partialMatches.length === 1
        ? 'Namensübereinstimmung'
        : 'Mehrere mögliche Fahrten',
      result,
      seen
    );
    return;
  }

  pushUniquePreviewRow(result.unmatched, seen, buildPreviewRow(csvRow, null));
}

function emptyResult(): KtsMatchResult {
  return {
    matched: [],
    lowConfidence: [],
    unmatched: [],
    bereitsImportiert: []
  };
}

export function parseKtsCsvRows(data: Record<string, string>[]): KtsCsvRow[] {
  const rows: KtsCsvRow[] = [];

  data.forEach((raw, index) => {
    const transportdatum = raw.Transportdatum?.trim() ?? '';
    const patient = raw.Patient?.trim() ?? '';
    const belegnummer = raw.Belegnummer?.trim() ?? '';

    if (!transportdatum && !patient && !belegnummer) {
      return;
    }

    const gesamtpreis = parseGermanAmount(raw.Gesamtpreis ?? '');
    const eigenanteil = parseGermanAmount(raw.Eigenanteil ?? '');

    if (gesamtpreis === null || eigenanteil === null) {
      return;
    }

    rows.push({
      rowIndex: index,
      transportdatum,
      patient,
      belegnummer,
      gesamtpreis,
      eigenanteil
    });
  });

  return rows;
}

/**
 * why: outbound + return share one CSV Belegnummer — each matched trip becomes its own
 * preview row; already-imported trips are moved to skip bucket regardless of match quality.
 */
export function matchKtsCsvRows(
  csvRows: KtsCsvRow[],
  trips: KtsCandidateTrip[]
): KtsMatchResult {
  const result = emptyResult();
  const seen = new Set<string>();
  const consumedTripIds = new Set<string>();

  for (const csvRow of csvRows) {
    const transportYmd = parseGermanDate(csvRow.transportdatum);
    if (!transportYmd) {
      pushUniquePreviewRow(
        result.unmatched,
        seen,
        buildPreviewRow(csvRow, null)
      );
      continue;
    }
    matchSingleRow(csvRow, trips, transportYmd, result, seen, consumedTripIds);
  }

  return result;
}
