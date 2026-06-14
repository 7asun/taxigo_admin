# KTS PR3.2 — Page shell audit (`/dashboard/kts`)

**Status:** Complete — implemented per [`.cursor/plans/kts_pr3.2_queue_page_c140c62d.plan.md`](../../.cursor/plans/kts_pr3.2_queue_page_c140c62d.plan.md)

**Date:** 2026-06-10  
**Scope:** Read-only audit for the **KTS processing queue** page — navigation, shell, KPIs, table data path, inline row expansion, filters, refresh strategy, component reuse, and mobile.  
**Constraint:** Audit only — implementation in PR3.2.

**Business context:** `/dashboard/kts` is a speed-first clearing queue. Admin compares physical KTS papers to TaxiGo trips. Five document states (`ungeprueft`, `korrekt`, `fehlerhaft`, `in_korrektur`, `uebergeben`). Critical UX: **inline row expand** for flag-error / send-to-issuer — one text field, Enter confirms, **no modal, no sheet, no navigation**.

**Related:** [`docs/kts-architecture.md`](../kts-architecture.md) §3.4, [`docs/plans/kts-pr3-1-status-audit.md`](kts-pr3-1-status-audit.md), [`docs/plans/kts-pr3-5-page-shell-audit.md`](kts-pr3-5-page-shell-audit.md).

---

## Sources read

**Navigation + shell**

- `src/config/nav-config.ts` — full
- `src/components/layout/app-sidebar.tsx` — full
- `src/components/icons.tsx` — full
- `src/app/dashboard/layout.tsx` — full
- `src/components/layout/page-container.tsx` — full
- `src/components/layout/header.tsx` — full

**Reference pages**

- `src/app/dashboard/invoices/page.tsx` — full
- `src/app/dashboard/trips/page.tsx` — full
- `src/app/dashboard/trips/fahrten-page-shell.tsx` — full
- `src/features/invoices/components/invoice-kpi-section.tsx` — full
- `src/features/dashboard/components/stats-card.tsx` — full

**Trips table**

- `src/features/trips/components/trips-listing.tsx` — full
- `src/features/trips/components/trips-tables/index.tsx` — full
- `src/features/trips/components/trips-tables/columns.tsx` — KTS column defs + general column shape
- `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx` — full
- `src/features/trips/components/trips-tables/` — 10 files listed; expandable-row grep across trips feature

**KTS service + hooks**

- `src/features/kts/kts.service.ts` — full
- `src/features/kts/hooks/use-kts-status.ts` — full
- `src/features/kts/hooks/use-kts-corrections.ts` — referenced via correction form/timeline
- `src/features/kts/hooks/use-update-kts-mutation.ts` — not primary for PR3.2 queue actions
- `src/features/trips/trip-detail-sheet/components/kts-correction-form.tsx` — full
- `src/features/trips/trip-detail-sheet/components/kts-correction-timeline.tsx` — full

**Sheet pattern**

- `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` — Sheet open/close props + trigger path
- `src/components/ui/sheet.tsx` — full

**Filtering + query**

- `src/features/trips/components/trips-filters-bar.tsx` — full (URL update pattern)
- `src/lib/searchparams.ts` — full
- `src/query/keys/trips.ts` — full
- `src/features/trips/api/trips.service.ts` — signatures only (no dedicated kts_status list fetch)
- `supabase/migrations/20260610140000_kts_status.sql` — partial index name

**Design tokens + UI inventory**

- `src/styles/globals.css`, `src/styles/theme.css`, `src/styles/themes/vercel.css`
- `src/lib/trip-status.ts`, `docs/color-system.md`
- `src/types/data-table.ts` — `ColumnMeta`
- `src/components/ui/` — 63 files listed

**Refresh / realtime**

- `src/features/trips/providers/trips-rsc-refresh-provider.tsx`
- `src/features/trips/components/trips-realtime-sync.tsx`
- `src/features/trips/components/trips-rsc-refresh-chrome.tsx`

---

## 1. Navigation entry

### NavItem shape for a new top-level leaf

From `src/types/index.ts`:

| Field | Type | Required |
| ----- | ---- | -------- |
| `title` | `string` | yes |
| `url` | `string` | yes |
| `disabled` | `boolean` | no |
| `external` | `boolean` | no |
| `shortcut` | `[string, string]` | no |
| `icon` | `keyof typeof Icons` | no |
| `label` | `string` | no |
| `description` | `string` | no |
| `isActive` | `boolean` | no |
| `items` | `NavItem[]` | no (empty `[]` for leaf) |
| `access` | `PermissionCheck` | no |

Example leaf (matches Fahrten / Controlling):

```typescript
{
  title: 'KTS',
  url: '/dashboard/kts',
  icon: 'post',           // see icon candidates below
  shortcut: ['k', 's'],
  isActive: false,
  items: []
}
```

`nav-config.ts` comments require: shortcuts must not duplicate existing combinations; billing items under Abrechnung; app settings under Einstellungen.

### Icon candidates for “KTS”

| Rank | `Icons` key | Tabler component | Rationale |
| ---- | ----------- | ---------------- | --------- |
| 1 | `post` | `IconFileText` | Document / form metaphor — closest to “KTS paper” |
| 2 | `shiftReconciliation` | `IconClipboardCheck` | Checklist / reconciliation queue |
| 3 | `warning` | `IconAlertTriangle` | Error-queue emphasis (already used for “Unzugeordnete Fahrten”) |

Adding a dedicated `kts: IconFileText` alias is optional; `post` is available without editing `icons.tsx`.

### Shortcut keys — unused and safe

**Currently used** (from `nav-config.ts` + KBar `newTripAction`):

`d,d` `t,t` `c,o` `r,f` `a,a` `r,r` `g,g` `r,e` `p,r` `v,v` `a,v` `f,f` `b,n` `f,p` `s,z` `f,l` `k,k` `f,r` `l,t` `e,u` `u,f` `h,h`

**Safe unused pairs** (no collision today):

- **`k,s`** — recommended for KTS (mnemonic: **K**TS **S**chein)
- `i,k`, `q,k`, `w,k`, `x,k`, `y,k`, `z,k`, `m,t`, `n,t`

Avoid `k,t` (reads like “Kostenträger + trip”) and `k,k` (Kostenträger).

### Breadcrumbs + KBar — automatic or extra registration?

| Concern | Automatic? | Mechanism |
| ------- | ---------- | --------- |
| **Sidebar** | Yes | `app-sidebar.tsx` → `useFilteredNavItems(navItems)` |
| **Breadcrumbs** | Yes | `src/lib/build-breadcrumbs.ts` DFS over `navItems` by URL |
| **KBar** | Yes | `src/components/kbar/index.tsx` flatMaps `filteredItems` into navigation actions (parent + children) |

**No separate breadcrumb or KBar registry.** One edit to `navItems` wires all three, subject to driver RBAC in `use-nav.ts` (admin-only items still show for admins).

**Route file still required:** `src/app/dashboard/kts/page.tsx` (and feature components) — nav alone does not create the page.

---

## 2. Page shell pattern

### PageContainer (trips) vs inline div + p-8 (invoices)

| Pattern | Used by | Scroll ownership |
| ------- | ------- | ---------------- |
| **PageContainer** `scrollable={false}` | Fahrten, Regelfahrten, Clients | Parent `overflow-hidden`; child table owns scroll |
| **Inline `div` + `p-8`** | Rechnungen | Page root `overflow-y-auto`; table scrolls inside client component |

**Recommendation: PageContainer (trips-style).**

Concrete reason: the KTS queue is a **full-height data table with sticky filters and internal vertical scroll**, identical to Fahrten. Invoices KPI cards + list tolerate page-level scroll; a processing queue with inline expand rows needs the table viewport locked (`min-h-0 flex-1 overflow-hidden`) so expanded rows stay visible without double scrollbars.

### Client wrapper like `FahrtenPageShell`?

**Yes — a thin client boundary is needed**, but not for layout alone.

`FahrtenPageShell` exists solely to mount `TripsRscRefreshProvider` so mutations anywhere under the page can call `refreshTripsPage()` (RSC refetch + `tripKeys.all` invalidation).

For KTS:

- Table data will likely stay **RSC-fetched** (same as `trips-listing.tsx`).
- Inline mutations use **`use-kts-status.ts`** hooks that invalidate `tripKeys.all` + `tripKeys.detail` but **do not** call `router.refresh()`.

**Options:**

1. Reuse `TripsRscRefreshProvider` via `KtsPageShell` alias (same provider, works because KTS rows are trips).
2. Add `KtsRscRefreshProvider` that wraps the same logic + optional `tripKeys.ktsSummaries` invalidation for KPI counts.

**Cannot be a bare RSC `page.tsx` only** if KPIs are client `useQuery` and mutations must refresh RSC list + KPIs without full reload — need provider + `refreshTripsPage()` (or KTS-named equivalent) after URL filter changes and post-mutation.

### Minimum `page.tsx` structure (desktop + mobile)

Follow `trips/page.tsx`:

```tsx
// Pseudocode — structure only
export default async function KtsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await searchParamsCache.parse(searchParams); // or KTS-specific cache

  return (
    <KtsPageShell>  {/* TripsRscRefreshProvider or fork */}
      <PageContainer
        scrollable={false}
        pageTitle='KTS'
        pageDescription='…'
      >
        <Suspense fallback={<DataTableSkeleton … />}>
          <KtsListingPage searchParams={searchParams} />  {/* RSC: Supabase query */}
        </Suspense>
        {/* Optional: TripsRealtimeSync or KTS-scoped realtime */}
      </PageContainer>
    </KtsPageShell>
  );
}
```

Dashboard layout (`layout.tsx`) already provides `SidebarProvider`, `Header`, `SidebarInset` with `flex min-h-0 flex-1 flex-col overflow-hidden`. PageContainer `scrollable={false}` + `p-4 md:px-6` matches Fahrten at all breakpoints.

---

## 3. Stat cards / KPI section

### `StatsCardProps` (exact)

From `src/features/dashboard/components/stats-card.tsx`:

| Prop | Type | Required |
| ---- | ---- | -------- |
| `title` | `string` | yes |
| `value` | `string \| number` | yes |
| `countLabel` | `string` | no |
| `description` | `string` | no |
| `trend` | `{ value: string \| number; isUp: boolean; label?: string }` | no |
| `trendTooltip` | `string` | no |
| `isLoading` | `boolean` | no |
| `className` | `string` | no |

`StatsRowCard` accepts the same props (compact carousel layout).

### How `InvoiceKpiSection` fetches data

**Client React Query + derived counts** — not RSC, not direct Supabase in the section.

Chain: `InvoiceKpiSection` → `useAbrechnungKpis()` → `useInvoices()` + `useAngeboteList()` → client-side loop over fetched rows.

### KTS stat cards — four PostgREST count queries

Assume `companyId` from session (e.g. `auth()` + `accounts.company_id` or embed). **Trips list today does not pass `company_id` explicitly** — RLS scopes tenant. For **explicit** counts (server action or RSC), include `.eq('company_id', companyId)`.

Partial index for status filters: **`idx_trips_company_kts_status`** on `(company_id, kts_status) WHERE kts_document_applies = true` (from `20260610140000_kts_status.sql`).

#### (a) KTS gesamt

```typescript
const { count } = await supabase
  .from('trips')
  .select('*', { count: 'exact', head: true })
  .eq('company_id', companyId)
  .eq('kts_document_applies', true);
```

#### (b) Ungeprüft

```typescript
const { count } = await supabase
  .from('trips')
  .select('*', { count: 'exact', head: true })
  .eq('company_id', companyId)
  .eq('kts_document_applies', true)
  .eq('kts_status', 'ungeprueft');
```

#### (c) Fehlerhaft + In Korrektur (combined)

```typescript
const { count } = await supabase
  .from('trips')
  .select('*', { count: 'exact', head: true })
  .eq('company_id', companyId)
  .eq('kts_document_applies', true)
  .in('kts_status', ['fehlerhaft', 'in_korrektur']);
```

#### (d) Überfällig (`in_korrektur`, open correction, `sent_at` &lt; now − 10d)

**Not a single-table count.** `sent_at` lives on `kts_corrections`, not `trips`. Options:

**Option A — filter trips with embed (PostgREST):**

```typescript
const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

const { count } = await supabase
  .from('trips')
  .select('id, kts_corrections!inner(sent_at, received_at)', { count: 'exact', head: true })
  .eq('company_id', companyId)
  .eq('kts_document_applies', true)
  .eq('kts_status', 'in_korrektur')
  .is('kts_corrections.received_at', null)
  .lt('kts_corrections.sent_at', cutoff);
```

**Option B — count corrections table (may over-count if multiple open rounds per trip — schema should prevent):**

```typescript
const { count } = await supabase
  .from('kts_corrections')
  .select('*', { count: 'exact', head: true })
  .eq('company_id', companyId)
  .is('received_at', null)
  .lt('sent_at', cutoff);
// Join/filter to trips.kts_status = 'in_korrektur' in RPC for accuracy.
```

**Recommendation for PR3.2:** one **`get_kts_queue_kpis(company_id)` RPC** returning four integers — avoids four round-trips and embed edge cases. Until then, Option A from server RSC or client query.

### RSC vs client `useQuery` for stat cards?

**Client `useQuery` with dedicated key** (e.g. `tripKeys.ktsSummaries()` or `['kts', 'kpis']`) **+ invalidate on mutation success** alongside `tripKeys.all`.

Reasons:

- Inline mutations (`markKtsChecked`, `markKtsFehlerhaft`, etc.) must update counts **without full page reload**.
- Matches invoice KPI pattern (client refetch path).
- RSC-only KPIs would require `router.refresh()` on every row action — slower UX on a speed-critical queue.

Hybrid acceptable: RSC seed on first paint, client query with `initialData` — optional optimization.

---

## 4. Trip table — data fetching

### How `trips-listing.tsx` fetches

**Direct Supabase in RSC** — not an API route, not `tripsService.getTrips()`.

Pattern:

```typescript
export default async function TripsListingPage({
  searchParams
}: TripsListingPageProps)
```

Inside: `createClient()` (server) → `supabase.from('trips').select(tripsListSelect, { count: 'exact' })` → filters from `searchParamsCache` → `.range(from, to)` for pagination.

### Reuse for KTS table?

**Do not reuse `TripsListingPage` as-is.** Fork into `KtsListingPage` (or shared internal helper) with:

- Forced `.eq('kts_document_applies', true)`
- Filters on `kts_status` (not legacy `kts_filter` tokens)
- Different columns and inline actions
- Optional embed: `kts_corrections(sent_at, received_at, sent_to)` for aging column

Shared extraction candidate: date filter block (`scheduled_at` URL param + `getZonedDayBoundsIso`) — copy or extract later.

### SELECT string — includes `kts_status`?

List select uses `*`:

```typescript
const tripsListSelect = `
  *,
  payer:payers(name, reha_schein_enabled),
  billing_variant:billing_variants(...),
  driver:accounts!trips_driver_id_fkey(name),
  fremdfirma:fremdfirmen(...)
`;
```

**`kts_status` is included via `*`** once migration is applied. No select-string change required for the column itself.

**Add for queue UX:**

- `kts_patient_id` (already on row via `*`)
- Optional embed: `kts_corrections(id, sent_at, received_at, sent_to)` filtered to open round for `in_korrektur` aging

### Pagination

| Mechanism | Detail |
| --------- | ------ |
| **Type** | Offset via PostgREST `.range(from, to)` |
| **URL params** | `page` (1-based), `perPage` (default 50) |
| **Parsers** | `src/lib/searchparams.ts` + `useDataTable` / `useQueryState('perPage', parseAsInteger.withDefault(50))` |
| **Server** | `searchParamsCache.get('page')`, `searchParamsCache.get('perPage')` in listing RSC |

Kanban bypasses pagination (`limit(2000)`); KTS queue should use **list pagination** like Fahrten.

### `company_id` scoping

**RLS only** in `trips-listing.tsx` — no explicit `.eq('company_id', …)`.

Session JWT + Supabase RLS policies restrict rows to the active company. Explicit `company_id` filter is still wise for KPI RPCs/server actions when using service patterns that bypass RLS.

---

## 5. TanStack table setup

### Column definition pattern (`columns.tsx`)

Minimal column:

```typescript
{
  id: 'client_name',           // optional; defaults from accessorKey
  accessorKey: 'client_name',  // or accessorFn: (row) => …
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='Fahrgast' />
  ),
  cell: ({ row }) => <span>{row.original.client_name}</span>,
  meta: { label: 'Fahrgast', variant: 'text' },
  enableColumnFilter: false
}
```

KTS columns today (`kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung`) use inline cells wrapped in `KtsCellGroupProvider` — built for **Fahrten inline edit**, not queue actions.

### `ColumnMeta` type

From `src/types/data-table.ts`:

```typescript
interface ColumnMeta<TData, TValue> {
  label?: string;
  placeholder?: string;
  variant?: FilterVariant;
  options?: Option[];
  range?: [number, number];
  unit?: string;
  icon?: React.FC<React.SVGProps<SVGSVGElement>>;
}
```

### Action columns

**Dedicated `actions` column** at end of `columns` array:

```typescript
{
  id: 'actions',
  cell: ({ row }) => <CellAction data={row.original} />
}
```

Row-level buttons for KTS queue should live in a **`kts_actions` column** (or inline in status column), not the trips `CellAction` dropdown.

### Row selection

**Yes — checkbox column `id: 'select'`** at start of `columns`:

- Header: `table.toggleAllPageRowsSelected`
- Cell: `row.toggleSelected`
- State: TanStack `rowSelection` via `useDataTable`
- Bulk bar: `TripsPaginationBulkActions` in pagination footer

KTS PR3.3 handover batch may reuse this pattern; PR3.2 queue may omit selection until handover.

---

## 6. Inline row expansion — critical

### Existing expandable table rows?

**No.** Repo-wide grep: no `getExpandedRowModel`, `row.getIsExpanded`, or accordion rows in any table.

Collapsible usage elsewhere:

- `trips-filters-bar.tsx` — mobile “more filters” panel (not table)
- `add-passenger-inline.tsx` — form UI
- Kanban “expand” — fullscreen portal, not table rows
- CSV column selector — category expand

### Closest shadcn components

Both **installed**:

- `src/components/ui/collapsible.tsx`
- `src/components/ui/accordion.tsx`

**Collapsible inside `<tr>`:** Radix Collapsible renders a `div` — **invalid HTML inside `<table>`** and breaks layout/semantics in strict table mode.

**Accordion:** same issue — not for use inside `<tbody>` rows.

### Recommended DOM pattern for KTS expand

Render **two sibling `<TableRow>` elements** per logical row:

1. Data row (existing cells + ✓/✗ buttons)
2. Expand row: single `<TableCell colSpan={visibleColumnCount}>` containing input + confirm/cancel

This matches valid table semantics and works with current `DataTable` structure.

### Implementation note on `DataTable`

`src/components/ui/table/data-table.tsx` hardcodes **one `<TableRow>` per TanStack row** (lines 151–167). Inline expand requires either:

- **Fork** `KtsDataTable` copied from `DataTable` with expand row branch, or
- **Extend** `DataTable` with optional `renderSubRow?(row)` callback

Do **not** put Collapsible as a child of `<td>` expecting it to span full row width without `colSpan` on a second row.

---

## 7. Filtering + URL state

### Trips filter bar URL management

**Manual `URLSearchParams` + `router.replace`** — not `useQueryState` in the filter bar.

Flow (`trips-filters-bar.tsx`):

1. Read: `useSearchParams()`
2. Write: clone params → mutate → `router.replace(pathname + '?' + params, { scroll: false })`
3. Then: `refreshTripsPage()` so RSC refetches (replace alone can show stale tree briefly)

**nuqs** used for:

- Server: `searchParamsCache` / `createSearchParamsCache` in `src/lib/searchparams.ts`
- Client table: `useQueryState('perPage')`, sorting/page via `useDataTable`

### Trips URL params (existing)

| Param | Parser | Default / notes |
| ----- | ------ | ---------------- |
| `page` | `parseAsInteger` | `1` |
| `perPage` | `parseAsInteger` | `50` |
| `search` | `parseAsString` | optional |
| `status` | `parseAsString` | trip lifecycle, not KTS |
| `driver_id` | `parseAsString` | |
| `payer_id` | `parseAsArrayOf(,)` | comma-separated |
| `billing_variant_id` | `parseAsArrayOf(,)` | |
| `invoice_status` | `parseAsString` | |
| `kts_filter` | `parseAsArrayOf(,)` | `kts`, `kts_fehler`, `no_kts`, `no_reha`, `reha` |
| `scheduled_at` | `parseAsString` | YMD, timestamp, or `from,to` range |
| `sort` | `parseAsString` | |
| `view` | `parseAsString` | `list` (default) / `kanban` |

Fahrten mounts default `scheduled_at=today` on first visit if absent.

### KTS page filter params — reuse map

| KTS need | Trips equivalent | Reusable? |
| -------- | ---------------- | --------- |
| `status` (kts_status enum) | `status` (trip status) | **Param name collision** — use `kts_status` |
| `date` (single/range) | `scheduled_at` | **Logic reusable**, prefer `kts_date` or reuse `scheduled_at` if product means trip date |
| `search` (patient / kts_patient_id) | `search` | **Pattern reusable** — extend OR clause with `kts_patient_id.ilike`, `client_name.ilike` |
| `overdue` (boolean) | — | **New** — e.g. `overdue=1` triggers embed filter |

Legacy `kts_filter` tokens do **not** map to PR3.1 `kts_status` enum — do not reuse for queue filters.

### Filter bar configurability

**Hardcoded to Fahrten fields** — `TripsFiltersBar` is not config-driven. KTS needs **`KtsFiltersBar`** (copy structure, subset of controls) or shared primitives extracted later.

---

## 8. Real-time / refresh strategy

### Trips realtime

**Yes.** `src/features/trips/components/trips-realtime-sync.tsx`:

- Channel: `trips-realtime-sync`
- Events: `postgres_changes` INSERT/UPDATE on `public.trips`
- Debounced 450ms → `refreshTripsPage()`

### Recommended refresh for KTS inline mutations

| Layer | After mutation |
| ----- | -------------- |
| **Row UI** | Optimistic update optional for ✓/✗; at minimum invalidate/refetch |
| **TanStack Query** | Already: `tripKeys.detail(tripId)` + `tripKeys.all` in `use-kts-status.ts` |
| **RSC list** | Call **`refreshTripsPage()`** (or KTS alias) after success — grid data lives in RSC |
| **KPI counts** | Invalidate dedicated `['kts', 'kpis']` query |

**Pattern:** `onSuccess`: `await refreshTripsPage()` + `invalidateQueries(ktsKpiKey)` — same as filter bar after URL change.

Pure `router.refresh()` without Query invalidation misses trip detail caches; pure Query invalidation **does not** refresh RSC list props.

### `TripsRscRefreshProvider`

**Yes — reusable on KTS page.**

```typescript
refreshTripsPage = async () => {
  await router.refresh();
  await queryClient.invalidateQueries({ queryKey: tripKeys.all });
};
```

Mount via page shell wrapper. Optionally add `TripsRealtimeSync` for multi-admin concurrency (same `trips` table).

Rename to generic `TripDataRefreshProvider` is cosmetic only.

---

## 9. `KtsCorrectionForm` + `KtsCorrectionTimeline` reuse

### `KtsCorrectionForm` props (still accurate)

```typescript
interface KtsCorrectionFormProps {
  tripId: string;
  companyId: string;
  onSuccess: () => void;
  onCancel: () => void;
}
```

Uses **`useInsertKtsCorrectionMutation`** (legacy insert) — **not** `sendKtsCorrection` from PR3.1. Queue “send to issuer” should call **`useSendKtsCorrectionMutation`** → `sendKtsCorrection()` which sets `kts_status: in_korrektur`.

### Render inside table row expansion?

**Not for the critical ✗ fehler path.** Form has **three fields** (sent_to, sent_at, notes) + save/cancel — heavier than “one text field, Enter confirms.”

| Action | Reuse form? |
| ------ | ----------- |
| Flag error (`ungeprueft` → `fehlerhaft`) | **New minimal inline input** calling `markKtsFehlerhaft` |
| Send to issuer (`fehlerhaft` → `in_korrektur`) | **Simplified inline** (sent_to only?) or slimmed form — not full sheet form |
| Detail / audit | Optional `TripDetailSheet` link |

Styling (`border-dashed`, `text-xs`) fits a `colSpan` expand panel visually.

### `KtsCorrectionTimeline` — “Korrektur erhalten” button

**Rendered internally** for open rounds (`received_at == null`). Uses `useCloseKtsCorrectionMutation` — **not** PR3.1 `receiveKtsCorrection` / `useReceiveKtsCorrectionMutation` (status may not transition to `ungeprueft` via close-only path).

Queue “mark received” action should use **`useReceiveKtsCorrectionMutation`** explicitly.

### Empty timeline

**Returns `null`** when `rounds.length === 0` — no empty-state UI.

---

## 10. shadcn components available

### All files in `src/components/ui/` (63)

`accordion.tsx`, `alert-dialog.tsx`, `alert.tsx`, `aspect-ratio.tsx`, `avatar.tsx`, `badge.tsx`, `breadcrumb.tsx`, `builder-section-card.tsx`, `button.tsx`, `calendar.tsx`, `card.tsx`, `chart.tsx`, `checkbox.tsx`, `client-auto-suggest.tsx`, `collapsible.tsx`, `command.tsx`, `context-menu.tsx`, `date-time-picker.tsx`, `dialog.tsx`, `drawer.tsx`, `dropdown-menu.tsx`, `form.tsx`, `frame.tsx`, `heading.tsx`, `hover-card.tsx`, `info-button.tsx`, `infobar.tsx`, `input-otp.tsx`, `input.tsx`, `label.tsx`, `menubar.tsx`, `modal.tsx`, `navigation-menu.tsx`, `pagination.tsx`, `popover.tsx`, `progress.tsx`, `radio-group.tsx`, `resizable.tsx`, `scroll-area.tsx`, `select.tsx`, `separator.tsx`, `sheet.tsx`, `sidebar.tsx`, `skeleton.tsx`, `slider.tsx`, `sonner.tsx`, `switch.tsx`, `table.tsx`, `tabs.tsx`, `textarea.tsx`, `toggle-group.tsx`, `toggle.tsx`, `tooltip.tsx`, plus `table/*` data-table helpers.

### Presence checklist

| Component | Present |
| --------- | ------- |
| Collapsible | yes |
| Accordion | yes |
| Badge | yes |
| Tooltip | yes |
| Popover | yes |
| Sheet | yes |
| Dialog | yes |
| Table | yes |
| Input | yes |
| Textarea | yes |
| Button | yes |
| Select | yes |
| DatePicker / Calendar | yes (`calendar.tsx`, `date-time-picker.tsx`) |
| Command | yes |

Missing components can be added with `npx shadcn@latest add <component>` — project uses shadcn New York style; no conflict expected with existing set.

---

## 11. Color tokens for status badges

### Existing patterns

Per `docs/color-system.md`:

- **UI chrome:** theme tokens (`bg-muted`, `text-muted-foreground`, `border-border`, `text-destructive`)
- **Semantic status:** hardcoded Tailwind + `dark:` in **`src/lib/trip-status.ts`** (`tripStatusBadge` cva)

KTS correction timeline badges (inline example):

- Open: `border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300`
- Closed: `border-green-100 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400`

### Map `kts_status` → tokens

| Status | Mapping | Example classes |
| ------ | ------- | ----------------- |
| `ungeprueft` | neutral / muted | `bg-muted text-muted-foreground border-border` (same as `tripStatusBadge` pending) |
| `korrekt` | success / green | `bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800` |
| `fehlerhaft` | error / red | `bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800` |
| `in_korrektur` | warning / amber | `bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800` |
| `uebergeben` | faint / archived | `bg-muted/50 text-muted-foreground border-border opacity-70` |

**Recommendation:** add `src/lib/kts-status.ts` mirroring `trip-status.ts` (central cva) — do not scatter colors in table cells.

### Light + dark mode

Theme tokens (`--muted`, `--destructive`, etc.) defined per theme in `src/styles/themes/*.css` with `.dark` variants — **yes, both modes supported.**

Semantic green/amber/red use explicit `dark:` pairs in `trip-status.ts` — **yes, both modes supported.**

---

## 12. Mobile considerations

### Trips mobile fallback

**Yes.** `TripsTable` uses `useIsNarrowScreen(768)`:

- **≥768px:** `DataTable` (desktop table)
- **&lt;768px:** `TripsMobileCardList` — card stack, same TanStack instance, checkboxes + `CellAction`

### KTS page — mobile requirement?

Product assumption: **admin at desk with physical papers** — desktop-first.

**Pragmatic approach:**

- **Desktop/tablet landscape (≥768px):** full queue + inline expand — **required**
- **Mobile/narrow:** simplified read-only list or “open in Fahrten detail” fallback — **acceptable for PR3.2** if documented

Inline expand on phone is low priority; do not block PR3.2 on mobile parity.

### Responsive breakpoint strategy (trips)

| Breakpoint | Behavior |
| ---------- | -------- |
| **`md` (768px)** | `useIsNarrowScreen(768)` — table vs cards |
| **`md` in filters** | Stacked filters + collapsible “more filters” vs horizontal row |
| **Table** | `min-w-[720px]` horizontal scroll inside `ScrollArea` on desktop |

KTS should reuse **768px** for consistency unless user research demands tablet portrait (768–1024) full expand — optional phase 2.

---

## Senior recommendation

### Inline expand implementation: (a) vs (b) vs (c)

| Option | Verdict |
| ------ | ------- |
| **(a) TanStack `getExpandedRowModel` + second `<tr>`** | Viable but **requires forking `DataTable`** anyway — no built-in sub-row render today. TanStack API adds little over manual state for a **single-level** expand. |
| **(b) Custom `expandedRowId` / `Set` + second `<tr>` with `colSpan`** | **Recommended.** Minimal state, valid HTML, fits speed queue (one expand at a time keeps focus). Enter-to-submit on input without modal. |
| **(c) CSS grid instead of `<table>`** | **Reject for PR3.2.** Large divergence from Fahrten; loses `DataTable` pagination/scroll/sticky header investments; team pays migration cost twice if KTS later aligns with trips infra. |

**Do not use shadcn Collapsible inside `<td>`** as the primary expand mechanism.

**Concrete plan:**

1. Copy `data-table.tsx` → `kts-data-table.tsx` (or add optional `renderExpandedRow` prop).
2. State: `const [expand, setExpand] = useState<{ tripId: string; mode: 'fehler' | 'send' } | null>(null)`.
3. After each data `<TableRow>`, conditionally render expand `<TableRow><TableCell colSpan={n}>…</TableCell></TableRow>`.

### Fork trips TanStack setup vs fresh lightweight table?

**Dedicated KTS table module — fork selectively, not full TripsListingPage.**

| Reuse | Fork / new |
| ----- | ---------- |
| `useDataTable` (pagination/sort URL) | `KtsListingPage` RSC query |
| `DataTablePagination` | `KtsFiltersBar` |
| `PageContainer` + page shell provider | Trips `columns` / `TripsFiltersBar` |
| `StatsCard` + client KPI hook | `KtsCellGroupProvider` / inline KTS switches on Fahrten |
| Mutation hooks `use-kts-status.ts` | `CellAction` dropdown |
| Optional `TripDetailSheet` for deep edit | Kanban / view toggle |

**Why not raw shadcn `Table` only?** Pagination, URL sync, and scroll container are already solved in `useDataTable` + `DataTable` — reimplementing costs more than a forked row renderer.

**Why not reuse `TripsTable` directly?** Wrong columns, wrong filters, no expand rows, DnD column reorder unnecessary for a fixed queue layout.

---

## Implementation checklist (PR3.2 — for implementer)

1. Add nav leaf + `/dashboard/kts/page.tsx` with `PageContainer` + shell provider.
2. Create `KtsListingPage` RSC: forced `kts_document_applies = true`, `kts_status` filters, embed open corrections for aging.
3. Client KPI section: four counts + invalidate on mutation.
4. `KtsDataTable` with expand row + action column wired to `use-kts-status.ts`.
5. New `src/lib/kts-status.ts` badge cva.
6. Wire `refreshTripsPage()` after mutations and filter changes.
7. Defer mobile inline expand; optional narrow fallback message.

---

## Open questions (product)

1. Default date filter: today only vs all open KTS vs configurable?
2. Single expand vs multiple expanded rows?
3. Send-to-issuer inline: one field (`sent_to`) or full correction form?
4. Align timeline `closeKtsCorrection` with `receiveKtsCorrection` for status transitions on queue “mark received”?

---

*Audit complete. Implementation: PR3.2 shipped — see plan link above.*
