# Spalten Popover — Visual Pattern vs KTS / Kostenträger (Audit)

**Goal:** Identify the exact JSX shell used by KTS and Kostenträger filters so `renderColumnVisibilityPopover` can be restyled to match — **zero behaviour change** (still toggles TanStack `column.toggleVisibility()`).

**Scope:** Read-only audit of [`trips-filters-bar.tsx`](../src/features/trips/components/trips-filters-bar.tsx).

**Date:** 2026-06-19

---

## Executive summary

| Question | Answer |
|----------|--------|
| Shared wrapper component? | **No** — no `MultiSelectFilter`, `FacetedFilter`, or `FilterPopover` in this codebase (grep under `src/features/trips` returns nothing). |
| What KTS / Kostenträger use | **Inlined JSX** in `advancedFilterSelects` inside the same file: `Popover` → `Button` trigger → `PopoverContent` → `Command` → `CommandList` → `CommandGroup` → `CommandItem` rows. |
| What Spalten uses today | Same **primitives** (`Popover` + `Command` + …) but a **different visual shell**: fixed narrow panel, `Settings2` trigger, **trailing** checkmark, **no** checkbox box, **no** clear footer, **no** scroll cap on list. |

To match KTS/Kostenträger visually, copy the **Kostenträger popover block** (lines 653–741) as the template and swap data/handlers — not a separate shared component import.

---

## 1. KTS and Kostenträger — components and JSX

Both filters live inside `advancedFilterSelects` (lines 496–839). They are **not** extracted components.

### Shared primitive stack

| Layer | Import source |
|-------|----------------|
| `Popover`, `PopoverTrigger`, `PopoverContent` | `@/components/ui/popover` |
| `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator` | `@/components/ui/command` |
| Trigger | `Button` from `@/components/ui/button` |
| Icons | `PlusCircle`, `XCircle` (lucide); `CheckIcon`, `CaretSortIcon` (@radix-ui/react-icons) |
| Styling helper | `cn` from `@/lib/utils` |

---

### KTS filter (lines 561–651)

**Controlled popover:** `open={ktsPickerOpen}` / `onOpenChange={setKtsPickerOpen}` (state line 180).

**Trigger — `Button`:**

```563:595:src/features/trips/components/trips-filters-bar.tsx
          <Button
            type='button'
            variant='outline'
            className='h-10 min-h-10 w-full min-w-0 justify-between gap-1.5 text-xs font-normal sm:min-w-[110px] md:h-9 md:min-h-0 md:w-auto md:shrink-0'
          >
            {selectedKtsFilterValues.length > 0 ? (
              <span ... aria-label='KTS-Filter zurücksetzen' onClick={...}>
                <XCircle className='size-4' />
              </span>
            ) : (
              <PlusCircle className='mr-1 size-4 shrink-0' />
            )}
            <span className='min-w-0 flex-1 truncate text-left'>
              {ktsTriggerLabel}
            </span>
            <CaretSortIcon className='ml-1 h-3.5 w-3.5 shrink-0 opacity-50' />
          </Button>
```

**Panel:**

```597:650:src/features/trips/components/trips-filters-bar.tsx
        <PopoverContent
          className='w-[min(calc(100vw-2rem),18rem)] p-0'
          align='start'
        >
          <Command>
            <CommandInput placeholder='KTS-Option suchen…' className='h-8 text-xs' />
            <CommandList>
              <CommandEmpty className='py-2 text-center text-xs'>Keine Option gefunden.</CommandEmpty>
              <CommandGroup className='max-h-[18.75rem] overflow-y-auto'>
                {KTS_FILTER_OPTION_ROWS.map((row) => (
                  <CommandItem ... className='text-xs'>
                    <div className={cn(
                      'border-primary mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                      isSelected ? 'bg-primary text-primary-foreground' : 'opacity-50 [&_svg]:invisible'
                    )}>
                      <CheckIcon className='size-3' />
                    </div>
                    <span className='truncate'>{row.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {selectedKtsFilterValues.length > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem onSelect={() => clearKtsFilter()} className='justify-center text-center text-xs'>
                      × Auswahl löschen
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
```

**Item selection indicator:** **Left** bordered checkbox (`size-4`, `border-primary`, filled when selected).

**`CommandItem`:** `value={`${row.label} ${row.value}`}` for cmdk search.

---

### Kostenträger filter (lines 653–741)

**Controlled popover:** `open={payerPickerOpen}` / `onOpenChange={setPayerPickerOpen}` (state line 178).

**Trigger — same shell as KTS** (label + icons differ):

```655:685:src/features/trips/components/trips-filters-bar.tsx
          <Button
            type='button'
            variant='outline'
            className='h-10 min-h-10 w-full min-w-0 justify-between gap-1.5 text-xs font-normal sm:min-w-[120px] md:h-9 md:min-h-0 md:w-auto md:shrink-0'
          >
            {selectedPayerIds.length > 0 ? (
              <span ... aria-label='Kostenträgerfilter zurücksetzen' onClick={...}>
                <XCircle className='size-4' />
              </span>
            ) : (
              <PlusCircle className='mr-1 size-4 shrink-0' />
            )}
            <span className='min-w-0 truncate'>{payerTriggerLabel}</span>
            <CaretSortIcon className='ml-1 h-3.5 w-3.5 shrink-0 opacity-50' />
          </Button>
```

**Panel:** Identical structure to KTS — `w-[min(calc(100vw-2rem),18rem)] p-0`, `align='start'`, `CommandGroup className='max-h-[18.75rem] overflow-y-auto'`, checkbox rows, optional clear footer `"Auswahl löschen"`.

**Item row:**

```704:721:src/features/trips/components/trips-filters-bar.tsx
                    <CommandItem
                      key={payer.id}
                      value={`${payer.name} ${payer.id}`}
                      onSelect={() => togglePayerId(payer.id)}
                      className='text-xs'
                    >
                      <div className={cn(
                        'border-primary mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        isSelected ? 'bg-primary text-primary-foreground' : 'opacity-50 [&_svg]:invisible'
                      )}>
                        <CheckIcon className='size-3' />
                      </div>
                      <span className='truncate'>{payer.name}</span>
                    </CommandItem>
```

**Abrechnung** (billing variants, lines 743–837) uses the **same pattern** with `w-[min(calc(100vw-2rem),20rem)]` panel width and `sm:min-w-[120px]` trigger.

---

## 2. Complete `renderColumnVisibilityPopover` (current Spalten UI)

**Function:** lines 439–485.

**Wrapper:** `Popover` + `PopoverTrigger` + `PopoverContent` + `Command` + `CommandList` + `CommandGroup` — **same primitive family** as KTS/Kostenträger, **different layout/details**.

```439:485:src/features/trips/components/trips-filters-bar.tsx
  const renderColumnVisibilityPopover = (triggerClassName: string) =>
    currentView === 'list' && table ? (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant='outline' className={cn('px-3', triggerClassName)}>
            <Settings2 className='h-3.5 w-3.5 shrink-0' />
            <span className='truncate'>Spalten</span>
            <CaretSortIcon className='ml-1 h-3.5 w-3.5 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-48 p-0'>
          <Command>
            <CommandInput placeholder='Spalte suchen...' className='h-8 text-xs' />
            <CommandList>
              <CommandEmpty className='py-2 text-center text-xs'>Keine Spalten gefunden.</CommandEmpty>
              <CommandGroup>
                {hidableColumns.map((column) => (
                  <CommandItem
                    key={column.id}
                    onSelect={() => column.toggleVisibility(!column.getIsVisible())}
                    className='text-xs'
                  >
                    <span className='truncate'>
                      {(column.columnDef.meta as any)?.label ?? column.id}
                    </span>
                    <CheckIcon className={cn(
                      'ml-auto size-3.5 shrink-0',
                      column.getIsVisible() ? 'opacity-100' : 'opacity-0'
                    )} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    ) : null;
```

**Mount points** (receives `triggerClassName` for responsive layout):

- Narrow: lines 915–920 — `cn('h-10 min-h-10 justify-between gap-1.5 text-xs font-normal', …)`
- Wide: line 941–943 — `'h-10 min-h-10 min-w-0 flex-1 … md:min-w-[8.5rem] md:flex-initial'`

---

## 3. Shared wrapper component?

**No.** KTS, Kostenträger, Abrechnung, and Spalten each **inline** the same shadcn building blocks in `trips-filters-bar.tsx`. There is no reusable filter component file to import.

---

## 4. If a shared component existed — props interface

**N/A** — no shared component. For implementation, treat **Kostenträger block (653–741)** as the canonical copy-paste template.

---

## Side-by-side — visual differences (Spalten vs KTS/Kostenträger)

| Aspect | KTS / Kostenträger | Spalten (today) |
|--------|-------------------|-----------------|
| **Popover control** | Controlled (`open` / `onOpenChange`) | Uncontrolled |
| **Trigger `type`** | `type='button'` | Omitted |
| **Trigger layout** | `justify-between gap-1.5 text-xs font-normal` + min-width breakpoints | `px-3` + passed `triggerClassName` |
| **Leading icon** | `PlusCircle` (empty) or `XCircle` clear (active) | `Settings2` (static) |
| **Label** | Dynamic (`ktsTriggerLabel` / `payerTriggerLabel`) | Static `"Spalten"` |
| **CaretSortIcon** | Yes (`opacity-50`) | Yes |
| **PopoverContent width** | `w-[min(calc(100vw-2rem),18rem)]` | `w-48` (192px fixed) |
| **CommandGroup scroll** | `max-h-[18.75rem] overflow-y-auto` | None |
| **Row indicator** | Left checkbox box + `CheckIcon size-3` | Trailing `CheckIcon size-3.5` opacity toggle |
| **CommandItem `value`** | Set (searchable) | Not set |
| **Clear footer** | `CommandSeparator` + “Auswahl löschen” when selection non-empty | None |
| **Behaviour** | URL multi-select toggles | `column.toggleVisibility()` |

---

## Implementation checklist — match KTS/Kostenträger shell (behaviour unchanged)

When restyling Spalten, copy these **visual** elements from Kostenträger (653–741):

1. **Trigger:** `Button type='button' variant='outline'` with `justify-between gap-1.5 text-xs font-normal` and responsive min-width classes from `triggerClassName` prop (already passed at call sites).
2. **Optional:** `PlusCircle` / dynamic label — for Spalten, label can stay `"Spalten"` or show count of hidden columns; **do not** wire URL clear unless product asks — column reset is different from filter clear.
3. **`PopoverContent`:** `className='w-[min(calc(100vw-2rem),18rem)] p-0' align='start'`.
4. **`CommandInput`:** `className='h-8 text-xs'` (placeholder `"Spalte suchen..."` or `"Spalten suchen…"` to match ellipsis style).
5. **`CommandGroup`:** add `className='max-h-[18.75rem] overflow-y-auto'`.
6. **Each row:** left checkbox `div` + `CheckIcon className='size-3'`; `isSelected` = `column.getIsVisible()`; `onSelect` unchanged (`column.toggleVisibility(!column.getIsVisible())`).
7. **Add `value` on `CommandItem`:** e.g. `value={label}` for cmdk filter (matches KTS pattern).
8. **Clear footer:** optional for Spalten — KTS clears URL selection; columns have no single “clear all” in current behaviour. **Omit footer** unless product wants “all columns visible” reset (would be **behaviour change**).

**Controlled `open` state:** KTS uses `ktsPickerOpen` — Spalten can add `columnsPickerOpen` state for parity (visual only, no logic change required for toggle itself).

---

## File index

| Location | Content |
|----------|---------|
| `trips-filters-bar.tsx` L178–180 | Picker open state (`payerPickerOpen`, `ktsPickerOpen`, …) |
| `trips-filters-bar.tsx` L439–485 | `renderColumnVisibilityPopover` |
| `trips-filters-bar.tsx` L561–651 | KTS filter JSX |
| `trips-filters-bar.tsx` L653–741 | Kostenträger filter JSX (best template) |
| `trips-filters-bar.tsx` L743–837 | Abrechnung filter (same pattern, wider panel) |
| `@/components/ui/popover` | Radix popover primitives |
| `@/components/ui/command` | cmdk wrapper |
