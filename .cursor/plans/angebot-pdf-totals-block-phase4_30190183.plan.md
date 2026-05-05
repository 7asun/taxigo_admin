---
name: angebot-pdf-totals-block-phase4
overview: Add an opt-in totals block to Angebot PDFs, controlled by a new `angebote.show_totals_block` DB column and a builder Step 2 switch. Totals are computed as a single-row summary (net/tax/gross) using a pure function in the formula engine and rendered only when the flag is enabled and the schema contains a `net_amount` role column.
todos:
  - id: migration
    content: Add Supabase migration adding `angebote.show_totals_block` default false; gate build.
    status: completed
  - id: types
    content: Add `show_totals_block` to Angebot row types and `showTotalsBlock` to create/update payload types (camelCase only in TS); gate build.
    status: completed
  - id: api-mapping
    content: "Map DB↔TS in `angebote.api.ts`: include `show_totals_block` in create/update and in header mapping, without leaking camelCase into Supabase update payload; gate build."
    status: completed
  - id: builder-hook
    content: Add `showTotalsBlock` state + initial option to `useAngebotBuilder` and include in create/edit save flows; gate build.
    status: completed
  - id: builder-ui
    content: Wire `showTotalsBlock` through builder `index.tsx` and add Step 2 switch below line items table; gate build.
    status: completed
  - id: pdf-totals
    content: Add `computeAngebotTotals` to engine + tests, compute totals in `AngebotPdfDocument`, render totals block in `AngebotPdfCoverBody` (only when flag true and net_amount role exists); gate build + test.
    status: completed
  - id: docs-phase4
    content: Update `docs/angebot-formula-engine.md` with Phase 4 section + status; append Phase 4 completed entry to `docs/plans/formula-engine-audit.md`; final build + test gates.
    status: completed
isProject: false
---

## Key observations from the current code

- `updateAngebot()` in [`src/features/angebote/api/angebote.api.ts`](src/features/angebote/api/angebote.api.ts) currently forwards the payload directly into `.update({ ...payload })`. This means we must **not** let any camelCase field (e.g. `showTotalsBlock`) leak into that object, or Supabase will try to update a non-existent column.
- The Angebot PDF body uses shared invoice `styles` from `pdf-styles` (so `styles.totalsSection`, `styles.totalsRow`, etc. already exist and can be reused).
- The builder Step 2 UI is in [`src/features/angebote/components/angebot-builder/step-2-positionen.tsx`](src/features/angebote/components/angebot-builder/step-2-positionen.tsx) and already renders the line-items table + a “Zeile hinzufügen” button at the bottom; the switch should be placed **between** the table and that button.

## Step-by-step implementation (match the spec)

### Step 1 — Supabase migration

- Add new migration file: `supabase/migrations/<UTC timestamp>_angebot_show_totals_block.sql`
- Contents exactly as specified:
  - `ALTER TABLE public.angebote ADD COLUMN show_totals_block boolean NOT NULL DEFAULT false;`

Gate: `bun run build`

### Step 2 — Types and payloads

Update [`src/features/angebote/types/angebot.types.ts`](src/features/angebote/types/angebot.types.ts):

- Add to `AngebotRow`:
  - `show_totals_block: boolean;`
- `AngebotWithLineItems` already extends `AngebotRow`, so it inherits it.
- Add to `CreateAngebotPayload`:
  - `showTotalsBlock: boolean;`
- Add to `UpdateAngebotPayload`:
  - Do **not** add to `DraftSchemaRefreshPayload`.
  - Because `UpdateAngebotPayload` is currently derived from `AngebotRow` (snake_case), we must extend it with an extra optional camelCase field without mixing names elsewhere:
    - Add `showTotalsBlock?: boolean;` via intersection/extension, while keeping existing snake_case fields.

Gate: `bun run build`

### Step 3 — API serialization (DB↔TS mapping)

Update [`src/features/angebote/api/angebote.api.ts`](src/features/angebote/api/angebote.api.ts):

- Before implementing Step 3, read the full body of `updateAngebot` in `angebote.api.ts` and confirm whether it uses a direct payload spread or already builds an explicit update object. The approach for `show_totals_block` must match the existing pattern.
- In `mapAngebotHeaderFromDb`, map `raw.show_totals_block` to `show_totals_block` on the returned `AngebotRow` (boolean coercion; default to `false` if nullish).
- In `createAngebot(payload)` insert object, include:
  - `show_totals_block: payload.showTotalsBlock ?? false`
- In `updateAngebot(id, payload)`:
  - Build an `updatePayload` object that:
    - spreads only the **snake_case** fields from `payload`
    - conditionally adds `show_totals_block` **only** when `payload.showTotalsBlock !== undefined` using the exact conditional spread pattern from the spec
    - excludes `showTotalsBlock` from the object passed to `.update(...)` (to avoid invalid column updates)
  - Keep `updateDraftAngebotSchema` unchanged.

Gate: `bun run build`

### Step 4 — Builder hook state

Update [`src/features/angebote/hooks/use-angebot-builder.ts`](src/features/angebote/hooks/use-angebot-builder.ts):

- Extend `UseAngebotBuilderOptions`:
  - `initialShowTotalsBlock?: boolean`
- Add state:
  - `const [showTotalsBlock, setShowTotalsBlock] = useState(initialShowTotalsBlock ?? false)`
- Ensure the flag is persisted:
  - Create: the create mutation should send `showTotalsBlock` in the payload passed to `createAngebot`.
  - Edit-save: `updateAngebot` must receive `showTotalsBlock` (either merged into `header` or passed as part of the header object), but only when the user toggled it.
- Return:
  - `showTotalsBlock`, `setShowTotalsBlock`

Gate: `bun run build`

### Step 5 — Builder + Step 2 switch

Update [`src/features/angebote/components/angebot-builder/index.tsx`](src/features/angebote/components/angebot-builder/index.tsx):

- Pass `initialShowTotalsBlock: initialAngebot?.show_totals_block ?? false` into `useAngebotBuilder`.
- Pass new props to `Step2Positionen`:
  - `showTotalsBlock={showTotalsBlock}`
  - `onShowTotalsBlockChange={setShowTotalsBlock}`

Update [`src/features/angebote/components/angebot-builder/step-2-positionen.tsx`](src/features/angebote/components/angebot-builder/step-2-positionen.tsx):

- Extend `Step2PositionenProps` with:
  - `showTotalsBlock: boolean`
  - `onShowTotalsBlockChange: (value: boolean) => void`
- Add shadcn `Switch` below the line items table and above “Zeile hinzufügen”, with the exact German label from the spec.

Gate: `bun run build`

### Step 6 — Totals computation + PDF rendering

#### 6a — Pure totals function in engine

Update [`src/features/angebote/lib/angebot-formula-engine.ts`](src/features/angebote/lib/angebot-formula-engine.ts):

- Add `computeAngebotTotals(rows, columns)` exactly as specified (pure; sums only finite numbers; returns null when role column missing / no values).
- Add tests in `src/features/angebote/lib/angebot-formula-engine.test.ts`:
  - sums for 3 rows
  - schema missing net role → netTotal null

Gate: `bun run build` + `bun test`

#### 6b — Compute totals in `AngebotPdfDocument` and pass down

Update [`src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`](src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx):

- Import `computeAngebotTotals` from the engine.
- Compute `hasNetAmountCol` from `columnSchema`.
- Build `totalsData` only when:
  - `angebot.show_totals_block === true` **and**
  - `hasNetAmountCol === true`
- Pass `totalsData` (or `null`) as a new prop into `AngebotPdfCoverBody`.

#### 6c — Render totals block in `AngebotPdfCoverBody`

Update [`src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`](src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx):

- Extend props with:
  - `totalsData: { netTotal; taxTotal; grossTotal } | null`
- Render the totals block **only** when `totalsData` is non-null.
- Place it immediately after the line items table and before the outro prose.
- Use the existing shared `styles.totalsSection`, `styles.totalsRow`, `styles.totalsLabel`, `styles.totalsValue`, `styles.totalsGrandSpacer`, `styles.totalsGrandRow`, `styles.totalsGrandLabel`, `styles.totalsGrandValue` (same as invoice).
- Use the local EUR formatter in the Angebot cover body (don’t import invoice formatters).

Gate: `bun run build` + `bun test`

### Step 7 — Mandatory docs + audit trail

- Update [`docs/angebot-formula-engine.md`](docs/angebot-formula-engine.md):
  - Add **“Phase 4 — PDF Totals Block”** section documenting:
    - `angebote.show_totals_block` default false
    - `computeAngebotTotals` contract
    - render condition: flag + net_amount role column present
    - single summary only (multi-rate deferred)
  - Update phase status: Phase 4 → done
- Append **“Phase 4 — Completed”** entry to [`docs/plans/formula-engine-audit.md`](docs/plans/formula-engine-audit.md) with changed files list.
- Add “why” comments to each new function/prop/conditional as required.

Final gates:
- `bun run build`
- `bun test`
