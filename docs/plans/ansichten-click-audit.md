# Micro-audit — Preset click in `AnsichtenDropdown` (read-only)

**Scope:** `ansichten-dropdown.tsx`, `use-apply-trip-preset.ts`, `use-trips-table-store.ts`, plus provider verification for Q3 (`trips-rsc-refresh-provider.tsx`).  
**Date:** 2026-05-14

---

## 1. Preset `DropdownMenuItem` — `onSelect`, `applyPreset`, `preventDefault`

### Exact JSX (preset list item + all props on `DropdownMenuItem`)

**File:** `src/features/trips/components/ansichten-dropdown.tsx`

```420:435:src/features/trips/components/ansichten-dropdown.tsx
                <DropdownMenuItem
                  key={preset.id}
                  className='gap-2 text-xs'
                  onSelect={() => {
                    if (active) {
                      resetToDefault();
                    } else {
                      applyPreset(preset);
                    }
                  }}
                >
                  <span className='shrink-0' aria-hidden>
                    {active ? '●' : '○'}
                  </span>
                  <span className='min-w-0 truncate'>{preset.name}</span>
                </DropdownMenuItem>
```

Props present: `key`, `className`, `onSelect`. (No `disabled`, `onClick`, etc.)

### Is `onSelect` defined? Does it call `applyPreset`?

- **`onSelect` is defined** at lines **423–429**.
- **`applyPreset(preset)` is called** when **`active` is falsy** (line **427**).
- When **`active` is true** (`preset.id === activePresetId`, see lines **418** and **387–388**), the handler calls **`resetToDefault()`** instead (line **425**) — **not** `applyPreset`.

### `event.preventDefault()` in this handler or parent?

- **Preset item handler:** **no** `preventDefault` (lines **423–429**).
- **Elsewhere in the same file:** `preventDefault` appears only on **`DropdownMenuSubContent` `onKeyDown`** for **Enter** in **`SavePresetSubMenu`** (lines **251–254**), unrelated to the preset list item.
- **Parent:** `DropdownMenu` has `modal={false}` (line **394**); no `onSelect`/`preventDefault` on the menu root in this file.

---

## 2. `useApplyTripPreset` return value & consumption

### What does `useApplyTripPreset` return?

**File:** `src/features/trips/hooks/use-apply-trip-preset.ts`

It **`return`s the result of `useCallback(...)`** — i.e. **a single function** `(preset: TripPreset) => void`, **not** an object with a named key.

```39:50:src/features/trips/hooks/use-apply-trip-preset.ts
export function useApplyTripPreset() {
  const router = useRouter();
  const pathname = usePathname();
  const { refreshTripsPage } = useTripsRscRefresh();
  const setPendingColumnVisibility = useTripsTableStore(
    (s) => s.setPendingColumnVisibility
  );
  const setPendingColumnOrder = useTripsTableStore(
    (s) => s.setPendingColumnOrder
  );

  return useCallback(
```

### How is it consumed in `ansichten-dropdown.tsx`?

**Line 322:**

```322:322:src/features/trips/components/ansichten-dropdown.tsx
  const applyPreset = useApplyTripPreset();
```

So: **`const applyPreset = useApplyTripPreset()`** — the hook’s return value is assigned directly and later invoked as **`applyPreset(preset)`** (line **427**).

---

## 3. `refreshTripsPage` in `use-apply-trip-preset.ts`

### Import and usage in `use-apply-trip-preset.ts`

**Import:** none for `refreshTripsPage` by name; it comes from **`useTripsRscRefresh`**:

```7:8:src/features/trips/hooks/use-apply-trip-preset.ts
import { useTripsRscRefresh } from '@/features/trips/providers';
import { useTripsTableStore } from '@/features/trips/stores/use-trips-table-store';
```

**Obtained (destructured):**

```42:42:src/features/trips/hooks/use-apply-trip-preset.ts
  const { refreshTripsPage } = useTripsRscRefresh();
```

**Called inside the preset callback:**

```59:60:src/features/trips/hooks/use-apply-trip-preset.ts
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      void refreshTripsPage();
```

### Is `useTripsRscRefresh` correct? Does it expose `refreshTripsPage`?

**File:** `src/features/trips/providers/trips-rsc-refresh-provider.tsx`

The context value type includes **`refreshTripsPage: () => Promise<void>`** (lines **25–27**). **`useTripsRscRefresh`** returns the full context value (lines **63–70**), which is **`{ refreshTripsPage, isRscRefreshPending }`** from the provider’s `useMemo` (lines **50–52**). Destructuring `{ refreshTripsPage }` in `use-apply-trip-preset.ts` is consistent with that API.

---

## 4. Router usage

### Import in `use-apply-trip-preset.ts`

```4:4:src/features/trips/hooks/use-apply-trip-preset.ts
import { usePathname, useRouter } from 'next/navigation';
```

**Not** `next/router`.

### `router.replace` argument

```59:59:src/features/trips/hooks/use-apply-trip-preset.ts
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
```

**First argument:** a **string** built from `pathname` and query string (`URLSearchParams`), **not** a `URL` object.

**Note:** `ansichten-dropdown.tsx` also imports **`useRouter`** from **`next/navigation`** (line **5**) for `resetToDefault` (line **335**), same pattern.

---

## 5. `useCallback` deps and how `table` is read

### Full `useCallback` dependency array

```50:86:src/features/trips/hooks/use-apply-trip-preset.ts
  return useCallback(
    (preset: TripPreset) => {
      const params = new URLSearchParams();
      const stored = jsonToParamEntries(preset.params);
      Object.entries(stored).forEach(([k, v]) => {
        if (v) params.set(k, v);
      });
      params.set('page', '1');

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      void refreshTripsPage();

      const visibility = jsonToVisibilityState(preset.column_visibility);
      const tbl = useTripsTableStore.getState().table;
      if (tbl !== null) {
        tbl.setColumnVisibility(visibility);
      } else {
        setPendingColumnVisibility(visibility);
      }

      const order = jsonToColumnOrder(preset.column_order);
      if (order.length > 0) {
        if (tbl !== null) {
          tbl.setColumnOrder(order);
        } else {
          setPendingColumnOrder(order);
        }
      }
    },
    [
      router,
      pathname,
      refreshTripsPage,
      setPendingColumnVisibility,
      setPendingColumnOrder
    ]
  );
```

### `table`: hook selector vs `getState()`

- **`table` is read inside the callback** as **`useTripsTableStore.getState().table`** (line **63**).
- It is **not** read via **`useTripsTableStore((s) => s.table)`** in this hook.
- Therefore **`table` does not appear** in the **`useCallback` dependency array** (lines **79–85**).

---

## 6. Active preset detection — could it “block” clicks or hide the list?

### Conditional around the preset list?

**File:** `src/features/trips/components/ansichten-dropdown.tsx`

- The **map is always rendered** when `presets` is iterated: **`presets.map((preset) => { ... })`** (lines **417–437**).
- There is **no** wrapper that skips the list when `activePresetId` is set or null.
- When **`presets.length === 0`**, a **separate** empty-state `div` is shown **in addition** to the group (lines **412–416**); the map still runs over an empty array.

### `activePresetId` memo — throw or bad values?

```368:390:src/features/trips/components/ansichten-dropdown.tsx
  const activePresetId = React.useMemo(() => {
    if (!presets?.length) return null;
    const currentParamsJson = stableParamsJson(
      buildTripPresetParamsFromSearchParams(searchParams)
    );
    const currentVisJson = canonicalColumnVisibilityForCompare(columnVisibility);
    return (
      presets.find((preset) => {
        const paramsMatch =
          stableParamsJson(presetParamsForCompare(preset.params)) ===
          currentParamsJson;
        const visMatch =
          canonicalColumnVisibilityForCompare(
            jsonToVisibilityState(preset.column_visibility)
          ) === currentVisJson;
        const orderMatch = presetColumnOrderMatches(
          preset.column_order,
          tripsColumnOrder
        );
        return paramsMatch && visMatch && orderMatch;
      })?.id ?? null
    );
  }, [presets, searchParams, columnVisibility, tripsColumnOrder]);
```

- **Throws:** under normal data, **no** explicit `throw`; **`presets?.length`** guards empty.
- **Return type:** **`string | null`** — either a matching preset **`id`** or **`null`**.
- **Effect on click:** `active` is `preset.id === activePresetId` (line **418**). For the **active** row, **`onSelect` calls `resetToDefault()`** (lines **424–425**), which **does** change URL, refresh, and column state (lines **330–344**) — behaviorally **not** a no-op; it **desynchronizes** from the preset rather than re-applying it.

---

## Summary observation (for debugging “click does nothing”)

From code review alone, the **inactive** preset path **does** invoke **`applyPreset(preset)`**, which **does** call **`router.replace`**, **`refreshTripsPage`**, and updates visibility/order. The **active** preset path intentionally calls **`resetToDefault()`** instead of **`applyPreset`**. Misaligned **`activePresetId`** detection (params / visibility / order) could mark a row **active** when the user does not expect it, so a click would **reset** rather than **re-apply** the preset — worth verifying in repros.
