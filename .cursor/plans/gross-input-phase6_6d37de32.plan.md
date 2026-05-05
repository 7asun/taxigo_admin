---
name: gross-input-phase6
overview: Add quote-level Netto/Brutto input mode to Angebote, persisting to DB and wiring a builder toggle that changes how the formula engine interprets existing input columns in gross mode without changing editability.
todos:
  - id: migration-input-mode
    content: Add migration for `angebote.input_mode` with CHECK constraint.
    status: completed
  - id: types-payloads
    content: Add `input_mode` to AngebotRow and camelCase `inputMode` to create/update payloads.
    status: completed
  - id: api-mapping
    content: Map `input_mode` in read/create/update paths, following `show_totals_block` patterns.
    status: completed
  - id: engine-gross-conversion
    content: Export `InputMode` and extend `computeRow` with gross-mode pre-conversion of price inputs before existing net-first chain.
    status: completed
  - id: engine-tests
    content: Add gross-mode test cases and regression guards.
    status: completed
  - id: hook-input-mode-state
    content: Add `inputMode` state to `useAngebotBuilder` with dirty guard and payload wiring.
    status: completed
  - id: builder-wiring
    content: Wire `inputMode` through builder, pass to `computeRow` and Step 2.
    status: completed
  - id: step2-toggle-warnings
    content: Add Step 2 toggle and warning icon+tooltip on `unit_price`/`flat_rate`/`surcharge` when gross mode lacks usable tax_rate.
    status: completed
  - id: docs-update
    content: Update `docs/angebot-formula-engine.md` and append Phase 6 completion to `docs/plans/formula-engine-audit.md`.
    status: completed
  - id: verify
    content: Run `bun run build` and `bun test` at the specified gates.
    status: completed
isProject: false
---

## Scope
Implement a quote-level `input_mode` stored on `angebote` (default `net`) and a Step 2 toggle to switch between **Netto-Eingabe** and **Brutto-Eingabe**. In gross mode, dispatchers still type into the same input columns; the engine pre-converts price inputs to net-equivalents using the row’s `tax_rate` before running the existing net-first computation chain.

## Key decisions locked (from your clarifications)
- `gross_amount` **stays computed/read-only** in both modes; `isComputedColumn()` remains unchanged.
- Gross mode does **not** read from `v.gross_amount` (dispatcher never types into `gross_amount`).
- `tax_rate = 0` is valid; conversion/back-calc proceeds without warning.
- Warning icon shows on **input price columns** (`unit_price`, `flat_rate`, `surcharge`) when `inputMode==='gross'` and the row has **no usable tax rate**.

## Data model + migration
- Add `angebote.input_mode` with DB-level CHECK constraint.
  - New migration: `supabase/migrations/<timestamp>_angebot_input_mode.sql`
  - SQL shape:
    - `ADD COLUMN input_mode text NOT NULL DEFAULT 'net'`
    - `ADD CONSTRAINT angebote_input_mode_check CHECK (input_mode IN ('net','gross'))`

## TypeScript types
- Update `src/features/angebote/types/angebot.types.ts`:
  - `AngebotRow`: add `input_mode: 'net' | 'gross'`.
  - `CreateAngebotPayload`: add `inputMode: 'net' | 'gross'`.
  - `UpdateAngebotPayload`: add `inputMode?: 'net' | 'gross'` (camelCase UI-only, like `showTotalsBlock`).

## API mapping (follow `show_totals_block` pattern)
- Update `src/features/angebote/api/angebote.api.ts`:
  - `mapAngebotHeaderFromDb`: map `input_mode` defensively:
    - `input_mode: (raw.input_mode === 'gross' ? 'gross' : 'net') as 'net' | 'gross'`
  - `createAngebot`: include `input_mode: payload.inputMode ?? 'net'` in `.insert({...})`.
  - `updateAngebot`: destructure `inputMode` out of payload and conditionally spread:
    - `...(inputMode !== undefined && { input_mode: inputMode })`
  - Do **not** touch `updateDraftAngebotSchema`.

## Engine changes (gross mode = pre-convert price inputs)
- Update `src/features/angebote/lib/angebot-formula-engine.ts`:
  - Export `InputMode = 'net' | 'gross'` near the top.
  - Extend `computeRow` signature:
    - `computeRow(row, columns, inputMode: InputMode = 'net')`
  - Keep the existing net-first path identical.
  - Implement gross mode by:
    - `const v = resolveRoleValues(row, columns)`
    - If `inputMode === 'gross'` and `v.tax_rate` is finite and `>= 0`:
      - `divisor = 1 + taxRate/100`
      - Convert only price roles (if non-null):
        - `v.unit_price /= divisor`
        - `v.flat_rate /= divisor`
        - `v.surcharge /= divisor`
      - Do **not** convert `distance_km` or `quantity`.
      - **Implementation note**: do not mutate `v` in place; assign to a new object, e.g. `const convertedV = { ...v }`, and overwrite converted keys on `convertedV` before passing into `computeNetAmount(convertedV)`.
    - Then run the same chain as today:
      - `netAmount = computeNetAmount(v)`
      - compute `tax_amount` and `gross_amount` exactly as current implementation.
  - When `inputMode === 'gross'` but tax rate is missing/unusable:
    - Skip conversion; computation proceeds with unconverted values (warning is UI concern on price inputs).

## Engine tests
- Update `src/features/angebote/lib/angebot-formula-engine.test.ts`:
  - Add a new describe block `computeRow — gross input mode` that asserts:
    - With `tax_rate=19` and inputs representing gross prices, outputs match expected net/tax/gross.
    - With `tax_rate=7` same.
    - With `tax_rate=0`, conversion is divisor=1 and outputs equal net-mode results, including an explicit assertion that `gross_amount === net_amount` (i.e. tax is 0).
    - With missing/invalid tax rate in gross mode, conversion is skipped (assert current behavior explicitly).
    - Regression guard: calling with default (no inputMode arg) preserves existing tests unchanged.

## Builder hook state
- Update `src/features/angebote/hooks/use-angebot-builder.ts`:
  - Add option `initialInputMode?: 'net' | 'gross'`.
  - Add state mirroring `showTotalsBlock` pattern:
    - `initialInputModeRef = useRef(initialInputMode ?? 'net')`
    - `const [inputMode, setInputMode] = useState(initialInputModeRef.current)`
  - Include `inputMode` in create payload.
  - In edit save mutation, add a separate dirty guard:
    - if dirty, pass `{...header, inputMode}` to `updateAngebot`.
  - Return `inputMode` and `setInputMode` from the hook.

## Builder wiring
- Update `src/features/angebote/components/angebot-builder/index.tsx`:
  - Pass `initialInputMode: (initialAngebot?.input_mode ?? 'net') as 'net' | 'gross'` into `useAngebotBuilder`.
  - Pull `inputMode`/`setInputMode` from the hook return.
  - Update live compute call:
    - `computeRow(mergedData, columnSchema, inputMode)`.
  - Pass `inputMode` + `onInputModeChange={setInputMode}` to `Step2Positionen`.

## Step 2 UI toggle + warnings
- Update `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`:
  - Extend props:
    - `inputMode: 'net' | 'gross'`
    - `onInputModeChange: (mode: 'net' | 'gross') => void`
  - Add toggle switch **below the line items list** and **above** the totals switch.
  - Implement a pure helper that checks whether the current row has a usable tax rate:
    - Find tax rate column by role: `columns.find(c => c.role==='tax_rate')`
    - Read `data[taxRateCol.id]`, parse float, require `isFinite(n) && n >= 0` (0 is valid; only empty/non-numeric blocks).
  - Show a warning icon + tooltip on the input price fields only when:
    - `inputMode==='gross'` AND `!hasTaxRateValue(item.data, columnSchema)` AND column role is one of `unit_price | flat_rate | surcharge`.
  - Reuse existing `Tooltip` and `AlertTriangle` components and keep layout unchanged for unaffected cells.

## Documentation updates
- Update `docs/angebot-formula-engine.md`:
  - Add Phase 6 section documenting:
    - `angebote.input_mode` + defaults
    - `InputMode` type + third `computeRow` arg
    - gross-mode pre-conversion rule and tax-rate requirements
    - warning icon trigger condition
    - deferrals
  - Update phase status to include Phase 6.
- Append a Phase 6 completion note to `docs/plans/formula-engine-audit.md`.

## Verification gates (run locally)
- After migration + TS updates: `bun run build`
- After engine + tests: `bun test`
- Final: `bun run build && bun test`
