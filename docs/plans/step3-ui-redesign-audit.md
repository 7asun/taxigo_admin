# Step 3 UI Redesign — Audit

**Scope:** Pre-implementation audit for a collapsed/expandable row redesign of
`step-3-line-items.tsx`.  
**Date:** 2026-04-23  
**Status:** Audit reference — implementation completed 2026-04-23.

### Implementation status

The collapsible row layout (per-row Radix `Collapsible`, `Set<number>` for
`openRows`, always-on gross/Anfahrt inputs, `editingRef` + deferred blur commit,
sticky footer using `subtotal` / `taxAmount` / `total`) is implemented in
[`src/features/invoices/components/invoice-builder/step-3-line-items.tsx`](../../src/features/invoices/components/invoice-builder/step-3-line-items.tsx).
See inline comments in that file for design rationale (multi-expand vs
Accordion, `border-l-2` layout stability, controlled `open` while editing,
`ensureRowOpen` idempotence, blur snapshot).

---

## 1. Patient / Passenger Identity

### Field name and availability on `BuilderLineItem`

`BuilderLineItem.client_name: string | null`

- **Location:** `src/features/invoices/types/invoice.types.ts` line 354.
- **Set by:** `buildLineItemsFromTrips` in `invoice-line-items.api.ts` lines
  275–278: joins `trip.client.first_name` + `trip.client.last_name` with a space.
- **Shape:** plain pre-joined string — no sub-fields, no further resolution
  needed at render time.
- **Can be null:** yes, when the trip has no `client` relation.

### Upstream shape on `TripForInvoice`

`TripForInvoice.client` is an optional join:
```typescript
client?: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  price_tag: number | null;
  reference_fields?: ClientReferenceField[] | null;
} | null;
```
(`src/features/invoices/types/invoice.types.ts` lines 256–263)

The raw `trips` DB row additionally carries a denormalised `trips.client_name:
string | null` column (database.types.ts line 1176), but `buildLineItemsFromTrips`
ignores it in favour of the joined `client` relation.

**Conclusion for redesign:** use `item.client_name` directly — it is a
pre-joined, display-ready string.

---

## 2. Address Fields

### Field names on `BuilderLineItem`

| Field | Type | Notes |
|---|---|---|
| `pickup_address` | `string \| null` | Copied verbatim from `trip.pickup_address` |
| `dropoff_address` | `string \| null` | Copied verbatim from `trip.dropoff_address` |

**Location:** `invoice.types.ts` lines 355–356; set in `invoice-line-items.api.ts`
lines 302–303.

### Format

Both are **plain single-line strings** (full formatted address, e.g.
`"Hauptstraße 12, 80331 München"`). The raw `trips` table also stores structured
sub-fields (`pickup_street`, `pickup_street_number`, `pickup_zip_code`,
`pickup_city`, etc. — `database.types.ts` lines 1209–1215), but those are **not**
surfaced on `BuilderLineItem`. The formatted strings on the builder item are
ready to render without composition.

**Conclusion for redesign:** render `item.pickup_address` and
`item.dropoff_address` directly. No sub-field joining needed.

---

## 3. Date and Time Fields

### Field name on `BuilderLineItem`

`BuilderLineItem.line_date: string | null`

- **Location:** `invoice.types.ts` line 350; set from `trip.scheduled_at` in
  `invoice-line-items.api.ts` line 299.
- **Format:** full ISO timestamp string (e.g. `"2026-03-15T08:30:00+01:00"`) —
  same value as `trips.scheduled_at`.
- **No separate time field.** Time must be extracted from the same timestamp if
  needed.

### Current rendering in Step 3

`format(new Date(item.line_date), 'EEE, dd.MM.yyyy', { locale: de })`  
→ produces e.g. `"Fr, 15.03.2026"` (weekday + date, no time).

To show departure time add a second `format` call:
`format(new Date(item.line_date), 'HH:mm')` → `"08:30"`.

**Conclusion for redesign:** `item.line_date` is the one field for both date
and time. Use `date-fns/format` with the `de` locale (already imported).

---

## 4. Distance Field

### Field name on `BuilderLineItem`

`BuilderLineItem.distance_km: number | null`

- **Location:** `invoice.types.ts` line 358; set from
  `trip.driving_distance_km` in `invoice-line-items.api.ts` line 304.
- **Confirmed available** on the builder item — it is not a raw-trip-only field.
- **Can be null** when no route metrics exist for the trip (triggers
  `'missing_distance'` warning and tax-rate fallback to 7 %).

**Current rendering:** `item.distance_km.toFixed(1) + ' km'`, or `'—'` if null
(`step-3-line-items.tsx` lines 357–359).

---

## 5. Warnings

### Data shape

`BuilderLineItem.warnings: LineItemWarning[]`

`LineItemWarning` is a string union (`invoice.types.ts` lines 458–462):
```typescript
type LineItemWarning =
  | 'missing_price'
  | 'missing_distance'
  | 'zero_price'
  | 'no_invoice_trip';
```

Produced by `validateLineItem()` in `invoice-validators.ts`.

### Existing rendering pattern (inline JSX — no reusable component)

`step-3-line-items.tsx` lines 537–560. Each warning code maps to:
- `missing_price` / `no_invoice_trip` → `<AlertTriangle h-4 w-4>` in amber,
  wrapped in a shadcn `<Tooltip>` whose content calls
  `getWarningLabel(w: LineItemWarning): string`.
- all others → `<Info h-4 w-4>` in amber, same tooltip wrapper.

There is **no reusable warning badge component** — the pattern is replicated inline.
`getWarningLabel` from `invoice-validators.ts` is the only shared helper.

**Conclusion for redesign:** the tooltip + icon pattern can be extracted into a
small `<LineItemWarningIcon warning={w} />` component if the new row design
calls for it. Not mandatory for the redesign.

---

## 6. Strategy Badge

### Location

`priceResolutionBadge(item: BuilderLineItem)` is a **module-level pure
function** defined in `step-3-line-items.tsx` lines 58–121.

It is **not** a shared component — it lives only inside `step-3-line-items.tsx`.

### Inputs / outputs

- **Input:** a `BuilderLineItem` — reads `item.isManualOverride` and
  `item.price_resolution.strategy_used`.
- **Output:** `{ label: string; className: string } | null` (null only for
  `strategy_used === 'no_price'`).
- **Consumed at:** lines 363–377 (strategy badge `<TableCell>`) and implicitly
  in the Bruttopreis cell via `item.isManualOverride`.

### Strategy → label mapping

| `strategy_used` | Label | Colour |
|---|---|---|
| `isManualOverride` (any) | Manuell | amber |
| `kts_override` | KTS · 0 € | blue |
| `client_price_tag` | Kunden-Preis | green |
| `trip_price_fallback` | Fahrt-Preis | blue |
| `manual_trip_price` | Manuell | muted |
| `tiered_km` | Staffel km | violet |
| `fixed_below_threshold_then_km` | Fix + km | violet |
| `time_based` | Zeit | amber |
| `no_price` | (null — no badge) | — |
| everything else | Regel | muted |

**Conclusion for redesign:** `priceResolutionBadge` should be lifted to
a shared lib or kept at module level — no changes needed to its signature.

---

## 7. Current Edit Mode

### State shape

```typescript
// step-3-line-items.tsx lines 52–56, 161
type EditingState = {
  position: number;
  grossValue: string;   // string copy of gross amount input
  approachValue: string; // string copy of approach fee input
} | null;

const [editing, setEditing] = useState<EditingState>(null);
```

Only **one item** can be in edit mode at a time (single `editing` state, not
a `Set`). Entering edit mode on a new item automatically exits the previous one
(state is replaced).

### `onBlur` guard — exact code

```typescript
// step-3-line-items.tsx lines 163–205
const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Called on both inputs' onBlur
const handleBlur = (state: EditingState) => {
  commitTimerRef.current = setTimeout(() => {
    commitEdit(state);
  }, 0);
};

// Called on both inputs' onFocus — cancels pending commit from sibling's blur
const handleFocus = () => {
  if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
};

// Called on Escape in either input — cancels edit AND clears pending timer
const cancelEdit = () => {
  if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
  setEditing(null);
};
```

The `editing` state snapshot is passed into `handleBlur` explicitly
(`handleBlur(editing)`) rather than being read inside the closure — this
prevents a stale-closure bug where `commitEdit` would read outdated
`editing` after the Anfahrt input's `onChange` updated it.

---

## 8. Current Column Structure and Panel Width

### Column order and content

| # | Header | Content |
|---|---|---|
| 1 | `#` (`w-8`) | `item.position` |
| 2 | `Beschreibung` | `item.description` + date (`line_date`) + address pill + billing variant / KTS / no-invoice badges |
| 3 | `Strecke` | `item.distance_km` in km or `—` |
| 4 | `Strategie` | `priceResolutionBadge` |
| 5 | `Bruttopreis` (`text-right`) | Gross amount (editable) + Manuell badge + × reset |
| 6 | `Anfahrt (brutto)` (`text-right`) | `item.approach_fee_gross` (editable when col 5 is editing) |
| 7 | `MwSt` | `formatTaxRate(item.tax_rate)` — e.g. `"7 %"` |
| 8 | (empty, `w-16`) | Warning icons (tooltip per code) |

**8 columns total.**

Table footer: `colSpan={5}` for labels, `colSpan={2}` for values (spans cols 6–7),
1 empty cell for col 8.

### Container width constraint

`index.tsx` line 474:
```tsx
<div className='border-border flex h-full w-[480px] shrink-0 flex-col overflow-hidden border-r'>
```

The **left column is hard-fixed at `w-[480px]`** and does not grow.
`Step3LineItems` lives inside `BuilderSectionCard` which adds `px-6` padding
(12 px each side → `24 px`), leaving an effective content width of ~456 px.

The outer table container is `overflow-x-auto` (line 263), so horizontal
scrolling is the current fallback when all 8 columns overflow 456 px. With
narrower cells this is fine but only because the table collapses gracefully;
the admin must scroll right to see Anfahrt / MwSt in practice on 480 px.

---

## 9. Available shadcn Primitives

Full list of components in `src/components/ui/`:

```
accordion.tsx        alert.tsx           alert-dialog.tsx
aspect-ratio.tsx     avatar.tsx          badge.tsx
breadcrumb.tsx       builder-section-card.tsx
button.tsx           calendar.tsx        card.tsx
chart.tsx            checkbox.tsx        client-auto-suggest.tsx
collapsible.tsx      command.tsx         context-menu.tsx
date-time-picker.tsx dialog.tsx          drawer.tsx
dropdown-menu.tsx    form.tsx            frame.tsx
heading.tsx          hover-card.tsx      info-button.tsx
infobar.tsx          input-otp.tsx       input.tsx
label.tsx            menubar.tsx         modal.tsx
navigation-menu.tsx  pagination.tsx      popover.tsx
progress.tsx         radio-group.tsx     resizable.tsx
scroll-area.tsx      select.tsx          separator.tsx
sheet.tsx            sidebar.tsx         skeleton.tsx
slider.tsx           sonner.tsx          switch.tsx
table.tsx            tabs.tsx            textarea.tsx
toggle-group.tsx     toggle.tsx          tooltip.tsx
```

### Already used in the codebase (confirmed)

| Component | Used in |
|---|---|
| `Collapsible` / `CollapsibleTrigger` / `CollapsibleContent` | `builder-section-card.tsx`, `trips-filters-bar.tsx`, `step-4-vorlage.tsx`, `payer-group.tsx`, `app-sidebar.tsx`, `nav-main.tsx`, etc. |
| `Accordion` / `AccordionItem` / etc. | `vorlage-text-section.tsx`, `vorlage-editor-panel.tsx`, `shift-history-row.tsx` |
| `Badge`, `Button`, `Input`, `Tooltip` | Used throughout, including Step 3 today |
| `Card` | Available but not used in the invoice builder column |
| `Separator` | Available |

### Collapsible vs Accordion

Both Radix primitives are installed and wired up.

- **`Collapsible`** — per-item toggle (open/close one node independently). Used
  by `BuilderSectionCard` internally. Best fit for "one expandable row at a
  time" OR "multiple rows independently".
- **`Accordion`** — multiple items sharing a controlled/uncontrolled open state
  with optional single-open constraint (`type="single"` with `collapsible`). Used
  in PDF vorlage editor. Best fit if only one row should be expanded at a time.

---

## 10. Senior Recommendation

### Problem

The **480 px hard-fixed left column** is the binding constraint. At 480 px with
24 px padding the usable content width is ~456 px. The current 8-column
table already overflows horizontally for any invoice with standard data; the
admin must scroll right to see Anfahrt and MwSt. Adding more detail to each row
would make this worse.

The goal — a **3-column collapsed row with expandable detail** — is the right
architectural answer. It eliminates the horizontal overflow entirely and moves
secondary fields (Strecke, Strategie, Anfahrt, MwSt, Warnings) into an
expandable detail panel below each row.

### Recommended approach — Accordion of card rows

Replace the `<Table>` with a vertical list of **`Collapsible` rows** (or a
`type="single"` `Accordion`). Each collapsed row shows exactly three
horizontally-arranged pieces:

```
[ #  |  Patient name — date                  |  Bruttopreis (editable)  ]
```

Expanding a row reveals a detail panel below it with:
- Pickup → Dropoff address pill
- Distance · Strecke
- Strategy badge
- Anfahrt (brutto) (editable when editing mode active)
- MwSt
- Warnings

**Why `Collapsible` over `Accordion`:**

`Accordion type="single"` closes the previous row when you open a new one —
acceptable for browsing but problematic for price editing: if the admin opens
row A to edit the price, then opens row B to compare, row A collapses and the
edit is lost. Using individual `Collapsible` per row (each with its own `open`
state in a `Set<number>`) keeps multiple rows expanded independently and doesn't
interfere with the edit state.

**Edit mode interaction with expansion:**

When the admin clicks the Bruttopreis cell to enter edit mode, the row should
auto-expand (if not already) so the Anfahrt input is visible. Auto-expand can
be implemented by checking `editing?.position === item.position` and forcing
`open={true}` on that row's `Collapsible`.

**Collapsed row layout (3 "columns" via CSS grid or flex):**

```
grid-cols-[2rem_1fr_auto]  (# | content | price)
```

- **Col 1 (`2rem`):** position number (muted, xs)
- **Col 2 (flex 1):** `client_name` (semibold sm) + date on a second line
  (muted xs: `EEE, dd.MM.yyyy HH:mm`)
- **Col 3 (auto, text-right):** Bruttopreis clickable cell — same hover +
  Manuell badge + × reset as today. Amber `Fehlt` when null.

**Detail panel (when expanded):**

```
bg-muted/30  px-4 pb-3 pt-2 border-t  space-y-1.5
```

Row 1: `pickup → dropoff` address pill (existing truncate logic preserved)
Row 2: `distance_km km · taxRate` · strategy badge  
Row 3: `Anfahrt (brutto)` label + value/input (second editable field)  
Row 4: warning icons + labels inline (no tooltip needed — panel has room)

**Footer:**

Keep the existing Netto / MwSt / Brutto totals below the list as a sticky
`bg-muted/80 backdrop-blur-sm` bar rather than a `TableFooter`, since there
is no table anymore.

**State management — no hook changes required:**

The `editing` state, `commitTimerRef`, `onApplyGrossOverride`, and
`onResetOverride` props are unchanged. Only the render tree changes.
A new `openRows: Set<number>` local state replaces the table's implicit
always-visible rows.

**Migration path:** `step-3-line-items.tsx` is self-contained; no changes to
`index.tsx`, `use-invoice-builder.ts`, or any hook are needed. The props
interface (`onApplyGrossOverride`, `onResetOverride`) remains identical.

### Rejected alternatives

| Approach | Reason rejected |
|---|---|
| Keep `<Table>`, reduce columns | Still overflows at 480 px; can't fit patient name + address + price side-by-side |
| `Accordion type="single"` | Closes rows on sibling expand; breaks multi-edit compare |
| Dialog/Sheet for detail | Too much friction — admin needs to see the main list while editing |
| Horizontal scroll + sticky col | Already the current state; hides critical columns without edit affordance |
