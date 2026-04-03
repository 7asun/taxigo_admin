/**
 * KTS (Krankentransportschein) default cascade: variant → familie (behavior_profile) → payer → false.
 * All trip flows (forms, CSV, cron) must use this module — do not duplicate precedence logic.
 * @see docs/kts-architecture.md
 */
import { parseBehaviorProfileRaw } from '@/features/trips/lib/normalize-billing-type-behavior-profile';

/** Resolver output tier; persisted on trips as `kts_source` together with `manual`. */
export type KtsCatalogSource =
  | 'variant'
  | 'familie'
  | 'payer'
  | 'system_default';

export type TripKtsSource = KtsCatalogSource | 'manual';

export interface ResolveKtsDefaultInput {
  payerKtsDefault: boolean | null | undefined;
  /** Parent `billing_types.behavior_profile` for the selected Unterart. */
  familyBehaviorProfile: unknown;
  variantKtsDefault: boolean | null | undefined;
}

export function normalizeKtsDefaultFromBehavior(
  familyBehaviorProfile: unknown
): 'yes' | 'no' | 'unset' {
  const b = parseBehaviorProfileRaw(familyBehaviorProfile);
  const k = b.kts_default ?? b.ktsDefault;
  if (k === 'yes' || k === true) return 'yes';
  if (k === 'no' || k === false) return 'no';
  return 'unset';
}

/** Result of parsing optional CSV cells `kts` / `kts_document` / `kts_document_applies`. */
export type KtsCsvParseResult = 'empty' | 'true' | 'false' | 'invalid';

/**
 * Parses a single CSV cell for explicit KTS override. Empty → inherit catalog cascade.
 */
export function parseKtsCsvCell(
  raw: string | undefined | null
): KtsCsvParseResult {
  const t = String(raw ?? '').trim();
  if (!t) return 'empty';
  const l = t.toLowerCase();
  if (l === 'true' || l === '1' || l === 'ja' || l === 'yes') return 'true';
  if (l === 'false' || l === '0' || l === 'nein' || l === 'no') return 'false';
  return 'invalid';
}

/** First non-empty of `kts` | `kts_document` | `kts_document_applies` (CSV header aliases). */
export function firstNonEmptyKtsCsvSource(row: {
  kts?: string;
  kts_document?: string;
  kts_document_applies?: string;
}): string {
  const keys = ['kts', 'kts_document', 'kts_document_applies'] as const;
  for (const key of keys) {
    const v = row[key];
    const t = typeof v === 'string' ? v.trim() : '';
    if (t) return t;
  }
  return '';
}

export function resolveKtsDefault(input: ResolveKtsDefaultInput): {
  value: boolean;
  source: KtsCatalogSource;
} {
  const v = input.variantKtsDefault;
  if (v !== null && v !== undefined) {
    return { value: !!v, source: 'variant' };
  }

  const kd = normalizeKtsDefaultFromBehavior(input.familyBehaviorProfile);
  if (kd === 'yes') return { value: true, source: 'familie' };
  if (kd === 'no') return { value: false, source: 'familie' };

  const pk = input.payerKtsDefault;
  if (pk !== null && pk !== undefined) {
    return { value: !!pk, source: 'payer' };
  }

  return { value: false, source: 'system_default' };
}
