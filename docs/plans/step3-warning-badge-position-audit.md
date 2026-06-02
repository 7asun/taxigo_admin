# Step 3 — Warning badge position audit

**Source file:** `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`  
(There is no `components/invoice/builder/steps/step-3-line-items.tsx` in this repo; the invoice builder step lives under `src/features/invoices/components/invoice-builder/`.)

**Scope:** Normal line-item rows inside `lineItems.map` (not the “Stornierte Fahrten” section).

---

## Implementation status

**Implemented** (layout-only; no behavior change).

| Decision | Outcome |
|----------|---------|
| Approach | **Inclusion rail** — `flex flex-col items-start gap-1.5` on the existing `row-span-2` left column; opt-out/warning strip moved directly under `<Checkbox />`. |
| `row-span-2` | Kept on the left column wrapper (no `row-span-3`, no outer grid change). |
| Column 2 wrapper | Removed redundant `div.min-w-0` around the 3-col grid; merged `min-w-0` onto `grid w-full min-w-0 grid-cols-3`. |
| Spacing | Dropped `mt-2.5` on the strip; column `gap-1.5` handles vertical spacing. |
| Collapsed presentation | Unchanged — `AlertTriangle` + tooltip (not full visible `getWarningLabel` text). |
| Expanded list (1167–1179) | Unchanged (still inside `CollapsibleContent`). |
| „Keine Rechn." collapsed | Not surfaced (still expanded-only badge). |

**Deferred (unchanged from audit):** visible warning text under checkbox, dedupe expanded warnings, „Keine Rechn." in collapsed rail.

---

## 1. Warning badge / label JSX (collapsed row)

### Primary collapsed-row block (always visible when row is collapsed)

**Lines 910–948** — rendered only when `(isOptedOut || item.warnings.length > 0)`.

```tsx
{(isOptedOut || item.warnings.length > 0) && (
  <div className='mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5'>
    {/* Opt-out: Badge + reason text */}
    {/* Warnings: AlertTriangle icon + Tooltip with getWarningLabel text */}
  </div>
)}
```

| Aspect | Detail |
|--------|--------|
| **Position in tree** | Last child inside `div.min-w-0` (controls column), **after** the inner `grid grid-cols-3` (KM / MwSt / Brutto). |
| **Parent `className`** | `mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5` |
| **Grandparent** | `div` with `className='min-w-0'` (line 653) — grid column 2, **row 2** of the outer `grid-cols-[auto_1fr]`. |

**Opt-out branch (lines 912–925):**

- `Badge` `variant='outline'` with `className='h-4 shrink-0 border-amber-400 px-1 text-[10px] text-amber-700'` — label **„Ausgeschlossen“**.
- Optional `span` with `className='truncate text-[10px] text-amber-600'` for `item.billingInclusion.reason`.

**`item.warnings` branch (lines 927–946):**

- Not a visible text badge in the collapsed row.
- `Tooltip` → `button` with `AlertTriangle` (`className='text-amber-500'`) → `TooltipContent` shows joined `getWarningLabel(w)` strings (e.g. *„Fahrt als „keine Rechnung“ markiert — bitte prüfen“*).

### Secondary block — full warning text (expanded only)

**Lines 1167–1179** — inside `<CollapsibleContent>`:

```tsx
{item.warnings.length > 0 && (
  <div className='flex flex-wrap gap-1'>
    {item.warnings.map((w) => (
      <span className='inline-flex items-center gap-1 text-[10px] text-amber-600'>
        <AlertTriangle ... />
        {getWarningLabel(w)}
      </span>
    ))}
  </div>
)}
```

Parent panel: `div` with `className='bg-muted/30 border-border space-y-2 border-t px-4 pt-2 pb-3'`.

### Related — `no_invoice_warning` (not `getWarningLabel`, expanded only)

**Lines 1028–1036** — amber `Badge` **„Keine Rechn.“** inside the same `CollapsibleContent` badge row (`billing_variant_name` / KTS / no-invoice).

---

## 2. Line-item `<Checkbox>` JSX

**Lines 584–605:**

```tsx
<div className='row-span-2 flex items-start pt-0.5'>
  <Checkbox
    checked={item.billingInclusion.included}
    aria-label={...}
    onClick={(e) => e.stopPropagation()}
    onCheckedChange={...}
  />
</div>
```

| Aspect | Detail |
|--------|--------|
| **Wrapper** | Single `div` — not a multi-child flex column today. |
| **Wrapper `className`** | `row-span-2 flex items-start pt-0.5` |
| **Outer grid** | Sibling on line 583: `div` with `className='grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 px-4 py-2.5 pr-9 transition-colors'` |

The checkbox is **column 1** (`auto`) of that 2-column grid. All main row content is **column 2** (`1fr`).

**Cancelled trips checkbox** (different pattern): lines 1281–1297 — `flex items-start gap-3`, no `row-span-2`, not part of this grid.

---

## 3. `row-span-2` — what it spans today

Yes — this is CSS Grid `grid-row: span 2` on the checkbox column cell.

The outer grid (`grid-cols-[auto_1fr]`) has **two implicit rows** driven by column-2 children:

| Grid row | Column 1 (`auto`) | Column 2 (`1fr`) |
|----------|-------------------|------------------|
| **Row 1** | Checkbox cell (starts) | Info strip: `#position`, client name, date, Maps link (lines 608–650) |
| **Row 2** | Checkbox cell (continues) | Controls: 3-column KM / MwSt / Brutto grid **+** warning/opt-out strip at bottom (lines 653–949) |

The checkbox cell is one grid item spanning **both** row tracks so the control stays top-aligned beside the full right-hand block.

### Would the badge need `row-span-3`?

**Probably not**, if the badge lives **inside** the existing `row-span-2` cell as a vertical stack (`flex flex-col`) under the checkbox. The cell already covers both rows; extra content grows within that cell and can increase row height via grid auto-sizing.

`row-span-3` would only matter if you introduced a **third** explicit grid row in column 2 (e.g. splitting info / controls / warnings into three rows) and wanted the left column to span all three. That is a larger layout change than stacking inside the current left cell.

---

## 4. Alignment classes affecting vertical stack

On the **outer row grid** (line 583):

- `items-start` — grid items align to the start of their row area (top), not vertically centered.

On the **checkbox wrapper** (line 584):

- `flex items-start pt-0.5` — flex children (only the checkbox today) align to the top with slight padding.

On the **warning strip** (line 911):

- `items-center` on the flex row (icon/badge horizontal group), not on the outer grid.

On the **inner 3-column controls grid** (line 654):

- `items-start`.

**Implication:** A `flex flex-col items-start gap-1` (or `gap-1.5`) wrapper in the left column should align checkbox + badge to the top-left consistently with current behavior. No conflicting `items-center` on the left column today.

---

## 5. Nesting relative to `<Collapsible>` and `grid-cols-[auto,1fr]`

Note: Tailwind uses `grid-cols-[auto_1fr]` (underscore), not a comma.

```
Collapsible                          (566)
└── div.relative.border-l-2...       (571)  — row chrome / opacity / missing-price bg
    ├── div.grid.grid-cols-[auto_1fr] (583)  — collapsed row body
    │   ├── div.row-span-2            (584)  ← Checkbox ONLY
    │   ├── div (row 1, col 2)        (608)  — # / client / date
    │   └── div.min-w-0 (row 2, col 2) (653)
    │       ├── div.grid.grid-cols-3  (654)  — KM / MwSt / Brutto
    │       └── div.mt-2.5...         (910)  ← Warning / opt-out strip  ★
    ├── CollapsibleTrigger (chevron)  (952)
    └── CollapsibleContent            (970)
        └── expanded detail + full getWarningLabel list (1167)
```

**Depth from `Collapsible` root:** warning strip is **3 levels down** (`Collapsible` → border wrapper → grid → `min-w-0` → warning `div`).

The warning area **is inside** the `grid grid-cols-[auto_1fr]` container but in **column 2**, not column 1. It is **not** outside the grid.

---

## 6. Inside or outside `<CollapsibleContent>`?

| UI | CollapsibleContent? | Always visible when row collapsed? |
|----|---------------------|-----------------------------------|
| Opt-out badge + reason, warning **icon** + tooltip (lines 910–948) | **Outside** — sibling above trigger | **Yes** (part of collapsed grid) |
| Full `getWarningLabel` text rows (1167–1179) | **Inside** | **No** — only when expanded |
| „Keine Rechn.“ badge (1028–1036) | **Inside** | **No** — only when expanded |

**Goal alignment:** Moving the collapsed strip (910–948) under the checkbox keeps warnings **outside** `CollapsibleContent`, so they remain visible when the row is collapsed. Any relocation of the **expanded-only** block (1167–1179) would be a separate product decision (duplicate vs remove vs keep as detail).

---

## 7. Smallest DOM change to place badge under checkbox

### Recommended minimal move (collapsed warnings)

1. **Extend the checkbox wrapper** (line 584) from a single-child flex row to a column stack, e.g.  
   `row-span-2 flex flex-col items-start gap-1.5 pt-0.5` (keep `row-span-2`).
2. **Move** the block at lines 910–948 from inside `div.min-w-0` to **below** `<Checkbox />` inside that left column wrapper.
3. **Adjust styling** when moved:
   - Drop or reduce `mt-2.5` (was separating warnings from the 3-col grid below); use `gap-*` on the column instead.
   - Consider `max-w-[...]` or `w-full` on the badge row so long `getWarningLabel` text wraps in the narrow `auto` column instead of widening the row.
4. **Optional UX improvement** (slightly more than “position only”): render warning text as a small amber `Badge` or truncated `span` under the checkbox, not only `AlertTriangle` + tooltip — so *„keine Rechnung“* is visible without hover (matches user expectation of a “badge below checkbox”).

### What to avoid unless necessary

- **`row-span-3`** — only if column 2 is split into three grid rows and the left rail must span all three.
- **Changing `grid-cols-[auto_1fr]`** — not required for a simple under-checkbox stack.
- **Moving into `CollapsibleContent`** — would hide warnings when collapsed (contradicts goal).

### Opt-out + warnings together

Both branches already share the same container (910–948). Moving that entire `div` preserves opt-out **„Ausgeschlossen“** placement next to warnings under the checkbox.

### Expanded section (1167–1179)

Leave as-is initially to avoid duplicate labels, **or** remove from `CollapsibleContent` after collapsed row shows full text — avoids repetition when expanded.

---

## Senior recommendation

**Cleanest approach:** Treat the left column as a fixed **“inclusion rail”**: one `flex flex-col items-start gap-1.5` inside the existing `row-span-2` cell containing (1) inclusion `Checkbox`, (2) the conditional strip now at 910–948 (opt-out badge + warnings).

**Why this is best:**

- Smallest diff: one cut/paste + wrapper class tweak; no grid dimension surgery.
- Preserves **always-visible** warnings (stays outside `CollapsibleContent`).
- Matches mental model: inclusion control + its consequences (excluded / advisory warnings) live in one vertical stack.
- `row-span-2` stays correct; the rail still spans the info + controls rows while content stacks internally.

**Follow-ups to decide in implementation (not blocking layout):**

1. **Collapsed warning presentation** — icon-only tooltip vs compact text badge under checkbox (product/readability).
2. **Deduplication** — if collapsed row shows full `getWarningLabel` text, drop or shorten the expanded list at 1167–1179.
3. **`no_invoice_warning`** — today „Keine Rechn.“ only appears when expanded; if *„keine Rechnung“* must always show under checkbox, surface `no_invoice_trip` (or the existing Badge) in the left rail, not only inside expanded badges.

**Do not** rely on `row-span-3` unless you deliberately add a third grid row on the right for layout reasons; stacking inside the current left cell is the idiomatic fix.

---

## Reference line map

| Lines | Element |
|-------|---------|
| 566–570 | `<Collapsible>` per row |
| 583 | Outer `grid grid-cols-[auto_1fr] items-start ...` |
| 584–605 | Checkbox column (`row-span-2`) |
| 608–650 | Row 1 right — metadata |
| 653–949 | Row 2 right — controls + warning strip |
| 910–948 | **Target strip to relocate** (collapsed, always visible) |
| 952–968 | Chevron `CollapsibleTrigger` |
| 970–1181 | `CollapsibleContent` (expanded-only warning text + „Keine Rechn.“) |
| 68, 80–90 | `getWarningLabel` in `invoice-validators.ts` |
