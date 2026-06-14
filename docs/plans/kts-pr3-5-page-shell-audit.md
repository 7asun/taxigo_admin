# KTS PR3.5 — Page shell audit (`/dashboard/kts`)

**Date:** 2026-06-10  
**Scope:** Read-only audit for a dedicated **KTS operations page** (stat cards, filtered trip table, correction quick-actions). Aligns with architecture **PR6** (“KTS-Abrechnung dashboard”) and product direction for a clearing queue beyond Fahrten list columns.  
**Constraint:** No code changes — findings only.

**Related:** [`docs/kts-architecture.md`](../kts-architecture.md) §7.2 (PR4 next, PR6 future dashboard), [`docs/plans/kts-pr2-1-1-badges-audit.md`](kts-pr2-1-1-badges-audit.md), [`docs/plans/kts-pr2-columns-audit.md`](kts-pr2-columns-audit.md), [`docs/trips-performance.md`](../trips-performance.md).

---

## Sources read

- `src/app/dashboard/` — route tree (63 files under dashboard)
- `src/app/dashboard/layout.tsx` — full
- `src/components/layout/` — all 7 files (`app-sidebar`, `header`, `page-container`, etc.)
- `src/config/nav-config.ts`, `src/hooks/use-nav.ts`, `src/components/nav-main.tsx` (via sidebar)
- `src/app/dashboard/invoices/page.tsx` — full; `src/app/dashboard/trips/page.tsx` — full
- `src/app/dashboard/controlling/page.tsx`, `src/app/dashboard/regelfahrten/page.tsx` — patterns
- `src/features/invoices/components/invoice-kpi-section.tsx`, `abrechnung-kpi-cards.tsx`
- `src/features/controlling/components/KpiCards.tsx`, `OperationalFlags.tsx`, `WheelchairStats.tsx`
- `src/features/dashboard/components/stats-card.tsx`
- `src/features/trips/components/trips-listing.tsx` — full (prior session)
- `src/features/trips/components/trips-tables/index.tsx` — full
- `src/query/keys/trips.ts` — full
- `src/features/kts/` — all 3 files
- `src/features/trips/trip-detail-sheet/components/kts-correction-form.tsx`, `kts-correction-timeline.tsx`
- `supabase/migrations/20260610120000_kts_corrections.sql`, `20260610125000_kts_rpc_tenant_guard.sql`, `20260610130000_kts_patient_id.sql`
- `docs/kts-architecture.md` — full
- `supabase/migrations/20260530120000_controlling_rpcs.sql` — `get_controlling_operational` KTS field

---

## Dashboard route inventory (`src/app/dashboard/`)

Top-level route folders (each typically has `page.tsx`):

| Route folder | Notes |
| ------------ | ----- |
| `overview/` | Parallel routes (`@area_stats`, `@bar_stats`, …), `layout.tsx`, `error.tsx` |
| `trips/` | `page.tsx`, `new/`, `fahrten-page-shell.tsx`, `trips-header-actions.tsx` |
| `controlling/` | Pure client analytics page |
| `regelfahrten/` | RSC list + client table |
| `invoices/` | Nested `[id]/`, `new/`, `example/` |
| `angebote/` | Nested `[id]/`, `new/`, `edit/` |
| `abrechnung/` | Hub + `preise/`, `vorlagen/`, `rechnungsempfaenger/`, `angebot-vorlagen/` |
| `clients/` | `page.tsx`, `[id]/`, `new/` |
| `payers/`, `fremdfirmen/`, `drivers/`, `users/`, `fleet/` | Single `page.tsx` each |
| `letters/` | `page.tsx`, `[id]/`, `new/` |
| `fahrerschichtplanung/`, `shift-reconciliations/` | Operations |
| `settings/` | `company/`, `invoice-templates/`, `pdf-vorlagen/`, `unzugeordnete-fahrten/` |
| `documentation/` | `layout.tsx`, `[slug]/` |
| `rechnungsempfaenger/` | Legacy redirect-style page |
| `layout.tsx`, `page.tsx` | Dashboard root |

**No `/dashboard/kts/` route exists today.**

**`loading.tsx` / `error.tsx` convention:** Sparse. Only `overview/` parallel slots and `overview/error.tsx` use them routinely. `regelfahrten/page.tsx` comment explicitly says “No `loading.tsx` yet”. Most list pages use `Suspense` + skeleton inside `page.tsx` instead.

---

## 1. Navigation / sidebar structure

### Where nav is defined

| Layer | File | Role |
| ----- | ---- | ---- |
| **Config (source of truth)** | `src/config/nav-config.ts` | Static `navItems: NavItem[]` array |
| **Rendering** | `src/components/layout/app-sidebar.tsx` | Maps `navItems` → sidebar UI |
| **Filtering** | `src/hooks/use-nav.ts` | `useFilteredNavItems()` — hides all items for driver role (defense in depth) |
| **Breadcrumbs** | `src/lib/build-breadcrumbs.ts` | DFS over same `navItems` tree |
| **KBar** | `src/components/kbar/` | Uses nav config for command palette |

Not dynamic from DB. Comments in `nav-config.ts` document three item variants: **leaf**, **collapse-only group** (`url: '#'`), **expand-and-navigate** (not used in current tree).

### Current top-level nav items and routes

| Sidebar label | Type | Route / children |
| ------------- | ---- | ---------------- |
| Dashboard | Leaf | `/dashboard/overview` |
| Fahrten | Leaf | `/dashboard/trips` |
| Controlling | Leaf | `/dashboard/controlling` |
| Regelfahrten | Leaf | `/dashboard/regelfahrten` |
| Abrechnung | Collapse group (`#`) | Rechnungen, Angebote, Rechnungsempfänger, Preisregeln, Vorlagen, Angebotsvorlagen |
| Account | Collapse group (`#`, `defaultOpen`) | Fahrgäste, Benutzer, Fahrerschichtplanung, Schichtzettel-Abgleich, Flottenübersicht, Kostenträger, Fremdfirmen, Briefe |
| Einstellungen | Collapse group (`#`) | Unternehmen, Unzugeordnete Fahrten |
| Dokumentation | Leaf | `/dashboard/documentation` |

Sidebar group label is hardcoded **“Overview”** in `app-sidebar.tsx` (all items render under one group).

### Where “KTS” fits naturally

Options (product decision):

1. **New top-level leaf** after Fahrten or Controlling — mirrors operational workflow (like Fahrten / Regelfahrten). Architecture PR6 names a future **“KTS-Abrechnung dashboard”**; a dedicated leaf is consistent.
2. **Under Abrechnung** — KTS is billing-adjacent but architecturally separate from invoicing (§1 `kts-architecture.md`). Nav comments say billing items belong under Abrechnung; KTS clearing is **not** standard Rechnung flow — **weak fit**.
3. **Under Account** — operational master data lives here; KTS is trip operations, not Stammdaten — **weak fit**.

**Recommendation:** Top-level leaf **“KTS”** → `/dashboard/kts`, placed after **Fahrten** (same dispatcher mental model: trips → KTS queue).

### Pattern for adding a nav item

1. Edit `src/config/nav-config.ts` — append to `navItems`:

```typescript
{
  title: 'KTS',
  url: '/dashboard/kts',
  icon: 'warning', // or new key in icons.tsx — see below
  shortcut: ['k', 't'], // must not collide; 'k','t' is Fahrten — pick e.g. ['k', 's']
  isActive: false,
  items: []
}
```

2. **`NavItem` shape** (`src/types/index.ts`): `title`, `url`, optional `icon` (keyof `Icons`), `shortcut`, `isActive`, `items`, optional `access`.

3. **Icons** (`src/components/icons.tsx`): Tabler icons mapped by key. Existing keys include `warning` (`IconAlertTriangle`), `trips`, `billing`, `controlling`. No `kts` key — add e.g. `kts: IconFileText` or reuse `warning`.

4. **Breadcrumbs** auto-resolve once `url` is in `navItems` (`build-breadcrumbs.ts`).

5. **No change** to `app-sidebar.tsx` unless new group label desired.

---

## 2. Dashboard layout and page shell pattern

### `src/app/dashboard/layout.tsx`

Shared shell for all dashboard routes:

- **Admin guard** (Supabase `accounts.role === 'admin'`)
- **KBar** command palette
- **`SidebarProvider`** + **`AppSidebar`** (left)
- **`SidebarInset`**: **`Header`** + scrollable `children` area
- **`InfoSidebar`** (right, infobar)

Does **not** include page title — that is per-page.

### Header (`src/components/layout/header.tsx`)

- Sidebar trigger, **Breadcrumbs** (from nav config)
- Global actions: Create trip, search, pending assignments popover

### Per-page shell options

| Pattern | Example | Title | Data fetch |
| ------- | ------- | ----- | ---------- |
| **PageContainer** | `trips/page.tsx`, `regelfahrten/page.tsx`, `clients/page.tsx` | `pageTitle` + `pageDescription` via `Heading` | RSC in child / Suspense |
| **Inline div + h2** | `invoices/page.tsx` | Manual `<h2 className='text-3xl font-bold…'>` | RSC + client KPI section |
| **Client page self-layout** | `controlling/page.tsx` | Own `<h1>` inside client component | TanStack Query only |

### Invoices page structure (`invoices/page.tsx`)

- **Async RSC** (`export default async function`)
- Light server fetch: payers list for filter dropdown
- **Client islands:** `InvoiceKpiSection` (KPI cards), `InvoiceListTable` (wrapped in `Suspense`)
- Layout: `flex min-h-0 flex-1 flex-col overflow-y-auto` + `p-8` padding (not `PageContainer`)

### Trips page structure (`trips/page.tsx`)

- **RSC** + `dynamic = 'force-dynamic'`
- **`FahrtenPageShell`** (client) → `TripsRscRefreshProvider`
- **`PageContainer`** `scrollable={false}` + `pageTitle` / `pageDescription` / header actions
- **`Suspense`** → `TripsListingPage` (heavy RSC Supabase query)
- **`TripsRealtimeSync`** client

### Minimum for `/dashboard/kts/page.tsx`

To fit the established shell:

```tsx
// Recommended hybrid (see senior recommendation)
export default async function KtsPage({ searchParams }) {
  return (
    <PageContainer
      scrollable={false}  // if table owns scroll like Fahrten
      pageTitle='KTS'
      pageDescription='Krankentransportschein — Clearing und Korrekturen'
    >
      <KtsPageClient /> {/* or Suspense boundaries inside */}
    </PageContainer>
  );
}
```

Or invoices-style outer `div` + `p-8` if no `PageContainer` desired. Must use `flex min-h-0 flex-1 flex-col overflow-hidden` (or `overflow-y-auto` for scrollable KPI + table) so content fills area below header.

**Metadata:** `export const metadata = { title: '…' }` like other dashboard pages.

---

## 3. Stat card / KPI pattern

### Existing KPI implementations

| Page | Component | Data pattern |
| ---- | --------- | ------------ |
| **Rechnungen** | `InvoiceKpiSection` → `AbrechnungKpiCards` | Client hook `useAbrechnungKpis()` (React Query / Supabase) |
| **Controlling** | `KpiCards`, `InvoiceKpis`, `WheelchairStats` | `useControllingData(period)` → RPCs |
| **Dashboard overview** | `StatsCard` in parallel routes | Server + client mix |

**Shared UI primitive:** `src/features/dashboard/components/stats-card.tsx` — `Card` with title, value, optional `countLabel`, description, trend badge, `isLoading` skeleton.

**Invoices pattern:** RSC page shell + **client-only KPI section** so aggregates refetch without full RSC round-trip.

**Controlling pattern:** Entire page client; period picker drives RPC refetch.

**Conclusion:** KPI stat cards **exist**; closest template for KTS page is **invoices** (top KPI row + table below) using `StatsCard` / `AbrechnungKpiCards` layout grid.

---

## 4. Data available today for KTS stat cards

### From `trips` (RLS-scoped PostgREST `count`)

| Stat (DE label idea) | Query shape |
| -------------------- | ----------- |
| KTS-Fahrten gesamt | `.from('trips').select('*', { count: 'exact', head: true }).eq('kts_document_applies', true)` |
| Mit KTS-Fehler | `.eq('kts_document_applies', true).eq('kts_fehler', true)` |
| Ohne Patienten-ID | `.eq('kts_document_applies', true).or('kts_patient_id.is.null,kts_patient_id.eq.')` (trim empty) |
| Date-scoped variants | Add same filters as `trips-listing.tsx` on `scheduled_at` / `requested_date` (Berlin bounds) |

Optional filters: `status <> cancelled` (match controlling semantics).

### From `kts_corrections` (RLS-scoped)

| Stat | Query shape |
| ---- | ----------- |
| Offene Korrektur-Runden (rows) | `.from('kts_corrections').select('*', { count: 'exact', head: true }).is('received_at', null)` |
| Überfällig (sent > N days ago, still open) | `.is('received_at', null).lt('sent_at', isoThreshold)` |

### Harder without RPC / migration

| Stat | Why |
| ---- | --- |
| **Trips with open latest round** (not just any open row) | Needs `DISTINCT ON (trip_id)` / latest-round semantics — same problem as list columns audit |
| **Trips in Korrektur** (count distinct `trip_id` with open latest) | Multi-round history; embed or client aggregation is wrong |
| **Beim Steuerberater / pipeline stages** (PR6) | No `kts_reviews` table yet |
| **PR4 external invoice matching** | Tables not migrated |

### `trip_kts_correction_summaries(p_trip_ids uuid[])`

- **Scoped only** to caller-supplied trip UUID array
- Returns **one row per trip that has ≥1 correction** in that set (trips with zero corrections omitted)
- Fields: `trip_id`, `correction_count`, `latest_sent_to`, `latest_sent_at`, `latest_received_at`
- **Not suitable** for global dashboard totals without first knowing all trip IDs
- **Suitable** for table row badges / side panel when trip list is already loaded (PR2.1.1 pattern)

**Tenant guard:** KTS-SEC-01 resolved (`20260610125000_kts_rpc_tenant_guard.sql`).

---

## 5. KTS trip table — reuse vs new

### Can Fahrten list be reused filtered to KTS?

**Partially yes**, with caveats:

- `trips-listing.tsx` already supports URL `kts_filter` tokens: `kts`, `kts_fehler`, `no_kts`, `no_reha`, `reha` (PostgREST on `trips` columns).
- Defaulting `/dashboard/kts` to `kts_filter=kts` (or hardcoding `.eq('kts_document_applies', true)` in a forked listing) reuses RSC query, pagination, filters, kanban toggle.

**Problems with full reuse as-is:**

| Concern | Detail |
| ------- | ------ |
| **Column noise** | Full `columns.tsx` includes driver, price, tax, Fremdfirma, inline KTS toggles, invoice status, etc. |
| **View toggle** | Liste/Kanban + date filter UX is Fahrten-centric |
| **Missing columns** | Correction count, open round, days since `sent_at`, `kts_patient_id` display — not in table |
| **URL coupling** | Fahrten presets, `TripsRscRefreshProvider`, realtime sync — may be wanted or not on KTS page |
| **Performance** | Same deferred invoice + future correction summary queries |

### Columns relevant for KTS operations page

**Keep / prioritize:**

- Datum, Zeit, Fahrgast (`client_name` / passenger label)
- Abholung / Ziel
- Kostenträger, Abrechnung (billing variant)
- `kts_fehler`, `kts_fehler_beschreibung` (read-only or inline)
- Status, Rechnungsstatus (soft warning context)
- **New:** correction summary columns or badges (PR2 columns audit)
- **New:** `kts_patient_id` (trip snapshot)
- Actions: open trip sheet **or** KTS-focused side panel

**Noise for dedicated KTS queue:**

- Driver assignment (unless KTS workflow needs it)
- Netto/Brutto/MwSt, Fremdfirma columns
- Inline `kts_document_applies` toggle (page is already KTS-only)
- Kanban view (optional later)

### Recommendation

- **Do not** mount raw `TripsListingPage` + full `columns` without adaptation.
- **Do** extract shared RSC query helpers from `trips-listing.tsx` or pass forced `kts_filter` + a **slim `ktsColumns`** definition + optional `TripKtsCorrectionSummariesProvider`.
- Architecture PR6 implies a **purpose-built queue**, not a duplicate of Fahrten.

---

## 6. Correction quick-actions — feasibility without trip detail sheet

### Existing mutations / hooks

| Action | Hook / service | File |
| ------ | -------------- | ---- |
| Flag KTS-Fehler / toggle KTS | `useUpdateKtsMutation` | `src/features/kts/hooks/use-update-kts-mutation.ts` → `updateTripKts` / `normalizeKtsPatch` |
| Inline table KTS toggles | Same hook | `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx` |
| List correction rounds | `useTripCorrections(tripId)` | `src/features/kts/hooks/use-kts-corrections.ts` |
| Open correction round | `useInsertKtsCorrectionMutation` | same → `insertKtsCorrection` in `kts.service.ts` |
| Mark received | `useCloseKtsCorrectionMutation` | same → `closeKtsCorrection` |

### Coupling to trip detail sheet?

**Not coupled.** Hooks only need:

- `tripId`, `companyId` (for insert)
- Supabase client (created inside hooks)
- React Query keys (`tripKeys.ktsCorrections`, `tripKeys.all` for KTS field updates)

`KtsCorrectionForm` and `KtsCorrectionTimeline` live under `trip-detail-sheet/components/` but import hooks from `@/features/kts/` — **no sheet context required**.

### `KtsCorrectionForm` props

```typescript
interface KtsCorrectionFormProps {
  tripId: string;
  companyId: string;
  onSuccess: () => void;
  onCancel: () => void;
}
```

**Can render outside trip detail sheet** in a Sheet/Dialog on the KTS page. `onSuccess` should also invalidate `tripKeys.ktsCorrectionSummaries` (once added) per badges audit.

### `KtsCorrectionTimeline` props

```typescript
interface KtsCorrectionTimelineProps {
  tripId: string;
}
```

Includes **“Korrektur erhalten”** button per open round via `useCloseKtsCorrectionMutation`. Reusable in side panel.

### Gaps for page-level quick actions

| Gap | Note |
| --- | ---- |
| No single “flag fehlerhaft + open correction” compound mutation | Compose: `useUpdateKtsMutation` (`kts_fehler: true`) then `useInsertKtsCorrectionMutation` |
| Summary cache invalidation | Insert/close only invalidate `tripKeys.ktsCorrections(tripId)` today — list badges won’t update until extended |
| Row actions UI | Not built — need table action column or side panel |

---

## 7. Side panel pattern

### Reusable focused panel?

| Pattern | File | Notes |
| ------- | ---- | ----- |
| **Trip detail sheet** | `trip-detail-sheet.tsx` | Full `Sheet` `sm:max-w-xl` — heavy, trip-centric |
| **Payer details** | `payer-details-sheet.tsx` | `Sheet` for Kostenträger CRUD — good reference for entity side panel |
| **Shift detail** | `shift-detail-panel.tsx` | **Inline panel** (not Sheet) in Miller-style layout |
| **Client column view** | `clients-column-view.tsx` + `ClientDetailPanel` | Master-detail columns on same page |
| **Invoice builder** | `Sheet` bottom/right for PDF preview | Ephemeral preview, not CRUD panel |

**No shared `<SidePanel>` abstraction.** Standard approach: **shadcn `Sheet`** (`src/components/ui/sheet.tsx`) with `SheetContent side='right'`.

**Pragmatic KTS page pattern:** Table row click → narrow **`Sheet`** with:

- Trip summary (read-only subset)
- `KtsCorrectionTimeline` + conditional `KtsCorrectionForm`
- Link to full `TripDetailSheet` for deep edits

Alternatively reuse existing **`TripDetailSheet`** opened from KTS page (less “without sheet” but zero new UI).

---

## 8. Route and file structure

### Proposed structure (conventions)

```
src/app/dashboard/kts/
  page.tsx              # RSC shell + metadata (+ optional searchParams)
  kts-page-shell.tsx    # optional client provider wrapper (like FahrtenPageShell)
  # loading.tsx         # optional — not required by convention
  # error.tsx           # optional

src/features/kts/
  components/
    kts-kpi-section.tsx
    kts-trip-table.tsx      # or wrap adapted listing
    kts-trip-side-sheet.tsx # correction-focused Sheet
  hooks/
    use-kts-dashboard-stats.ts
    use-kts-correction-summaries.ts  # batch RPC (PR2.1.1)
  kts.service.ts          # existing + fetchTripKtsCorrectionSummaries
  hooks/                  # existing correction + update hooks
```

### Nested routes

| Route | When |
| ----- | ---- |
| `/dashboard/kts` only | **V1** — stats + filtered table + side sheet |
| `/dashboard/kts/import/[id]` | **PR4** CSV import review — defer |
| `/dashboard/kts/[tripId]` | Optional deep link; could open sheet via query `?tripId=` instead |

**Query param pattern** matches Fahrten (`tripId` opens detail sheet) and clients (`?clientId=`).

### `loading.tsx` / `error.tsx`

Optional. Follow **trips/regelfahrten**: `Suspense` + `DataTableSkeleton` inside `page.tsx` is the dominant pattern.

---

## 9. Existing KTS feature folder

### Files in `src/features/kts/`

| File | Purpose |
| ---- | ------- |
| `kts.service.ts` | **Write authority** for trip KTS columns: `normalizeKtsPatch`, `buildKtsPatchFromDrafts`, `updateTripKts`. **Corrections:** `fetchTripCorrections`, `insertKtsCorrection`, `closeKtsCorrection`. Constants: `KTS_SOURCE_MANUAL`. |
| `hooks/use-update-kts-mutation.ts` | TanStack mutation for inline/list KTS field updates; invalidates `tripKeys.detail` + `tripKeys.all`. |
| `hooks/use-kts-corrections.ts` | `useTripCorrections`, `useInsertKtsCorrectionMutation`, `useCloseKtsCorrectionMutation`. |

### UI in `src/features/kts/`

**None.** All UI today lives in:

- `trip-detail-sheet.tsx` (KTS block, patient ID)
- `trip-detail-sheet/components/kts-correction-form.tsx`, `kts-correction-timeline.tsx`
- `trips-tables/inline-cells/kts-cells.tsx`

### Additions needed for page shell

| Piece | Suggested location |
| ----- | ------------------ |
| KPI stat cards | `features/kts/components/kts-kpi-section.tsx` |
| Dashboard stats query | `features/kts/hooks/use-kts-dashboard-stats.ts` or RSC server function |
| Batch correction summaries | `features/kts/hooks/use-kts-correction-summaries.ts` + service RPC wrapper |
| Table wrapper / columns | `features/kts/components/kts-trips-table.tsx` or extend trips feature with `kts/` subfolder |
| Side sheet | `features/kts/components/kts-trip-panel.tsx` |
| Query keys | `src/query/keys/kts.ts` or extend `tripKeys` with `ktsDashboardStats`, `ktsCorrectionSummaries` |

---

## 10. Controlling RPC relevance

### `get_controlling_operational(p_company_id, p_date_from, p_date_to)`

**Context:** Controlling dashboard (`/dashboard/controlling`) — **period-based analytics**, not a KTS clearing queue.

**Return shape** (one row per calendar day in range):

| Column | Type |
| ------ | ---- |
| `trip_date` | date |
| `total_trips` | integer |
| `completed_trips` | integer |
| `cancelled_trips` | integer |
| `revenue_net` / `revenue_gross` | numeric |
| `total_km` | numeric |
| `avg_price_per_trip` / `avg_km_per_trip` | numeric |
| `unpriced_trips` | integer |
| `unassigned_trips` | integer |
| `wheelchair_trips` | integer |
| **`kts_trips`** | integer — count non-cancelled trips with `kts_document_applies = true` **that day** |
| `fremdfirma_trips` | integer |
| `fremdfirma_cost` | numeric |

**Useful for KTS page?**

- **Limited.** Gives **daily KTS trip volume** inside a selected period (same as `WheelchairStats` KTS share card).
- Does **not** expose: `kts_fehler`, open corrections, patient ID gaps, pipeline status.
- Requires **company_id + date range** and client-side aggregation (`aggregateOperationalRows`).

**Verdict:** Do not depend on Controlling RPCs for KTS operations dashboard; use dedicated counts on `trips` + `kts_corrections` (or future KTS-specific RPC).

---

## Senior recommendation — page architecture

### Choose: **Hybrid RSC shell + client islands** (like Fahrten + Invoices)

| Layer | Approach | Rationale |
| ----- | -------- | --------- |
| **`page.tsx`** | Async **RSC** | Metadata, optional light server prefetch (company id), `PageContainer`, `Suspense` boundaries |
| **Stat cards** | **Client** `useQuery` (or small RSC `count` fetch) | Aggregates change on mutations; refetch without `router.refresh()`; mirrors `InvoiceKpiSection` |
| **Trip table** | **RSC data fetch** OR shared listing with forced KTS filter | Pagination/filter URL via `nuqs` like Fahrten; grid data in RSC props keeps parity with trips-listing performance model |
| **Correction summaries** | **Client batch RPC** keyed by visible trip IDs | Same deferred pattern as invoice badges; not in main RSC select |
| **Quick actions** | **Client mutations** | Existing hooks; invalidate stats + summary keys on success |
| **Detail / corrections UI** | **`Sheet` side panel** | Lighter than full trip sheet; reuse `KtsCorrectionForm` + `KtsCorrectionTimeline` |

### Avoid

| Approach | Why |
| -------- | --- |
| **Pure client page** (Controlling-style) | Loses RSC trip list benefits; duplicates heavy query logic client-side |
| **Pure RSC** | Stat cards and mutations need client refetch; awkward without islands |
| **Full `TripsListingPage` unmodified** | Wrong columns, kanban noise, wrong default filters |

### Suggested render tree

```
page.tsx (RSC)
  PageContainer title="KTS"
    KtsKpiSection (client, useQuery × N counts or one RPC later)
    Suspense → KtsTripsListing (RSC: trips where kts_document_applies, paginated)
      KtsTripTable (client: TanStack + correction summary provider)
      KtsTripPanel (client Sheet: timeline + form + link to full trip)
    TripDetailSheet (optional: reuse global trip sheet via ?tripId=)
```

### Query keys to add

- `ktsKeys.stats(period?)` or `['kts', 'dashboard', 'stats', …]`
- `tripKeys.ktsCorrectionSummaries(sortedTripIds)` (per PR2.1.1 audit)
- Invalidate both + `tripKeys.all` on correction insert/close and KTS field updates

### Phasing

1. **PR3.5a:** Route + nav + KPI counts (trips + open corrections) + read-only table (slim columns, KTS filter).
2. **PR3.5b:** Correction summary RPC wiring + row badges.
3. **PR3.5c:** Side sheet quick actions (fehler, open/close round) without full trip sheet.
4. **PR4+:** CSV import nested route, external invoice stats.

---

## Related documents

- [`docs/kts-architecture.md`](../kts-architecture.md) — PR6 future dashboard row
- [`docs/plans/kts-pr2-1-1-badges-audit.md`](kts-pr2-1-1-badges-audit.md)
- [`docs/plans/kts-pr2-columns-audit.md`](kts-pr2-columns-audit.md)
- [`docs/access-control.md`](../access-control.md) — admin-only dashboard layout
