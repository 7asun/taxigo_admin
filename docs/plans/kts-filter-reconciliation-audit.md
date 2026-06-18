# KTS Filter Reconciliation Audit

Read-only reconciliation audit. Files read completely: `src/features/trips/components/trips-filters-bar.tsx`, `src/features/trips/components/trips-listing.tsx`, `src/lib/searchparams.ts`, `src/lib/parsers.ts`, `docs/plans/kts-filter-audit.md`, `docs/plans/kts-pr2-columns-audit.md`, and `docs/plans/kts-reha-audit.md`. Repo-wide search found no dedicated `buildKtsFilterCondition` helper and no alternate production server path that reads the trips-list KTS URL filter; the server application is inline in `trips-listing.tsx`.

## 1. Client Contract

The current client reads and writes URL param `kts_filter`, not `ktsfilter`.

Client evidence:

- The local comment says allowed `kts_filter` URL tokens are comma-joined (`src/features/trips/components/trips-filters-bar.tsx:75`).
- The client allowlist is `KTS_FILTER_VALUES = ['kts', 'kts_fehler', 'no_kts', 'no_reha', 'reha']` (`src/features/trips/components/trips-filters-bar.tsx:75-83`).
- The option rows emit the same values: `kts`, `kts_fehler`, `reha`, `no_kts`, `no_reha` (`src/features/trips/components/trips-filters-bar.tsx:85-91`).
- The client reads `const ktsParam = searchParams.get('kts_filter')` (`src/features/trips/components/trips-filters-bar.tsx:121-124`).
- The client parses that raw param with `parseCommaSeparatedIds`, then filters against `KTS_FILTER_VALUES` (`src/features/trips/components/trips-filters-bar.tsx:124-131`).
- Toggling a KTS option calls `updateFilters({ kts_filter: arr.length > 0 ? arr : null })`, and `updateFilters` serializes arrays with `value.join(',')` (`src/features/trips/components/trips-filters-bar.tsx:291-308`, `src/features/trips/components/trips-filters-bar.tsx:386-392`).
- Clearing KTS and the global reset both remove `kts_filter` (`src/features/trips/components/trips-filters-bar.tsx:394-396`, `src/features/trips/components/trips-filters-bar.tsx:838-848`).

I found no current client code in `trips-filters-bar.tsx` that reads or writes `ktsfilter`, `ktsfehler`, `nokts`, or `noreha`.

## 2. Server Contract

The current server/RSC/parser also reads URL param `kts_filter`, not `ktsfilter`.

Server/parser evidence:

- `src/lib/searchparams.ts` defines `kts_filter: parseAsArrayOf(parseAsString, ',')`, with a comment listing `kts | kts_fehler | no_kts | no_reha | reha` (`src/lib/searchparams.ts:1-8`, `src/lib/searchparams.ts:17-25`).
- `trips-listing.tsx` defines server allowlist `TRIPS_KTS_FILTER_QUERY_VALUES = new Set(['kts', 'kts_fehler', 'no_kts', 'no_reha', 'reha'])` (`src/features/trips/components/trips-listing.tsx:38-45`).
- The RSC parses the route search params via `await searchParamsCache.parse(searchParams)` (`src/features/trips/components/trips-listing.tsx:52-55`).
- The RSC reads `searchParamsCache.get('kts_filter')`, defaults to `[]`, and filters against `TRIPS_KTS_FILTER_QUERY_VALUES` (`src/features/trips/components/trips-listing.tsx:61-71`).
- `src/lib/parsers.ts` contains sorting/filter-state parser helpers only; it does not define or reference `kts_filter`/`ktsfilter` (`src/lib/parsers.ts:1-110`).

The server-side filter is applied inline to the Supabase query in `trips-listing.tsx`, after `supabase.from('trips').select(...)` is created (`src/features/trips/components/trips-listing.tsx:120-124`, `src/features/trips/components/trips-listing.tsx:147-192`).

## 3. Contract Mismatch Check

Within the current repo snapshot, the client and server contracts match:

- Param: `kts_filter` on both client and server.
- Tokens: `kts`, `kts_fehler`, `no_kts`, `no_reha`, `reha` on both client and server.
- Serialization: comma-separated values on the client; comma-separated array parser on the server.

There is no current client/server mismatch between `trips-filters-bar.tsx`, `searchparams.ts`, and `trips-listing.tsx`.

There is a mismatch only between the user-provided/pasted contract and the current repo:

- Pasted contract: `ktsfilter`, `ktsfehler`, `nokts`, `noreha`.
- Current repo contract: `kts_filter`, `kts_fehler`, `no_kts`, `no_reha`.

User-visible behavior if a URL uses the pasted contract against this current code:

- `?ktsfilter=nokts,noreha` is ignored entirely because neither the client nor the parser/RSC reads `ktsfilter`.
- `?kts_filter=nokts,noreha` is read but both tokens are dropped because neither `nokts` nor `noreha` exists in the client/server allowlists (`src/features/trips/components/trips-filters-bar.tsx:124-131`, `src/features/trips/components/trips-listing.tsx:69-71`).
- A user selecting the current UI options will produce `?kts_filter=no_kts,no_reha`, which the server does understand.

## 4. Multi-Select Semantics

Since the current contracts match, the likely live bug is multi-select semantics.

The RSC builds one PostgREST condition per selected token (`src/features/trips/components/trips-listing.tsx:147-171`):

- `kts` -> `kts_document_applies.eq.true` (`src/features/trips/components/trips-listing.tsx:153-155`).
- `kts_fehler` -> `and(kts_document_applies.eq.true,kts_fehler.eq.true)` (`src/features/trips/components/trips-listing.tsx:156-160`).
- `no_kts` -> `kts_document_applies.eq.false` (`src/features/trips/components/trips-listing.tsx:161-163`).
- `no_reha` -> `reha_schein.eq.false` (`src/features/trips/components/trips-listing.tsx:164-166`).
- `reha` -> `reha_schein.eq.true` (`src/features/trips/components/trips-listing.tsx:167-169`).

Single-token selections are applied with direct `.eq(...)` calls (`src/features/trips/components/trips-listing.tsx:173-187`). Multi-token selections are combined with `query.or(uniqueKtsConditions.join(','))` (`src/features/trips/components/trips-listing.tsx:188-190`).

Therefore `no_kts + no_reha` becomes:

```text
kts_document_applies = false OR reha_schein = false
```

It does not become:

```text
kts_document_applies = false AND reha_schein = false
```

So a user selecting “Kein KTS” and “Kein Reha-Schein” will see trips where either field is false, not only trips where both are false.

## 5. Stale Audit / Branch Drift

`docs/plans/kts-filter-audit.md` exists and matches the current repo snapshot. It states `kts_filter`, `kts_fehler`, `no_kts`, `no_reha`, and calls out the OR-vs-AND issue (`docs/plans/kts-filter-audit.md:1-13`, `docs/plans/kts-filter-audit.md:29-41`, `docs/plans/kts-filter-audit.md:73-79`).

`docs/plans/kts-pr2-columns-audit.md` also matches the current repo snapshot for this filter. It documents `kts_filter` comma-separated tokens `kts`, `kts_fehler`, `no_kts`, `no_reha`, `reha`, and says they are applied in `trips-listing.tsx` with `.eq(...)` and `.or(...)` for multi-select (`docs/plans/kts-pr2-columns-audit.md:269-283`).

`docs/plans/kts-reha-audit.md` is related KTS/Reha context but not a current KTS URL filter contract source. It explicitly notes an older `docs/plans/kts-audit.md` is partly outdated because it predates `kts_fehler` (`docs/plans/kts-reha-audit.md:1-6`).

Conclusion: the existing `docs/plans/kts-filter-audit.md` is not stale relative to the current workspace. The conflicting `ktsfilter`/`nokts` evidence is most likely stale pasted context or branch-specific evidence from a different version of `trips-filters-bar.tsx`.

## 6. Maintainability Extraction Candidate

Yes. A shared helper such as `src/features/trips/lib/kts-filter.ts` would remove duplicated and drift-prone contract logic between client and server.

Move these pieces there:

- `KTS_FILTER_VALUES` / token allowlist, currently duplicated as client `KTS_FILTER_VALUES` and server `TRIPS_KTS_FILTER_QUERY_VALUES` (`src/features/trips/components/trips-filters-bar.tsx:75-83`, `src/features/trips/components/trips-listing.tsx:38-45`).
- A `KtsFilterValue` type exported from the shared token tuple (`src/features/trips/components/trips-filters-bar.tsx:83`).
- UI option rows or at least token-to-label mapping for `Nur KTS`, `Nur KTS-Fehler`, `Nur Reha-Schein`, `Kein KTS`, `Kein Reha-Schein` (`src/features/trips/components/trips-filters-bar.tsx:85-91`).
- `parseCommaSeparatedIds` or a KTS-specific parser/normalizer that filters unknown tokens (`src/features/trips/components/trips-filters-bar.tsx:93-96`, `src/features/trips/components/trips-filters-bar.tsx:124-131`).
- Trigger-label derivation for zero/one/many selections (`src/features/trips/components/trips-filters-bar.tsx:368-379`).
- Toggle/clear selection helpers used by the popover (`src/features/trips/components/trips-filters-bar.tsx:381-396`).
- Server condition mapping from token to PostgREST condition or direct Supabase query operation (`src/features/trips/components/trips-listing.tsx:147-190`).
- The semantic combiner for multiple tokens, especially the special `no_kts + no_reha` intersection rule if product wants “both empty”.

The helper should be feature-level, not generic, because these tokens encode `trips` table business semantics: `kts_document_applies`, `kts_fehler`, and `reha_schein`.

## Root Cause

In the current repo, the bug is not a client/server naming mismatch. The client, parser, and RSC all use `kts_filter` and underscore tokens. The live behavioral root cause is multi-select OR semantics in `trips-listing.tsx:188-190`: `no_kts` plus `no_reha` returns rows matching either negative state, while the reported expectation is rows matching both negative states. The broader confusion comes from branch drift or stale pasted evidence that refers to a different contract (`ktsfilter`, `nokts`, `noreha`, `ktsfehler`) than this workspace currently implements.

## Recommended Next Step

Treat `kts_filter` plus underscore tokens as the current contract unless product intentionally wants to rename the URL API. Fix the semantics by centralizing KTS filter tokens and condition-building in `src/features/trips/lib/kts-filter.ts`, then encode the desired `no_kts + no_reha` behavior as an explicit intersection instead of letting it fall through the generic multi-token `OR`.

---

## Implementation Status (applied)

**Implemented** as part of `kts-filter-fix` plan. All changes are in the current workspace.

### New shared helper

`src/features/trips/lib/kts-filter.ts` is now the single source of truth for the `kts_filter` URL contract. It exports:

- `KTS_FILTER_VALUES` and `KtsFilterValue` — the canonical token allowlist.
- `KTS_FILTER_OPTION_ROWS` — German UI labels for the popover.
- `normalizeKtsFilterValues(raw)` — strips unknown tokens, deduplicates.
- `parseKtsFilterParam(param)` — parses a raw `searchParams.get('kts_filter')` string.
- `getKtsFilterTriggerLabel(values)` — derives the popover trigger text.
- `buildKtsTripFilterPlan(values)` — returns a semantic discriminated union:
  - `{ mode: 'none' }` — no filter active.
  - `{ mode: 'single'; token }` — exactly one token selected.
  - `{ mode: 'missing-both' }` — **only** `no_kts + no_reha` selected → AND semantics.
  - `{ mode: 'any-of'; tokens; includeMissingBoth? }` — multiple tokens; when `includeMissingBoth: true`, the negative pair is still grouped as an AND.

### Client changes

`trips-filters-bar.tsx` now imports `KTS_FILTER_OPTION_ROWS`, `KtsFilterValue`, `parseKtsFilterParam`, and `getKtsFilterTriggerLabel` from the helper. The local `KTS_FILTER_VALUES`, `KtsFilterValue`, and `KTS_FILTER_OPTION_ROWS` constants were removed; the `ktsTriggerLabel` memo was replaced with a call to the shared label function.

### Server changes

`trips-listing.tsx` now imports `normalizeKtsFilterValues` and `buildKtsTripFilterPlan` from the helper. `TRIPS_KTS_FILTER_QUERY_VALUES` was removed. The inline condition-building block was replaced by a `switch` on the semantic plan:

- `single` → same chained `.eq` calls as before (no `or(...)` overhead).
- `missing-both` → `query.eq('kts_document_applies', false).eq('reha_schein', false)` — **AND**, not OR.
- `any-of` → `query.or(orParts.join(','))` where the negative pair, when present, is expressed as `and(kts_document_applies.eq.false,reha_schein.eq.false)` inside the OR list.

### Tests

`src/features/trips/lib/__tests__/kts-filter.test.ts` — 23 tests covering normalization, label derivation, single-token plans, `no_kts + no_reha` as AND, invalid-token stripping, and the mixed `kts + no_kts + no_reha` case. All pass.
