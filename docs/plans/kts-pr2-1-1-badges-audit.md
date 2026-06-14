# KTS PR2.1.1 — Correction list badges audit

**Date:** 2026-06-10  
**Scope:** Read-only audit for wiring `trip_kts_correction_summaries` into Fahrten **list** and **Kanban** UI (PR2.1.1).  
**Constraint:** No code changes — findings only.

**Related:** [`docs/kts-architecture.md`](../kts-architecture.md) §10 (RPC → list badges), [`docs/plans/kts-pr2-columns-audit.md`](kts-pr2-columns-audit.md), [`docs/plans/kts-rpc-tenant-guard-deferred.md`](kts-rpc-tenant-guard-deferred.md) (KTS-SEC-01 **RESOLVED**), [`docs/trips-performance.md`](../trips-performance.md).

---

## Sources read

- `src/features/trips/components/` — all files; filtered by `badge`, `list`, `column`, `kts` in path/name
- `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`
- `src/features/kts/` — `kts.service.ts`, `hooks/use-kts-corrections.ts`, `hooks/use-update-kts-mutation.ts`
- `src/features/trips/trip-detail-sheet/components/kts-correction-timeline.tsx`, `kts-correction-form.tsx`
- `src/features/trips/api/trips.service.ts`
- `src/features/trips/hooks/use-trip-form-data.ts`, `use-trip-invoice-statuses.ts`
- `src/features/trips/types/trip-form-reference.types.ts`
- `src/types/database.types.ts` — `kts_corrections` table + `trip_kts_correction_summaries` function type
- `supabase/migrations/20260610120000_kts_corrections.sql`, `20260610125000_kts_rpc_tenant_guard.sql`
- `docs/kts-architecture.md` (full)
- `docs/plans/kts-rpc-tenant-guard-deferred.md`
- `src/query/keys/trips.ts`, `src/features/trips/components/trips-listing.tsx`, `trips-tables/*`, `kanban/*`

---

## Matching files under `src/features/trips/components/`

Files whose path or name contains `badge`, `list`, `column`, or `kts`:

| File | Relevance to PR2.1.1 |
| ---- | -------------------- |
| `trip-invoice-status-badge.tsx` | **Pattern** — deferred badge component (variant mapping) |
| `trip-invoice-status-badge-cell.tsx` | **Pattern** — per-row cell + `Skeleton` while loading |
| `trip-invoice-statuses-context.tsx` | **Pattern** — provider + `Map<tripId, …>` from batch query |
| `trips-listing.tsx` | **Data source** — RSC Supabase query for list + kanban |
| `trips-tables/index.tsx` | **List shell** — wraps table/mobile in `TripInvoiceStatusesProvider` |
| `trips-tables/columns.tsx` | **Desktop rows** — KTS inline columns + `invoice_status` deferred column |
| `trips-tables/trips-mobile-card-list.tsx` | **Mobile rows** — KTS badge only; no correction UI today |
| `trips-tables/inline-cells/kts-cells.tsx` | KTS toggle/text inline cells (not correction badges) |
| `trips-kanban-board.tsx` | Re-export shim → `kanban/kanban-board.tsx` |
| `kanban/kanban-board.tsx` | **Kanban orchestrator** — receives `trips` prop from RSC |
| `kanban/kanban-trip-card.tsx` | **Kanban card** — per-trip visual unit (no KTS/correction today) |
| `kanban/kanban-column.tsx`, `kanban-group-container.tsx`, `kanban-driver-column-header.tsx` | Column chrome; no trip correction data |
| `passenger-badge.tsx`, `trip-address-passenger/passenger-badge.tsx` | Passenger UI; unrelated |
| `print-trip-groups-list.tsx` | Print list; out of PR2.1.1 scope |
| `csv-export/column-selector-step.tsx` | CSV columns; unrelated |

---

## 1. Trip list / Kanban — where correction badges need to appear

### Product intent (from architecture)

[`docs/kts-architecture.md`](../kts-architecture.md) §10 names PR2.1.1 as **list badges** backed by `trip_kts_correction_summaries(p_trip_ids uuid[])`. The prior columns audit ([`kts-pr2-columns-audit.md`](kts-pr2-columns-audit.md)) scoped **four desktop table columns** plus an **optional** compact badge on mobile/kanban (“Korrektur offen” / count).

### Desktop list (table)

| Layer | File | Role |
| ----- | ---- | ---- |
| Server fetch | `src/features/trips/components/trips-listing.tsx` | Async RSC; runs Supabase `.from('trips').select(...)` with filters, sort, **pagination** (`range`) or kanban **limit(2000)** |
| Client table | `src/features/trips/components/trips-tables/index.tsx` | `useDataTable`; passes `data` (trip rows) + `invoiceStatusTripIds` to provider |
| Row definition | `src/features/trips/components/trips-tables/columns.tsx` | TanStack `ColumnDef[]`; each row renders via `cell` |
| Deferred cell pattern | `trip-invoice-status-badge-cell.tsx` | Thin wrapper: `tripId` → context hook → badge or skeleton |

**Recommended placement for PR2.1.1 badges/columns:**

1. **Primary (desktop):** New column(s) in `columns.tsx` after the existing KTS block (`kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung`) — either one combined “Korrekturen” badge column or four read-only summary columns per `kts-pr2-columns-audit.md`.
2. **Cell components:** New files mirroring `TripInvoiceStatusBadgeCell` (e.g. `KtsCorrectionBadgeCell` or count/open-variant cells) reading from a **batch summary provider**, not from `row.original`.

### Mobile list (cards)

| File | Structure |
| ---- | --------- |
| `trips-tables/trips-mobile-card-list.tsx` | Maps `table.getRowModel().rows`; each card shows time, passenger, **status badge**, optional **KTS** badge (`kts_document_applies` from RSC row), addresses. Wrapped by `TripInvoiceStatusesProvider` but **does not consume** invoice context. |

**Optional badge placement:** Header row beside status/KTS badges (same strip as lines 151–168) — e.g. “2 Korrekturen” (muted) or “Korrektur offen” (amber), driven by summary provider.

### Kanban

| Layer | File | Role |
| ----- | ---- | ---- |
| Server fetch | Same `trips-listing.tsx` | `view === 'kanban'` → `tripsKanbanSelect` + `.limit(2000)` |
| Board | `kanban/kanban-board.tsx` | Client; `trips: KanbanTrip[]` prop; DnD, pending store, save |
| Card | `kanban/kanban-trip-card.tsx` | Renders one trip: time chip, name, status badge, route, bottom badges (group, payer, billing, wheelchair) |

**Recommended placement for PR2.1.1:** Bottom badge row in `kanban-trip-card.tsx` (lines 342–420), alongside payer/billing badges — **only if product wants Kanban parity**. No correction UI exists there today; Kanban also does **not** use `TripInvoiceStatusesProvider`.

### Data flow summary

```
trips-listing.tsx (RSC)
  → TripListRow[] as props
  → view=list: TripsTable → columns.tsx / trips-mobile-card-list.tsx
  → view=kanban: TripsKanbanBoard → kanban-trip-card.tsx
```

Correction summaries are **not** in RSC props today; they must be a **second client fetch** keyed by visible trip IDs (same class as invoice badges).

---

## 2. `trip_kts_correction_summaries` RPC — call sites

**Search:** All files under `src/` for `trip_kts_correction_summaries`.

| Result | Detail |
| ------ | ------ |
| **Type definition only** | `src/types/database.types.ts` — `Database['public']['Functions']['trip_kts_correction_summaries']` |
| **No `.rpc('trip_kts_correction_summaries', …)`** | Grep across `src/` finds no application call site |

**Conclusion:** The RPC is **unwired** in TypeScript. PR2.1 CRUD uses direct table access (`fetchTripCorrections` → `.from('kts_corrections').select('*')`), not the summary RPC.

---

## 3. How trips are fetched for list and Kanban

### Mechanism

Single **server component** query in `trips-listing.tsx` — not `tripsService.getTrips()` and not TanStack Query for the grid body.

### List view `.select()` (no `kts_corrections`)

```sql
*,
payer:payers(name, reha_schein_enabled),
billing_variant:billing_variants(name, code, billing_types(name, color)),
driver:accounts!trips_driver_id_fkey(name),
fremdfirma:fremdfirmen(id, name, default_payment_mode)
```

### Kanban view `.select()` (adds invoice embed; still no `kts_corrections`)

```sql
*,
payer:payers(name, reha_schein_enabled),
billing_variant:billing_variants(name, code, billing_types(name, color)),
driver:accounts!trips_driver_id_fkey(name),
fremdfirma:fremdfirmen(id, name, default_payment_mode),
invoice_line_items!invoice_line_items_trip_id_fkey(
  invoice_id,
  invoices(status, paid_at, sent_at)
)
```

### Pagination / limits

| View | Limit |
| ---- | ----- |
| **List** | `page` + `perPage` URL params → `.range(from, to)`; default `perPage = 50` (`src/lib/searchparams.ts`) |
| **Kanban** | `.limit(2000)` hard cap |

### `kts_corrections` in main query?

**No** — not embedded, joined, or selected in either list or kanban RSC query. Trip rows include scalar KTS columns on `trips` (`kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung`, `kts_patient_id`, etc.) via `*`.

### Secondary client queries (existing pattern)

| Data | Fetch | Key |
| ---- | ----- | --- |
| Invoice status (list only) | `fetchTripInvoiceStatuses(tripIds)` → `invoice_line_items` | `tripKeys.invoiceStatuses(sortedTripIds)` |
| Correction rounds (detail only) | `fetchTripCorrections(supabase, tripId)` → `kts_corrections` | `tripKeys.ktsCorrections(tripId)` |

---

## 4. `kts_corrections` Row type and RPC return type

### Table `kts_corrections` — `database.types.ts`

| Column | TypeScript type |
| ------ | ----------------- |
| `id` | `string` |
| `company_id` | `string` |
| `trip_id` | `string` |
| `sent_to` | `string` |
| `sent_at` | `string` |
| `received_at` | `string \| null` |
| `notes` | `string \| null` |
| `created_at` | `string` |
| `created_by` | `string \| null` |

Insert/Update shapes mirror these with optional fields per usual Supabase codegen.

### Function `trip_kts_correction_summaries` — **present** in `database.types.ts`

```typescript
trip_kts_correction_summaries: {
  Args: { p_trip_ids: string[] };
  Returns: {
    trip_id: string;
    correction_count: number;
    latest_sent_to: string;
    latest_sent_at: string;
    latest_received_at: string | null;
  }[];
};
```

Located under `Database['public']['Functions']` (not a separate RPC namespace). Typed return shape **exists** and matches migration `RETURNS TABLE`.

**RPC semantics (migrations):** Returns **only trips that have ≥1 correction** in the input ID set (INNER JOIN between `latest` and `counts` CTEs). Trips with zero corrections are **absent** from the result — callers must treat missing `trip_id` as count 0 / no open round.

**Security:** `20260610125000_kts_rpc_tenant_guard.sql` adds `JOIN trips` + `current_user_company_id()` (KTS-SEC-01 resolved).

---

## 5. Current KTS UI on trip list / Kanban

### Desktop table (`columns.tsx`)

| UI | File | What it shows |
| -- | ---- | ------------- |
| KTS switch | `inline-cells/kts-cells.tsx` → `KtsSwitchCell` | `kts_document_applies` inline edit |
| KTS-Fehler switch | `KtsFehlerSwitchCell` | `kts_fehler` inline edit |
| KTS-Fehler text | `KtsFehlerTextCell` | `kts_fehler_beschreibung` debounced input |
| Reha switch | `inline-cells/reha-cells.tsx` | `reha_schein` |

**No correction count, open-round indicator, or summary badge** in list columns today.

### Mobile cards (`trips-mobile-card-list.tsx`)

- **KTS badge:** `Badge variant='secondary'` text **“KTS”** when `trip.kts_document_applies` (from RSC row).
- **No** correction badge.

### Kanban cards (`kanban-trip-card.tsx`)

- **No KTS indicator** (no `kts_document_applies` badge, no correction badge).
- Shows: status badge, payer outline badge, billing-colored badge, wheelchair destructive badge, group badge.

### Invoice builder / print

Out of scope for PR2.1.1; listed for completeness — invoice PDF shows KTS on line items elsewhere.

---

## 6. Badge component inventory

**File:** `src/components/ui/badge.tsx` (shadcn/ui New York)

**Variants** (`badgeVariants` / `VariantProps`):

| Variant | Tailwind intent |
| ------- | ---------------- |
| `default` | Primary fill |
| `secondary` | Muted secondary fill — used for “KTS” mobile badge |
| `destructive` | Red — wheelchair kanban badge |
| `outline` | Border only — billing, status-adjacent |

**No built-in `warning` / `success` variants.** Open/closed correction states in the detail timeline use **`outline` + manual amber/green classes** (`kts-correction-timeline.tsx` lines 86–96):

- Open: `border-amber-200 bg-amber-50 text-amber-800` (+ dark variants)
- Closed: `border-green-100 bg-green-50 text-green-600` (+ dark variants)

**Recommendation for list badges:** Reuse `Badge variant='outline'` with the same amber/green utility classes for “Korrektur offen” vs neutral count; use `variant='secondary'` for “N Korrekturen” when no open round.

---

## 7. Performance — batch size and virtualization

| View | Typical row count | Mechanism |
| ---- | ----------------- | --------- |
| **List (desktop/mobile)** | **50 per page** (default `perPage`); user can change via URL | Server pagination `.range()`; **no row virtualization** in `DataTable` |
| **Kanban** | Up to **2000** trips per date/filter | All cards mounted in columns; **no virtualization**; horizontal scroll + DnD |

**RPC batch sizing:**

- **List:** One RPC with **≤50 UUIDs** per page (stable, safe single call).
- **Kanban:** One RPC with **up to 2000 UUIDs** — still one round-trip but larger payload; Postgres `ANY(uuid[])` handles this; monitor if tenants regularly hit the cap.
- **Chunking:** Not required for list; optional safety valve for kanban (e.g. chunks of 500) only if profiling shows timeouts — not indicated by existing patterns (invoice query uses same visible-ID batch without chunking).

**Column visibility:** Invoice summaries fetch runs regardless of whether the Rechnungsstatus column is hidden (`TripInvoiceStatusesProvider` wraps the whole table). Same likely applies to correction summaries unless gated later.

---

## 8. Loading / skeleton patterns on trip cards

| Surface | Loading pattern | File |
| ------- | ---------------- | ---- |
| **Desktop invoice badge** | `Skeleton className='mx-auto h-5 w-[5.5rem] rounded-full'` while `isPending` | `trip-invoice-status-badge-cell.tsx` |
| **Detail correction timeline** | Two `Skeleton h-16 w-full rounded-lg` blocks | `kts-correction-timeline.tsx` |
| **Driver select cell** | `Skeleton h-8 w-32` | `driver-select-cell.tsx` |
| **List/kanban body during RSC refresh** | Top **pulse strip** only (`aria-busy`); **no card skeleton** | `trips-rsc-refresh-chrome.tsx` |
| **Kanban / mobile trip cards** | **No per-card skeleton** for trip data — rows render immediately from RSC props |

**PR2.1.1 recommendation:** Match **invoice badge** pattern — small rounded `Skeleton` in the badge cell slot until `tripKeys.ktsCorrectionSummaries(...)` resolves; do not skeleton entire cards.

---

## 9. `detailsDirty` / save interaction and React Query keys

### Correction insert/close from detail sheet

| Mutation | Invalidates | Does **not** invalidate |
| -------- | ----------- | ------------------------ |
| `useInsertKtsCorrectionMutation` | `tripKeys.ktsCorrections(tripId)` | `tripKeys.all`, list RSC, summary batch key |
| `useCloseKtsCorrectionMutation` | `tripKeys.ktsCorrections(tripId)` | same |

`KtsCorrectionForm` / `KtsCorrectionTimeline` do **not** call `refreshAfterTripSave()` or `refreshTripsPage()`.

### Trip detail save (`Trip aktualisieren`)

`useTripDetailSaveRefresh` → `invalidateQueries({ queryKey: tripKeys.all })` + optional `router.refresh()` when on Fahrten route — **would** invalidate a future `tripKeys.ktsCorrectionSummaries(...)` key (prefix `['trips', …]`).

### Inline KTS table edits

`useUpdateKtsMutation` → `onSettled`: `tripKeys.detail(id)` + `tripKeys.all`.

### List grid data

Lives in **RSC props** until user triggers `refreshTripsPage()` (`router.refresh()` + `tripKeys.all`). Correction-only mutations **do not** update list/kanban badges until summary query refetch (invalidation) or full page refresh.

### Trip-related `queryKey` values (`src/query/keys/trips.ts`)

| Factory | Key shape |
| ------- | --------- |
| `tripKeys.all` | `['trips']` |
| `tripKeys.detail(tripId)` | `['trips', 'detail', tripId]` |
| `tripKeys.unplannedRoot` | `['trips', 'unplanned']` |
| `tripKeys.unplanned(filter)` | `['trips', 'unplanned', filter]` |
| `tripKeys.timelessRuleTripsRoot` | `['trips', 'timeless-rules']` |
| `tripKeys.timelessRuleTrips(today, tomorrow)` | `['trips', 'timeless-rules', today, tomorrow]` |
| `tripKeys.invoiceStatuses(tripIds)` | `['trips', 'invoiceStatuses', ...sortedIds]` |
| `tripKeys.ktsCorrections(tripId)` | `['trips', 'kts_corrections', tripId]` |
| `tripKeys.presets()` | `['trips', 'presets']` |

**No `tripKeys.ktsCorrectionSummaries` yet** — proposed in `kts-pr2-columns-audit.md`.

### `detailsDirty`

Unrelated to corrections — tracks unsaved trip detail drafts in `trip-detail-sheet.tsx`. Inserting/closing a correction does not toggle `detailsDirty`; timeline refetches via `ktsCorrections` key only.

**PR2.1.1 gap:** After insert/close, **also invalidate** `tripKeys.ktsCorrectionSummaries(...)` (or `tripKeys.all`) so list badges update without leaving the sheet.

---

## 10. Recurring rule sheet — KTS and `kts_patient_id`

**File:** `src/features/recurring-rules/components/create-recurring-rule-sheet.tsx`

| Topic | Status |
| ----- | ------ |
| KTS section (document applies, fehler, corrections) | **Absent** — no KTS UI in recurring rule create flow |
| Correction display | **Absent** |
| `kts_patient_id` | **Partially wired** — client autosuggest `.select(...)` includes `kts_patient_id` for `ClientOption` typing/search only; **not** displayed or persisted on the rule form |
| Form body | Delegates to `RecurringRuleFormBody` / `ruleFormSchema` — no KTS fields found under `src/features/recurring-rules/` |

Recurring rules mirror some trip billing fields via cron (`docs/kts-architecture.md` §3.1); patient ID on generated trips is a separate product decision (out of PR2.1.1).

---

## Senior recommendation — fetching correction summaries for the list

### Preferred strategy: **single batch RPC per view + separate React Query key** (mirror invoice badges)

1. **Add** `fetchTripKtsCorrectionSummaries(tripIds, supabase)` calling `.rpc('trip_kts_correction_summaries', { p_trip_ids: tripIds })`.
2. **Add** `tripKeys.ktsCorrectionSummaries(tripIds)` — sort IDs for stable key (same as `invoiceStatuses`).
3. **Add** `useTripKtsCorrectionSummaries(tripIds)` with `staleTime: TRIP_REFERENCE_STALE_TIME_MS` (10 min).
4. **Add** `TripKtsCorrectionSummariesProvider` wrapping `TripsTable` (and optionally kanban board) passing **visible trip IDs** from RSC (`trips.map(t => t.id)` — already done for invoice as `invoiceStatusTripIds`).
5. **Build** `Map<tripId, Summary>` in provider; cells/badges read via context hook.

### Why not per-trip queries?

`useTripCorrections(tripId)` per row would mean **50+ parallel** `kts_corrections` selects on list page — N+1, heavy RLS evaluation, poor cache shape. The summary RPC exists precisely to avoid this.

### Why not embed on RSC?

Documented anti-pattern in `trips-performance.md` and `kts-pr2-columns-audit.md` — one-to-many history bloat, wrong latest-round semantics if client aggregates, loads when columns hidden.

### Why separate query key (not shared with trip list)?

- Trip **grid body** is RSC-cached, not `tripKeys.*` query data.
- Invoice status already uses a **sibling key** under `tripKeys.all` — correction summaries should follow for independent `staleTime`, invalidation, and loading skeletons.
- **Invalidate** on correction mutations: `tripKeys.ktsCorrectionSummaries` prefix or `tripKeys.all` (broader, matches `refreshTripsPage`).

### Batch size

| View | IDs per RPC | Chunking |
| ---- | ----------- | -------- |
| List | ≤ `perPage` (default 50) | **Not needed** |
| Kanban | ≤ 2000 | **Start with single call**; add 500-ID chunks only if production metrics require |

### Open-round badge logic (client)

From RPC row for `trip_id`:

- `has_open_correction` = `latest_received_at === null` (and `correction_count > 0`)
- Display: amber “Korrektur offen” if open; else muted “{n} Korrekturen” if `correction_count > 1`; optional hide when count 0

### Kanban

Either wrap `TripsKanbanBoard` with the same provider (trip IDs from `trips` prop) or defer kanban badges to a follow-up — architecture mentions list badges first; kanban has no invoice deferred fetch today.

### Mutation invalidation (required for good UX)

Extend `useInsertKtsCorrectionMutation` / `useCloseKtsCorrectionMutation` `onSuccess` to invalidate:

- `tripKeys.ktsCorrections(tripId)` (existing)
- `tripKeys.all` **or** predicate invalidation for `ktsCorrectionSummaries` keys

So list badges update while the detail sheet stays open.

---

## PR2.1.1 implementation touch list (reference)

| Area | Action |
| ---- | ------ |
| `trips.service.ts` | `fetchTripKtsCorrectionSummaries` |
| `src/query/keys/trips.ts` | `ktsCorrectionSummaries(tripIds)` |
| New hook + provider | Mirror `use-trip-invoice-statuses.ts` + `trip-invoice-statuses-context.tsx` |
| `trips-tables/index.tsx` | Wrap provider; pass trip IDs |
| `columns.tsx` | Badge and/or summary column(s) |
| `trips-mobile-card-list.tsx` | Optional compact badge |
| `kanban-trip-card.tsx` | Optional badge (product) |
| `use-kts-corrections.ts` | Invalidate summary cache on insert/close |
| `trips-listing.tsx` | **No** change to main `.select()` |

---

## Related documents

- [`docs/plans/kts-pr2-columns-audit.md`](kts-pr2-columns-audit.md) — column-level detail (overlaps; this doc adds RPC wiring + kanban + mutation cache gaps)
- [`docs/kts-architecture.md`](../kts-architecture.md) — §3.3 `kts_corrections`, §7.3 KTS-SEC-01, §10 code map
- [`docs/trips-performance.md`](../trips-performance.md) — deferred secondary fetch pattern
