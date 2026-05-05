---
name: gross-dual-field-step2
overview: In gross mode, render dual-field UI for price inputs (gross editable + net read-only) using local state for gross display while persisting only net to row data via existing engine conversion.
todos:
  - id: step2-local-gross-state
    content: Add `grossInputs` local state + reset effect in `SortableCard`.
    status: completed
  - id: step2-dual-field-render
    content: Render dual-field gross/net UI for `unit_price`/`flat_rate`/`surcharge` in gross mode; keep net mode unchanged.
    status: completed
  - id: step2-warning-placement
    content: Ensure warning icon+tooltip renders alongside gross input in dual-field mode when tax rate missing.
    status: completed
  - id: docs-phase6-note
    content: Update `docs/angebot-formula-engine.md` with Phase 6 note about local gross state + dual-field trigger.
    status: completed
  - id: verify-build-tests
    content: Run `bun run build` and `bun test`.
    status: completed
isProject: false
---

## Goal
Update the Angebot builder Step 2 so that, in gross mode, each price input column (`unit_price`, `flat_rate`, `surcharge`) renders two side-by-side fields:
- Left: editable **gross** input (local UI state)
- Right: read-only **net** value (from `item.data[col.id]`), formatted via existing `renderComputedDisplay`

Net mode and non-price columns must render exactly as today.

## Confirmed decisions
- **Docs update is allowed**: update `docs/angebot-formula-engine.md` with a note about local gross state + dual-field render trigger.
- **onChange behavior**: `onUpdate` receives the typed **gross** number. The engine converts and writes **net** back into `item.data[col.id]`.
- **Hard rule (corrected)**: `grossInputs` is never persisted to row data directly. It exists only to keep the gross number visible in the editable field while `item.data[col.id]` stores net.

## Implementation steps

### 1) Add local gross input state in `SortableCard`
File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- Add local state:
  - `const [grossInputs, setGrossInputs] = useState<Record<string, string>>({});`
- Add effect:
  - Use a `useRef` to track the previous mode and only reset on the transition `gross → net` (avoid resetting on every render while already in net mode).
- Keep this state local to `SortableCard` and never include it in `item.data` merges (the source of truth for persisted values remains `item.data`).

### 2) Add dual-field render for gross mode price roles
File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
Inside the per-column render loop (where `layout.pdfRenderType === 'currency' || 'currency_per_km'` currently renders a single `<Input>`):
- Compute:
  - `const isGrossPriceInput = inputMode === 'gross' && (col.role === 'unit_price' || col.role === 'flat_rate' || col.role === 'surcharge');`
- When `isGrossPriceInput` is true, render the dual-field layout:
  - Left input value: `grossInputs[col.id] ?? ''`
  - On change:
    - update `grossInputs`
    - parse + guard before calling `onUpdate`:
      - Prefer matching any existing numeric-input normalization in this file.
      - Otherwise normalize German decimal commas (`',' → '.'`) and map `NaN` to `null` so mid-typing invalid values never send truncated numbers.\n
        Example:\n
        - `const parsed = raw === '' ? null : parseFloat(raw.replace(',', '.'));`\n
        - `onUpdate({ data: { [col.id]: parsed === null || isNaN(parsed) ? null : parsed } });`
  - Right field value:
    - if `item.data[col.id] != null`, show `renderComputedDisplay(col, item.data[col.id])`
    - else show a muted “Netto” placeholder
- Ensure the existing single-input render path remains **byte-for-byte identical** for:
  - `inputMode === 'net'`
  - non-price roles
  - non-currency render types
  - and, in net mode, the warning icon / tooltip behavior must not change.

### 3) Keep warning icon behavior
File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- Reuse existing `showGrossWarning` condition.
- In the gross dual-field branch, place the warning icon + tooltip **next to the gross input** (left side) when `showGrossWarning` is true.

### 4) Update docs
File: `docs/angebot-formula-engine.md`
- Under the Phase 6 section, add a note:
  - gross inputs are held in local Step 2 state to keep the gross number visible
  - row data stores net values (engine-converted)
  - trigger condition: `inputMode === 'gross' && role in {unit_price, flat_rate, surcharge}`

## Verification
- Run `bun run build`
- Run `bun test`

## Files changed
- `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- `docs/angebot-formula-engine.md`
