# Angebot-Builder

This document describes how the TaxiGo **Angebot-Builder** (quote builder) determines and persists the line-item table schema (`columnSchema`) across create/edit flows.

## Schema hydration in edit mode

### Create mode (`/dashboard/angebote/new`)

- **Template selection**: the user selects an Angebotsvorlage in Step 2.\n- **Schema source**: the builder uses the selected Vorlage’s `columns`.\n- **Persistence**: on create, the resolved schema is written into `angebote.table_schema_snapshot` and becomes the snapshot used by PDFs and detail views.

Relevant code:\n- `src/features/angebote/components/angebot-builder/index.tsx` (`handleVorlageChange`, create payload)\n- `src/features/angebote/api/angebote.api.ts` (`createAngebot` writes `table_schema_snapshot`)

### Edit mode for non-drafts (sent/accepted/declined)

- **Template selector**: read-only (cannot change template identity).\n- **Schema source**: **frozen** to `angebote.table_schema_snapshot` (or legacy fallback) via `resolveAngebotPdfColumnSchema(angebot)`.\n- **Persistence**: snapshot is intentionally immutable; the normal edit update path must never overwrite it.

Relevant code:\n- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` (`resolveAngebotPdfColumnSchema` precedence)\n- `src/features/angebote/types/angebot.types.ts` (`UpdateAngebotPayload` omits `table_schema_snapshot`)\n- `src/features/angebote/api/angebote.api.ts` (`updateAngebot` does not write `table_schema_snapshot`)

### Edit mode for drafts (draft schema refresh)

Goal: drafts should reflect **live template columns** if admins add new columns to the Vorlage after the draft was created.

- **Template selector**: read-only (template identity does not change).\n- **Schema source**: when editing an Angebot with `status === 'draft'`, the builder prefers the live Vorlage’s `columns` (looked up by `angebot_vorlage_id`). If the Vorlage is missing or has no columns, it falls back to the stored snapshot.\n- **Row compatibility**: when the live schema first loads, existing line-item rows are patched to include `null` values for any newly added column IDs. Existing values are preserved; orphaned keys are kept.\n- **Persistence on save**: draft edits persist the refreshed schema back into `angebote.table_schema_snapshot` using a dedicated API function guarded by `status='draft'`.

Relevant code:\n- `src/features/angebote/components/angebot-builder/index.tsx` (live schema hydration + reconciliation)\n- `src/features/angebote/hooks/use-angebot-builder.ts` (optional `liveColumnSchema` passed into edit save)\n- `src/features/angebote/api/angebote.api.ts` (`updateDraftAngebotSchema` with `.eq('status','draft')` guard)

