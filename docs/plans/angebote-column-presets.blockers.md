# Pre-implementation blockers — Angebotsvorlagen column preset system
Generated: 2026-04-14
Status: RESOLVED

## Q1 — percent type

### Step 1a — Migration seed (`20260413120000_angebot_flexible_table.sql`)

- **Finding**: The seed `INSERT INTO public.angebot_vorlagen ... jsonb_build_array(...)` contains 5 column objects:
  - `col_leistung` (`type`: `text`)
  - `col_anfahrtkosten` (`type`: `currency`)
  - `col_price_first_5km` (`type`: `currency_per_km`)
  - `col_price_per_km_after_5` (`type`: `currency_per_km`)
  - `col_notes` (`type`: `text`)
- **Percent in seed**: **None** (no object in the seed has `type = 'percent'`).

### Step 1b — Settings page defaults (`SYSTEM_DEFAULT_ANGEBOT_COLUMNS`)

File: `src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-settings-page.tsx`

- **Finding**: `SYSTEM_DEFAULT_ANGEBOT_COLUMNS` defines the same 5 columns as the migration seed.
- **Percent in defaults**: **None** (no entry has `type: 'percent'`).

### Step 1c — Editor type options (`TYPE_OPTIONS`)

File: `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`

- **Finding**: `TYPE_OPTIONS` includes `'percent'` as a selectable option (array contains: `text`, `integer`, `currency`, `currency_per_km`, `percent`).
- **Percent selectable by admin today**: **YES** (reachable via the template editor “Typ” dropdown).

### Step 1d — `AngebotColumnType`

File: `src/features/angebote/types/angebot.types.ts`

- **Finding**: `AngebotColumnType` includes `'percent'` via `angebotColumnTypeSchema`.

### Answers + recommendation

- **Is percent reachable by an admin today?** **YES** (selectable in the template editor).
- **Does percent appear in any seed data?** **NO**.
- **Does percent appear in settings-page default data?** **NO**.

**Recommendation:** Treat percent as live/possible data (because it is admin-reachable) and preserve correct rendering semantics during the preset migration. Add **`pdfRenderType: 'percent'` as a sixth render type value (render-type only, not a sixth preset)** and implement runtime normalization so legacy `{ type: 'percent' }` columns render as percent after migration. Do **not** expose a “percent preset” in the UI.

**Concrete approach (recommended):**

- Legacy normalization maps `type: 'percent'` to preset `'betrag'` (or another preset) **but** forces `pdfRenderType: 'percent'` at runtime for those columns (legacy-only path), so values stored as 0–100 continue to render as percent instead of euros.
- This avoids introducing a new admin concept while preventing silent data corruption/misrendering.

**Final decision:** **Percent is admin-reachable today → keep percent rendering via a legacy-only `pdfRenderType: 'percent'` bridge (no new preset).**

## Q2 — Migration files 20260412140000 and 20260412150000

### `20260412140000_client_price_tags.sql`

- **Touches Angebot tables (`angebote`, `angebot_line_items`, `angebot_vorlagen`)?** **NO**
- **Alters/renames/drops columns on Angebot tables?** **NO**
- **Adds constraints/indexes/triggers on Angebot tables?** **NO** (indexes are on `client_price_tags`)
- **Modifies RLS policies on Angebot tables?** **NO** (RLS created for `client_price_tags`)
- **References `table_schema_snapshot` or line `data` JSONB?** **NO**

**Verdict:** No conflict — does not touch Angebot tables.

### `20260412150000_fix_cpt_rls.sql`

- **Touches Angebot tables (`angebote`, `angebot_line_items`, `angebot_vorlagen`)?** **NO**
- **Alters/renames/drops columns on Angebot tables?** **NO**
- **Adds constraints/indexes/triggers on Angebot tables?** **NO**
- **Modifies RLS policies on Angebot tables?** **NO** (drops/recreates policies on `client_price_tags` only)
- **References `table_schema_snapshot` or line `data` JSONB?** **NO**

**Verdict:** No conflict — does not touch Angebot tables.

## Q3 — ANGEBOT_POSITION_COLUMN width

File: `src/features/angebote/lib/angebot-auto-columns.ts`

### Current definition (as-is today)

- **minWidth**: `32`
- **type**: `'integer'`
- **weight**: `1`

### Is it read/imported outside `angebot-auto-columns.ts`?

**Imports of `ANGEBOT_POSITION_COLUMN`:**

- `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx` (imports `ANGEBOT_POSITION_COLUMN` and uses it for width preview input array)
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` (imports `ANGEBOT_POSITION_COLUMN` and prepends it to `effectiveColumns`)

**Imports of `ANGEBOT_POSITION_COLUMN_ID` (relevant to injection/filters):**

- `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`

### Confirmed decision statement

Product decision (confirmed): ANGEBOT_POSITION_COLUMN will use preset: 'anzahl' at runtime, giving it fixed 48pt, right aligned, integer. It is injected at render time only and never stored. Any current minWidth or weight value is irrelevant after the preset system lands — those fields will be removed from ANGEBOT_POSITION_COLUMN's definition.

- **Current minWidth vs product fixed width**: current `minWidth = 32`, product fixed width is `48`.
- **Impact**: ⚠️ visual delta of **+16pt** — all existing offer PDFs will shift column widths by 16pt. Acceptable per product decision.

## Overall status

All three questions resolved. Implementation prompt may proceed.

