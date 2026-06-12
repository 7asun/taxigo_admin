# KTS Module A — Architecture Audit

**Date:** 2026-06-10  
**Scope:** Read-only audit preparing Module A (KTS Correction Tracking) and the broader KTS data-layer decision (Option 1 vs Option 2).  
**Sources read:** `database.types.ts`, `resolve-kts-default.ts`, `kts-cells.tsx`, `trip-detail-sheet.tsx`, `build-trip-details-patch.ts`, `columns.tsx`, `docs/kts-architecture.md`, `.cursor/plans/kts_document_workflow.plan.md`, `.cursor/plans/kts-fehler_feature_6a2db4aa.plan.md`, all KTS-related Supabase migrations, `src/features/trips/lib/*`, `src/features/invoices/api/invoices.api.ts` (service pattern reference), and a full-repo grep for the four trip KTS columns.

---

## Executive summary

The codebase has **four KTS columns on `trips`** (`kts_document_applies`, `kts_source`, `kts_fehler`, `kts_fehler_beschreibung`) read or filtered in **~40 production source files** plus **3 SQL artifacts** (migrations + controlling RPC). There is **no KTS service layer**; writes converge on `tripsService.updateTrip` / `createTrip` / `bulkCreateTrips` but **patch construction is duplicated** across inline cells, detail sheet, create/duplicate/return/cron paths. **Database-side KTS filtering** exists in the trips list RSC and `get_controlling_operational` RPC — moving columns off `trips` (Option 2) would touch both.

**Recommendation: Option 1** — keep KTS flags on `trips`, add `kts_corrections` satellite table, introduce `kts.service.ts` as the single write/patch entry point. This delivers ~90% of long-term maintainability at ~10% of Option 2’s regression risk.

---

## Current schema (trips KTS columns)

From `Database['public']['Tables']['trips']['Row']` (`src/types/database.types.ts`):

| Column | Type | Purpose |
|--------|------|---------|
| `kts_document_applies` | `boolean NOT NULL` | Operational KTS flag |
| `kts_source` | `text \| null` | `variant \| familie \| payer \| manual \| system_default` |
| `kts_fehler` | `boolean NOT NULL` | Document has an error |
| `kts_fehler_beschreibung` | `text \| null` | Free-text error description |

Migrations: `20260403120000_kts_catalog_and_trips.sql` (`kts_document_applies`, `kts_source` on `trips` + `recurring_rules`); `20260504130000_kts_fehler.sql` (`kts_fehler`, `kts_fehler_beschreibung`).

---

## 1. Read surface — every location reading KTS fields from `trips`

Below: **production reads** of `kts_document_applies`, `kts_source`, `kts_fehler`, or `kts_fehler_beschreibung` from trip rows (or `select('*')` / list projections that include them). Excludes pure type definitions unless the file only declares shapes. **Writes** noted separately in §2.

### Trips UI — list, detail, print, filters

| File | Lines | Fields read | Notes |
|------|-------|-------------|-------|
| `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx` | 136, 140, 143, 148, 205, 238–239, 276, 280–281, 285–286, 295 | all four (fehler fields gated by `kts_document_applies`) | Optimistic UI reads `trip.*` |
| `src/features/trips/components/trips-tables/columns.tsx` | 514–515, 528–529, 542–543 | `kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung` | `accessorKey` / `accessorFn` |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | 517, 520–521, 540–542, 958–963 | all four | Hydration + `detailsDirty` |
| `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` | 102–103, 124, 129 | all four + `kts_source` | Diff vs `trip` for PATCH |
| `src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts` | 53–56 (keys), 261–266 (write) | keys listed; partner patch **writes** drafts | Reads implied via `PAIRED_SYNC_COLUMN_KEYS` |
| `src/features/trips/components/trips-tables/trips-mobile-card-list.tsx` | 160 | `kts_document_applies` | Mobile KTS badge |
| `src/features/trips/components/print-trip-groups-list.tsx` | 51–52, 281, 297, 600 | `kts_fehler`, `kts_fehler_beschreibung` | Print warning blocks |
| `src/features/trips/components/mobile-print-template.tsx` | 26–27 | types only | `TripData` shape |
| `src/features/trips/components/trips-listing.tsx` | 154–158, 178–180 | `kts_document_applies`, `kts_fehler` | **Server-side PostgREST** `.eq` / `or` filters |
| `src/features/trips/components/trips-filters-bar.tsx` | 78, 87 | — | Filter token labels (`kts_fehler`); no trip row read |
| `src/features/trips/trips-sort-map.ts` | 35 | `kts_document_applies` | URL `?sort=` → DB column |
| `src/features/trips/components/ansichten-dropdown.tsx` | 86–88 | column ids | Preset column visibility |
| `src/features/trips/components/ansichten-sheet.tsx` | 100–103 | column ids | Same |

### Trip create, duplicate, return, recurring

| File | Lines | Fields read |
|------|-------|-------------|
| `src/features/trips/components/create-trip/create-trip-form.tsx` | 411–412, 425–427, 445–447, 1306–1322, 1384, 1451, 1541, 1628 | reads form state; persists all four on submit |
| `src/features/trips/components/create-trip/sections/payer-section.tsx` | 244, 335 | `kts_document_applies` (form watch) |
| `src/features/trips/components/create-trip/schema.ts` | 48–49, 55–56, 78–86 | Zod defaults/validation |
| `src/features/trips/lib/create-trip-draft.ts` | 23–26, 136–139, 161–164, 185–188 | draft hydration |
| `src/features/trips/hooks/use-create-trip-draft.ts` | 39–42 | draft persistence |
| `src/features/trips/lib/duplicate-trips.ts` | 298–301, 330 | reads `source.*`; writes copy |
| `src/features/trips/lib/build-return-trip-insert.ts` | 96–100 | reads `outbound.*` |
| `src/lib/recurring-trip-generator.ts` | 289–291, 537, 603 | reads `rule.kts_*`; writes to new trips |
| `src/features/clients/lib/build-recurring-rule-payload.ts` | 41, 87–88 | builds rule payload |
| `src/features/clients/components/recurring-rule-form-body.tsx` | 210–211, 251–252 | hydrates from `initialData` |
| `src/features/clients/components/recurring-rule-billing-fields.tsx` | 88, 324, 392 | form `kts_document_applies` |

### Bulk CSV, export

| File | Lines | Fields read |
|------|-------|-------------|
| `src/features/trips/components/bulk-upload-dialog.tsx` | 1306, 1385–1386 | reads staged trip before insert |
| `src/features/trips/components/bulk-upload/resolve-billing-variants-step.tsx` | 68–69 | assigns resolver output to row |
| `src/features/trips/components/bulk-upload/bulk-upload-types.ts` | 60 | CSV column type |
| `src/features/trips/components/csv-export/csv-export-constants.ts` | 97 | export column key |
| `src/app/api/trips/export/route.ts` | 233–238 | `t.kts_document_applies` formatter |

### Pricing & invoices (reads `kts_document_applies` from trips)

| File | Lines | Fields read |
|------|-------|-------------|
| `src/features/trips/lib/trip-price-engine.ts` | 200, 232, 298, 350, 374–375 | `kts_document_applies` in pricing context |
| `src/features/invoices/lib/resolve-trip-price.ts` | 85, 440 | P0 KTS → €0 |
| `src/features/invoices/lib/price-calculator.ts` | 36, 44 | adapter input |
| `src/features/invoices/api/invoice-line-items.api.ts` | 305, 428 (select), 516, 645, 707 | `trip.kts_document_applies` from join |
| `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` | 455, 1005, 1016 | `item.kts_document_applies` |
| `src/features/invoices/hooks/use-invoice-builder.ts` | 114, 820, 883 | line item / trip mapping |
| `src/features/invoices/lib/apply-tax-rate-override.ts` | 11 | passes through on item |
| `src/features/invoices/types/invoice.types.ts` | 343–344, 392, 621–624 | type comments/fields |

### Other surfaces

| File | Lines | Fields read |
|------|-------|-------------|
| `src/features/unassigned-trips/api/unassigned-trips.service.ts` | 38 | select `kts_document_applies` |
| `src/app/dashboard/settings/unzugeordnete-fahrten/page.tsx` | 43 | select projection |
| `src/features/unassigned-trips/types/unassigned-trips.types.ts` | 18 | type |
| `src/lib/searchparams.ts` | 23 | URL param comment |
| `src/types/database.types.ts` | 1472–1475, 1551–1554, 1628–1631 | generated types (also `recurring_rules` 911–912) |

### Operational scripts (read trips directly)

| File | Lines | Fields read |
|------|-------|-------------|
| `scripts/backfill-trip-prices-audit.ts` | 78, 113, 131 | `kts_document_applies` |
| `scripts/backfill-null-trip-net-prices.ts` | 45, 74 | `kts_document_applies` |
| `scripts/backfill-trip-price-split.ts` | 91, 230 | `kts_document_applies` |
| `scripts/backfill-driving-distance.ts` | 63, 83, 401, 422, 433, 436, 467, 561, 601 | `kts_document_applies` |

### Database / RPC (SQL reads `trips` columns)

| File | Lines | Fields read |
|------|-------|-------------|
| `supabase/migrations/20260530120000_controlling_rpcs.sql` | 95–97 | `t.kts_document_applies = true` in `get_controlling_operational` |

### Test fixtures (not production, but would break on Option 2)

~12 files under `src/**/__tests__/**` and `src/features/invoices/**/__tests__/**` set mock `kts_document_applies` on trip objects.

### Read surface counts

| Category | File count |
|----------|------------|
| Production `src/` (excluding `__tests__`) | **36** |
| `src/**/__tests__/**` | **12** |
| `scripts/` | **4** |
| Supabase SQL | **3** (2 migrations + 1 RPC) |
| **Total distinct files** | **~55** |

**`kts_source` read count** is smaller than the other three: primarily `build-trip-details-patch.ts`, `trip-detail-sheet.tsx` (via resolver save path), `duplicate-trips.ts`, `build-return-trip-insert.ts`, `recurring-trip-generator.ts`, bulk upload, and create-trip submit — not used in list filters, print fehler blocks, or invoice badges.

---

## 2. Write paths — assessment and unification behind `kts.service.ts`

### Current write paths for KTS trip fields

All persistence ultimately hits **`tripsService.updateTrip`**, **`createTrip`**, or **`bulkCreateTrips`** (`src/features/trips/api/trips.service.ts`). There is no separate KTS API. Divergence is in **who builds the patch**:

| Path | Entry | KTS fields written | Transport |
|------|-------|-------------------|-----------|
| **A — Inline KTS switch (on)** | `kts-cells.tsx` `KtsSwitchCell` | `kts_document_applies: true` | `useTripFieldUpdate` → `useUpdateTripMutation` → `tripsService.updateTrip` |
| **B — Inline KTS switch (off)** | `kts-cells.tsx` | cascade: `kts_document_applies: false`, `kts_fehler: false`, `kts_fehler_beschreibung: null` | `useUpdateTripMutation` (multi-field) |
| **C — Inline Fehler switch** | `kts-cells.tsx` `KtsFehlerSwitchCell` | `kts_fehler` ± `kts_fehler_beschreibung: null` | `useUpdateTripMutation` |
| **D — Inline Fehler text** | `kts-cells.tsx` `KtsFehlerTextCell` | `kts_fehler_beschreibung` | `useTripFieldUpdate` |
| **E — Detail sheet save** | `build-trip-details-patch.ts` | all four + `kts_source` | `useUpdateTripMutation` |
| **F — Paired Gegenfahrt** | `paired-trip-sync.ts` `buildPartnerSyncPatchFromDrafts` | same as E on partner leg | `useUpdateTripMutation` |
| **G — Neue Fahrt** | `create-trip-form.tsx` submit | all four on insert | `tripsService.createTrip` (+ linked legs) |
| **H — Bulk CSV** | `bulk-upload-dialog.tsx` | `kts_document_applies`, `kts_source` | `bulkCreateTrips` |
| **I — Duplicate** | `duplicate-trips.ts` | copies all four; forces `kts_source: 'manual'` | insert via duplicate API |
| **J — Rückfahrt** | `build-return-trip-insert.ts` | copies from outbound | `createTrip` |
| **K — Recurring cron** | `recurring-trip-generator.ts` | copies `rule.kts_*` | trip insert |
| **L — Recurring rule editor** | `build-recurring-rule-payload.ts` | writes `recurring_rules`, not `trips` | separate table, same field names |

**Not KTS writes but read `kts_document_applies` during update:** `trip-price-engine.ts` inside `tripsService.updateTrip` when `shouldRecalculatePrice(patch)` is true (e.g. toggling KTS triggers €0 recalc).

### Duplicate cascade semantics (risk if not centralized)

Both inline and detail paths implement **“KTS off → clear Fehler + Beschreibung”**:

- Inline: `kts-cells.tsx` 212–219  
- Detail: `trip-detail-sheet.tsx` 1715–1718 (draft) + `build-trip-details-patch.ts` 134–137 (persist)

Detail sheet additionally sets `kts_source` from resolver/manual lock; inline **on** path does not set `kts_source` when enabling KTS (only sets `kts_document_applies: true`) — a subtle inconsistency today.

### What unification requires

Introduce `src/features/kts/kts.service.ts` (mirroring `invoices.api.ts` / feature service pattern):

```ts
// Conceptual surface (not implemented in this audit)
normalizeKtsPatch(patch): UpdateTrip   // cascade clears, trim beschreibung
updateTripKts(supabase, tripId, patch): Promise<Trip>
buildKtsPatchFromDrafts(input): UpdateTrip  // extract from build-trip-details-patch
```

**Minimum refactor (prerequisite before `kts_corrections`):**

1. **`kts.service.ts`** — `normalizeKtsPatch()` encoding cascade rules + `kts_fehler_beschreibung` null when fehler false; optional `resolveKtsSourceForSave()` wrapping existing resolver + manual lock.
2. **`kts-cells.tsx`** — replace direct `mutate` / `updateField` patches with `ktsService.updateTripKts()` (or hook `useUpdateKtsMutation` wrapping it).
3. **`build-trip-details-patch.ts`** — delegate KTS diff block (lines 101–140) to `buildKtsPatchFromDrafts()`.
4. **`paired-trip-sync.ts`** — call same builder for partner leg.
5. **Optional same pass:** `create-trip-form.tsx` submit normalization (lines 1306–1322) → shared helper.

**Effort:** **Small–medium** (roughly **4–6 production files**, 1 new module ~120–180 LOC). Hooks (`useUpdateTripMutation`) stay; only KTS-specific patch construction moves. No query/filter changes.

**Not in scope of a minimal pass:** bulk upload, duplicate, return, cron — they **copy** fields rather than edit; can adopt `normalizeKtsPatch` on insert later.

---

## 3. `kts_reviews` (V2 §8) vs proposed `kts_corrections`

### `kts_reviews` (from `docs/kts-architecture.md` §8)

- **Append-only** status history: Fehlerhaft → In Korrektur → Korrigiert → Abgegeben → Bezahlt (with loops).
- Columns: `trip_id`, `status`, `previous_status`, `notes`, `created_by`, `created_by_label`, `created_at`.
- **Current status** = latest row by `created_at`.
- UI: collapsible timeline + “Status ändern” on trip detail.

### Proposed `kts_corrections` (Module A)

- **Per correction round:** `sent_to`, `sent_at`, `received_at`, `notes`, multiple rows per trip.
- Operational logistics: who received the document for correction, when sent, when corrected copy returned.
- Gate before accountant handoff.

### Relationship

| Aspect | `kts_reviews` | `kts_corrections` |
|--------|---------------|-------------------|
| Granularity | Workflow **state transitions** | **Round-level** correction logistics |
| Cardinality | Many rows, one “current status” | Many rows, each = one round |
| Overlap | “In Korrektur” state | The *detail* of being in correction |

**They are related but not the same.** `kts_corrections` should **not replace** `kts_reviews`; it should **sit alongside** it:

- Opening a correction round → insert `kts_corrections` row **and** append `kts_reviews` with `status = 'in_korrektur'` (or similar).
- Receiving corrected document → update `kts_corrections.received_at` **and** append `kts_reviews` with `status = 'korrigiert'` (or back to fehlerhaft if still wrong).
- Keep `trips.kts_fehler` + `kts_fehler_beschreibung` as the **current boolean + summary** for filters/badges; history lives in the two append-only tables.

**Alternative (not recommended):** stuffing `sent_to` / timestamps into `kts_reviews.notes` as unstructured text — loses queryability for Module D dashboard tabs (“Korrekturen”).

---

## 4. Filter performance — database-side KTS usage

### Server-side / RPC (not client-only)

| Location | Mechanism | Columns |
|----------|-----------|---------|
| `src/features/trips/components/trips-listing.tsx` | PostgREST `.eq('kts_document_applies', …)`, `.eq('kts_fehler', …)`, `.or(...)` for multi-select | `kts_document_applies`, `kts_fehler` |
| `supabase/migrations/20260530120000_controlling_rpcs.sql` | `get_controlling_operational` — `COUNT(*) FILTER (WHERE … t.kts_document_applies = true)` | `kts_document_applies` only |

### Client-side only

- Table column accessors (`columns.tsx`), mobile badge, print, invoice builder badges, sort map (issues `ORDER BY kts_document_applies` on `trips` — still DB sort, not post-fetch filter).

### Option 2 query cost

Moving `kts_document_applies` / `kts_fehler` to `kts_trip_meta` would require:

1. **JOIN** (or denormalized view) on every list query in `trips-listing.tsx`.
2. **RPC rewrite** for `get_controlling_operational`.
3. **Index strategy** on `(trip_id)` FK + filter columns on satellite table.
4. Risk to PostgREST `.or()` filter composition (already non-trivial at lines 147–189).

`kts_fehler` is **not** in controlling RPC today; only list filters use it server-side.

**Verdict:** Option 2 has **real** database filter cost, not just UI churn — especially for the high-traffic Fahrten list RSC.

---

## 5. Option 1 — minimum refactor before `kts_corrections`

### Prerequisite steps (ordered)

1. **Add `src/features/kts/kts.service.ts`**
   - `normalizeKtsPatch(patch: UpdateTrip): UpdateTrip` — single cascade implementation.
   - `buildKtsPatchFromDetailDrafts(...)` — extracted from `build-trip-details-patch.ts`.
   - `updateTripKts(id, patch)` — calls `tripsService.updateTrip` after normalize.
2. **Wire inline cells** — `kts-cells.tsx` only (3 handlers).
3. **Wire detail sheet** — `build-trip-details-patch.ts` import; no UI change.
4. **Add `useUpdateKtsMutation`** (optional thin hook) — invalidates same keys as `useUpdateTripMutation`.
5. **Document** in `docs/kts-architecture.md` code map row for `kts.service.ts`.

### What stays unchanged

- All **read** paths (filters, columns, export, pricing, invoice builder).
- `trips` schema.
- `resolve-kts-default.ts` (catalog cascade stays separate).

### Realistic?

**Yes.** Can land in **one PR** before Module A schema work. Fixes existing inline/detail `kts_source` inconsistency as a bonus if `normalizeKtsPatch` sets `manual` on user toggles.

### Then Module A

- Migration: `kts_corrections` table.
- Extend `kts.service.ts` with `createCorrectionRound`, `closeCorrectionRound`, `listCorrectionsForTrip`.
- New UI in trip detail (correction timeline); **no** movement of the four trip columns.

---

## 6. Option 2 — `kts_trip_meta` migration feasibility

### Surface area

Every file in §1 **plus**:

- `trips-listing.tsx` query shape (JOIN or embedded select).
- `trips-sort-map.ts` (sort column target).
- `trip-price-engine.ts` `resolveTripForPricing` select list.
- `invoice-line-items.api.ts` trip selects (3 query sites).
- `get_controlling_operational` migration.
- `recurring_rules` parity decision (KTS on rules vs trips meta).
- Regenerate `database.types.ts`; update all Insert/Update paths.
- RLS policies on new table.
- Data backfill migration `trips` → `kts_trip_meta`.
- 12 test files + 4 scripts.

### Big-bang vs incremental?

**Incremental is theoretically possible** (dual-write + view), but the codebase has **no view layer** for trips today — list/kanban/detail all read `trips` directly. A phased approach still requires:

1. Migration + backfill + compat view `trips_with_kts` **or** embedded resource `kts_trip_meta` in every `.select()`.
2. Touch **all 36 production files** before dropping columns.
3. Coordinate mobile/print/export/invoice/pricing in one release window.

### Risk assessment

| Risk | Severity |
|------|----------|
| Missed read site → null KTS in UI | High |
| List filter regression | High |
| Pricing €0 not applied (KTS missed) | High (revenue) |
| Invoice builder missing KTS badge | Medium |
| Recurring/duplicate copy drift | Medium |

**Verdict:** Achievable only as a **dedicated multi-sprint migration** with feature flags and exhaustive regression — **not** as a sidecar to Module A. Regression risk is **unacceptably high** relative to benefit for Module A alone.

### Proposed migration surface count (Option 2)

| Bucket | Files to change |
|--------|-----------------|
| Production `src/` | **36** |
| Tests | **12** |
| Scripts | **4** |
| SQL (migrations, RPC, RLS, backfill) | **4–6** new/altered |
| **Total** | **~56–58 files** |

---

## 7. Senior recommendation

**Choose Option 1: keep KTS on `trips`, add `kts_corrections`, unify writes in `kts.service.ts`.**

Do **not** pursue Option 2 (`kts_trip_meta`) unless a future requirement demands strict normalization (e.g. many more KTS columns, separate RLS domain, or multi-document KTS per trip). The current four columns are **filter- and pricing-critical**, tightly coupled to `trips` lifecycle, and already mirrored on `recurring_rules` — moving them buys architectural purity at the cost of touching **~56 files** and rewriting server-side filters/RPCs with no user-visible gain for Module A/B/C.

**Option 3 (hybrid) considered:** “Option 1 + later `kts_reviews` for dashboard tabs” — this is the intended path; `kts_reviews` handles workflow states, `kts_corrections` handles round logistics, trip columns remain the fast path for list filters and pricing.

**One-paragraph justification:** The repo already invested in KTS-as-trip-flags across list filters (including multi-select PostgREST), controlling KPIs, pricing P0, invoice soft warnings, print, CSV, and duplicate/recurring propagation. Option 2 forces a coordinated rewrite of that entire cone of dependencies before Module A can ship. Option 1 adds the correction history table and a ~5-file service extraction that eliminates the only real pain point today — duplicated write semantics — while leaving performant filters and `resolveKtsDefault` untouched. That is approximately **90% maintainability benefit for 10% of the risk**.

---

## Risk matrix — Option 1 vs Option 2

| Dimension | Option 1 (satellite + service) | Option 2 (`kts_trip_meta`) |
|-----------|--------------------------------|----------------------------|
| **Schema change risk** | Low — additive `kts_corrections` | High — column move + backfill |
| **Application churn** | Low–medium (writes + new UI) | High (~56 files) |
| **List filter / RPC risk** | None | High (JOIN + RPC rewrite) |
| **Pricing / invoice regression** | None | High if join missed |
| **Time to Module A** | 1–2 sprints | 3+ sprints before Module A |
| **Aligns with V2 `kts_reviews`** | Yes (alongside) | Neutral (still need reviews table) |
| **Long-term normalization** | Good enough for 4 fields | Better if KTS becomes large subdomain |
| **Rollback ease** | Drop satellite table | Hard (columns moved) |

---

## Suggested implementation sequence (Module A + foundation)

1. **PR1 — `kts.service.ts` + wire inline + detail patch** (no schema).
2. **PR2 — `kts_corrections` migration + RLS + service CRUD + detail UI**.
3. **PR3 — Gate rules** (e.g. block “ready for accountant” while open correction round exists) — product rules TBD.
4. **Defer** `kts_reviews` until Module D dashboard; design statuses to reference correction rounds.

---

## Appendix — invoices service pattern (reference)

`src/features/invoices/api/invoices.api.ts` establishes the convention: feature-level `*.api.ts` / `*.service.ts`, Supabase client inside, throw on error, React Query at hook layer. A KTS service should follow the same split:

- `src/features/kts/kts.service.ts` — persistence + normalization  
- `src/features/kts/hooks/use-kts-corrections.ts` — TanStack Query (Module A)  
- Query keys in `src/query/keys` when list invalidation is needed

---

*End of audit.*
