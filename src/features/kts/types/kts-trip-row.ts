import type { Trip } from '@/features/trips/api/trips.service';
import type { KtsStatus } from '@/features/kts/kts.service';

export interface KtsCorrectionEmbed {
  id: string;
  sent_at: string;
  received_at: string | null;
  sent_to: string;
}

/** Row shape from KtsListingPage RSC select (trips + kts_corrections embed). */
export type KtsTripRow = Trip & {
  kts_status: KtsStatus | null;
  kts_corrections: KtsCorrectionEmbed[] | null;
};

export function getOpenKtsCorrection(
  trip: KtsTripRow
): KtsCorrectionEmbed | undefined {
  const rounds = trip.kts_corrections ?? [];
  return rounds.find((r) => r.received_at == null);
}

export function ktsCorrectionAgeDays(sentAtIso: string): number {
  const sent = new Date(sentAtIso).getTime();
  if (Number.isNaN(sent)) return 0;
  const diffMs = Date.now() - sent;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}
