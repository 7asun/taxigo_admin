# Micro-audit — `AnsichtenSheet` structure (read-only)

**Scope:** `src/features/trips/components/ansichten-sheet.tsx`, column metadata order from `src/features/trips/components/trips-tables/columns.tsx`.  
**Date:** 2026-05-14

---

## 1. Preset row JSX structure (exact markup today)

Each preset is one `<li>` inside `<ul className='space-y-2 pb-4'>`. Two variants:

### A. Delete confirmation (`confirmDeleteId === p.id`)

```tsx
<li className='border-border flex flex-col gap-2 rounded-md border p-2' key={...}>
  <div className='space-y-2'>
    <p className='text-sm'>Wirklich löschen?</p>
    <div className='flex justify-end gap-2'>
      <Button variant='ghost' size='sm' className='h-7 text-xs'>Abbrechen</Button>
      <Button variant='destructive' size='sm' className='h-7 text-xs'>Löschen</Button>
    </div>
  </div>
</li>
```

### B. Normal row (default)

```tsx
<li className='border-border flex flex-col gap-2 rounded-md border p-2' key={...}>
  <>
    <div className='flex items-center gap-2'>
      {/* Reorder */}
      <div className='text-muted-foreground flex shrink-0 flex-col gap-0.5'>
        <Button variant='ghost' size='icon' className='size-6' aria-label='Nach oben'>…ChevronUp</Button>
        <Button variant='ghost' size='icon' className='size-6' aria-label='Nach unten'>…ChevronDown</Button>
      </div>
      {/* Name: edit vs display */}
      <div className='min-w-0 flex-1'>
        {editingId === p.id ? (
          <Input value={draftName} maxLength={60} className='h-8 text-xs' autoFocus … />
        ) : (
          <button type='button' className='hover:text-foreground text-muted-foreground w-full truncate text-left text-sm font-medium' …>
            {p.name}
          </button>
        )}
      </div>
      {/* Actions */}
      <div className='flex shrink-0 items-center gap-1'>
        <Button variant='outline' size='sm' className='h-7 px-2 text-xs'>Übernehmen</Button>
        <Button variant='ghost' size='sm' className='text-muted-foreground h-7 px-2 text-xs' title='…'>Überschreiben</Button>
        <Button variant='ghost' size='icon' className='size-7' aria-label='Umbenennen'><Pencil /></Button>
        <Button variant='ghost' size='icon' className='text-destructive size-7' aria-label='Löschen'><Trash2 /></Button>
      </div>
    </div>
  </>
</li>
```

**Summary:** One horizontal band per row: **move up/down** | **name (input or clickable text)** | **Übernehmen, Überschreiben, pencil rename, trash**. No secondary panel, no column editor in this file yet.

---

## 2. Expand/collapse / accordion

- **No** `Collapsible`, `Accordion`, or Radix disclosure primitives are imported or used.
- **ChevronDown / ChevronUp** are only used as **reorder** controls (`aria-label='Nach oben'`, `'Nach unten'`), not as expand/collapse affordances.
- Delete flow uses **inline replacement** of the row body (confirm copy + buttons), not an accordion.

---

## 3. Padding / spacing — structure and where “unclean” shows up

### `SheetContent` (this sheet)

```tsx
<SheetContent side='right' className='flex w-full max-w-md flex-col sm:max-w-md'>
```

**Merged with shadcn defaults** (`src/components/ui/sheet.tsx`): base includes `flex flex-col gap-4`, `h-full`, `w-3/4`, `border-l`, and **`sm:max-w-sm` on the `right` side — overridden here by `sm:max-w-md` via `cn` merge.** So width is intentionally wider than the default sheet.

The default `SheetContent` **does not** apply horizontal padding to the whole panel; **only** `gap-4` between flex children.

### `SheetHeader`

Uses default: `className='flex flex-col gap-1.5 p-4'` (from `sheet.tsx`). Title + description are **inset by `p-4`**.

### Main body wrapper (below header)

```tsx
<div className='flex min-h-0 flex-1 flex-col pt-2'>
```

- Adds **`pt-2` only** — no `px-*`, so horizontal alignment does **not** match the header’s `p-4` gutter unless something else adds it (nothing does here).

### List scroll region

```tsx
<ScrollArea className='min-h-0 flex-1 pr-3'>
  <ul className='space-y-2 pb-4'>
```

- **`pr-3`**: reserves space for the scrollbar / end padding on the right.
- **No `pl-*` symmetry** with header; list content can sit flush to the sheet’s left inner edge while the title/description are indented — **visual misalignment** between header block and rows.

### Each row (`<li>`)

```tsx
className='border-border flex flex-col gap-2 rounded-md border p-2'
```

**Why it can feel “busy” / uneven:**

| Layer | Classes | Note |
|--------|---------|------|
| SheetContent | `gap-4` (default) + custom width | Vertical gap between header and body wrapper |
| Body wrapper | `pt-2` only | Small top nudge; no horizontal rhythm with `SheetHeader` |
| ScrollArea | `pr-3` | Asymmetric vs no left padding on scroll viewport |
| `<ul>` | `space-y-2`, `pb-4` | Vertical stacking + bottom padding inside scroll |
| `<li>` | `border`, `p-2`, `gap-2`, `rounded-md` | Tight card-in-card; all controls in one dense row |

**“Unclean” in one line:** header uses **`p-4`**, body uses **`pt-2`** + **`ScrollArea pr-3`** only, so **horizontal padding is inconsistent**; rows add their own **`p-2`** inside an unpadded scroll lane.

---

## 4. Column `id`s + `meta.label` (order in `columns.tsx`)

Order follows the **`columns` array** definition.  
**`meta.label` is omitted** for some defs (noted below). For an editor, you may fall back to `DataTableColumnHeader` `title` where present.

| # | `id` | `meta.label` (or note) |
|---|------|-------------------------|
| 1 | `select` | *(no `meta`)* |
| 2 | `scheduled_at` | `Datum` |
| 3 | `time` | `Zeit` |
| 4 | `name` | `Fahrgast` |
| 5 | `pickup_address` | `Abholung` |
| 6 | `dropoff_address` | `Ziel` |
| 7 | `driver_id` | `Fahrer` |
| 8 | `status` | `Status` |
| 9 | `gross_price` | *(no `meta` — header title `Brutto`)* |
| 10 | `invoice_status` | `Rechnungsstatus` |
| 11 | `payer_name` | `Kostenträger` |
| 12 | `fremdfirma` | `Fremdfirma` |
| 13 | `fremdfirma_abrechnung` | `Abrechnung Fremdfirma` |
| 14 | `billing_type` | *(no `meta` — header title `Abrechnung`)* |
| 15 | `billing_calling_station` | `Anrufstation` |
| 16 | `billing_betreuer` | `Betreuer` |
| 17 | `kts_document_applies` | `KTS` |
| 18 | `kts_fehler` | `KTS-Fehler` |
| 19 | `kts_fehler_beschreibung` | `KTS-Fehler (Text)` |
| 20 | `reha_schein` | `Reha-Schein` |
| 21 | `net_price` | *(no `meta` — header title `Netto`)* |
| 22 | `tax_rate` | *(no `meta` — header title `MwSt.`)* |
| 23 | `actions` | *(no `meta`)* |

**Editor source-of-truth note:** visibility/order presets already persist `column_order` / `column_visibility` by **`id`**. Display strings for UI should prefer `meta.label` when set; for gaps above, use header `title` or hard-coded map aligned with this table.
