# Audit — Ansichten dropdown re-render on hover

Read-only audit of `AnsichtenDropdown` and related hooks/services as of the reviewed sources. No source code was modified for this document.

---

## 1. Active preset comparison — is it running on every render?

### Where active detection runs

- **Not** in `useMemo`, `useCallback`, or `useEffect`.
- It runs **inside the main render path**, for **each** preset row, inside `presets.map`:

```206:211:src/features/trips/components/ansichten-dropdown.tsx
            {presets.map((preset) => {
              const active = isPresetActive(
                preset,
                searchParams,
                columnVisibility
              );
```

### What `isPresetActive` reads

Implementation:

```101:119:src/features/trips/components/ansichten-dropdown.tsx
function isPresetActive(
  preset: TripPreset,
  searchParams: URLSearchParams,
  columnVisibility: VisibilityState
): boolean {
  const storedParams = presetParamsForCompare(preset.params);
  const currentParams = buildTripPresetParamsFromSearchParams(searchParams);
  if (stableParamsJson(currentParams) !== stableParamsJson(storedParams)) {
    return false;
  }
  const storedVisCanon = canonicalColumnVisibilityForCompare(
    jsonToVisibilityState(preset.column_visibility)
  );
  const currentVisCanon = canonicalColumnVisibilityForCompare(columnVisibility);
  if (storedVisCanon !== currentVisCanon) {
    return false;
  }
  return true;
}
```

**Dependencies (values consumed per call):**

| Source | Role |
|--------|------|
| `preset.params` / `preset.column_visibility` | From each `preset` in `presets` (React Query `data`). |
| `searchParams` | `URLSearchParams` from `useSearchParams()` in the parent component (see §3). |
| `columnVisibility` | From `useTripsTableStore((s) => s.columnVisibility)` (see §2). |

### `canonicalColumnVisibilityForCompare` / `stableParamsJson` on every render?

- **Yes**, whenever `AnsichtenDropdown` re-renders and the `presets.map` branch runs, **each** visible row invokes `isPresetActive`, which calls:
  - `stableParamsJson(...)` **twice** per preset (`currentParams` and `storedParams` paths) — lines **108–109**.
  - `canonicalColumnVisibilityForCompare(...)` **twice** per preset — lines **111–114**.

There is **no** `useMemo` wrapping these calls for the active indicator. The only memo in the component is `snapshotSummary` (lines **145–156**), which does **not** feed the ●/○ logic.

---

## 2. Column visibility subscription

### Exact selector in `AnsichtenDropdown`

```123:123:src/features/trips/components/ansichten-dropdown.tsx
  const columnVisibility = useTripsTableStore((s) => s.columnVisibility);
```

### Granular vs whole store

- **Granular:** only `s.columnVisibility` is selected, **not** `useTripsTableStore((s) => s)`.

### New object reference on updates?

- The store’s setter replaces the whole slice:

```21:22:src/features/trips/stores/use-trips-table-store.ts
  setTable: (table) => set({ table }),
  setColumnVisibility: (columnVisibility) => set({ columnVisibility }),
```

- Zustand re-notifies subscribers when `columnVisibility` **reference** (or value per `Object.is` on the selected slice) changes. Each `set({ columnVisibility })` with a **new** object identity triggers components using this selector to re-render.
- Whether that happens “even if values haven’t changed” depends on **callers** of `setColumnVisibility`. The store itself does not deep-compare; it always assigns the argument passed in.

**Duplicate subscription in `useCurrentTripViewSnapshot`**

The same selector is used again inside the snapshot hook (used by `AnsichtenDropdown`):

```38:38:src/features/trips/hooks/use-current-trip-view-snapshot.ts
  const columnVisibility = useTripsTableStore((s) => s.columnVisibility);
```

So `AnsichtenDropdown`-subtree hooks subscribe to `columnVisibility` **twice** (direct line 123 + hook line 38).

---

## 3. `useSearchParams` behavior

### Called inside the dropdown?

**Yes:**

```122:124:src/features/trips/components/ansichten-dropdown.tsx
  const searchParams = useSearchParams();
  const columnVisibility = useTripsTableStore((s) => s.columnVisibility);
  const currentView = searchParams.get('view') ?? 'list';
```

### Re-render on any search param change (e.g. `page`)?

- Next.js App Router: `useSearchParams()` is documented to subscribe the client component to the **current URL’s search string**. When the search portion of the URL changes, **the component that called `useSearchParams` re-renders**.
- **There is no** param-level filtering or memoization in this file: the hook is used as a whole `URLSearchParams` instance.
- `buildTripPresetParamsFromSearchParams` **filters** which keys are *stored* in presets (it skips `page` / `perPage` and non-whitelist keys) — see `use-current-trip-view-snapshot.ts` lines **18–32** — but **that does not stop** `AnsichtenDropdown` from re-rendering when `page` or other keys change; it only affects the *payload* built from `searchParams` after the render already happened.

### Memoization on search params in this component

- **`snapshotSummary`** is memoized with `[searchParams, columnVisibility]`:

```145:156:src/features/trips/components/ansichten-dropdown.tsx
  const snapshotSummary = React.useMemo(() => {
    const params = buildTripPresetParamsFromSearchParams(searchParams);
    ...
  }, [searchParams, columnVisibility]);
```

- The **active preset** path (§1) is **not** memoized and runs on every render that reaches the list.

---

## 4. `useTripPresets` query

### `staleTime`

```25:34:src/features/trips/hooks/use-trip-presets.ts
const PRESETS_STALE_MS = 5 * 60 * 1000;

export function useTripPresets() {
  return useQuery({
    queryKey: tripKeys.presets(),
    queryFn: async () => {
      const supabase = createClient();
      return fetchTripPresets(supabase);
    },
    staleTime: PRESETS_STALE_MS
  });
}
```

**`staleTime` = `300_000` ms (5 minutes).**

### Data reference / transforms

- `queryFn` returns `fetchTripPresets(supabase)` directly — no `.map` in the hook.
- **`select` is absent** — no per-render transform in the query options.
- When data is unchanged, React Query keeps **`data` reference stable** until a fetch replaces it or the cache is updated (e.g. invalidation after mutations in other hooks in this file).

### Service layer

`fetchTripPresets` returns `(data ?? []) as TripPreset[]` — no extra transformation in the service:

```24:34:src/features/trips/api/trip-presets.service.ts
export async function fetchTripPresets(
  supabase: SupabaseClient
): Promise<TripPreset[]> {
  const { data, error } = await supabase
    .from('trip_presets')
    .select('*')
    ...
  if (error) throw toQueryError(error);
  return (data ?? []) as TripPreset[];
}
```

---

## 5. Hover trigger — symptom (Radix / local handlers)

### Handlers on trigger or parent in this file

- **`AnsichtenDropdown`** does **not** attach `onMouseEnter`, `onHoverStart`, or similar to `DropdownMenuTrigger` or the `Button` (lines **184–194**).
- **Save sub-panel** uses `onKeyDown` on `DropdownMenuSubContent` only (lines **252–260**), not pointer hover.

### “Reload on hover” interpretation

From **this file alone**:

- Pointer movement across menu items typically updates **internal Radix / focus** state inside `DropdownMenuContent` children. That causes **internal** re-renders of menu primitives without necessarily updating React state owned by `AnsichtenDropdown`.
- If the **whole** `AnsichtenDropdown` re-renders on hover, a more probable driver is a **parent re-render** or a **Next/Zustand subscription** firing (see §2–§3), not a hover handler defined here.

**Cross-file note (Trips list, not one of the six audited files):** `TripsTable` syncs `table.getState().columnVisibility` into Zustand in an effect keyed on `columnVisibility` (`trips-tables/index.tsx` ~84–87). If TanStack’s `columnVisibility` reference changes often, that could churn the store and re-subscribers (including `AnsichtenDropdown`) independent of hover — worth validating separately.

---

## 6. Popover inside `DropdownMenu` — terminology vs this codebase

### Popover vs `DropdownMenuSub`

- This implementation uses **`DropdownMenuSub` / `DropdownMenuSubContent`** for “Aktuelle Ansicht speichern”, **not** `Popover`.

```245:306:src/features/trips/components/ansichten-dropdown.tsx
            <DropdownMenuSub open={saveSubOpen} onOpenChange={setSaveSubOpen}>
              <DropdownMenuSubTrigger className='text-xs'>
                Aktuelle Ansicht speichern
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
```

### Does `saveSubOpen` re-render the dropdown?

**Yes.** `saveSubOpen` is React state on `AnsichtenDropdown`:

```132:132:src/features/trips/components/ansichten-dropdown.tsx
  const [saveSubOpen, setSaveSubOpen] = React.useState(false);
```

Toggling it re-renders the **entire** `AnsichtenDropdown` function component, including the preset list and `isPresetActive` work.

### `modal={!saveSubOpen}` — remount of content?

```183:183:src/features/trips/components/ansichten-dropdown.tsx
      <DropdownMenu modal={!saveSubOpen} onOpenChange={(o) => !o && setSaveSubOpen(false)}>
```

- Changing `modal` toggles Radix **modal** behavior (focus trap / outside-dismiss semantics). Whether that **remounts** `DropdownMenuContent` is an implementation detail of `@radix-ui/react-dropdown-menu`; it can cause **layout/focus** changes. This audit does not assert full remount without library source — only that **props on `DropdownMenu` change** when `saveSubOpen` flips, which is a **reconcile** of the root menu component.

---

## 7. Snapshot hook and URL subscription

### Does `useCurrentTripViewSnapshot` call `useSearchParams`?

**Yes:**

```36:38:src/features/trips/hooks/use-current-trip-view-snapshot.ts
export function useCurrentTripViewSnapshot() {
  const searchParams = useSearchParams();
  const columnVisibility = useTripsTableStore((s) => s.columnVisibility);
```

### Effect on `AnsichtenDropdown`

`AnsichtenDropdown` calls **both** top-level `useSearchParams()` (line **122**) and `useCurrentTripViewSnapshot()` (line **130**), which calls `useSearchParams()` **again** in the same component instance.

- Any URL search-string change that triggers a `useSearchParams` subscriber will affect this component tree accordingly (duplicate subscription to the same underlying source).
- **Including `page` changes** initiated elsewhere: there is **no** subscription narrowing; the component re-renders when the framework signals a search-param update.

The returned `getSnapshot` is a **`useCallback`** depending on `[searchParams, columnVisibility]`:

```40:45:src/features/trips/hooks/use-current-trip-view-snapshot.ts
  return useCallback(() => {
    return {
      params: buildTripPresetParamsFromSearchParams(searchParams),
      column_visibility: { ...columnVisibility } as VisibilityState
    };
  }, [searchParams, columnVisibility]);
```

That **stabilizes the callback identity** only when those deps are stable; it does **not** reduce re-renders of the component itself.

---

## Senior assessment

### Most likely root cause of “hover-triggered reload” (ranked)

1. **`isPresetActive` runs in render, O(n) per `AnsichtenDropdown` render** (lines **206–211**, **101–119**). Any parent or subscription-driven re-render recomputes JSON/canonical strings for every preset. Hover might **coincide** with focus-driven updates elsewhere, but the **dominant fixable cost** is this uncached work tied to **any** re-render.

2. **Broad URL subscription:** `useSearchParams()` (lines **122**, and again via **`useCurrentTripViewSnapshot`** line **37**) re-renders on **any** search change, not only whitelist keys — so unrelated param churn (e.g. pagination) still recomputes active state.

3. **`columnVisibility` Zustand churn** (lines **123**, duplicate hook **38**): if upstream writes new object references often, both the dropdown and the snapshot hook re-render and re-run the map.

4. **`modal={!saveSubOpen}`**: toggling when opening the save sub-panel changes Radix menu modality; more relevant to **focus/submenu** behavior than to **hover over preset list**, unless users confuse sub-panel open with “reload”.

“Reload” **cannot** be attributed to `useTripPresets` refetch on hover from this code: **5-minute** `staleTime` and no `select` transform; refetch would require invalidation or cache miss.

### Minimal fix (conceptual — no code in this doc)

- **One targeted improvement:** Memoize **“which preset id is active”** (or the **canonical current** `stableParamsJson` + `canonicalColumnVisibilityForCompare` strings) with `useMemo` deps **`[searchParams, columnVisibility, presets]`**, and have each row read that result **by id** — avoids **per-preset** repeated JSON work on every render.

- **Smaller follow-up:** Drop the **duplicate** `useSearchParams` + `columnVisibility` usage by not calling both directly and inside `useCurrentTripViewSnapshot` for the same UI (or split concerns so the dropdown doesn’t double-subscribe).

- **Larger re-architecture (usually unnecessary first):** Isolate active detection in a small child that only subscribes to narrowed state — only after proving Zustand/URL churn.

### `modal={!saveSubOpen}` and nested Popover pattern

- This file uses **`DropdownMenuSub`**, not Popover. For **Popover-inside-DropdownMenu**, Radix guidance is typically: avoid conflicting **modal** layers, coordinate **`modal={false}`** on one side, and/or use **submenus / portaled content** with explicit focus handling — analogous to the **`modal={!saveSubOpen}`** comment at lines **181–182**.

Whether toggling `modal` **unmounts** content should be verified in the installed `@radix-ui/react-dropdown-menu` version; treat it as **behavioral risk** for focus and subtree updates, not as proof of full remount without library inspection.

---

## File index (audited)

| File | Role |
|------|------|
| `src/features/trips/components/ansichten-dropdown.tsx` | UI, `useSearchParams`, Zustand, React Query, active detection in render |
| `src/features/trips/hooks/use-trip-presets.ts` | Query `staleTime`, mutations |
| `src/features/trips/hooks/use-apply-trip-preset.ts` | `useCallback` for apply; not in hot render path for ●/○ |
| `src/features/trips/hooks/use-current-trip-view-snapshot.ts` | Second `useSearchParams` + Zustand in same dropdown |
| `src/features/trips/stores/use-trips-table-store.ts` | `columnVisibility` slice identity |
| `src/features/trips/api/trip-presets.service.ts` | Fetch/create — not per-hover |
