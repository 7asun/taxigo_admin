---
name: angebot-vorlage-role-picker-phase2
overview: Add a role picker UI to the Angebotsvorlage editor so admins can assign `AngebotColumnRole` per column (add form + inline edit), with grouped input/computed options, computed-role visual cues, and duplicate-role soft warnings. No engine logic yet.
todos:
  - id: role-ui-catalog
    content: Add ANGEBOT_COLUMN_ROLE_UI + ordered option arrays to angebot-column-presets.ts; gate build.
    status: completed
  - id: role-select-add-form
    content: Add newRole state + local RoleSelect + persist role on new columns + reset; gate build.
    status: completed
  - id: role-select-edit-list
    content: Add per-column RoleSelect + duplicateRoles memo + per-column warning; gate build.
    status: completed
  - id: role-display-chips-optional
    content: Render role badges in sortable chips using ANGEBOT_COLUMN_ROLE_UI (mandatory when col.role is set); gate build.
    status: completed
  - id: docs-phase2
    content: Update docs/angebot-formula-engine.md with Phase 2 section and append Phase 2 completed entry to formula-engine-audit.md.
    status: completed
  - id: verify
    content: Run bun run build and bun test.
    status: completed
isProject: false
---

## Goal
Add a role picker to the Vorlage editor so admins can assign `AngebotColumnRole` per column when creating/editing an Angebotsvorlage. Roles remain inert (no calculation/read-only enforcement).

## Files to change
- [`src/features/angebote/lib/angebot-column-presets.ts`](src/features/angebote/lib/angebot-column-presets.ts)
- [`src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx)
- [`src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx`](src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx)
- [`docs/angebot-formula-engine.md`](docs/angebot-formula-engine.md)
- [`docs/plans/formula-engine-audit.md`](docs/plans/formula-engine-audit.md)

## Constraints (must hold)
- `ANGEBOT_COLUMN_ROLE_UI` is the **single source of truth** for role labels/groups/descriptions.
- Persist role as `AngebotColumnRole | undefined` on column defs (UI uses `null` internally; never store `''` or `null`).
- Duplicate-role behavior is **warning only** (never blocks save).
- Computed roles are visually distinct everywhere they appear.
- No builder form changes; no engine logic.

## Step 1 — Add role UI metadata catalog
Update [`src/features/angebote/lib/angebot-column-presets.ts`](src/features/angebote/lib/angebot-column-presets.ts):
- Add exported `ANGEBOT_COLUMN_ROLE_UI: Record<AngebotColumnRole, { label; group; description }>` exactly covering all 12 roles.
- Add exported ordered option arrays `ANGEBOT_ROLE_INPUT_OPTIONS` and `ANGEBOT_ROLE_COMPUTED_OPTIONS` derived from the catalog.

Gate: `bun run build`

## Step 2 — Add role picker to the “Spalte hinzufügen” form
Update [`src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx):
- Add state: `const [newRole, setNewRole] = useState<AngebotColumnRole | null>(null);` right after `newRequired`.
- Implement a **local** `RoleSelect` component (not exported) using shadcn `Select`:
  - Includes a top option **“Keine Rolle”** (maps to `null`).
  - Renders two visually separated groups:
    - “Eingabe” from `ANGEBOT_ROLE_INPUT_OPTIONS`
    - “Berechnet ⚙” from `ANGEBOT_ROLE_COMPUTED_OPTIONS` (items muted; tooltip uses `description`)
  - Props: `value: AngebotColumnRole | null`, `onChange(v)`, optional `disabled`.
- Insert the role picker in the add form between Preset and Required. Label: `Rolle (optional)`.
- In `handleAddColumn`, include `role: newRole ?? undefined`.
- After successful add, reset `newRole` back to `null`.

Gate: `bun run build`

## Step 3 — Add role picker to inline per-column editing + duplicate warning
Still in [`angebot-vorlage-editor-panel.tsx`](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx):
- Add a `RoleSelect` per column in the inline edit row, placed after the existing preset select.
- Update column state on change, using the **callback parameter** from `RoleSelect` (not the add-form `newRole` state):
  - Use e.g. `onChange={(value) => setColumns(... role: value ?? undefined ...)}`.
  - Do **not** reuse the add-form `newRole` variable name here; they are separate concerns.
- Add duplicate-role warning logic:
  - `duplicateRoles` memo that counts roles across `columns` and returns a `Set` of roles used 2+ times.
  - For any column whose `col.role` is in `duplicateRoles`, render an amber advisory text (with `AlertTriangle`) under the role select: “Diese Rolle ist bereits vergeben”.
  - Warning is per-column; saving remains allowed.

Gate: `bun run build`

## Step 4 — Role display in sortable chips (mandatory)
Review current behavior: `SortableAngebotColumnList` renders `{emoji} {header}` and a `Legacy` tag for `percent` (see `sortable-angebot-column-list.tsx`).

Step 4 is mandatory. Always render the role badge in sortable chips when `col.role` is set. This is not optional.

- Update [`src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx`](src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx):
  - Import `ANGEBOT_COLUMN_ROLE_UI`.
  - When `col.role` exists, show a small secondary badge with `ANGEBOT_COLUMN_ROLE_UI[col.role].label`.
  - Prefix computed-role badge with `⚙`.
  - Keep this file display-only (no editing logic); duplicate warnings remain in the editor panel list.

Gate: `bun run build`

## Step 5 — Mandatory docs
- Update [`docs/angebot-formula-engine.md`](docs/angebot-formula-engine.md): add a **“Phase 2 — Vorlage Editor UI”** section describing:
  - Role picker placement (add form + edit list)
  - Grouped select structure (Eingabe / Berechnet)
  - Duplicate-role warning semantics
  - Explicit deferrals (engine, read-only, PDF totals)
- Append **“Phase 2 — Completed”** entry to [`docs/plans/formula-engine-audit.md`](docs/plans/formula-engine-audit.md) listing changed files.

## Final verification
- `bun run build`
- `bun test`