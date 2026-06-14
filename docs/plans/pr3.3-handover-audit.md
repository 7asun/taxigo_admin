# PR3.3 Handover (Übergabe) — Pre-Implementation Audit

**Date:** 2026-06-10  
**Scope:** Read-only audit for batch handover (`korrekt` → `uebergeben` + `kts_handovers` record).  
**Related docs:** [`docs/kts-architecture.md`](../kts-architecture.md), [`docs/plans/kts-pr3-1-status-audit.md`](kts-pr3-1-status-audit.md), [`docs/plans/kts-pr3-2-page-shell-audit.md`](kts-pr3-2-page-shell-audit.md)

**Note:** `docs/kts-module.md` does not exist. KTS module documentation lives in `docs/kts-architecture.md`.  
**Page entry point:** `src/app/dashboard/kts/page.tsx` (not `kts-page.tsx`).

---

## Files reviewed

| Area | Paths |
| ---- | ----- |
| Table | `src/features/kts/components/kts-table/kts-data-table.tsx`, `kts-columns.tsx`, `index.tsx` |
| Types | `src/features/kts/types/kts-trip-row.ts` |
| Hooks | `src/features/kts/hooks/use-kts-status.ts`, `use-kts-kpis.ts`, `use-kts-corrections.ts`, `use-update-kts-mutation.ts` |
| Service | `src/features/kts/kts.service.ts` |
| Actions | `src/features/kts/actions/` — **empty directory (0 files)** |
| Listing / filters | `src/features/kts/components/kts-listing-page.tsx`, `kts-filters-bar.tsx` |
| Page | `src/app/dashboard/kts/page.tsx`, `kts-page-shell.tsx`, `kts-header.tsx` |
| Migrations | 114 files under `supabase/migrations/` (most recent KTS trio read in full below) |

### Most recent migrations (full read)

1. `20260610150000_kts_queue_kpis.sql` — RPC `get_kts_queue_kpis` for stat cards  
2. `20260610140000_kts_status.sql` — `kts_status` enum + column + backfill + index  
3. `20260610130000_kts_patient_id.sql` — `kts_patient_id` on `clients` + `trips`

Other KTS migrations in repo (not re-read in full for this audit):  
`20260610120000_kts_corrections.sql`, `20260610125000_kts_rpc_tenant_guard.sql`, plus earlier catalog migrations (`20260403120000_kts_catalog_and_trips.sql`, `20260504130000_kts_fehler.sql`).

---

## 1. Row selection infrastructure

### Verdict: **Present and wired — not connected to any bulk action yet**

TanStack Table row selection is active via the shared `useDataTable` hook. The KTS table does **not** declare its own `rowSelection` state in `kts-data-table.tsx` or `page.tsx`; it inherits selection from `useDataTable`.

**Checkbox column** — first column in `kts-columns.tsx` (`id: 'select'`):

```33:56:src/features/kts/components/kts-table/kts-columns.tsx
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) =>
            table.toggleAllPageRowsSelected(!!value)
          }
          aria-label='Alle auswählen'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label='Zeile auswählen'
        />
      ),
      enableSorting: false,
      enableHiding: false
    },
```

**Wiring** — `KtsTable` calls `useDataTable`, which enables selection globally:

```28:35:src/features/kts/components/kts-table/index.tsx
  const { table } = useDataTable({
    data,
    columns,
    pageCount,
    shallow: false,
    debounceMs: 500,
    getRowId: (row) => row.id
  });
```

```114:116:src/hooks/use-data-table.ts
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    initialState?.rowSelection ?? {}
  );
```

```291:305:src/hooks/use-data-table.ts
    state: {
      pagination,
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      columnOrder
    },
    ...
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
```

**Status gating:** **None.** There is no `getRowCanSelect`, `enableRowSelection` callback, or disabled checkbox for non-`korrekt` rows. Any row on the current page can be selected.

**Bulk action wiring:** **Not implemented.** Explicit TODO in `kts-data-table.tsx`:

```40:42:src/features/kts/components/kts-table/kts-data-table.tsx
  // why: single expandedRow (not Set) — admin processes one paper at a time; opening another replaces focus.
  // TODO PR3.3: wire rowSelection to handover batch action
  const visibleColumnCount = table.getVisibleLeafColumns().length;
```

`kts-data-table.tsx` and `page.tsx` contain **no** local `rowSelection` state. Selection is readable only via `table.getSelectedRowModel()` on the TanStack instance returned from `useDataTable`.

---

## 2. Bulk action bar

### Verdict: **No shared KTS bulk bar; no generic `src/components/bulk-action-bar.tsx`**

| Component | Location | Props | Used by |
| --------- | -------- | ----- | ------- |
| `BulkActionBar` | `src/features/unassigned-trips/components/bulk-action-bar.tsx` | `selectedCount`, `selectedTrips`, `groupedTrips`, `onBulkAssign`, `isAssigning` | `unassigned-trips-client.tsx` |
| `TripsPaginationBulkActions` | `src/features/trips/components/trips-tables/trips-pagination-bulk-actions.tsx` | `table: TanstackTable<TData>` | Fahrten table + mobile card list (via `bulkActions` pagination slot) |

**`BulkActionBar`** — fixed bottom bar, billing-variant assignment for unassigned trips:

```25:31:src/features/unassigned-trips/components/bulk-action-bar.tsx
interface BulkActionBarProps {
  selectedCount: number;
  selectedTrips: Record<string, boolean>;
  groupedTrips: UnassignedTripsByPayer[];
  onBulkAssign: (tripIds: string[], billingVariantId: string) => void;
  isAssigning: boolean;
}
```

**`TripsPaginationBulkActions`** — reads `table.getSelectedRowModel()`, renders clear / duplicate / delete when `count > 0`:

```24:48:src/features/trips/components/trips-tables/trips-pagination-bulk-actions.tsx
interface TripsPaginationBulkActionsProps<TData> {
  table: TanstackTable<TData>;
}

export function TripsPaginationBulkActions<TData>({
  table
}: TripsPaginationBulkActionsProps<TData>) {
  ...
  const selectedRows = table.getSelectedRowModel().rows;
  const count = selectedRows.length;
  ...
  if (count === 0) return null;
```

**KTS feature:** No bulk action bar component exists under `src/features/kts/`. PR3.3 must add one (new component or fork the Fahrten pagination pattern).

---

## 3. `kts_handovers` table

### Verdict: **Does not exist — new migration required**

Searched all files under `supabase/migrations/` for `CREATE TABLE kts_handovers` / `kts_handovers`: **zero matches**.

`src/types/database.types.ts` has **no** `kts_handovers` table entry (only `kts_corrections` among KTS satellites).

### Planned shape (from prior audits — not yet migrated)

From [`docs/plans/kts-pr3-1-status-audit.md`](kts-pr3-1-status-audit.md):

- **`trips.kts_handover_id`** — `uuid NULL REFERENCES kts_handovers(id)` adjacent to `kts_status` (deferred from PR3.1)
- **`markKtsUebergeben`** intended patch: `{ kts_status: 'uebergeben', kts_handover_id, kts_fehler: false }`

No concrete `CREATE TABLE kts_handovers` DDL exists in the repo yet. PR3.3 must design columns (minimum: `id`, `company_id`, `created_at`, `created_by`; likely a join table or `trip_ids uuid[]` / `kts_handover_items` for many-to-many).

**Reference pattern:** `kts_corrections` (`20260610120000_kts_corrections.sql`) — `company_id` FK, RLS by tenant, indexes on `trip_id` / `company_id`.

---

## 4. Status transition mutation

### Verdict: **Single-trip stub only — no batch API, no working hook**

**Stub in service** (throws):

```357:363:src/features/kts/kts.service.ts
/** PR3.3 handover batch — stub until kts_handovers table exists. */
export async function markKtsUebergeben(
  _tripId: string,
  _handoverId: string
): Promise<Trip> {
  throw new Error('markKtsUebergeben: not implemented until PR3.3');
}
```

**Planned signature** (audit doc, PR3.1):

```typescript
export async function markKtsUebergeben(tripId: string, handoverId: string): Promise<Trip>;
// { kts_status: 'uebergeben', kts_handover_id, kts_fehler: false }
```

**Existing transitions** are all **single-trip**, one call per ID:

| Function | Signature |
| -------- | --------- |
| `markKtsChecked` | `(tripId: string) => Promise<Trip>` |
| `markKtsFehlerhaft` | `(tripId: string, beschreibung: string) => Promise<Trip>` |
| `clearKtsMistake` | `(tripId: string) => Promise<Trip>` |
| `sendKtsCorrection` | `(supabase, { tripId, companyId, sentTo, ... }) => Promise<{ trip, correction }>` |
| `receiveKtsCorrection` | `(supabase, { tripId, correctionId, ... }) => Promise<{ trip, correction }>` |

**Hooks in `use-kts-status.ts`:** `useMarkKtsCheckedMutation`, `useMarkKtsFehlerhaftMutation`, `useClearKtsMistakeMutation`, `useSendKtsCorrectionMutation`, `useReceiveKtsCorrectionMutation`, `useUpdateKtsPatientIdMutation` — **no** `useMarkKtsUebergebenMutation` or batch handover hook.

**Server actions:** `src/features/kts/actions/` is empty.

**Recommendation for PR3.3:** Add something like `createKtsHandover(supabase, { companyId, tripIds: string[] })` that atomically (1) inserts `kts_handovers`, (2) updates all trips — preferably one Postgres RPC or transaction, not N sequential `updateTripKts` calls without rollback.

---

## 5. `kts_status` enum / type guard

### Verdict: **Both PostgreSQL enum and TypeScript union; `uebergeben` already exists**

**Database enum** (`20260610140000_kts_status.sql`):

```4:10:supabase/migrations/20260610140000_kts_status.sql
CREATE TYPE public.kts_status AS ENUM (
  'ungeprueft',
  'korrekt',
  'fehlerhaft',
  'in_korrektur',
  'uebergeben'
);
```

**TypeScript** — re-exported from generated DB types:

```21:27:src/features/kts/kts.service.ts
export type KtsStatus = Database['public']['Enums']['kts_status'];

export const KTS_STATUS_UNGEPRUEFT = 'ungeprueft' as KtsStatus;
export const KTS_STATUS_KORREKT = 'korrekt' as KtsStatus;
export const KTS_STATUS_FEHLERHAFT = 'fehlerhaft' as KtsStatus;
export const KTS_STATUS_IN_KORREKTUR = 'in_korrektur' as KtsStatus;
export const KTS_STATUS_UEBERGEBEN = 'uebergeben' as KtsStatus;
```

```2180:2180:src/types/database.types.ts
      kts_status: 'ungeprueft' | 'korrekt' | 'fehlerhaft' | 'in_korrektur' | 'uebergeben';
```

**UI labels** — `src/lib/kts-status.ts` includes `uebergeben: 'Übergeben'`.

**Actions cell** already treats `uebergeben` as terminal (no workflow buttons):

```63:67:src/features/kts/components/kts-table/kts-actions-cell.tsx
  if (status === 'uebergeben') {
    return (
      <span className='text-muted-foreground text-xs'>—</span>
    );
  }
```

No enum migration needed for PR3.3.

---

## 6. Optimistic update pattern

### Verdict: **Queue status mutations do not use optimistic updates**

There is **no** `useKtsApproveMutation` in the codebase. Closest equivalents:

### A. `use-kts-status.ts` (KTS queue workflow — **pattern PR3.3 should follow**)

Shared side effects:

```18:30:src/features/kts/hooks/use-kts-status.ts
  const onKtsWriteSuccess = async (tripId: string) => {
    void queryClient.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
    void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    // why: stat cards use a dedicated key — refetch counts without waiting for full list RSC.
    void queryClient.invalidateQueries({ queryKey: ktsKpiKey });
    if (rscRefresh) {
      await rscRefresh.refreshTripsPage();
    }
  };
```

Example mutation (`useMarkKtsCheckedMutation`):

```35:42:src/features/kts/hooks/use-kts-status.ts
export function useMarkKtsCheckedMutation() {
  const { onKtsWriteSuccess } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: ({ tripId }: { tripId: string }) => markKtsChecked(tripId),
    onSuccess: async (_data, { tripId }) => {
      await onKtsWriteSuccess(tripId);
    }
  });
}
```

**Characteristics:**
- **No** `onMutate` / optimistic cache writes
- **No** toast on success (errors surface in expand row inline text)
- On success: invalidate `tripKeys.detail`, `tripKeys.all`, `ktsKpiKey`; optional `refreshTripsPage()` via `TripsRscRefreshProvider`
- Correction mutations additionally invalidate `tripKeys.ktsCorrections(tripId)`

### B. `use-update-kts-mutation.ts` (Fahrten inline KTS cells — different pattern)

Uses **optimistic update** on `tripKeys.detail` only:

```19:31:src/features/kts/hooks/use-update-kts-mutation.ts
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: tripKeys.detail(id) });

      const previousTrip = queryClient.getQueryData<Trip>(tripKeys.detail(id));

      if (previousTrip) {
        queryClient.setQueryData<Trip>(tripKeys.detail(id), {
          ...previousTrip,
          ...patch
        });
      }

      return { previousTrip };
    },
```

**PR3.3 guidance:** Follow **`use-kts-status.ts`** (invalidate + RSC refresh, no optimistic). Batch handover should invalidate once per affected trip (or `tripKeys.all` + `ktsKpiKey` + single `refreshTripsPage()`), then `table.resetRowSelection()`.

---

## 7. Filter / display of `uebergeben` rows

### Verdict: **No hard hide — server-side status filter; default excludes `uebergeben` on first visit**

**Server query** (`kts-listing-page.tsx`):

- Base filter: `kts_document_applies = true` only (all KTS trips, any status)
- When `kts_status` URL param has values: `.in('kts_status', ktsStatusValues)`
- When **no** status filter in URL: no status constraint on query (but see client default below)
- **No** `.neq('kts_status', 'uebergeben')` or implicit exclusion

```67:79:src/features/kts/components/kts-listing-page.tsx
    let query = supabase
      .from('trips')
      .select(ktsListSelect, { count: 'exact' })
      .eq('kts_document_applies', true);

    if (overdue && overdueTripIds) {
      query = query
        .eq('kts_status', 'in_korrektur')
        .in('id', overdueTripIds);
    } else if (ktsStatusValues.length > 0) {
      query = query.in('kts_status', ktsStatusValues);
    }
```

**Default filter (client)** — mount effect sets `kts_status=ungeprueft` when param absent:

```54:62:src/features/kts/components/kts-filters-bar.tsx
  useEffect(() => {
    if (searchParams.get('kts_status') != null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('kts_status', 'ungeprueft');
    ...
  }, []);
```

**Status multi-select** includes all five values (`KTS_STATUS_VALUES` in `kts-filters-bar.tsx`), **`uebergeben` included**. Admin can select it explicitly.

**After handover:** Rows stay on the same page (per product spec). They disappear from the default "Ungeprüft" view but remain visible when filter includes `uebergeben` or `korrekt` is cleared / multi-select adjusted.

**KPI RPC** counts all `kts_document_applies = true` trips in `gesamt`; does not break out `uebergeben` separately.

---

## 8. Senior recommendation — minimum safe scope for PR3.3

### Minimum safe scope (ordered)

1. **Migration (blocker)**
   - `CREATE TABLE kts_handovers` (+ RLS mirroring `kts_corrections`)
   - `ALTER TABLE trips ADD COLUMN kts_handover_id uuid REFERENCES kts_handovers(id)`
   - Index on `trips(kts_handover_id)` and `(company_id, kts_status)` already exists partially via `idx_trips_company_kts_status`
   - Regenerate `database.types.ts`

2. **Service layer**
   - Implement `createKtsHandover(supabase, { companyId, tripIds })` — **atomic** insert + bulk status update
   - Implement `markKtsUebergeben(tripId, handoverId)` or fold into batch function
   - Validate: every trip `kts_status === 'korrekt'`, same `company_id`, `kts_document_applies === true`
   - Patch per trip: `{ kts_status: 'uebergeben', kts_handover_id, kts_fehler: false }` (per PR3.1 audit)

3. **Hook**
   - `useCreateKtsHandoverMutation()` in `use-kts-status.ts` following `onKtsWriteSuccess` pattern; invalidate all affected trip IDs + `ktsKpiKey` + `refreshTripsPage()`

4. **UI**
   - `getRowCanSelect: (row) => row.original.kts_status === 'korrekt'` on table (or disabled checkbox in column)
   - New `KtsHandoverBulkActions` (fork `TripsPaginationBulkActions` pattern): show when selection > 0, button "Übergabe", confirm dialog, call mutation, `table.resetRowSelection()`
   - Wire via `paginationProps.bulkActions` or fixed bar — KTS table currently has no `bulkActions` slot

5. **Docs**
   - Update `docs/kts-architecture.md` §7.2 / §3.5

### Out of scope (defer)

- Mobile card list for KTS queue
- Accountant gate (block handover while open correction round) — marked deferred in architecture
- Optimistic UI for batch handover
- Removing Fahrten `KtsFehlerSwitchCell`

### Risks and dependencies

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| **Missing `kts_handovers` table** | Blocker | Migration first |
| **Missing `trips.kts_handover_id`** | Blocker | Same migration |
| **No atomic batch write** | High | RPC or single transaction; avoid partial handover |
| **Checkbox selects non-`korrekt` rows** | Medium | Gate before PR3.3 ships UI |
| **Page-level selection vs server pagination** | Medium | `toggleAllPageRowsSelected` only selects current page — document UX; validate cross-page expectations |
| **Default filter hides handed-over rows** | Low | Expected; rows remain in DB and filterable |
| **KPI `gesamt` includes `uebergeben`** | Low | May want separate KPI later (PR6) |
| **`markKtsUebergeben` stub** | Blocker | Replace before UI calls it |
| **No server actions folder** | Low | Client Supabase + service is established pattern |

### Ordering dependencies

```
Migration (kts_handovers + kts_handover_id)
  → database.types.ts regen
  → kts.service.ts batch function
  → use-kts-status.ts mutation hook
  → UI: row gating + bulk bar + wire table.getSelectedRowModel()
```

**Can parallelize after migration:** checkbox gating and bulk bar UI shell (disabled until service lands).

### What is already done (PR3.2 prep)

- Checkbox column + TanStack `rowSelection` via `useDataTable`
- `uebergeben` enum value + labels + terminal actions cell
- Queue page shell, RSC listing, refresh provider
- TODO comment at handover integration point in `kts-data-table.tsx`

---

## Appendix: Migration inventory (114 files)

Full list lives in `supabase/migrations/`. KTS-relevant subset:

| Migration | Purpose |
| --------- | ------- |
| `20260403120000_kts_catalog_and_trips.sql` | KTS catalog + trip flags |
| `20260504130000_kts_fehler.sql` | `kts_fehler`, beschreibung |
| `20260610120000_kts_corrections.sql` | `kts_corrections` + RLS |
| `20260610125000_kts_rpc_tenant_guard.sql` | RPC tenant guards |
| `20260610130000_kts_patient_id.sql` | Patient ID columns |
| `20260610140000_kts_status.sql` | `kts_status` enum |
| `20260610150000_kts_queue_kpis.sql` | `get_kts_queue_kpis` RPC |

**Not present:** any `kts_handovers` migration.
