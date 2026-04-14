---
todos:
  - id: part1-presets-module
    content: "Add src/features/angebote/lib/angebot-column-presets.ts — AngebotColumnPreset, AngebotColumnLayoutSpec, COLUMN_PRESET_SPECS, COLUMN_PRESET_UI, defaultHeaderForPreset, resolveColumnLayout; comments per plan Part 1."
  - id: part2-types-zod
    content: "Refactor angebot.types.ts — preset-based AngebotColumnDef + Zod; deprecate/remove AngebotColumnType; update all imports; JSDoc for legacy bridges."
  - id: part3-width-algorithm
    content: "Rewrite calcAngebotColumnWidths in angebot-pdf-columns.ts — fixed/fill/auto + Pos. interaction; keep ANGEBOT_PDF_AVAILABLE_WIDTH 515; document legacy catalog retention."
  - id: part4-pdf-renderers
    content: "AngebotPdfCoverBody + AngebotPdfDocument — resolveColumnLayout for align + pdfRenderType; renderCell on pdfRenderType only; special-case Pos. alignment."
  - id: part5-detail-html
    content: "Angebot detail table (angebot-detail-view.tsx) — align + format via resolveColumnLayout / pdfRenderType parity with PDF; fix integer row-index behaviour vs builder."
  - id: part6-template-editor
    content: "Rewrite angebot-vorlage-editor-panel.tsx + sortable-angebot-column-list.tsx — preset UX, 20-char header, warnings, preview bar sum check, locked Pos. row, remove weight/minWidth/slider."
  - id: part7-step2-builder
    content: "step-2-positionen.tsx + index.tsx — chips with emoji, inputs from pdfRenderType, per-offer preset override + callback; section2Complete preset logic; comment per-offer-only."
  - id: part8-settings-default-columns
    content: "angebot-vorlagen-settings-page.tsx SYSTEM_DEFAULT_ANGEBOT_COLUMNS — migrate to preset shape; align with SQL seed after migration."
  - id: part9-auto-position-column
    content: "angebot-auto-columns.ts — ANGEBOT_POSITION_COLUMN uses preset anzahl or synthetic layout via resolveColumnLayout(id hook); no stored type/weight/minWidth in JSON."
  - id: part10-migration-sql
    content: "New supabase/migrations after 20260413120000 — JSONB transform angebot_vorlagen.columns + angebote.table_schema_snapshot; idempotent; percent → betrag + review flag comment."
  - id: part11-api-fallback
    content: "angebot-vorlagen.api.ts + angebote.api.ts — normalize read (type→preset fallback); write strips legacy keys; document removal gate."
  - id: part12-resolve-legacy-profile
    content: "resolve-angebot-table-schema.ts profileToAngebotColumnDefs — emit preset-based defs from ANGEBOT_COLUMN_MAP; keep ANGEBOT_STANDARD_COLUMN_PROFILE path in AngebotPdfDocument."
  - id: part13-docs
    content: "Rewrite docs/angebote-vorlagen.md column model; update docs/angebote-module.md + cross-links."
---

# Angebotsvorlagen — preset-driven column type system

This plan replaces the low-level stored fields (`type`, `weight`, `minWidth`; there is **no** `align` on `AngebotColumnDef` today — alignment is inferred from `type` in renderers) with **five fixed semantic presets**. Admins only name columns (max 20 characters), pick a preset, and reorder. Widths and alignment are derived at runtime via `resolveColumnLayout`.

**Constraint:** No TypeScript, SQL, or TSX appears below — only prose and pseudocode.

---

## Files read (Step 0)

Every path below was read in full for this plan unless noted.

| Path | Notes |
|------|--------|
| [docs/angebote-module.md](docs/angebote-module.md) | |
| [docs/angebote-vorlagen.md](docs/angebote-vorlagen.md) | |
| [docs/pdf-vorlagen.md](docs/pdf-vorlagen.md) | Invoice PDF reference; Angebote reuse patterns only |
| [src/features/angebote/types/angebot.types.ts](src/features/angebote/types/angebot.types.ts) | |
| [src/features/angebote/lib/angebot-legacy-column-ids.ts](src/features/angebote/lib/angebot-legacy-column-ids.ts) | |
| [src/features/angebote/lib/angebot-auto-columns.ts](src/features/angebote/lib/angebot-auto-columns.ts) | |
| [src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts](src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts) | |
| [src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx) | |
| [src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx) | |
| [src/features/angebote/lib/resolve-angebot-table-schema.ts](src/features/angebote/lib/resolve-angebot-table-schema.ts) | |
| [src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx) | |
| [src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx](src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx) | Exists |
| [src/features/angebote/components/angebot-builder/step-2-positionen.tsx](src/features/angebote/components/angebot-builder/step-2-positionen.tsx) | |
| [src/features/angebote/components/angebot-builder/step-3-details.tsx](src/features/angebote/components/angebot-builder/step-3-details.tsx) | No column schema logic |
| [src/features/angebote/components/angebot-builder/index.tsx](src/features/angebote/components/angebot-builder/index.tsx) | Partial read (schema + section2Complete + handleVorlageChange) |
| [src/features/angebote/hooks/use-angebot-builder.ts](src/features/angebote/hooks/use-angebot-builder.ts) | |
| [src/features/angebote/api/angebote.api.ts](src/features/angebote/api/angebote.api.ts) | Partial read (snapshot parse + imports); remainder assumed mirror patterns |
| [src/features/angebote/api/angebot-vorlagen.api.ts](src/features/angebote/api/angebot-vorlagen.api.ts) | |
| [src/features/angebote/hooks/use-angebot-vorlagen.ts](src/features/angebote/hooks/use-angebot-vorlagen.ts) | Partial read |
| [src/query/keys/angebote.ts](src/query/keys/angebote.ts) | No column-type coupling |
| [src/features/invoices/components/invoice-pdf/pdf-column-layout.ts](src/features/invoices/components/invoice-pdf/pdf-column-layout.ts) | First ~130 lines — JSONB coercion patterns for comparison only |
| [supabase/migrations/20260412140000_client_price_tags.sql](supabase/migrations/20260412140000_client_price_tags.sql) | **Not read in full** — only filename from `find … \| tail -3` |
| [supabase/migrations/20260412150000_fix_cpt_rls.sql](supabase/migrations/20260412150000_fix_cpt_rls.sql) | **Not read in full** — only filename from `find … \| tail -3` |
| [supabase/migrations/20260413120000_angebot_flexible_table.sql](supabase/migrations/20260413120000_angebot_flexible_table.sql) | Seed `jsonb_build_array` excerpt read for JSON shape |

**Additional file discovered during analysis (uses `col.type` but was not in the Step 0 list):** [src/features/angebote/components/angebot-detail-view.tsx](src/features/angebote/components/angebot-detail-view.tsx) — must be updated in implementation for parity with PDF.

**Additional file:** [src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-settings-page.tsx](src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-settings-page.tsx) — `SYSTEM_DEFAULT_ANGEBOT_COLUMNS` duplicates migration seed shape.

---

## Current state (Step 1 — from files actually read)

### AngebotColumnDef shape (today)

Defined by `angebotColumnDefSchema` in [angebot.types.ts](src/features/angebote/types/angebot.types.ts):

- **id** — string, min length 1. Stable key for `angebot_line_items.data` and width map keys.
- **header** — string. German label in UI and PDF (no max length enforced in Zod today).
- **type** — one of `text`, `integer`, `currency`, `currency_per_km`, `percent` (`AngebotColumnType`).
- **weight** — non-negative number. Used only for proportional width distribution in `calcAngebotColumnWidths`.
- **minWidth** — non-negative number (points). Floor per column in `calcAngebotColumnWidths`.
- **required** — optional boolean.
- **formula** — optional nullable string; documented as Phase 2b reserved, not evaluated.

**Written:** `angebot_vorlagen.columns` (via create/update Vorlage APIs after Zod parse), `angebote.table_schema_snapshot` at offer creation (`createAngebot` payload validated with `angebotColumnDefArraySchema`), client-side constants in `angebot-vorlagen-settings-page.tsx` (`SYSTEM_DEFAULT_ANGEBOT_COLUMNS`), and synthetic `ANGEBOT_POSITION_COLUMN` in `angebot-auto-columns.ts` (still uses `type`/`weight`/`minWidth` for width calc — not persisted in DB).

**Read:** Template editor, Step 2 builder, PDF cover body, detail view HTML table, `resolveAngebotPdfColumnSchema`, APIs on read after Zod, width preview in editor.

There is **no** `align` field on `AngebotColumnDef`. Alignment is **derived from `type`** in `AngebotPdfCoverBody.textAlignForCol` and `angebot-detail-view.alignClass`.

### AngebotColumnType values and usage

| Value | PDF (`AngebotPdfCoverBody` `renderCell` + `textAlignForCol`) | Editor | Builder Step 2 |
|-------|--------------------------------------------------------------|--------|------------------|
| `text` | Format as plain string; align left | Type dropdown option | `type="text"` input |
| `integer` | Parse int; empty → em dash; align center | Type dropdown | `type="number"` step 1 |
| `currency` | `formatEur`; align right | Type dropdown | `type="number"` step 0.01, min 0 |
| `currency_per_km` | `formatEurPerKm`; align right | Type dropdown | Same as currency |
| `percent` | `formatTaxRate` after dividing raw by 100; align right | Type dropdown | `type="number"` step 0.1, min 0, max 100 |

`sortable-angebot-column-list.tsx` shows `col.type` in chip label (line 126).

`index.tsx` `section2Complete` uses `columnSchema.find((c) => c.type !== 'integer')` to skip “position-like” integer columns when detecting content (lines 210–214).

### Current `calcAngebotColumnWidths` (plain English)

Source: [angebot-pdf-columns.ts](src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts) function `calcAngebotColumnWidths`.

1. Start from `ANGEBOT_PDF_AVAILABLE_WIDTH` (515 pt).
2. If zero columns → empty width map.
3. If exactly one column → that column gets the full 515 pt.
4. Otherwise compute **totalWeight** as sum of each column’s `weight` (treating non-positive weights as part of a fallback where each column counts as weight 1 if total is zero).
5. For each column, **rawWidth** = (column weight / effective total weight) × available width.
6. **Clamp** each raw width up to at least `minWidth`.
7. If sum of minima exceeds available → log a console warning and return each column at its `minWidth` only.
8. If sum of clamped widths **exceeds** available → repeatedly subtract overflow from “flexible” columns (those strictly above their `minWidth`), proportional to weight, up to 50 iterations until sum fits.
9. If sum **under** available → distribute spare width proportionally by weight so the row fills 515 pt.

Separate legacy function `calcAngebotPdfCatalogColumnWidths` operates on `AngebotColumnKey[]` and catalog `defaultWidthPt` / `minWidthPt` — unrelated to dynamic `AngebotColumnDef[]` except shared constant `ANGEBOT_PDF_AVAILABLE_WIDTH`.

### Template editor (today)

[angebot-vorlage-editor-panel.tsx](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx):

- Name, description, default checkbox for the Vorlage.
- **Sortable list** via `SortableAngebotColumnList`: drag handle, label `header (type)`, delete (guarded when only one column remains).
- **Add column** bordered section: header text input; **type** select (`TYPE_OPTIONS`); **weight** slider 1–5; **min width (pt)** number input; **required** checkbox; “Spalte übernehmen”.
- **Width preview** bar: segments for `ANGEBOT_POSITION_COLUMN` + editable columns; percentage from `widthPreview[col.id] ?? col.minWidth` vs 515.
- Reserved header check for `^pos\.?$` (case insensitive) with German error string.
- Save sends `editableColumns` (filters `col_position`).

### Seed JSON shape in migration

From [20260413120000_angebot_flexible_table.sql](supabase/migrations/20260413120000_angebot_flexible_table.sql) `jsonb_build_object` entries (five columns):

Each element is an object with keys: **`id`** (text), **`header`** (text), **`type`** (text enum value), **`weight`** (integer), **`minWidth`** (integer), **`required`** (boolean). No `formula` in seed. Comments above array document that `col_position` is not stored.

### `table_schema_snapshot`

- **Written:** On `createAngebot` — payload field `tableSchemaSnapshot` validated and persisted (see [angebote.api.ts](src/features/angebote/api/angebote.api.ts) reference to `angebotColumnDefArraySchema.parse` for payload; exact insert line not re-read in full file).
- **Read:** `mapAngebotHeaderFromDb` parses JSON/string JSONB through `angebotColumnDefArraySchema.safeParse` — failed parse yields `null` snapshot on the in-memory row.
- **Shape:** Same as `AngebotColumnDef[]` as today.
- **Immutability:** `UpdateAngebotPayload` omits snapshot (types comment); offers keep snapshot after create.

### Every place `col.type`, `col.weight`, `col.minWidth`, `col.align` are read

**`col.type`**

- [AngebotPdfCoverBody.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx) lines 162, 195, 198 — `renderCell` switch and `textAlignForCol`.
- [step-2-positionen.tsx](src/features/angebote/components/angebot-builder/step-2-positionen.tsx) lines 130, 146, 164, 187 — input branching.
- [angebot-detail-view.tsx](src/features/angebote/components/angebot-detail-view.tsx) lines 158, 187–189, 193 — `formatDetailCell` and `alignClass`.
- [sortable-angebot-column-list.tsx](src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx) line 126 — chip label.
- [index.tsx](src/features/angebote/components/angebot-builder/index.tsx) line 212 — `section2Complete` first non-integer column.

**`col.weight`**

- [angebot-pdf-columns.ts](src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts) lines 156–160, 166–167, 195–198, 207–210 — `calcAngebotColumnWidths` only.

**`col.minWidth`**

- [angebot-pdf-columns.ts](src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts) lines 173, 179, 185, 193, 198 — `calcAngebotColumnWidths`.
- [AngebotPdfCoverBody.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx) lines 288, 329 — fallback when `colWidths[col.id]` missing.
- [angebot-vorlage-editor-panel.tsx](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx) line 301 — preview bar fallback.

**`col.align`**

- **Not present** on `AngebotColumnDef`. Closest: **`AngebotPdfCatalogColumnDef.align`** in [angebot-pdf-columns.ts](src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts) (legacy catalog rows) — used only through catalog metadata, not dynamic defs.

**Indirect via `profileToAngebotColumnDefs`:** [resolve-angebot-table-schema.ts](src/features/angebote/lib/resolve-angebot-table-schema.ts) sets `type`, `weight`, `minWidth` from `ANGEBOT_COLUMN_MAP` (lines 46–52).

---

## Architecture decisions

1. **Single resolver (`resolveColumnLayout`)** — Preset is the admin-facing concept; layout and PDF cell behaviour are centralized so PDF, HTML detail, builder, and width calc do not duplicate preset tables.

2. **`pdfRenderType` vs preset in `renderCell`** — Branching in PDF/HTML formatters must use **`pdfRenderType`** (text, integer, currency, currency_per_km) so a future preset tweak does not fork formatting in four places. If percent support is reintroduced, extend `pdfRenderType` explicitly rather than switching on preset key.

3. **Keep legacy catalog path** — `ANGEBOT_STANDARD_COLUMN_PROFILE` + `ANGEBOT_COLUMN_CATALOG` remain for offers without `table_schema_snapshot` until those rows are migrated or retired. `profileToAngebotColumnDefs` becomes a **producer of preset-based defs** instead of type/weight/minWidth defs.

4. **Per-offer preset override** — Draft `columnSchema` in the builder (create flow) already becomes `tableSchemaSnapshot` on submit via existing `createColumnSchema` state. A new callback from Step 2 to parent updates `createColumnSchema` in place without calling Vorlage API; template rows in DB stay unchanged.

5. **Pos. column** — Still injected only at render for PDF; not stored. Its layout must participate in the new width algorithm as **fixed width** (plan: align with user’s 36 pt target vs current `minWidth` 32 in auto-columns — **verify** during implementation).

6. **Available width constant** — Keep **`ANGEBOT_PDF_AVAILABLE_WIDTH = 515`**. The brief mentions “479 pt” for overflow messaging; treat as **internal check** = 515 minus fixed columns including Pos., or **⚠️ NEEDS DECISION** if a different cap is intended.

---

## Part 1 — New constants module

**Create:** [src/features/angebote/lib/angebot-column-presets.ts](src/features/angebote/lib/angebot-column-presets.ts)

**Export:**

- **Type name:** `AngebotColumnPreset` — union of exactly five string literal keys: `beschreibung`, `betrag`, `preis_km`, `notiz`, `anzahl` (must match product table; do not add or rename).

- **Interface name:** `AngebotColumnLayoutSpec` — fields as specified in the brief: `width` discriminated union (`fill` | `fixed` with pt | `auto` with flex), `align`, `pdfRenderType`, optional `inputStep` / `inputMin`, `maxHeaderChars` (e.g. 20 for all presets unless preset-specific).

- **Constant:** `COLUMN_PRESET_SPECS` — map from each preset key to its `AngebotColumnLayoutSpec`. Encode fixed pt values from brief: betrag and preis_km → 80 pt right; anzahl → 48 pt right; beschreibung → fill left; notiz → auto flex 2 left. Map `pdfRenderType`: beschreibung/notiz → text; betrag → currency; preis_km → currency_per_km; anzahl → integer.

- **Constant:** `COLUMN_PRESET_UI` — for each preset: `label`, `emoji`, `description` (German helper text for editor and builder dropdowns).

- **Function:** `defaultHeaderForPreset(preset)` — returns suggested German header per preset (e.g. Beschreibung, Betrag (€), etc.).

- **Function:** `resolveColumnLayout(col: AngebotColumnDef): AngebotColumnLayoutSpec` — looks up `COLUMN_PRESET_SPECS[col.preset]`; throws or returns safe fallback only if preset missing (should not happen after Zod). **Comment requirement:** state that **callers must not read `col.preset` directly** for layout/format — only through this function.

**Special case:** Synthetic injected Pos. column (`ANGEBOT_POSITION_COLUMN_ID`) may need **`resolveColumnLayoutForPosition()`** or a branch inside resolver keyed by id — document that Pos. is not a preset stored in JSON but still has a layout spec (fixed narrow width, left align, integer display).

---

## Part 2 — Type changes

**Modify:** [src/features/angebote/types/angebot.types.ts](src/features/angebote/types/angebot.types.ts)

- Import `AngebotColumnPreset` from presets module (or re-export preset type from types file — **decision:** keep preset type **defined in presets module** to avoid circular imports; types file imports it for Zod).

- **Zod:** Replace `angebotColumnTypeSchema` usage in column def with `z.enum([...])` of the five preset keys (or import a shared tuple from presets). New object shape: `id`, `header` (max 20 via `.max(20)`), `preset`, optional `required`, optional `formula`.

- **Remove** from stored schema: `type`, `weight`, `minWidth`.

- **`AngebotColumnType`:** Remove or mark **`@deprecated`** and keep temporarily only if needed for migration helpers — prefer **removing** from public exports once fallback lives in API layer.

**Files that import `AngebotColumnType` today (must be updated):** [angebot-vorlage-editor-panel.tsx](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx) (lines 43, 57–63, 98, 239).

**Files that depend on `AngebotColumnDef` shape:** listed in grep results — every file under `src/features/angebote/` that references `AngebotColumnDef` plus types-only imports in settings page.

**Inline comments:** On new Zod schema — “Stored JSONB must never include type/weight/minWidth after migration; API normalizes legacy rows on read.”

---

## Part 3 — Width algorithm rewrite

**Modify:** [src/features/angebot-pdf-columns.ts](src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts)

- **Keep** `ANGEBOT_PDF_AVAILABLE_WIDTH` export (515).

- **Replace** body of `calcAngebotColumnWidths(columns: AngebotColumnDef[])`:

  **Pseudocode:**

  1. For each column, call `resolveColumnLayout(col)` to get width mode.
  2. **Fixed** columns: assign exactly `pt` from spec (after Pos. column if caller prepends it — see below).
  3. **Remaining** = `ANGEBOT_PDF_AVAILABLE_WIDTH` − sum(fixed widths). If negative or zero → document behaviour: either scale down fixed columns proportionally (**⚠️ risky**) or assign mins and warn — **product decision**; plan recommends: **warn + disable save** in editor already; PDF clamps to mins with console warning mirroring today.
  4. **Fill** columns: if one or more, split **remaining** equally among all fill-mode columns.
  5. **Auto** columns: after fill allocation, take **remaining** after fill, distribute by `flex` ratio among auto columns.
  6. If multiple fill columns, equal split as specified.
  7. **Remainder** floating point: add to the **widest non-fixed** column (or largest fill) — comment which rule is chosen for determinism.

- **Interaction with Pos.:** Call sites (e.g. `AngebotPdfCoverBody`) already build `effectiveColumns = [ANGEBOT_POSITION_COLUMN, …userColumns]`. Width function receives that array; Pos. must use **fixed** layout from resolver (e.g. 36 pt — align with auto-columns constant). **Comment:** Pos. participates as first fixed column.

- **Edge cases (must be commented in code):**

  - No fill and no auto columns — only fixed columns.
  - Multiple fill columns — equal share of post-fixed space.
  - Sum of fixed (including Pos.) exceeds available — warn / degrade behaviour documented.

- **`ANGEBOT_COLUMN_CATALOG` / `calcAngebotPdfCatalogColumnWidths`:** **Keep** — still used for legacy key-based PDF path until profile mapping is fully preset-based. **Do not remove** `ANGEBOT_STANDARD_COLUMN_PROFILE` from types (see Open questions).

- **`ANGEBOT_STANDARD_COLUMN_PROFILE` string:** This constant lives in **angebot.types.ts**, not angebot-pdf-columns.ts — no removal in Part 3.

---

## Part 4 — PDF renderer changes

**Modify:** [AngebotPdfCoverBody.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx)

- Replace `renderCell` switch on `col.type` with switch (or map) on **`resolveColumnLayout(col).pdfRenderType`**. Keep **`col_position`** early return for row index.

- Replace `textAlignForCol(col)` implementation to use **`resolveColumnLayout(col).align`**, preserving special case for Pos. left alignment (existing comments).

- Replace `col.minWidth` fallbacks with **fixed minimum from layout spec** (e.g. 0 or a floor from preset) — document.

- **`legacyFallback`:** Keep until all line items reliably populate `data` for legacy offers and typed columns are dropped from DB — see Open questions for removal condition.

- **`coerceLineItemData`:** Keep while PostgREST can return stringified JSON for `data` — same rationale as invoice pdf-column-layout comment block.

**Modify:** [AngebotPdfDocument.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx)

- Only if `resolveAngebotPdfColumnSchema` needs to **normalize** legacy snapshot rows (prefer doing normalization in API — see Part 8). Otherwise minimal change.

**Comment:** PDF branching uses `pdfRenderType`, not `preset`, for separation of concerns.

---

## Part 5 — Template editor UI rewrite

**Modify:** [angebot-vorlage-editor-panel.tsx](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx)

- Remove type select, weight slider, min-width input.

- **Column list:** Each row: drag handle; **inline name** `Input` max 20 chars with live counter (e.g. “12/20”); **preset** `Select` showing emoji + label from `COLUMN_PRESET_UI`; delete button.

- **Locked Pos. row** at top of list (read-only): show “Pos.” + lock icon; not in reorder list; not saved to JSON.

- **Add column:** Single row at bottom: name + preset + “Übernehmen”; no modal.

- **Preset select:** On change, if name empty, set name from `defaultHeaderForPreset`.

- **Live preview bar:** Always visible; show resolved pt width per column (use new `calcAngebotColumnWidths` + column headers); **✓** if sum equals 515 (with epsilon); **⚠️** with message if not.

**Guardrails (German copy to implement exactly as specified by product — placeholders below if not yet finalised):**

- Two `beschreibung` columns: **allowed**, yellow inline warning (exact copy in implementation ticket).

- Six or more columns: yellow warning.

- Header over 20 chars: block save / hard validation.

- Header matches `/^pos\.?$/i`: keep existing reserved error.

- Delete last column: disable delete + tooltip (extend existing behaviour).

- Fixed columns consume space so fill columns get zero or negative remainder: **red** preview state, save disabled (mirror “Fixed columns leave no room for Pos.” requirement — include Pos. in fixed sum).

**Modify:** [sortable-angebot-column-list.tsx](src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx)

- Accept richer row renderer or pass `label` from parent — chip label becomes **emoji + header** (no raw type string).

---

## Part 6 — Step 2 builder UI changes

**Modify:** [step-2-positionen.tsx](src/features/angebote/components/angebot-builder/step-2-positionen.tsx)

- **Section A chips:** For each user column, show **preset emoji** + `header` (no alignment icon).

- **Inputs:** Derive HTML input kind from `resolveColumnLayout(col).pdfRenderType` and optional `inputStep` / `inputMin` from spec (map currency → number with 0.01, etc.).

- **Preset dropdown per column** in Section A (create mode only, or also edit mode for per-offer override — **recommend** allow in create only if edit snapshot is immutable; **⚠️** if edit should allow changing preset for existing offer, that contradicts Phase 2a immutability — **recommend** per-offer preset override **create flow only**).

- **Callback:** e.g. `onColumnPresetChange(columnId, newPreset)` to parent.

**Modify:** [index.tsx](src/features/angebote/components/angebot-builder/index.tsx)

- Implement callback: immutably map `createColumnSchema` to update matching column’s `preset` (and optionally trim header).

- **Comment (required):** “Preset change here is per-offer only — does not mutate the saved template.”

- **`section2Complete`:** Replace `c.type !== 'integer'` heuristic with preset-based rule — e.g. first column whose preset is not `anzahl`, or first `beschreibung`/`notiz` — document chosen rule to match product intent.

**`handleVorlageChange`:** Unchanged template semantics; still replaces full schema from template when picking another Vorlage.

---

## Part 7 — Migration

**Create:** New file under `supabase/migrations/` with timestamp **strictly after** `20260413120000_angebot_flexible_table.sql` (latest Angebote-related migration at plan time). Suggested name pattern: `20260414XXXXXX_angebot_column_presets.sql` (adjust when implementing).

**Content (pseudocode only):**

- For each row in `angebot_vorlagen`, parse `columns` jsonb array; for each object:

  - Map `type` to `preset` using rules: `currency`→`betrag`; `currency_per_km`→`preis_km`; `integer`→`anzahl`; `text` with weight ≥ 3→`beschreibung`; `text` with weight < 3→`notiz`; `percent`→`betrag` with SQL comment **“manual review — was percent”**.

  - Remove keys `type`, `weight`, `minWidth`, `align` if present.

  - Ensure `header` truncated to 20 chars **or** leave full and let app enforce — **⚠️ NEEDS DECISION** (recommend truncate in SQL for consistency).

- Same transformation for `angebote.table_schema_snapshot` where not null.

- **Idempotent:** Use `WHERE` clauses that detect legacy shape (e.g. first element still has `type` key) or use `jsonb_path_exists` — document exact predicate so re-run is no-op.

- **Seed data:** Update `jsonb_build_array` in **original** migration only if greenfield installs matter; for existing deployments rely on new migration. **Do not edit** `20260413120000` if already applied in production — use forward-only migration only (team rule).

**API behaviour before migration runs:** Rows still have `type`/`weight`/`minWidth` → Zod parse **fails** → `table_schema_snapshot` becomes `null` in mapper → `resolveAngebotPdfColumnSchema` falls back to legacy profile — **data visible but wrong schema**. **Part 8 runtime fallback** is mandatory so parse succeeds until SQL runs.

---

## Part 8 — API and legacy handling

**Modify:** [angebot-vorlagen.api.ts](src/features/angebote/api/angebot-vorlagen.api.ts) `rowFromDb`:

- After JSON parse, if objects have `type` and no `preset`, run **same mapping function** as SQL migration (shared TS helper in presets or `normalizeAngebotColumnDef` module).

- Then validate with **new** Zod schema.

- On write (create/update), strip any legacy keys before insert.

**Modify:** [angebote.api.ts](src/features/angebote/api/angebote.api.ts) `mapAngebotHeaderFromDb`:

- Apply identical normalization to `table_schema_snapshot` before `safeParse`.

**Removal gate for runtime fallback:** After migration verified on **all** environments (prod + staging) **and** no row returns legacy shape for a defined observation window — e.g. 30 days — remove fallback in a follow-up PR. Document this explicitly in code comment.

---

## Part 9 — Docs update

- **[docs/angebote-vorlagen.md](docs/angebote-vorlagen.md):** Replace width/type/weight/minWidth sections with preset model, resolver, snapshot rules, migration note.

- **[docs/angebote-module.md](docs/angebote-module.md):** Update column system bullet list, data flow (Step 3 no longer hosts template picker per current code — optional doc fix), PDF percent note if percent preset removed.

---

## Open questions (Step 4)

### `ANGEBOT_STANDARD_COLUMN_PROFILE` — survive?

**Recommendation:** **Yes, keep.** It is read in [AngebotPdfDocument.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx) lines 46–48 when snapshot and legacy override are absent. It becomes input to **`profileToAngebotColumnDefs`**, which must output **preset-based** `AngebotColumnDef[]`. The constant is not replaced by presets — it is the **ordered list of legacy keys** for default layout.

### `resolve-angebot-table-schema.ts` / `profileToAngebotColumnDefs`

**Not dead code.** It must map each `AngebotColumnKey` through `ANGEBOT_COLUMN_MAP` to pick the correct **preset** (e.g. leistung → beschreibung, anfahrtkosten → betrag, price_* → preis_km, notes → notiz, position → **⚠️** position key today maps to id `position` string — verify vs injected Pos. column id — may need special case).

### Per-offer preset override → `table_schema_snapshot`

**Flow:** Step 2 calls parent → `setCreateColumnSchema` updates draft → `columnSchema` memo → `createAngebotMutation` payload `tableSchemaSnapshot` already taken from builder state in [index.tsx](src/features/angebote/components/angebot-builder/index.tsx) (draft object uses `columnSchema` for create). No template API call. **Edit mode:** snapshot immutable — preset override in builder should be **disabled** or only affect preview draft without persisting (confirm product).

### `legacyFallback` removal condition

Remove when **all** of: (1) every `angebot_line_items` row has non-empty `data` for all snapshot column ids; (2) deprecated typed columns removed from schema or always null; (3) no production offer relies on `leistung` / `anfahrtkosten` scalar fallback. Verify with SQL audit query before deletion.

### `percent` type / preset gap

**⚠️ NEEDS DECISION.** Today percent renders as tax-rate-style % in PDF and as raw `%` in detail view. Mapping migration to **`betrag`** mis-renders stored 0–100 values as euros. **Recommendation:** Either add **`pdfRenderType` value `percent`** reserved for legacy normalized preset, or map percent → **`notiz`** with string formatting, or run data migration to clear percent columns. Product must sign off.

### Fixed total vs 479 pt vs 515 pt

Brief mentions 479 pt overflow; codebase uses **515 pt**. **⚠️ NEEDS DECISION:** use 515 minus fixed total for “no room” detection, or clarify 479 as typo.

---

## What must NOT change

- **`ANGEBOT_LEGACY_COLUMN_IDS`** literals and SQL backfill comment alignment (ids stable).

- **RLS / grants** on `angebot_vorlagen`.

- **Immutability** of `table_schema_snapshot` and `angebot_vorlage_id` on edit (Phase 2a rule).

- **Invoice** `pdf-column-layout.ts` and invoice Vorlagen — read-only reference.

- **Shared** invoice header/footer components contract.

---

## Files changed table (implementation)

| File | Change |
|------|--------|
| [src/features/angebote/lib/angebot-column-presets.ts](src/features/angebote/lib/angebot-column-presets.ts) | **Create** — presets, specs, UI map, resolvers, migration helper for type→preset |
| [src/features/angebote/types/angebot.types.ts](src/features/angebote/types/angebot.types.ts) | Preset-based `AngebotColumnDef` + Zod; deprecations |
| [src/features/angebote/lib/angebot-auto-columns.ts](src/features/angebote/lib/angebot-auto-columns.ts) | Pos. column matches new def shape / resolver |
| [src/features/angebote/lib/resolve-angebot-table-schema.ts](src/features/angebote/lib/resolve-angebot-table-schema.ts) | Emit preset-based defs |
| [src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts](src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts) | New width algorithm |
| [src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx) | Layout + render from resolver |
| [src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx](src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx) | Optional normalize hook if not only in API |
| [src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx](src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx) | Full editor UX rewrite |
| [src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx](src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx) | Chip labels; optional inline editors |
| [src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-settings-page.tsx](src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-settings-page.tsx) | `SYSTEM_DEFAULT_ANGEBOT_COLUMNS` preset shape |
| [src/features/angebote/components/angebot-builder/step-2-positionen.tsx](src/features/angebote/components/angebot-builder/step-2-positionen.tsx) | Preset chips, inputs, override dropdown |
| [src/features/angebote/components/angebot-builder/index.tsx](src/features/angebote/components/angebot-builder/index.tsx) | Callback, `section2Complete` |
| [src/features/angebote/components/angebot-detail-view.tsx](src/features/angebote/components/angebot-detail-view.tsx) | Align + format via resolver |
| [src/features/angebote/api/angebot-vorlagen.api.ts](src/features/angebote/api/angebot-vorlagen.api.ts) | Read/write normalization |
| [src/features/angebote/api/angebote.api.ts](src/features/angebote/api/angebote.api.ts) | Snapshot normalization on read; payload validation |
| [src/features/angebote/hooks/use-angebot-builder.ts](src/features/angebote/hooks/use-angebot-builder.ts) | Types only unless new props needed |
| `supabase/migrations/NEWER_than_20260413120000_*.sql` | **Create** — JSONB migration |
| [docs/angebote-vorlagen.md](docs/angebote-vorlagen.md) | Rewrite column sections |
| [docs/angebote-module.md](docs/angebote-module.md) | Update references |

**Possibly affected (verify during implementation):** any test file under `src/features/angebote/**/__tests__` if present **(unconfirmed — verify before implementing)**; PDF preview hook [use-angebot-builder-pdf-preview.tsx](src/features/angebote/components/angebot-builder/use-angebot-builder-pdf-preview.tsx) **(unconfirmed — not read)**.

---

## Post-implementation verification

- `bun run build` and `bun test` pass.

- Manual: create offer with template, override preset in Step 2, confirm PDF + DB snapshot match.

- Manual: legacy offer without snapshot still renders via standard profile path.
