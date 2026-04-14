# Angebotsvorlagen (offer table templates)

Angebotsvorlagen define the **column schema** for offer line-item tables: stable column `id`, German `header` (max 20 chars), **`preset`**, and optional `required` / `formula` (formula reserved for future calculated columns; not evaluated in Phase 2a).

The stored shape never contains `type`, `weight`, `minWidth`, or `align` after the preset migration — layout and formatting are derived at runtime via `resolveColumnLayout()`.

They are stored in **`public.angebot_vorlagen`** (parallel to invoice **`pdf_vorlagen`** — separate table, no shared rows).

## Database

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid | PK |
| `company_id` | uuid | FK → `companies(id)` ON DELETE CASCADE |
| `name` | text | |
| `description` | text? | |
| `is_default` | boolean | At most one `true` per company (partial unique index) |
| `columns` | jsonb | Array of column definition objects (validated in app with Zod) |
| `created_at` / `updated_at` | timestamptz | |

RLS: same pattern as `angebote` / `angebot_line_items` — admin + `company_id = current_user_company_id()`.

Migration: `supabase/migrations/20260413120000_angebot_flexible_table.sql` (also adds `angebote.angebot_vorlage_id`, `angebote.table_schema_snapshot`, `angebot_line_items.data`, backfill, seed per company).

## Cascade into offers and PDFs

1. **Per-offer frozen schema** — `angebote.table_schema_snapshot` is a copy of the template’s `columns` at **create** time. Phase 2a: **immutable** on edit; `updateAngebot` does not overwrite it (or `angebot_vorlage_id` / legacy `pdf_column_override`).
2. **Template row** — `angebote.angebot_vorlage_id` records which Vorlage was chosen (audit).
3. **Company default** — `angebot_vorlagen.is_default` pre-selects a template in the builder (create flow).
4. **System seed** — migration inserts a **Standard** five-column template for every company that has none (`NOT EXISTS` guard).

**Editing templates in settings does not change existing offers** — each offer keeps its own snapshot.

## Line item storage

Row values live in **`angebot_line_items.data`** (jsonb), keyed by column `id` from the snapshot. Legacy typed columns (`leistung`, `anfahrtkosten`, …) remain on the table for backward compatibility; new creates write **`data` only** (typed columns get empty/null placeholders). Well-known ids match `ANGEBOT_LEGACY_COLUMN_IDS` in `src/features/angebote/lib/angebot-legacy-column-ids.ts`.

## PDF column resolution

Implemented in `resolveAngebotPdfColumnSchema()` (`AngebotPdfDocument.tsx`):

1. `table_schema_snapshot` (Phase 2a+)
2. Legacy `pdf_column_override` profile (pre–Phase 2a rows only)
3. `ANGEBOT_STANDARD_COLUMN_PROFILE` + catalog mapping via `profileToAngebotColumnDefs()` (`resolve-angebot-table-schema.ts`)

Percent cells are stored as **0–100** in `data`; the PDF and detail view render them as `X %`.

## Width algorithm

`calcAngebotColumnWidths(columns)` in `angebot-pdf-columns.ts` distributes **`ANGEBOT_PDF_AVAILABLE_WIDTH` (515 pt)** using preset layout specs:

- fixed columns: use the preset’s fixed pt width
- fill columns: split remaining width equally
- auto columns: split remaining-after-fill proportionally by flex

**Important:** call sites must not branch on `col.preset` directly for layout or formatting. Always call `resolveColumnLayout(col)` (single source of truth).

Invoice main table inner width uses **499 pt** (`pdf-column-layout.ts`) — different padding/table layout.

## Presets

Stored presets (`AngebotColumnPreset`) and their semantics live in `src/features/angebote/lib/angebot-column-presets.ts`:

- `beschreibung`: fill, left, text
- `betrag`: fixed 80pt, right, currency (step 0.01, min 0)
- `preis_km`: fixed 80pt, right, currency_per_km (step 0.01, min 0)
- `notiz`: auto flex 2, left, text
- `anzahl`: fixed 48pt, right, integer (step 1, min 0)
- `percent`: fixed 60pt, right, percent (step 0.1, min 0, max 100)

`percent` exists as a first-class preset to render existing/legacy templates correctly, but is **not selectable** in the admin preset dropdown.

## Migration strategy

- SQL: `supabase/migrations/20260414100000_angebot_column_presets.sql` migrates JSONB arrays in:
  - `angebot_vorlagen.columns`
  - `angebote.table_schema_snapshot`
- Runtime bridge: both APIs normalize legacy `{ type, weight, minWidth }` column objects on read via `normalizeLegacyColumn()` until all environments have applied the SQL migration.

## UI routes and files

| Area | Path |
|------|------|
| Settings | `/dashboard/abrechnung/angebot-vorlagen` — `src/app/dashboard/abrechnung/angebot-vorlagen/page.tsx` |
| Settings shell | `src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-settings-page.tsx` |
| Editor | `angebot-vorlage-editor-panel.tsx` (live width preview uses `calcAngebotColumnWidths`) |
| List panel | `angebot-vorlagen-panel.tsx` |
| Sortable columns | `sortable-angebot-column-list.tsx` |
| API | `src/features/angebote/api/angebot-vorlagen.api.ts` |
| Hooks | `src/features/angebote/hooks/use-angebot-vorlagen.ts` |
| Query keys | `angebotKeys.vorlagen` in `src/query/keys/angebote.ts` |

Navigation: **Abrechnung → Angebotsvorlagen** (`src/config/nav-config.ts`).
