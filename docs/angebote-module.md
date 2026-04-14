# Angebote Module

> See [access-control.md](access-control.md) for the full role-based access control architecture.

Full template / snapshot spec: [angebote-vorlagen.md](angebote-vorlagen.md).

## Architecture overview

The Angebote (Offers) feature is scoped under `src/features/angebote/` and mirrors the invoice builder architecture. Offers are **free-text pricing documents** — they have no link to trips, no tax totals, and no SEPA QR block.

### Folder layout

```
src/features/angebote/
├── api/
│   ├── angebote.api.ts
│   └── angebot-vorlagen.api.ts
├── components/
│   ├── angebot-builder/
│   │   ├── index.tsx
│   │   ├── step-1-empfaenger.tsx
│   │   ├── step-2-positionen.tsx   # dynamic inputs from columnSchema
│   │   ├── step-3-details.tsx      # dates + Tiptap
│   │   ├── angebot-tiptap-field.tsx
│   │   └── use-angebot-builder-pdf-preview.tsx
│   ├── angebot-vorlagen/           # settings UI (list + editor)
│   ├── angebot-pdf/
│   │   ├── angebot-pdf-columns.ts  # legacy catalog + calcAngebotColumnWidths
│   │   ├── AngebotPdfCoverBody.tsx
│   │   └── AngebotPdfDocument.tsx  # exports resolveAngebotPdfColumnSchema
│   ├── angebote-list-view.tsx
│   └── angebot-detail-view.tsx
├── hooks/
│   ├── use-angebote.ts
│   ├── use-angebot-builder.ts
│   └── use-angebot-vorlagen.ts
├── lib/
│   ├── angebot-number.ts
│   ├── angebot-legacy-column-ids.ts
│   └── resolve-angebot-table-schema.ts  # profileToAngebotColumnDefs
└── types/
    └── angebot.types.ts            # AngebotColumnDef, Zod schemas, payloads
```

### Data flow

```
app/dashboard/angebote/new
  → AngebotBuilder
      → useAngebotVorlagenList(companyId) + default template
      → Step1Empfaenger
      → Step2Positionen(columnSchema, data per row)
      → Step3Details
      → useAngebotBuilderPdfPreview → AngebotPdfDocument
      → createAngebot({ tableSchemaSnapshot, angebotVorlageId, line_items: { data } })
```

---

## DB schema reference

### `public.angebote`

| Column | Type | Notes |
|--------|------|--------|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | **FK → `public.companies(id)`** — same as invoices / `accounts.company_id`. |
| `angebot_number` | `text` | Unique, format `AG-YYYY-MM-NNNN` |
| `status` | `angebot_status` | `draft \| sent \| accepted \| declined` |
| `recipient_company` | `text?` | |
| `recipient_first_name` / `recipient_last_name` | `text?` | Primary name fields for PDF salutation |
| `recipient_name` | `text?` | Legacy / denormalized full name |
| `recipient_anrede` | `text?` | `'Herr' \| 'Frau'` |
| `recipient_street` … `recipient_city` | `text?` | |
| `recipient_email` / `recipient_phone` | `text?` | CRM; not on PDF window |
| `customer_number` | `text?` | PDF meta grid |
| `subject` | `text?` | |
| `valid_until` | `date?` | |
| `offer_date` | `date` | |
| `intro_text` / `outro_text` | `text?` | HTML (Tiptap) |
| `angebot_vorlage_id` | `uuid?` | FK → `angebot_vorlagen`; set at create; Phase 2a immutable on edit |
| `table_schema_snapshot` | `jsonb?` | Frozen `AngebotColumnDef[]` at create; Phase 2a immutable on edit |
| `pdf_column_override` | `jsonb?` | **Deprecated** — legacy `AngebotColumnProfile` for pre–Phase 2a rows; new creates set `null` |
| `created_at` / `updated_at` | `timestamptz` | |

### `public.angebot_vorlagen`

Company-scoped templates. See [angebote-vorlagen.md](angebote-vorlagen.md).

### `public.angebot_line_items`

| Column | Type | Notes |
|--------|------|--------|
| `id` | `uuid` | PK |
| `angebot_id` | `uuid` | FK → `angebote(id)` CASCADE |
| `position` | `integer` | 1-based order |
| `data` | `jsonb` | Cell values keyed by column `id` from `table_schema_snapshot` |
| `leistung`, `anfahrtkosten`, … | typed | **Deprecated** — mirrored into `data` for legacy reads; new rows use `data` only at insert |

### RLS

`angebot_vorlagen` uses the same admin + `current_user_company_id()` pattern as `angebote` / `angebot_line_items`.

### Migrations

- `20260413120000_angebot_flexible_table.sql` — `angebot_vorlagen`, snapshot + FK on `angebote`, `data` on line items, backfill, seed per company, RLS.

---

## Offer number format

**Format:** `AG-{YYYY}-{MM}-{NNNN}`

**RPC:** `angebot_numbers_max_for_prefix(p_prefix text)` — `SECURITY DEFINER`, admin-only.

**Retry on conflict** on unique `angebot_number`.

---

## Status lifecycle

Unchanged: `draft → sent → accepted | declined` (see detail page actions).

---

## PDF structure

**Page:** `styles.angebotPage` — shorter bottom padding than invoice `page` (see existing doc section).

**Body:** `AngebotPdfCoverBody` receives **`columnSchema: AngebotColumnDef[]`** resolved by `resolveAngebotPdfColumnSchema()` (snapshot → legacy profile → standard catalog). Table widths from **`calcAngebotColumnWidths`** targeting **`ANGEBOT_PDF_AVAILABLE_WIDTH` (515 pt)**.

**Percent:** stored 0–100 in `data`; rendered as `X %` in PDF and detail view.

**JSONB:** `data` may arrive as a string from PostgREST — `coerceLineItemData` in `AngebotPdfCoverBody` mirrors the invoice `pdf-column-layout` / `parseJsonbField` approach.

---

## Salutation logic

Implemented in `buildSalutation()` using `recipient_anrede`, `recipient_first_name`, `recipient_last_name`, and legacy `recipient_name`:

- **Herr / Frau** with last name → „Sehr geehrter Herr …“ / „Sehr geehrte Frau …“ (last name only; legacy full string falls back to last token).
- **No anrede** but names → „Guten Tag {first} {last},“
- **No usable name** → „Sehr geehrte Damen und Herren,“

---

## Column system (Phase 2a)

- **Templates:** `angebot_vorlagen.columns` — editable under **Abrechnung → Angebotsvorlagen** (`/dashboard/abrechnung/angebot-vorlagen`).
- **Snapshot:** each offer stores its own `table_schema_snapshot` at creation.
- **Legacy:** `ANGEBOT_STANDARD_COLUMN_PROFILE` + `ANGEBOT_COLUMN_CATALOG` in `angebot-pdf-columns.ts` remain as **fallback** when snapshot and `pdf_column_override` are absent.
- **Well-known ids:** `angebot-legacy-column-ids.ts` + SQL migration comments keep backfill strings aligned.
- **Presets:** `AngebotColumnDef` stores `preset` (not `type/weight/minWidth`). Layout and formatting are derived via `resolveColumnLayout(col)` in `angebot-column-presets.ts`. Do not switch on `col.preset` outside that module for layout/formatting decisions.

---

## Shared infrastructure

| Asset | Usage |
|-------|--------|
| `InvoicePdfCoverHeader` / `InvoicePdfFooter` | Reused with `metaConfig` |
| `InvoiceBuilderPdfPanel` | Preview iframe |
| `invoice_text_blocks` | Intro/outro templates |
| `BuilderSectionCard` | Sections |

Changes to shared invoice components must stay backward-compatible.
