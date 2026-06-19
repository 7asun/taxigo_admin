# Billing Variant Popover Scroll — Audit

**Scope:** Read-only audit of why wheel/trackpad scroll fails on the billing-variant multi-select popover in the CSV export filter step.

**Files read:**

- `src/features/trips/components/csv-export/export-filter-step.tsx`
- `src/features/trips/components/csv-export/csv-export-dialog.tsx` (parent context)
- `src/components/ui/popover.tsx`
- `src/components/ui/command.tsx`
- All `Popover` + `Command` pairings under `src/features/trips/components/` and `src/components/ui/`

**Date:** 2026-06-19

---

## Executive summary

The export billing-variant picker **does not use `Command` / `CommandList` at all**. It is a bare `PopoverContent` → scrollable `div` → checkbox rows pattern, mounted **inside a Radix `Dialog`** whose step wrapper is an `overflow-y-auto` scroll root. Every working multi-select popover in this codebase uses **`Popover` + `Command` + `CommandList`** on a normal page surface (not inside the export dialog).

The attempted JS wheel workaround (`billingListRef` + `useEffect([])`) has a **lifecycle bug**: on a cold load the component first renders a loading spinner (no popover DOM), the effect runs once with `ref === null` and exits, and **never re-runs** when the popover mounts after queries resolve — so the listener is often never attached.

Even when attached, the handler only calls `stopPropagation()` and manually adjusts `scrollTop`; it does **not** call `preventDefault()`. Wheel events can still chain to the dialog’s scroll container (`csv-export-dialog.tsx` line 270), which is the behavior users report (dialog scrolls instead of the list).

---

## 1. Billing variant popover DOM structure (`export-filter-step.tsx`)

The billing block is at lines 259–324. There is **no** `Command`, `CommandInput`, or `CommandItem` in this file (checkbox rows only).

### Ancestor context (not part of the popover portal, but relevant)

```
Dialog (csv-export-dialog.tsx)
  DialogContent  className="… flex max-h-[85vh] … flex-col overflow-hidden …"
    DialogHeader …
    div  className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain touch-pan-y py-4"
      ExportFilterStep root  div className="space-y-4"
        … billing section …
```

`PopoverContent` is portaled to `document.body` via `PopoverPrimitive.Portal`, but wheel **scroll chaining** still targets the nearest scrollable ancestor in the focus/scroll interaction model — here, the dialog step wrapper above.

### From `PopoverContent` down

| Element | Source | Classes / attributes |
|--------|--------|-------------------|
| **`PopoverPrimitive.Portal`** | `popover.tsx` | (no classes) |
| **`PopoverPrimitive.Content`** | `export-filter-step.tsx` + `popover.tsx` defaults | **Props:** `align="start"`, `forceMount`, `style={{ width: 'var(--radix-popover-trigger-width)' }}`, `className="p-0"` |
| | **Merged `className` on Content:** | `bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border shadow-md outline-hidden p-0` |
| **Scrollable list `div`** | `export-filter-step.tsx:283–286` | `ref={billingListRef}`, `className="max-h-64 overflow-y-auto overscroll-contain touch-pan-y p-1"` |
| **Row `div`** (per variant) | `:288–291` | `className="relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-2 text-sm outline-hidden select-none"` |
| **`Checkbox`** | `:292–296` | (component defaults) |
| **`Label`** | `:297–306` | `className="flex cursor-pointer items-center gap-2 text-sm font-normal"` |
| Color dot **`span`** | `:301–304` | `className="inline-block h-2 w-2 shrink-0 rounded-full"` + inline `backgroundColor` |
| Label text **`span`** | `:305` | (no extra classes) |
| **Footer `div`** (conditional) | `:310–321` | `className="border-t p-2"` |
| **`Button`** (Auswahl löschen) | `:312–319` | `variant="ghost" size="sm" className="w-full text-xs"` |

### JS wheel handler (lines 149–160)

```tsx
const billingListRef = React.useRef<HTMLDivElement>(null);

React.useEffect(() => {
  const el = billingListRef.current;
  if (!el) return;
  const onWheel = (e: WheelEvent) => {
    e.stopPropagation();
    el.scrollTop += e.deltaY;
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}, []);
```

**Lifecycle issue:** Lines 220–227 return early while `isLoading` is true. The popover (and `billingListRef` target) does not exist on that first paint. The empty-deps effect runs once, sees `el === null`, and returns without subscribing. After queries finish, the popover mounts but the effect **does not run again**, so the listener is never added on a typical cold open.

`forceMount` on `PopoverContent` only keeps content mounted when the popover subtree exists; it does not help during the loading-spinner branch when the entire billing `Popover` is absent from the tree.

---

## 2. Every `Popover` + `Command` usage found

Search covered `src/features/trips/components/` and `src/components/ui/`. Additional matches elsewhere are included because they are the same UI pattern.

**Note:** `export-filter-step.tsx` uses `Popover` only — **not** in this table.

| # | File | Inside `Dialog`? | Scrolls with wheel? (expected) | Scrollable element & classes |
|---|------|------------------|-------------------------------|------------------------------|
| 1 | `src/features/trips/components/trips-filters-bar.tsx` — column visibility | No (trips page toolbar) | Yes (same surface as list filters; no competing dialog scroll root) | See structures below |
| 2 | `trips-filters-bar.tsx` — KTS multi-select | No | Yes | See below |
| 3 | `trips-filters-bar.tsx` — payer multi-select | No | Yes | See below |
| 4 | `trips-filters-bar.tsx` — **billing variant multi-select** | No | Yes (canonical billing filter on Fahrten page) | See below |
| 5 | `src/features/trips/components/trip-address-passenger/address-autocomplete.tsx` | Often inside **Sheet** (`trip-detail-sheet`) or create-trip form — overlay context | Works when `onWheel` guard is present | See below |
| 6 | `src/components/ui/table/data-table-faceted-filter.tsx` | No (inline table toolbar) | Yes | See below |
| 7 | `src/components/ui/table/data-table-view-options.tsx` | No | Yes | See below |
| 8 | `src/features/kts/components/kts-filters-bar.tsx` — status filter | No | Yes (short list; `CommandList` default cap rarely hit) | See below |
| 9 | `src/features/invoices/components/invoice-builder/step-2-params.tsx` — `MonthlyBillingTypesPicker` | No (full-page builder step) | Yes | See below |
| 10 | `step-2-params.tsx` — `MonthlyVariantSubsetPicker` | No | Yes | Same as #9 |

No `Popover` + `Command` combination was found under `src/components/ui/` beyond the two data-table helpers (#6, #7).

### Per-file DOM structures (PopoverContent → scroll target)

#### 1 — `trips-filters-bar.tsx` column visibility (`:450–483`)

```
PopoverContent  className="w-48 p-0" align="start"
  Command  (default: bg-popover flex h-full w-full flex-col overflow-hidden rounded-md)
    CommandInput wrapper  className="flex h-9 items-center gap-2 border-b px-3"
    CommandList  className="max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto"  ← scroll
      CommandEmpty
      CommandGroup  className="… overflow-hidden p-1 …"  (default from command.tsx)
        CommandItem …
```

#### 2 — KTS picker (`:597–650`)

```
PopoverContent  className="w-[min(calc(100vw-2rem),18rem)] p-0" align="start"
  Command
    CommandInput  className="h-8 text-xs"
    CommandList  max-h-[300px] overflow-y-auto  (defaults)
      CommandEmpty
      CommandGroup  className="max-h-[18.75rem] overflow-y-auto"  ← inner scroll cap
        CommandItem …
      [CommandSeparator + CommandGroup footer]
```

#### 3 — Payer picker (`:687–740`)

Same structure as KTS picker (#2).

#### 4 — Billing variant picker on Fahrten list (`:780–835`) — **closest functional twin**

```
PopoverContent  className="w-[min(calc(100vw-2rem),20rem)] p-0" align="start"
  Command
    CommandInput  placeholder="Abrechnung suchen…"  className="h-8 text-xs"
    CommandList  max-h-[300px] overflow-y-auto  (defaults)
      CommandEmpty
      CommandGroup  className="max-h-[18.75rem] overflow-y-auto"
        CommandItem … (checkbox-style div + label)
      [CommandSeparator + clear footer CommandGroup]
```

#### 5 — `address-autocomplete.tsx` (`:304–367`)

```
PopoverContent  className="w-[var(--radix-popover-trigger-width)] p-0" align="start"
  Command  className="h-auto overflow-visible"  shouldFilter={false}
    CommandList  className="overflow-y-auto overscroll-contain"
                 onWheel={(e) => e.stopPropagation()}  ← explicit overlay fix
      CommandEmpty
      CommandGroup  (default overflow-hidden)
        CommandItem …
```

This is the **only** Popover+Command site that adds an explicit wheel handler — evidence that scroll inside nested overlays was a known problem elsewhere.

#### 6 — `data-table-faceted-filter.tsx` (`:134–184`)

```
PopoverContent  className="w-[12.5rem] p-0" align="start"
  Command
    CommandInput
    CommandList  className="max-h-full"  (overrides default max-h-[300px])
      CommandEmpty
      CommandGroup  className="max-h-[18.75rem] overflow-x-hidden overflow-y-auto"  ← scroll
        CommandItem …
      [clear footer]
```

#### 7 — `data-table-view-options.tsx` (`:57–84`)

```
PopoverContent  className="w-44 p-0" align="end"
  Command
    CommandInput
    CommandList  max-h-[300px] overflow-y-auto  (defaults)
      CommandEmpty
      CommandGroup  overflow-hidden (default)
        CommandItem …
```

#### 8 — `kts-filters-bar.tsx` (`:88–137`)

```
PopoverContent  className="w-56 p-0" align="start"
  Command  shouldFilter={false}
    CommandList  max-h-[300px] overflow-y-auto
      CommandGroup  (no extra max-height; list is short)
        CommandItem …
      [clear footer]
```

#### 9 & 10 — `step-2-params.tsx` pickers (`:212–259`, `:340–391`)

Same as faceted filter / trips billing: `Command` → `CommandInput` → `CommandList` → `CommandGroup className="max-h-[18.75rem] overflow-y-auto"`.

### Related pattern (Popover without Command)

`src/features/invoices/components/pdf-vorlagen/column-picker.tsx` uses `PopoverContent` → `ScrollArea className="h-[220px]"` (Radix Scroll Area viewport), not `Command`. Not a Command pairing, but shows another scroll strategy for popovers.

---

## 3. Structural comparison — export billing popover vs working examples

| Aspect | Export `export-filter-step.tsx` | Working examples (e.g. `trips-filters-bar` billing) |
|--------|--------------------------------|------------------------------------------------------|
| **`Command` wrapper** | **Absent** | Present; `flex flex-col overflow-hidden` |
| **`CommandList`** | **Absent** | Present; default `max-h-[300px] overflow-y-auto` |
| **Scroll container** | Single plain `div` | `CommandList` and often `CommandGroup` with `max-h-[18.75rem] overflow-y-auto` |
| **`overflow-y-auto` location** | On list `div` only | On `CommandList` (+ sometimes `CommandGroup`) |
| **`CommandInput` / search** | None | Present on list filters |
| **`ScrollArea`** | Not used (was removed in an earlier fix) | Not used in Command popovers; used in `column-picker` |
| **`PopoverContent` height** | No max-height; `p-0`; width from trigger CSS var | Same: `p-0`, no fixed height on shell |
| **Footer (“Auswahl löschen”)** | Sibling `div` below scroll `div` | Inside `CommandList` after `CommandSeparator` |
| **Parent overlay** | **`Dialog`** with `overflow-hidden` + inner **`overflow-y-auto`** step wrapper | Normal page / toolbar — **no dialog scroll competitor** |
| **Wheel mitigation** | JS `addEventListener` (often not attached — see §1) | None needed on page; `address-autocomplete` uses React `onWheel` + `stopPropagation` in Sheet |

### Key structural differences that explain broken scroll

1. **Dialog nesting (strongest environmental factor):** The export wizard is the only billing-variant multi-select rendered inside `CsvExportDialog`. The step content wrapper (`overflow-y-auto overscroll-contain touch-pan-y`) creates a scroll root that competes with the portaled popover list. Working billing/KTS/payer pickers on the Fahrten page are not inside this dialog.

2. **Missing Command stack:** Working pickers route scroll through `cmdk`’s `CommandList` (`overflow-y-auto`, `max-h-[300px]`). The export step uses a hand-rolled `div` scroll region without the Command layout (`overflow-hidden` parent + list child) that the rest of the app standardizes on.

3. **Broken JS workaround:** Empty-deps `useEffect` + loading gate means the wheel listener frequently never attaches. This alone can explain “fix did nothing.”

4. **Incomplete event handling:** The workaround stops propagation but not default browser scroll chaining to the dialog. `address-autocomplete` only uses `stopPropagation` on React’s synthetic wheel event on `CommandList`; export uses native listener + manual `scrollTop` without `preventDefault()`.

5. **`ScrollArea`:** Not involved in either the broken or working Command popovers. The export step previously used `ScrollArea`; it was replaced by a plain `overflow-y-auto` div (see conversation history / `csv-export-audit.md`).

---

## 4. Default styles on `CommandList` (`command.tsx`)

```78:91:src/components/ui/command.tsx
function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot='command-list'
      className={cn(
        'max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto',
        className
      )}
      {...props}
    />
  );
}
```

**Exact default classes on `CommandList`:**

- `max-h-[300px]`
- `scroll-py-1`
- `overflow-x-hidden`
- `overflow-y-auto`

**Related defaults on sibling primitives:**

- **`Command` root:** `bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md`
- **`CommandGroup`:** includes `overflow-hidden p-1` (working multi-selects often override with `max-h-[18.75rem] overflow-y-auto`)

---

## 5. Styles on `PopoverContent` (`popover.tsx`) — scroll trapping?

```20:39:src/components/ui/popover.tsx
function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot='popover-content'
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
```

**Findings:**

- **`PopoverContent` does not set `overflow`, `max-height`, or touch/wheel-related classes.** Height is content-driven; callers pass `p-0` and put scroll on inner lists.
- **`PopoverPrimitive.Portal`** renders into `document.body`; no overflow styles on the portal wrapper itself.
- **Nothing in `popover.tsx` explicitly swallows wheel events.** Scroll issues come from **interaction between portaled popover content and other scroll roots** (here, the export dialog’s `overflow-y-auto` step wrapper), not from popover default CSS.
- **Radix `@radix-ui/react-popover`** may participate in focus/pointer-event layering with `@radix-ui/react-dialog` when both are open (same z-index tier `z-50`), but that behavior is in Radix primitives, not this wrapper file.

---

## Root-cause ranking (for future fix work)

1. **Dialog scroll chaining** — popover list vs `csv-export-dialog` step wrapper (`overflow-y-auto`).
2. **`useEffect([])` + loading gate** — wheel listener never attached after cold load.
3. **Pattern drift** — export step omitted the established `Popover` + `Command` + `CommandList` stack used by `trips-filters-bar` billing picker.
4. **Handler incomplete** — missing `preventDefault()` / attach-on-open pattern used successfully in `address-autocomplete`.

---

## Suggested fix directions (informational only — no code changed in this audit)

Align export billing UI with `trips-filters-bar.tsx` billing popover (`Command` + `CommandList` + `CommandGroup` scroll classes) **and** apply the same overlay wheel guard as `address-autocomplete` (`onWheel` → `stopPropagation` on `CommandList`), or attach the native listener in `onOpenChange` when the popover opens (not only on mount). Consider `modal={false}` on the dialog or Radix’s documented nested-overlay patterns if scroll chaining persists after aligning structure.

---

## Files referenced

| Path | Role |
|------|------|
| `src/features/trips/components/csv-export/export-filter-step.tsx` | Broken billing popover |
| `src/features/trips/components/csv-export/csv-export-dialog.tsx` | Dialog scroll root |
| `src/features/trips/components/trips-filters-bar.tsx` | Working billing variant popover |
| `src/features/trips/components/trip-address-passenger/address-autocomplete.tsx` | Wheel guard precedent |
| `src/components/ui/popover.tsx` | Popover shell defaults |
| `src/components/ui/command.tsx` | CommandList scroll defaults |
