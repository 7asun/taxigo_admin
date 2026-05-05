---
name: draft-quote-live-schema-refresh
overview: Refresh draft Angebots column schema from the live Angebotsvorlage when editing drafts, reconcile existing line-item data non-destructively, and persist the refreshed schema back into `angebote.table_schema_snapshot` on draft edit save only—leaving create mode and non-draft edit behaviour unchanged.
todos:
  - id: types-draft-schema-payload
    content: Add `DraftSchemaRefreshPayload` type (no changes to `UpdateAngebotPayload`).
    status: completed
  - id: api-update-draft-schema
    content: Add `updateDraftAngebotSchema()` with `.eq('status','draft')` guard; keep `updateAngebot()` unchanged.
    status: completed
  - id: hook-live-schema-save
    content: Add optional `liveColumnSchema` to `useAngebotBuilder` and persist it on edit save via `updateDraftAngebotSchema`.
    status: completed
  - id: builder-live-schema-hydration
    content: In `AngebotBuilder`, resolve live Vorlage columns for draft edits, reconcile existing row data once, and pass live schema to the hook.
    status: completed
  - id: docs-resolution
    content: Update audit doc with Resolution + create `docs/angebot-builder.md` explaining schema hydration rules.
    status: completed
isProject: false
---

## Goals
- In **edit mode for draft offers only** (`isEdit && initialAngebot.status === 'draft'`), derive `columnSchema` from the **live Angebotsvorlage.columns** (by `initialAngebot.angebot_vorlage_id`).
- Reconcile existing `lineItems[].data` for draft edits **non-destructively**:
  - preserve values for still-present column IDs
  - add missing column IDs with `null`
  - keep orphaned keys in `data` (do not delete)
- Persist the refreshed schema back to `angebote.table_schema_snapshot` on **draft edit save only**.
- Keep template selector **read-only** in edit mode.
- Leave **non-draft edit** and **create mode** behaviour untouched.

## Existing baseline (why this change is needed)
- Edit-mode schema currently comes from `resolveAngebotPdfColumnSchema(initialAngebot)` (snapshot-first), so edits are frozen to `table_schema_snapshot`.
  - See [`src/features/angebote/components/angebot-builder/index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) `columnSchema` useMemo around lines 132–137.
- `UpdateAngebotPayload` intentionally omits `table_schema_snapshot`, and `updateAngebot()` explicitly must not write it.
  - See [`src/features/angebote/types/angebot.types.ts`](src/features/angebote/types/angebot.types.ts) `UpdateAngebotPayload` around lines 194–210.
  - See [`src/features/angebote/api/angebote.api.ts`](src/features/angebote/api/angebote.api.ts) `updateAngebot` docstring around lines 332–337.

## Approach (minimal surface area, explicit draft-only write path)
### 1) Types: add a draft-only schema refresh payload
- In [`src/features/angebote/types/angebot.types.ts`](src/features/angebote/types/angebot.types.ts), add a new type below `UpdateAngebotPayload`:
  - `export type DraftSchemaRefreshPayload = { table_schema_snapshot: AngebotColumnDef[] }`
- Do **not** modify `UpdateAngebotPayload`.

### 2) API: add `updateDraftAngebotSchema()` (do not touch `updateAngebot`)
- In [`src/features/angebote/api/angebote.api.ts`](src/features/angebote/api/angebote.api.ts), add a new exported function directly below `updateAngebot()`:
  - `updateDraftAngebotSchema(id, snapshot)`
  - Performs `.update({ table_schema_snapshot: mappedSnapshot, updated_at: now })`
  - Includes **hard guard**: `.eq('id', id).eq('status', 'draft')`
  - Throws via `toQueryError` on error.
- Keep `updateAngebot()` unchanged.

### 3) Hook: wire optional live schema persistence into draft edit saves
- In [`src/features/angebote/hooks/use-angebot-builder.ts`](src/features/angebote/hooks/use-angebot-builder.ts):
  - Extend `UseAngebotBuilderOptions` to accept **optional** `liveColumnSchema?: AngebotColumnDef[]`.
  - Import `updateDraftAngebotSchema` from `../api/angebote.api`.
  - In `saveEditMutation.mutationFn`, after `replaceAngebotLineItems(...)`, conditionally call `updateDraftAngebotSchema(angebotId, liveColumnSchema)` **only if** `liveColumnSchema?.length`.
    - The caller will only pass `liveColumnSchema` for draft edits, so non-draft paths remain untouched.
    - DB-level safety still enforced by the `.eq('status', 'draft')` guard.

### 4) Builder: derive live schema for draft edit and reconcile existing row data once
- In [`src/features/angebote/components/angebot-builder/index.tsx`](src/features/angebote/components/angebot-builder/index.tsx):
  - Import `useAngebotVorlagenList` and `ANGEBOT_POSITION_COLUMN_ID`.
  - Call `useAngebotVorlagenList(companyId)` in the parent (React Query caching makes the duplicate call fine).
  - Add `liveEditColumnSchema` memo that returns `null` unless:
    - `isEdit === true`
    - `initialAngebot.status === 'draft'`
    - `initialAngebot.angebot_vorlage_id` exists
    - matching Vorlage exists and has non-empty columns
    - filter out `ANGEBOT_POSITION_COLUMN_ID`
  - Update `columnSchema` memo to prefer `liveEditColumnSchema` when present; otherwise keep current behaviour (`resolveAngebotPdfColumnSchema(initialAngebot)` for edit, `createColumnSchema` for create).
  - Add a one-time reconciliation `useEffect` guarded by `useRef(false)`:
    - For each row, compute missing column IDs (excluding position column).
    - Patch row `data` to add `{ [missingId]: null }` for each missing id.
    - Keep existing values untouched; do not delete orphan keys.
    - Ensure the guard prevents re-running even though `lineItems` changes.
  - Pass `liveColumnSchema: liveEditColumnSchema ?? undefined` into `useAngebotBuilder(...)`.

### 5) Docs: record the resolution
- Append a **Resolution** section to [`docs/plans/draft-quote-column-refresh-audit.md`](docs/plans/draft-quote-column-refresh-audit.md) summarizing:
  - draft edit uses live Vorlage columns
  - schema reconciliation semantics
  - draft-only snapshot refresh write path (`updateDraftAngebotSchema` with DB guard)
  - list of changed files
- Create new doc [`docs/angebot-builder.md`](docs/angebot-builder.md) (does not exist currently) with a section **“Schema hydration in edit mode”** describing:
  - create mode: schema from selected Vorlage
  - non-draft edit: frozen to snapshot
  - draft edit: live Vorlage schema + snapshot refreshed on save

## Build gates (per your rules)
- After each step, run `bun run build` and stop if it fails before proceeding.
- Final verification: `bun run build` and `bun test` (if present) after all steps.

## Notes on invariants (kept intact)
- PDF continues to resolve from `table_schema_snapshot` (via `resolveAngebotPdfColumnSchema`); after draft save refresh, PDFs naturally reflect the new schema.
- Template picker remains locked in edit mode (`step-2-positionen.tsx` remains unchanged).
- `UpdateAngebotPayload` and `updateAngebot()` remain unchanged, so non-draft edits cannot overwrite snapshots accidentally.