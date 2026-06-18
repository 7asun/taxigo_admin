/**
 * Single source of truth for the `kts_filter` URL param contract.
 *
 * Shared between client (`trips-filters-bar.tsx`) and server (`trips-listing.tsx`).
 * Exposes only what is needed for the current feature; do not extend into a
 * generic filter DSL or larger abstract planner.
 *
 * ## Semantic combiner rule
 *
 * WHY a semantic plan instead of raw PostgREST strings: the negative-pair case
 * (`no_kts + no_reha`) must be an intersection — trips where BOTH KTS and
 * Reha-Schein are absent — not a union. Encoding this as PostgREST OR expressions
 * in-place made that intent invisible and led to the bug this module fixes.
 * Returning a discriminated-union plan lets `trips-listing.tsx` translate each
 * mode explicitly, making the AND vs OR decision traceable in one place.
 */

// ─── Token contract ──────────────────────────────────────────────────────────

/** Allowed URL tokens for `kts_filter`. Absence of the param = no KTS filter. */
export const KTS_FILTER_VALUES = [
  'kts',
  'kts_fehler',
  'no_kts',
  'no_reha',
  'reha'
] as const;

export type KtsFilterValue = (typeof KTS_FILTER_VALUES)[number];

// ─── UI label rows ────────────────────────────────────────────────────────────

export const KTS_FILTER_OPTION_ROWS: ReadonlyArray<{
  value: KtsFilterValue;
  label: string;
}> = [
  { value: 'kts', label: 'Nur KTS' },
  { value: 'kts_fehler', label: 'Nur KTS-Fehler' },
  { value: 'reha', label: 'Nur Reha-Schein' },
  { value: 'no_kts', label: 'Kein KTS' },
  { value: 'no_reha', label: 'Kein Reha-Schein' }
] as const;

// ─── Parsing / normalization ──────────────────────────────────────────────────

/**
 * Strips unknown/crafted tokens and deduplicates the incoming selection.
 * Preserves order of valid tokens to keep URL state stable.
 *
 * WHY shared here: both the filter bar (client strip) and the RSC (server
 * allowlist) previously maintained independent copies of this allowlist, which
 * could drift. One source prevents the "filter stuck on" issue described in the
 * filter bar comment.
 */
export function normalizeKtsFilterValues(
  raw: readonly string[] | null | undefined
): KtsFilterValue[] {
  if (!raw?.length) return [];
  const seen = new Set<KtsFilterValue>();
  const result: KtsFilterValue[] = [];
  for (const v of raw) {
    if (
      KTS_FILTER_VALUES.includes(v as KtsFilterValue) &&
      !seen.has(v as KtsFilterValue)
    ) {
      seen.add(v as KtsFilterValue);
      result.push(v as KtsFilterValue);
    }
  }
  return result;
}

/**
 * Parses a raw URL param string (`"no_kts,no_reha"` or `null`) into a valid
 * token array for the filter bar's `useSearchParams().get('kts_filter')` path.
 */
export function parseKtsFilterParam(param: string | null): KtsFilterValue[] {
  if (!param) return [];
  return normalizeKtsFilterValues(param.split(',').filter(Boolean));
}

// ─── Trigger label ────────────────────────────────────────────────────────────

/**
 * German display label for the KTS multi-select popover trigger button.
 */
export function getKtsFilterTriggerLabel(
  values: readonly KtsFilterValue[]
): string {
  const n = values.length;
  if (n === 0) return 'KTS: Kein Filter';
  if (n === 1) {
    return (
      KTS_FILTER_OPTION_ROWS.find((o) => o.value === values[0])?.label ?? 'KTS'
    );
  }
  return `${n} KTS-Filter`;
}

// ─── Semantic server filter plan ─────────────────────────────────────────────

/**
 * Discriminated union describing what Supabase query conditions to apply.
 *
 * Deliberately small: only the four modes needed for current product semantics.
 * `trips-listing.tsx` owns the translation into actual query calls.
 *
 * WHY `missing-both` is a distinct mode:
 * The user selecting both "Kein KTS" and "Kein Reha-Schein" means they want
 * trips where BOTH documents are absent. Treating it as two independent OR
 * branches returns trips missing only one of the two — that is the bug this
 * module fixes. A dedicated mode makes the AND intent explicit and prevents
 * future refactors from silently collapsing it back into a generic OR path.
 */
export type KtsTripFilterPlan =
  | { mode: 'none' }
  | { mode: 'single'; token: KtsFilterValue }
  | { mode: 'missing-both' }
  | { mode: 'any-of'; tokens: KtsFilterValue[]; includeMissingBoth?: true };

/**
 * Maps a normalized token selection to a semantic filter plan.
 *
 * Rules (applied in order):
 * 1. Empty selection → `none`.
 * 2. Exactly one token → `single`.
 * 3. Exactly `{no_kts, no_reha}` (in any order) → `missing-both`.
 * 4. Multiple tokens that include `no_kts + no_reha` together → `any-of` with
 *    `includeMissingBoth: true` so the translator can group that pair as an AND.
 * 5. All other multi-token selections → `any-of`.
 */
export function buildKtsTripFilterPlan(
  values: readonly KtsFilterValue[]
): KtsTripFilterPlan {
  const dedupedTokens = normalizeKtsFilterValues(values);

  if (dedupedTokens.length === 0) {
    return { mode: 'none' };
  }

  if (dedupedTokens.length === 1) {
    return { mode: 'single', token: dedupedTokens[0]! };
  }

  const hasNoKts = dedupedTokens.includes('no_kts');
  const hasNoReha = dedupedTokens.includes('no_reha');

  // WHY this branch is exact: only `no_kts + no_reha` with nothing else is the
  // "show me trips missing both documents" case. Adding more tokens means the
  // user also wants to see other states (e.g. trips WITH KTS), so OR is correct
  // for those extra tokens; the negative pair is still grouped as an AND.
  if (hasNoKts && hasNoReha && dedupedTokens.length === 2) {
    return { mode: 'missing-both' };
  }

  if (hasNoKts && hasNoReha) {
    return { mode: 'any-of', tokens: dedupedTokens, includeMissingBoth: true };
  }

  return { mode: 'any-of', tokens: dedupedTokens };
}
