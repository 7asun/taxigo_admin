# Phase 1 Plan — `AngebotColumnRole` (data model + persistence wiring)

Objective: Introduce `AngebotColumnRole` as a **net-new optional field** on `AngebotColumnDef` and wire it through every layer that already handles `formula`: types → Zod validation → normalization → Vorlage API → snapshot API → draft refresh API. **No UI, no engine, no formula evaluation.** Docs are mandatory in this phase.

---

## Hard rules (non-negotiable)

- **No UI, engine logic, or formula evaluation** in this phase. `role` must be inert.
- **Do not modify the preset system** (role and preset remain separate concerns).
- **`formula` must remain byte-for-byte identical** to current definition in `src/features/angebote/types/angebot.types.ts` (type + position + comment).
- **`role` is optional** and **nullable**: `AngebotColumnRole | null | undefined`.
- **No magic strings**: only define role strings in the `AngebotColumnRole` union / Zod enum, never elsewhere.
- **Unknown role strings must be dropped** (`undefined`) in normalization to avoid downstream Zod parse failures on live offers.
- **All serialization sites must be updated consistently**:
  - 1 Vorlage write path (`stripLegacyKeys`)
  - 3 snapshot write map sites in `angebote.api.ts` (parse, create insert, draft refresh)
- **Build gate required between steps**: stop and report if a gate fails.

---

## Role enum (exact values)

Define `AngebotColumnRole` (TS union via Zod enum) with these exact literals:

### Input roles (manual entry)
- `description`
- `time`
- `days`
- `quantity`
- `distance_km`
- `unit_price`
- `flat_rate`
- `surcharge`
- `tax_rate`

### Computed roles (engine-derived, read-only in Phase 3)
- `net_amount`
- `tax_amount`
- `gross_amount`

---

## Step 1 — Define `AngebotColumnRole` in types

File: `src/features/angebote/types/angebot.types.ts`

1. Add `angebotColumnRoleSchema` directly after `angebotColumnPresetSchema`:

```ts
/**
 * Semantic role of a column within the formula engine.
 * Input roles mark columns the admin fills manually.
 * Computed roles mark columns whose values are derived by the engine
 * from other columns in the same row — never entered by hand.
 *
 * Phase 2b: role is set via the Vorlage editor UI.
 * Phase 3:  engine reads role to infer calculations and mark computed
 *           columns read-only in the builder form.
 * formula field (separate): future escape hatch for custom expressions.
 */
export const angebotColumnRoleSchema = z.enum([
  // Input roles
  'description',
  'time',
  'days',
  'quantity',
  'distance_km',
  'unit_price',
  'flat_rate',
  'surcharge',
  'tax_rate',
  // Computed roles
  'net_amount',
  'tax_amount',
  'gross_amount'
]);

export type AngebotColumnRole = z.infer<typeof angebotColumnRoleSchema>;
```

2. Extend `angebotColumnDefSchema` to include `role` as optional+nullable (same pattern as `formula`):

```ts
export const angebotColumnDefSchema = z.object({
  id: z.string().min(1),
  header: z.string().max(20),
  preset: angebotColumnPresetSchema,
  required: z.boolean().optional(),
  /** Reserved for Phase 2b+ calculated columns. Not evaluated in Phase 2a — store null. */
  formula: z.string().nullable().optional(),
  /**
   * Semantic role used by the formula engine (Phase 3+).
   * null / undefined = no role assigned; column behaves as manual input.
   * Set via Vorlage editor UI in Phase 2b.
   */
  role: angebotColumnRoleSchema.nullable().optional()
});
```

3. Confirm `AngebotColumnDef` remains inferred from schema; only update manual overrides if TypeScript requires it.

**Note (current baseline):** `AngebotColumnDef` is currently declared as an intersection of\n+`z.infer<typeof angebotColumnDefSchema>` plus `{ preset: AngebotColumnPreset }`. Since `role`\n+is added to the Zod schema itself, it will automatically be included in the inferred type.\n+Do **not** re-declare `role` on the manual intersection unless TypeScript forces it.\n+
### Gate after Step 1
- Run: `bun run build`

---

## Step 2 — Preserve `role` in normalization

File: `src/features/angebote/lib/angebot-column-presets.ts`

Goal: In `normalizeLegacyColumn`, preserve `role` using the same null/undefined semantics as `formula`, but **validate** role values and **drop unknown strings**.

1. Import `angebotColumnRoleSchema` and `AngebotColumnRole` from `../types/angebot.types`.

2. In **both** return sites of `normalizeLegacyColumn` (the “Already migrated?” return and the legacy-mapping return), add:

```ts
role:
  rec.role === null
    ? null
    : angebotColumnRoleSchema.safeParse(rec.role).success
      ? (rec.role as AngebotColumnRole)
      : undefined
```

### Gate after Step 2
- Run: `bun run build`

---

## Step 3 — Include `role` in Vorlage API serialization

File: `src/features/angebote/api/angebot-vorlagen.api.ts`

1. Update `stripLegacyKeys` mapping to include `role: c.role` alongside `formula`:

```ts
return cols.map((c) => ({
  id: c.id,
  header: c.header,
  preset: c.preset,
  required: c.required,
  formula: c.formula,
  role: c.role
}));
```

**Note:** `stripLegacyKeys` is typed as `AngebotVorlageCreatePayload['columns']`. Today that\n+is `AngebotColumnDef[]`, so adding `role` should be type-safe once Step 1 lands. If Step 3\n+fails the build gate with a complaint about an “unknown `role` property”, look for any\n+hardcoded/duplicated column shape types elsewhere that don’t yet include `role`.\n+
### Gate after Step 3
- Run: `bun run build`

---

## Step 4 — Include `role` in all three snapshot serialization paths

File: `src/features/angebote/api/angebote.api.ts`

Add `role: c.role` to all three `{ id, header, preset, required, formula }` mapping objects:

1. The `angebotColumnDefArraySchema.parse(payload.tableSchemaSnapshot.map(...))` mapping.
2. `createAngebot` insert payload: `table_schema_snapshot: payload.tableSchemaSnapshot.map(...)`.
3. `updateDraftAngebotSchema` update payload: `table_schema_snapshot: snapshot.map(...)`.

All three mappings must be identical shape:

```ts
{
  id: c.id,
  header: c.header,
  preset: c.preset,
  required: c.required,
  formula: c.formula,
  role: c.role
}
```

### Gate after Step 4
- Run: `bun run build`
- Run: `bun test` (if this repo has tests configured)

---

## Step 5 — Mandatory docs

### 5.1 Create new doc

Create: `docs/angebot-formula-engine.md` with these sections:

- **Architecture overview**: role-based inference, two-field model (`role` + `formula`), compute-at-render-time rationale, finalisation snapshot rationale.\n
- **Role reference**: all 12 roles, each marked input/computed, with a short description and “typical preset pairing” guidance.\n
- **Computation hierarchy** (Phase 3 implementors):\n
  1. `formula` string set → evaluate expression (future)\n
  2. `role` set → infer from role combination (Phase 3)\n
  3. neither → manual input, read from `data[col.id]` (current)\n
- **Phase status**: Phase 1 (this change), Phase 2 (Vorlage editor UI), Phase 3 (engine + builder reactivity), Phase 4 (PDF totals block).\n

### 5.2 Append “Phase 1 — Completed” to audit

Append to: `docs/plans/formula-engine-audit.md`

Add a short entry confirming Phase 1 completed and listing changed files:
- `src/features/angebote/types/angebot.types.ts`
- `src/features/angebote/lib/angebot-column-presets.ts`
- `src/features/angebote/api/angebot-vorlagen.api.ts`
- `src/features/angebote/api/angebote.api.ts`
- plus the new `docs/angebot-formula-engine.md`

Explicitly state: role is now wired through **types/Zod → normalizeLegacyColumn → Vorlage serialization → snapshot create → snapshot draft refresh** and is inert until later phases.

### Gate after Step 5
- Run: `bun run build`
- Run: `bun test` (if present)

