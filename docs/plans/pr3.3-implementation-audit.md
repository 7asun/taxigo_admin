# PR3.3 implementation audit — batch KTS Übergabe (handover)

Read-only verification of every PR3.3 layer against the plan (`pr3.3_kts_handover_5df2b17f.plan.md`, which still lists 6 todos as pending). This audit reflects **actual codebase state**, not plan checkbox status.

**Audit date:** 2026-06-10

No code or schema changes.

---

## 1. Migration — `kts_handovers` table

**Does `supabase/migrations/` contain any file with "handover" in the name?**

**Yes:** `supabase/migrations/20260610160000_kts_handovers.sql`

(Other migrations reference `kts_handover_id` as FK/column but do not have "handover" in the filename.)

### Full `CREATE TABLE`

```sql
CREATE TABLE public.kts_handovers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL
                          REFERENCES public.companies(id)
                          ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id)
                          ON DELETE SET NULL
);
```

**Source:** lines 4–12.

Also in same file: RLS policies (lines 31–53), `trips.kts_handover_id` FK column (lines 55–64), indexes.

### Full `CREATE OR REPLACE FUNCTION`

```sql
CREATE OR REPLACE FUNCTION public.create_kts_handover(
  p_company_id uuid,
  p_trip_ids   uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_handover_id uuid;
  v_expected    int;
  v_eligible    int;
  v_updated     int;
BEGIN
  IF NOT public.current_user_is_admin()
     OR p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'create_kts_handover: unauthorized';
  END IF;

  IF cardinality(p_trip_ids) = 0 THEN
    RAISE EXCEPTION 'create_kts_handover: trip list must not be empty';
  END IF;

  v_expected := cardinality(p_trip_ids);

  SELECT COUNT(*)::int INTO v_eligible
  FROM public.trips t
  WHERE t.id = ANY(p_trip_ids)
    AND t.company_id = p_company_id
    AND t.kts_status = 'korrekt'
    AND t.kts_document_applies = true;

  IF v_eligible <> v_expected THEN
    RAISE EXCEPTION
      'create_kts_handover: % trip(s) not eligible (not korrekt or wrong company)',
      v_expected - v_eligible;
  END IF;

  INSERT INTO public.kts_handovers (company_id, created_by)
  VALUES (p_company_id, auth.uid())
  RETURNING id INTO v_handover_id;

  UPDATE public.trips
  SET
    kts_status       = 'uebergeben',
    kts_handover_id  = v_handover_id,
    kts_fehler       = false
  WHERE id = ANY(p_trip_ids)
    AND company_id = p_company_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_expected THEN
    RAISE EXCEPTION
      'create_kts_handover: updated % trip(s) but expected %',
      v_updated, v_expected;
  END IF;

  RETURN v_handover_id;
END;
$$;
```

**Source:** lines 66–126.

**Deploy note:** File exists in repo. Live DB state depends on migration apply (`supabase db push` / CI) — not verified in this audit.

---

## 2. `database.types.ts`

**File:** `src/types/database.types.ts`

### a) `kts_handovers` table type

**Present.** Lines 1918–1946:

```typescript
      kts_handovers: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'kts_handovers_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          }
        ];
      };
```

### b) `kts_handover_id` on `trips` Row type

**Present.** Line 1478:

```typescript
          kts_handover_id: string | null;
```

FK relationship lines 1773–1777:

```typescript
          {
            foreignKeyName: 'trips_kts_handover_id_fkey';
            columns: ['kts_handover_id'];
            isOneToOne: false;
            referencedRelation: 'kts_handovers';
            referencedColumns: ['id'];
          },
```

Also on `trips` Insert/Update (lines 1564, 1648) and `kts_external_invoices` (lines 1879+).

### c) `create_kts_handover` function type

**Present.** Lines 2159–2162:

```typescript
      create_kts_handover: {
        Args: { p_company_id: string; p_trip_ids: string[] };
        Returns: string;
      };
```

---

## 3. Service layer — `createKtsHandover`

**File:** `src/features/kts/kts.service.ts`

### `createKtsHandover` — present

Payload type (lines 358–362):

```typescript
/** PR3.3 batch handover — atomic RPC transitions korrekt trips to uebergeben. */
export interface CreateKtsHandoverPayload {
  companyId: string;
  tripIds: string[];
}
```

Full function (lines 394–416):

```typescript
export async function createKtsHandover(
  supabase: SupabaseClient,
  payload: CreateKtsHandoverPayload
): Promise<{ handoverId: string }> {
  if (payload.tripIds.length === 0) {
    throw new Error('Es muss mindestens ein KTS-Beleg ausgewählt sein.');
  }

  const { data, error } = await supabase.rpc('create_kts_handover', {
    p_company_id: payload.companyId,
    p_trip_ids: payload.tripIds
  });

  if (error) {
    throw mapCreateKtsHandoverError(error);
  }

  if (!data) {
    throw new Error('Übergabe konnte nicht erstellt werden.');
  }

  return { handoverId: data };
}
```

Error mapping `mapCreateKtsHandoverError` at lines 371–392.

### `markKtsUebergeben` throwing stub

**Absent.** Repository-wide grep finds `markKtsUebergeben` only in plan/docs files, **not** in `kts.service.ts` or any runtime TypeScript. The PR3.3 plan expected removal of the stub in favour of `createKtsHandover` — that replacement appears complete.

---

## 4. Mutation hook — `useCreateKtsHandoverMutation`

**File:** `src/features/kts/hooks/use-kts-status.ts`, lines 142–158.

**Present:**

```typescript
export function useCreateKtsHandoverMutation() {
  const { onKtsBatchWriteSuccess } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: async ({ tripIds }: { tripIds: string[] }) => {
      const companyId = await fetchKtsCompanyId();
      if (!companyId) {
        throw new Error('Unternehmen konnte nicht ermittelt werden.');
      }
      const supabase = createClient();
      return createKtsHandover(supabase, { companyId, tripIds });
    },
    onSuccess: async (_data, { tripIds }) => {
      await onKtsBatchWriteSuccess(tripIds);
    }
  });
}
```

**`onSuccess` invalidation** (via `onKtsBatchWriteSuccess`, lines 34–43):

```typescript
  const onKtsBatchWriteSuccess = async (tripIds: string[]) => {
    for (const tripId of tripIds) {
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
    }
    void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    void queryClient.invalidateQueries({ queryKey: ktsKpiKey });
    if (rscRefresh) {
      await rscRefresh.refreshTripsPage();
    }
  };
```

No other hook file under `src/features/kts/hooks/` defines a handover mutation.

---

## 5. Checkbox status gating

**File:** `src/features/kts/components/kts-table/kts-columns.tsx`

### Table-level gating (`index.tsx`)

**Also present** in `src/features/kts/components/kts-table/index.tsx`, line 36:

```typescript
    enableRowSelection: (row) => row.original.kts_status === 'korrekt'
```

### Select column — header (korrekt-only bulk select)

Lines 42–66:

```typescript
      header: ({ table }) => {
        const korrektRows = table.getRowModel().rows.filter(
          (r) => r.original.kts_status === KTS_STATUS_KORREKT
        );
        const allKorrektSelected =
          korrektRows.length > 0 &&
          korrektRows.every((r) => r.getIsSelected());
        const someKorrektSelected = korrektRows.some((r) => r.getIsSelected());

        return (
          <Checkbox
            checked={
              allKorrektSelected ||
              (someKorrektSelected && !allKorrektSelected && 'indeterminate')
            }
            disabled={korrektRows.length === 0}
            onCheckedChange={(value) => {
              const select = !!value;
              for (const row of korrektRows) {
                row.toggleSelected(select);
              }
            }}
            aria-label='Alle auswählen'
          />
        );
      },
```

### Select column — cell (per-row disabled)

Lines 68–77:

```typescript
      cell: ({ row }) => {
        const isKorrekt = row.original.kts_status === KTS_STATUS_KORREKT;
        return (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!isKorrekt}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label='Zeile auswählen'
          />
        );
      },
```

**Answer:** Gating to `kts_status === 'korrekt'` is implemented at three levels: `enableRowSelection`, header (only toggles korrekt rows), and cell (`disabled={!isKorrekt}`).

**TODO comment:** No TODO related to handover or checkbox gating exists in `kts-columns.tsx` or other files under `src/features/kts/components/` (grep for `TODO` returned no matches).

---

## 6. Bulk action bar component

**Present.**

| Property | Value |
|----------|-------|
| **Component name** | `KtsHandoverBulkBar` |
| **File path** | `src/features/kts/components/kts-table/kts-handover-bulk-bar.tsx` |

**Props interface** (lines 22–24):

```typescript
interface KtsHandoverBulkBarProps {
  table: TanstackTable<KtsTripRow>;
}
```

**Behaviour summary:**

- Renders when `table.getSelectedRowModel().rows.length > 0` (line 44).
- Filters selected rows to `KTS_STATUS_KORREKT` before RPC (lines 33–35).
- Calls `useCreateKtsHandoverMutation().mutateAsync({ tripIds: korrektTripIds })` (line 60).
- Confirm `AlertDialog` with German copy (lines 106–151).
- Toast on success; inline error in dialog on failure.

No other bulk/handover bar component exists under `src/features/kts/components/`.

---

## 7. Bulk bar wiring in `kts-data-table` / `index`

### `kts-data-table.tsx`

Does **not** render the bulk bar directly. Passes through `paginationProps` to `DataTablePagination` (lines 164–166):

```typescript
      <div className='flex flex-col gap-2.5'>
        <DataTablePagination table={table} {...paginationProps} />
      </div>
```

### `kts-table/index.tsx`

**Bulk bar wired** via `bulkActions` slot (lines 45–49):

```typescript
        paginationProps={{
          totalDatasetCount: totalItems,
          datasetNounPlural: 'KTS-Belege',
          bulkActions: <KtsHandoverBulkBar table={table} />
        }}
```

Import line 9:

```typescript
import { KtsHandoverBulkBar } from '@/features/kts/components/kts-table/kts-handover-bulk-bar';
```

**TODO comment status:** No PR3.3 TODO in `index.tsx` or `kts-data-table.tsx`. Previous plan TODOs appear **replaced** by working wiring.

---

## 8. Gap summary

| Layer | Status | Notes |
|-------|--------|-------|
| Migration (`kts_handovers` + RPC) | **Done** (repo) | `20260610160000_kts_handovers.sql` complete. **Operational:** confirm applied on target Supabase. |
| `database.types.ts` regenerated | **Done** | `kts_handovers`, `trips.kts_handover_id`, `create_kts_handover` all typed. |
| `createKtsHandover` service fn | **Done** | RPC wrapper + German error mapping. `markKtsUebergeben` stub removed. |
| `useCreateKtsHandoverMutation` hook | **Done** | Invalidates `tripKeys.detail`, `tripKeys.all`, `ktsKpiKey`; RSC refresh. |
| Checkbox korrekt-only gating | **Done** | `enableRowSelection` + header + cell disabled logic. |
| Bulk bar component | **Done** | `KtsHandoverBulkBar` with confirm dialog + mutation. |
| Bulk bar wired to table | **Done** | `bulkActions` on `DataTablePagination` in `index.tsx`. |

**Partial items:** None at application layer. Only possible **Partial** is migration **deploy** if remote DB has not run `20260610160000`.

---

## 9. Senior assessment

### Is PR3.3 shippable as-is?

**Yes — in code.** All seven layers are implemented and wired end-to-end:

1. DB schema + atomic RPC  
2. Generated types  
3. Service + error mapping  
4. Mutation hook + cache invalidation  
5. Korrekt-only selection (UI + RPC double-guard)  
6. Bulk bar UI with confirmation  
7. Pagination bulk slot integration  

The admin's belief that the feature may already be implemented is **correct** relative to this repository.

### Minimum remaining work (if anything fails in production)

1. **Apply migration** `20260610160000_kts_handovers.sql` to the target Supabase project if not already deployed — without it, `create_kts_handover` RPC and `kts_handovers` table do not exist at runtime.
2. **Smoke test:** Select korrekt rows → "Übergabe erstellen" → confirm → verify `kts_status = uebergeben`, `kts_handover_id` set, KPI refresh.
3. **Update stale plan doc** `.cursor/plans/pr3.3_kts_handover_5df2b17f.plan.md` — todos still marked pending but implementation is complete (documentation hygiene only).

No additional TypeScript, hook, or UI work is required for a functional batch handover path based on this audit.

### Known product constraints (by design, not gaps)

- Selection and handover operate on **current table page** rows only (confirm dialog copy line 124–125 in bulk bar).
- RPC rejects non-`korrekt` or non-KTS trips server-side even if UI were bypassed.
- No dedicated handover history UI in this audit scope (batch record exists in `kts_handovers` but no list page audited here).

---

## File index

| Layer | Path |
|-------|------|
| Migration | `supabase/migrations/20260610160000_kts_handovers.sql` |
| Types | `src/types/database.types.ts` |
| Service | `src/features/kts/kts.service.ts` L358–416 |
| Hook | `src/features/kts/hooks/use-kts-status.ts` L142–158 |
| Columns / gating | `src/features/kts/components/kts-table/kts-columns.tsx` L40–81 |
| Table wiring | `src/features/kts/components/kts-table/index.tsx` L29–49 |
| Bulk bar | `src/features/kts/components/kts-table/kts-handover-bulk-bar.tsx` |
| Data table | `src/features/kts/components/kts-table/kts-data-table.tsx` |
