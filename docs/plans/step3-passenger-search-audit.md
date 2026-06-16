# Step 3 — Passenger Search + Opt-Out Layout Audit

**Date:** 2026-06-16  
**Scope:** Read-only audit of `step-3-line-items.tsx` for adding passenger-name search and fixing opt-out row layout. No code changes in this pass.

**Source file:** `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`  
(There is no `components/invoice/builder/steps/step-3-line-items.tsx` in this repo.)

**Related:** [`step3-warning-badge-position-audit.md`](step3-warning-badge-position-audit.md) (inclusion rail / opt-out badge placement — already implemented).

**Note:** The audit prompt was truncated mid-Q3 in the originating request. Q3 is answered from the current file; §4–§6 cover inferred implementation questions consistent with the audit title.

---

## 1. Files read

| # | File | Status |
|---|------|--------|
| 1 | `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` | Read in full (1635 lines) |
| 2 | `src/components/ui/input.tsx` | Read in full |
| 3 | `src/components/ui/badge.tsx` | Read in full |
| 4 | Search / filter widgets (see §1.1) | Searched codebase |
| 5 | `src/features/invoices/types/invoice.types.ts` | Read `BuilderLineItem`, `BillingInclusionState`, related types |
| — | `src/features/invoices/hooks/use-invoice-builder.ts` | Read relevant sections (lineItems ownership, totals) |
| — | `src/features/invoices/components/invoice-builder/index.tsx` | Read `section3SummaryText`, `confirmationRows`, `Step3LineItems` wiring |
| — | `src/features/invoices/api/invoice-line-items.api.ts` | Read `buildLineItemsFromTrips` client-name snapshot logic |
| — | `src/features/invoices/api/__tests__/build-line-items-from-trips-client-name.test.ts` | Read tests for normalization |

### 1.1 Search / filter widget inventory

**Symbols searched:** `SearchInput`, `SearchBar`, `FilterBar`, `useSearch`, `useFilter`

| Export | Path | Relevance to Step 3 |
|--------|------|---------------------|
| `SearchInput` (default export) | `src/components/search-input.tsx` | **Not applicable** — kbar command-palette toggle button, not a text filter |
| `TourenSearchBar` | `src/features/driver-portal/components/touren/touren-search-bar.tsx` | **Closest match** — debounced controlled `Input` with search icon + clear button |
| `TourenFilterBar` | `src/features/driver-portal/components/touren/touren-filter-bar.tsx` | Status chips + date picker (driver portal) |
| `UnassignedTripsFilterBar` | `src/features/unassigned-trips/components/filter-bar.tsx` | Payer + date filters with `Badge` count |
| `useSearchParams` | Next.js navigation (many feature files) | URL query state — **not** used in invoice builder |
| `useFilteredNavItems` | `src/hooks/use-nav.ts` | Nav RBAC only — unrelated |
| `useSearch` / `useFilter` hooks | **None found** | — |

**`components/ui/`:** Only `search-input.tsx` is not under `ui/`; no file under `components/ui/` contains “search” in the filename.

**`components/shared/`:** Does not exist at repo root. The only `shared` path is `src/features/driver-portal/components/shared/driver-trip-card.tsx` — unrelated.

**Conclusion:** There is **no** reusable invoice-builder or admin-table passenger search primitive. The best prior art for a Step 3 name filter is **`TourenSearchBar`** (controlled value, debounced `onChange`, icon + clear). Feature-specific filter bars (`trips-filters-bar.tsx`, `kts-filters-bar.tsx`) use URL `useSearchParams` — a different pattern than the invoice builder’s React-state wizard.

### 1.2 `Input` primitive (`components/ui/input.tsx`)

- Single component; **no `variant` prop** — styling is via `className` merge through `cn()`.
- Default classes: `h-9`, `w-full`, `min-w-0`, `rounded-md`, `border`, `px-3`, `text-base md:text-sm`, focus ring, `disabled:opacity-50 disabled:pointer-events-none`.
- Step 3 already overrides height to `h-8` / `h-7` on row inputs.

### 1.3 `Badge` primitive (`components/ui/badge.tsx`)

- **Variants:** `default`, `secondary`, `destructive`, `outline` (via `cva`).
- **No `size` variant** — size is ad hoc via `className` (Step 3 uses `h-4`, `text-[10px]`, `px-1` throughout).
- A result-count badge (e.g. “12 / 48”) would use `variant='secondary'` or `outline` + custom `className`, same as existing Step 3 badges.

### 1.4 `BuilderLineItem` name + inclusion fields (`invoice.types.ts`)

**Passenger / client name on `BuilderLineItem`:**

```ts
client_name: string | null;  // line 558 — NOT clientname, firstname, or lastname
```

- **No** `firstname` / `lastname` / `clientname` on `BuilderLineItem`.
- Separate `first_name` / `last_name` exist only on joined trip shapes (`TripForInvoice.client`, `CancelledTripRow.client`), not on the builder line item passed to Step 3.
- `client_name` is a **single pre-joined display string** snapshotted at build time.

**`billingInclusion` on `BuilderLineItem`:**

```ts
billingInclusion: BillingInclusionState;  // required on BuilderLineItem
```

`BillingInclusionState` (lines 41–44):

```ts
export type BillingInclusionState = {
  included: boolean;
  reason: string;
};
```

**`exclusionInherited`** is **not** on `billingInclusion`. It is a **sibling optional field** on `BuilderLineItem` (lines 685–693):

```ts
exclusionInherited?: boolean;  // builder-only; branch-draft hydration
```

Step 3 reads:

- `item.billingInclusion.included`
- `item.billingInclusion.reason`
- `item.exclusionInherited` (top-level, for badge label only)

---

## 2. Q1 — Search state ownership

**Answer: Option A — local `useState` inside `Step3LineItems`.**

Evidence:

1. **`lineItems` is the full unfiltered set.**  
   `useInvoiceBuilder` holds `lineItems` in `useState` and passes it unchanged to Step 3 (`index.tsx` L702–703). No upstream search/filter prop exists on `Step3LineItemsProps`.

2. **Trip fetch filtering is Step 2 only** (payer, date range, billing type/variant, client mode). After fetch, all normal trips become `lineItems`; opted-out rows remain in the array (never spliced — see `BuilderLineItem.billingInclusion` comment L677–681).

3. **Counts elsewhere do not need live search query today.**  
   - Step 3 intro: `{lineItems.length} Fahrten gefunden` (L461–465) — total fetched rows.  
   - Section 3 collapsed summary (`index.tsx` L483–487): `confirmationRows.length` — **billable** rows (excludes opted-out normal + unpriced cancelled), unrelated to name search.  
   - `tripsCount: lineItems.length` is returned from `useInvoiceBuilder` (L1231) but **not consumed** anywhere in the builder UI.

4. **Existing Step 3 UI state is already local** (`editing`, `kmEditing`, `openRows`, `optOutDialog`, etc.) — search fits the same pattern.

**When Option B would be needed:** Only if a **parent** surface must show the filtered count while Step 3 is collapsed (e.g. section header “3 / 48 Positionen (gefiltert)”). That is not implemented today. If product wants the **section card summary** to reflect an active name filter, lift query + `filteredLineItems` to `index.tsx` or the hook; otherwise keep search purely presentational inside Step 3.

**Search must not mutate `lineItems`.** Filtering is a view-layer `useMemo` over `lineItems`; totals, inclusion handlers, and save paths must continue to operate on the full array.

---

## 3. Q2 — Client name fields on `BuilderLineItem`

The prompt references `item.clientname`; the actual field is **`item.client_name`** (snake_case). Usages in Step 3: L661 (row header), L1573 (opt-out dialog).

### 3.1 Single string vs separate first/last

| Layer | Shape |
|-------|--------|
| `BuilderLineItem` (Step 3 prop) | `client_name: string \| null` only |
| `TripForInvoice` at fetch | `client?: { first_name, last_name }` **or** `client_name?: string \| null` on trip row |
| `buildLineItemsFromTrips` | Joins Stammdaten: `[first_name, last_name].filter(Boolean).join(' ')`; else `trip.client_name?.trim() \|\| null` |

There are **no** separate first/last fields on the object Step 3 receives.

### 3.2 Null / empty behaviour

- Type: `string | null` (not `undefined` on a built item, but display uses `?? '—'`).
- **Stammdaten path:** If both `first_name` and `last_name` are null/empty, `.filter(Boolean).join(' ')` yields `''` — in practice tests expect a non-empty join when at least one name part exists; an all-empty Stammdaten client would produce an empty string (not explicitly tested).
- **Trip-only path:** Whitespace-only `trips.client_name` is trimmed to **`null`** (`build-line-items-from-trips-client-name.test.ts` L74–82).
- Step 3 does **not** re-trim at render; it shows `item.client_name ?? '—'`.

### 3.3 Normalisation before Step 3

| Step | Normalisation |
|------|----------------|
| `buildLineItemsFromTrips` | Join + `.filter(Boolean)` for Stammdaten; `.trim()` on trip `client_name`; whitespace-only → `null` |
| Edit-mode hydration (`map-line-item-row-to-builder-line-item.ts`) | Copies persisted `row.client_name` as-is — **no** re-trim |
| Step 3 component | **None** (no trim, no lowercasing) |

**Implication for search:** Match against `item.client_name` as stored. For case-insensitive substring search, normalise in the filter (`toLocaleLowerCase('de-DE')` or `toLowerCase()` on both sides). Do not assume separate first/last tokens unless search is split-word over the joined string.

---

## 4. Q3 — Opt-out layout: column 1 DOM when `isOptedOut === true`

`isOptedOut` is `!item.billingInclusion.included` (L563).

**Important:** Opt-out chrome (badge + reason) lives in the **inclusion rail** (grid column 1 of `grid-cols-[auto_1fr]`, L587–653), **not** inside the 3-column controls grid. The “first column” of `grid grid-cols-3` (L701) is always the **KM / distance** column.

`isOptedOut` does **not** change which nodes are rendered in that KM column — it only sets `disabled={isOptedOut}` on the KM `Input` (L713). Tax `Select` (L810) and gross `Input` (L878) are also disabled. Row wrapper gets `opacity-60` (L577). Reset buttons (`onResetKmOverride`, etc.) are **not** gated by `isOptedOut`.

### 4.1 Column 1 wrapper (always)

```tsx
<div className='flex min-w-0 flex-col gap-1'>   {/* L703 */}
```

### 4.2 Branch A — `item.manual_km_enabled === true`

```tsx
<div className='flex items-center gap-1'>          {/* L705 */}
  <Input
    type='text'
    inputMode='decimal'
    aria-label='Manuelle Distanz in km'
    className='h-8 w-full text-right text-xs tabular-nums'
    disabled={isOptedOut}                          {/* true when opted out */}
    …
  />
  <span className='text-muted-foreground shrink-0 text-[10px]'>km</span>
</div>
```

**If additionally `item.isManualKmOverride`:**

```tsx
<div className='flex items-center gap-1'>          {/* L765 */}
  <Badge variant='outline' className='h-4 border-amber-400 px-1 text-[10px] text-amber-600'>
    KM manuell {original_distance_km formatted}
  </Badge>
  <Button type='button' variant='ghost' size='icon' className='h-6 w-6' …>
    <X />
  </Button>
</div>
```

### 4.3 Branch B — `item.manual_km_enabled === false`

```tsx
<span className='text-muted-foreground text-sm whitespace-nowrap tabular-nums'>
  {original_distance_km ?? distance_km formatted, or '—'}
</span>
```

### 4.4 Full row context when opted out (for layout debugging)

```
Collapsible
└── div.relative.opacity-60.border-l-2…
    ├── div.grid.grid-cols-[auto_1fr].items-start…
    │   ├── div.row-span-2.flex.flex-col…          ← inclusion rail
    │   │   ├── Checkbox (unchecked)
    │   │   └── div.flex.flex-wrap…                ← when isOptedOut || warnings
    │   │       └── div.flex.max-w-full…
    │   │           ├── Badge "Ausgeschlossen" | "Ausgeschlossen (Ursprungsrechnung)"
    │   │           └── span.truncate (reason, if any)
    │   ├── div (row 1) — #position, client_name, date, Maps
    │   └── div.grid.w-full.min-w-0.grid-cols-3    ← controls grid
    │       ├── [Column 1 — KM per §4.2/4.3]
    │       ├── [Column 2 — tax Select, disabled]
    │       └── [Column 3 — gross Input, disabled]
    ├── CollapsibleTrigger (chevron)
    └── CollapsibleContent (expanded detail; Anfahrt input NOT disabled by isOptedOut)
```

### 4.5 Likely “distortion” sources (from structure, not visual QA)

| Factor | Effect |
|--------|--------|
| Inclusion rail `Badge` + `truncate` reason in narrow `auto` column | Can increase **left column width** and row height when opted out |
| `isManualKmOverride` sub-row in column 1 | Badge + icon button below KM control — **tallest column** in the 3-col grid when override active |
| `grid-cols-3` with `items-start` | Columns do not equalise height; KM column with badge stack can make row 2 visually uneven vs tax/gross |
| `opacity-60` on entire row | Disabled inputs still occupy full grid space — no DOM removal |

**Cannot determine from files alone** which pixel-level distortion the user sees; no screenshot or bug report was provided. Structural fix candidates are documented in §6.

---

## 5. Passenger search — implementation notes (inferred)

### 5.1 Suggested placement

Above the scrollable list, inside the `lineItems.length > 0` block (before L503 `rounded-md border`), or between the alert stack (L468–501) and the list:

```
[optional alerts]
[search Input + result badge]     ← new
[scrollable line item list]
[totals footer]
```

Reuse **`TourenSearchBar`** pattern (debounced local input) or inline the same markup with placeholder e.g. `Fahrgast suchen…`.

### 5.2 Filter logic (minimal)

```ts
const filtered = useMemo(() => {
  const q = query.trim().toLocaleLowerCase('de-DE');
  if (!q) return lineItems;
  return lineItems.filter((item) =>
    (item.client_name ?? '').toLocaleLowerCase('de-DE').includes(q)
  );
}, [lineItems, query]);
```

- Map over `filtered` in the list; keep `lineItems` for counts that mean “all fetched trips”.
- Show badge: `filtered.length` / `lineItems.length` when `query` non-empty.
- **Do not** filter `cancelledTrips` unless product explicitly asks — cancelled section uses separate `trip.client` / `trip.client_name` assembly (L1275–1279).

### 5.3 Copy alignment

| String | Current meaning | After search |
|--------|-----------------|--------------|
| `{lineItems.length} Fahrten gefunden` (L463) | All fetched trips | Consider `filtered.length` when filter active, or split “X von Y” |
| Section 3 summary (`confirmationRows`) | Billable positions | Unchanged — search is view-only |

### 5.4 Empty filter state

When `filtered.length === 0` but `lineItems.length > 0`, show empty state inside the list (“Keine Fahrten für ‚…‘”) — do not disable “Weiter zu PDF-Vorlage” solely because the filter hides all rows (button already keys off full `lineItems.length === 0` at L1233).

---

## 6. Opt-out layout — fix candidates (inferred)

Prior audit [`step3-warning-badge-position-audit.md`](step3-warning-badge-position-audit.md) already moved opt-out/warning strip under the checkbox in the inclusion rail (implemented in current file L587–653).

Remaining structural options if column 1 still looks distorted when opted out:

1. **Constrain inclusion rail width** — e.g. `max-w-[7rem]` on badge/reason stack so `auto` column does not expand into controls.
2. **Hide or collapse KM override badge row when opted out** — reduces column 1 height; product decision (override still in state).
3. **Disable reset buttons when `isOptedOut`** — consistent with disabled inputs; prevents interaction without fixing layout.
4. **`items-stretch` + min-height** on `grid-cols-3` — cosmetic alignment only.

---

## 7. Reference line map (current file)

| Lines | Element |
|-------|---------|
| 174–216 | `Step3LineItemsProps` — no search props |
| 461–465 | Trip count intro (`lineItems.length`) |
| 503–1195 | Bordered list + totals footer |
| 563 | `isOptedOut` |
| 571–581 | Row chrome (`opacity-60`, left border) |
| 583 | Outer `grid grid-cols-[auto_1fr]` |
| 587–653 | Inclusion rail (checkbox + opt-out badge) |
| 656–698 | Row 1 metadata (`client_name`) |
| 701–951 | `grid grid-cols-3` — KM / MwSt / Brutto |
| 703–797 | **Column 1 — KM** |
| 1253–1547 | Stornierte Fahrten (separate layout) |
| 1549–1630 | Opt-out dialog |

---

## 8. Summary verdict

| Question | Verdict |
|----------|---------|
| **Q1** | **Option A** — local search state in `Step3LineItems`; `lineItems` is full unfiltered upstream |
| **Q2** | **`client_name`** is one nullable string; no first/last on `BuilderLineItem`; trim at build time only (not in Step 3) |
| **Q3** | Column 1 when opted out = same KM DOM as opted-in, with `Input`/`Select`/gross `disabled`; opt-out badge is in inclusion rail, not column 1 |
| **Search widget** | No shared admin search component; copy **`TourenSearchBar`** pattern |
| **Badge for count** | Use existing `Badge` + `className` sizing (`h-4`, `text-[10px]`) — no size API |
