# Audit — Plan E: inline KTS + Reha Schein cell editing (read-only)

**Date:** 2026-05-14  
**Note:** `Trip` is **`Database['public']['Tables']['trips']['Row']`** via `src/features/trips/api/trips.service.ts` — there is no separate `src/types/trip.types.ts` in this repo for the list row type.

---

## Source excerpts

### 1. `columns.tsx` — four column definitions (full)

**File:** `src/features/trips/components/trips-tables/columns.tsx`

**`kts_document_applies` (lines 476–499)**

```476:499:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'kts_document_applies',
    accessorKey: 'kts_document_applies',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='KTS' />
    ),
    cell: ({ row }) => {
      const applies = !!row.original.kts_document_applies;
      if (!applies) {
        return <span className='text-muted-foreground'>—</span>;
      }
      return (
        <Badge
          variant='secondary'
          className='px-1.5 py-0 text-[10px] font-normal'
          title='Krankentransportschein (KTS) — laut Fahrt markiert'
        >
          KTS
        </Badge>
      );
    },
    meta: { label: 'KTS', variant: 'text' },
    enableColumnFilter: false
  },
```

**`kts_fehler` (lines 500–523)**

```500:523:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'kts_fehler',
    accessorKey: 'kts_fehler',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='KTS-Fehler' />
    ),
    cell: ({ row }) => {
      const err = !!row.original.kts_fehler;
      if (!err) {
        return <span className='text-muted-foreground'>—</span>;
      }
      return (
        <Badge
          variant='destructive'
          className='px-1.5 py-0 text-[10px] font-normal'
          title='KTS-Dokument mit Fehler markiert'
        >
          Fehler
        </Badge>
      );
    },
    meta: { label: 'KTS-Fehler', variant: 'text' },
    enableColumnFilter: false
  },
```

**`kts_fehler_beschreibung` (lines 524–554)**

```524:554:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'kts_fehler_beschreibung',
    accessorFn: (row) => row.kts_fehler_beschreibung ?? '',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='KTS-Fehler (Text)' />
    ),
    cell: ({ row }) => {
      const v = row.original.kts_fehler_beschreibung as
        | string
        | null
        | undefined;
      const t = v?.trim();
      if (!t) return <span className='text-muted-foreground'>—</span>;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='max-w-[160px] cursor-default truncate text-sm'>
                {t}
              </span>
            </TooltipTrigger>
            <TooltipContent side='top' className='max-w-xs text-xs'>
              {t}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
    meta: { label: 'KTS-Fehler (Text)', variant: 'text' },
    enableColumnFilter: false
  },
```

**`reha_schein` (lines 555–578)**

```555:578:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'reha_schein',
    accessorKey: 'reha_schein',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Reha' />
    ),
    cell: ({ row }) => {
      const applies = !!row.original.reha_schein;
      if (!applies) {
        return <span className='text-muted-foreground'>—</span>;
      }
      return (
        <Badge
          variant='secondary'
          className='px-1.5 py-0 text-[10px] font-normal'
          title='Rehabilitationsschein — laut Fahrt markiert'
        >
          Reha
        </Badge>
      );
    },
    meta: { label: 'Reha-Schein', variant: 'text' },
    enableColumnFilter: false
  },
```

### 2. `use-update-trip-mutation.ts` (full file)

**File:** `src/features/trips/hooks/use-update-trip-mutation.ts`

```1:27:src/features/trips/hooks/use-update-trip-mutation.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import { tripsService, type UpdateTrip } from '../api/trips.service';

/**
 * Updates a single trip via `tripsService.updateTrip` and **invalidates** the detail query
 * (Option A — no optimistic `setQueryData` merge).
 *
 * Also invalidates `tripKeys.all` to refresh dashboard stats ("Fahrten heute", "Umsatz heute")
 * since trip updates can change scheduled_at, price, or status — all of which affect stat calculations.
 */
export function useUpdateTripMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTrip }) =>
      tripsService.updateTrip(id, patch),
    onSuccess: (_data, { id }) => {
      // Invalidate detail query for the trip sheet
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) });
      // Invalidate all trips to refresh dashboard stats
      void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    }
  });
}
```

### 3. `trips.service.ts` — update signature and fields

**File:** `src/features/trips/api/trips.service.ts`

- **Types (lines 14–16):**

```14:16:src/features/trips/api/trips.service.ts
export type Trip = Database['public']['Tables']['trips']['Row'];
export type InsertTrip = Database['public']['Tables']['trips']['Insert'];
export type UpdateTrip = Database['public']['Tables']['trips']['Update'];
```

- **`updateTrip` signature and body (lines 100–138):** accepts **`id: string`** and **`trip: UpdateTrip`**. Implementation: optional price recalculation via `shouldRecalculatePrice(trip)` / `computeTripPrice`, then `supabase.from('trips').update(trip).eq('id', id)`. **Supabase passes whatever keys are present** on `trip`; omitted columns are not cleared (normal partial-update semantics for JSON body).

### 4. Trip type — KTS / Reha fields (`database.types.ts`)

**File:** `src/types/database.types.ts` — `trips.Row` (excerpt)

| Field | Row type |
|--------|-----------|
| `kts_document_applies` | `boolean` |
| `kts_fehler` | `boolean` |
| `kts_fehler_beschreibung` | `string \| null` |
| `kts_source` | `string \| null` |
| `reha_schein` | `boolean` |

(See lines **1372–1376** in `database.types.ts` in current tree.)

`Update` / `Insert` use optional versions of these same fields (e.g. **1450–1454** for `Insert`).

### 5. `trip-detail-sheet.tsx` — KTS / Reha UI (excerpt only)

**File:** `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`

- **Label constant (line 149):** `/** Label for \`trips.reha_schein\`; UI only when Kostenträger \`reha_schein_enabled\`. */`
- **KTS block (approx. 1648–1707):** dashed bordered region „KTS / Krankentransportschein“: optional catalog hint; when `ktsDocumentAppliesDraft` — **Checkbox** „KTS-Fehler“, **Textarea** for `ktsFehlerBeschreibungDraft` (disabled when KTS off or error off); **Switch** toggles `ktsDocumentAppliesDraft` and clears error fields when off.
- **Reha block (approx. 1709–1724):** only if `payerDraft && detailPayerRehaGate` — **Label** + **Switch** `id='trip-detail-reha-schein'` bound to `rehaScheinDraft`.

Persistence is **not** in these snippets; save flows through `build-trip-details-patch.ts` / `paired-trip-sync.ts` (patch fields include `kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung`, `kts_source`, `reha_schein`).

### 6. `payer.types.ts` — Reha gate on payer

**File:** `src/features/payers/types/payer.types.ts`

**Exact field name:** **`reha_schein_enabled`** (required `boolean` on `Payer`, lines **95–96**):

```95:96:src/features/payers/types/payer.types.ts
  /** When true, Neue Fahrt and trip detail show the Reha-Schein trip switch. */
  reha_schein_enabled: boolean;
```

### 7. `trips-tables/index.tsx` — how `data` reaches the table

**File:** `src/features/trips/components/trips-tables/index.tsx`

- `TripsTable` receives **`data: TData[]`** as a prop (lines **36–41**).
- `useDataTable({ data, columns, ... })` feeds **`data`** into TanStack (line **46–48**).

**Where rows come from:** `src/features/trips/components/trips-listing.tsx` builds the Supabase query. **List view** select (lines **88–94**):

```88:94:src/features/trips/components/trips-listing.tsx
    const tripsListSelect = `
    *,
    payer:payers(name),
    billing_variant:billing_variants(name, code, billing_types(name, color)),
    driver:accounts!trips_driver_id_fkey(name),
    fremdfirma:fremdfirmen(id, name, default_payment_mode)
  `;
```

So each trip row includes **`payer` with `name` only** — **not** `reha_schein_enabled`. Gating Reha in the grid like the detail sheet would require **widening the select**, a **separate lookup**, or **deriving** from another source.

---

## Question answers

### 1. Current KTS cell renderers & inline patterns in `columns.tsx`

- **KTS / Reha columns:** **read-only** — `Badge`, `—`, or **truncated text + Tooltip** for error description. No switches, inputs, or mutation calls in cells.
- **Other inline-edit-style cells:**
  - **`driver_id`** uses **`DriverSelectCell`** (lines **248–260**) — full interactive **Select** inside the cell (reference for “edit in place”).
  - **`status`** cell (lines **263–274**) is a **read-only `Badge`** only (no `Select` in the cell despite `meta.options`).

**Reference: `driver_id` column (partial)**

```248:260:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'driver_id',
    accessorKey: 'driver.name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Fahrer' />
    ),
    cell: ({ row }) => (
      <div className='flex justify-center px-1'>
        <DriverSelectCell trip={row.original} />
      </div>
    ),
    enableColumnFilter: false,
    meta: { label: 'Fahrer' }
  },
```

`DriverSelectCell` (`driver-select-cell.tsx`) uses **direct `supabase.from('trips').update(...)`** (plus **`refreshTripsPage()`**), **not** `useUpdateTripMutation`.

### 2. Update mutation

- **Hook:** **`useUpdateTripMutation()`** returns **`useMutation(...)`** from TanStack Query — i.e. **`UseMutationResult`**, not a bare function.
- **Payload:** **`mutationFn: ({ id, patch }: { id: string; patch: UpdateTrip }) => tripsService.updateTrip(id, patch)`** — **partial `UpdateTrip`** is intended (`Update` has optional fields).
- **Optimistic updates:** **None** — comment explicitly says **Option A — no optimistic `setQueryData` merge**. **On success:** invalidates **`tripKeys.detail(id)`** and **`tripKeys.all`**.
- **Single-field updates:** **Yes** — only supplied keys are sent to `supabase.update(trip)`; no requirement to send the full row.

### 3. Payer-level Reha gate

- **Field name:** **`reha_schein_enabled`** on **`Payer`** (`payer.types.ts`).
- **In list rows:** **No** — `trips-listing` embed is **`payer:payers(name)`** only. **`reha_schein_enabled` is not** on the table row’s `payer` object unless the query is changed or payer is fetched elsewhere.

### 4. Inline text input in a table cell

- **Repo grep** for `Input` inside **`cell:`** in `*.tsx` did **not** surface a dedicated “editable text cell” in the trips table or elsewhere as a drop-in pattern.
- **Short text elsewhere:** **`@/components/ui/input`** (shadcn `Input`) is used widely (e.g. **`trip-detail-sheet.tsx`** **Kontakt** `Input` for Nachname/Telefon lines **1786–1799**; filters use **`Input`** in **`trips-filters-bar.tsx`**).

### 5. Debounce pattern

- **`src/hooks/use-debounced-callback.ts`** — `useDebouncedCallback(callback, delay)` wraps **`setTimeout`** / clear on unmount.
- **`src/hooks/use-debounce.tsx`** — `useDebounce(value, delay)` for **value** debouncing.
- **`trips-filters-bar.tsx`** — **manual debounce:** `useRef` + **`setTimeout(..., 350)`** for search `handleSearchChange` (see around lines **100–101** and the handler that calls `updateFilters`).
- **`touren-search-bar.tsx`** — inline **300ms** `setTimeout` pattern on change.
- **`use-data-table.ts`** — supports **`debounceMs`** (e.g. **500** in `TripsTable`) for **table-global** debouncing, not per-cell.

---

## Plan E implications (summary)

- Table cells for KTS/Reha are **display-only** today; **driver column** is the closest **in-cell interactive** precedent.
- **`useUpdateTripMutation`** + **`UpdateTrip`** are **suitable for partial patches** (booleans + nullable string for description); expect **refetch via invalidation**, not optimistic row merge.
- **Reha** UX in detail sheet is **gated by `detailPayerRehaGate`** (`payer.reha_schein_enabled`); **list rows currently lack that flag** on the embedded `payer` — Plan E must **join/select** or **fetch** payer gate if the grid should match detail behavior.
- For **debounced text** saves, reuse **`useDebouncedCallback`** / **`useDebounce`** or the **manual timer** pattern from the filter bar.
