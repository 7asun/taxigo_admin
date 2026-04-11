# Rechnungsvorlagen (Baukasten System)

## Overview

The Baukasten system allows you to create and manage reusable text blocks for invoice PDFs. These templates are stored in the `invoice_text_blocks` table and can be linked to specific payers (Kostenträger) or used as company-wide defaults.

## Fallback Chain (Priority Order)

### Issued invoice PDF (frozen row)

For **issued** invoices, text comes from the snapshot columns on the invoice
row and joined blocks — not recomputed from Vorlage or payer defaults.

### Builder defaults (new draft — Phase 10)

When pre-filling the builder **Bestätigung** step, intro/outro block IDs are
resolved in this order:

1. **Vorlage-level** — `pdf_vorlagen.intro_block_id` / `outro_block_id` when set
2. **Payer-specific** — `payers.default_intro_block_id` / `default_outro_block_id`
3. **Company default** — `invoice_text_blocks` with `is_default = true` for the type
4. **No selection** — user may pick manually; PDF can still use hardcoded fallbacks where applicable

### PDF render (general)

When generating an invoice PDF, intro/outro content is resolved for display
using the invoice’s stored block IDs and the chain above for defaults where
no snapshot exists yet — see `InvoicePdfCoverBody` and builder preview hooks.

The standalone settings route `/dashboard/settings/invoice-templates` **redirects**
to `/dashboard/abrechnung/vorlagen` (tab **Textbausteine**).

## Database Schema

### Table: `invoice_text_blocks`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `company_id` | UUID | FK to `company_profiles` — multi-tenant scope |
| `name` | VARCHAR(100) | Human-readable template name (e.g., "Standard", "Förmlich-Behörde") |
| `type` | VARCHAR(10) | 'intro' (Einleitung) or 'outro' (Schlussformel) |
| `content` | TEXT | The actual text content rendered in PDF |
| `is_default` | BOOLEAN | If true, this is the company-wide default for its type |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp |

### Constraints

- **Unique name per type per company**: `(company_id, type, name)` must be unique
- **Single default per type per company**: Partial unique index on `(company_id, type)` where `is_default = true`

### Modified Table: `payers`

Two columns added to link payers to their preferred text blocks:

| Column | Type | Description |
|--------|------|-------------|
| `default_intro_block_id` | UUID | FK to `invoice_text_blocks` — preferred intro text |
| `default_outro_block_id` | UUID | FK to `invoice_text_blocks` — preferred outro text |

Both columns have `ON DELETE SET NULL` — if a text block is deleted, payers using it fall back to the company default.

## UI Locations

### Settings Page

**Route:** `/dashboard/abrechnung/vorlagen` → tab **Textbausteine** (legacy
`/dashboard/settings/invoice-templates` redirects here)

- Manage all text blocks (create, edit, delete)
- Organized by type: Einleitungen and Schlussformeln
- Set company defaults
- Preview text blocks in context

### Payer Form

**Route:** `/dashboard/payers` → Select payer → "Rechnungsvorlagen" section

- Assign specific intro/outro templates to individual payers
- Link to manage templates in new tab
- Save assignments per payer

## API Endpoints

### Text Blocks API

All endpoints are in `@/features/invoices/api/invoice-text-blocks.api.ts`:

- `listInvoiceTextBlocks()` — List all blocks grouped by type
- `listAllInvoiceTextBlocks()` — List all blocks as flat array
- `createInvoiceTextBlock(input)` — Create new block
- `updateInvoiceTextBlock(id, input)` — Update existing block
- `deleteInvoiceTextBlock(id)` — Delete block
- `setInvoiceTextBlockAsDefault(id)` — Set as company default

### Payer Text Block Links

- `getPayerWithTextBlocks(payerId)` — Get payer with linked blocks
- `updatePayerTextBlocks(payerId, introId, outroId)` — Update payer assignments

## React Query Keys

All queries use the key factory in `@/query/keys/invoices.ts`:

```typescript
invoiceKeys.textBlocks.all      // ['invoice-text-blocks']
invoiceKeys.textBlocks.list()   // ['invoice-text-blocks', 'list']
invoiceKeys.textBlocks.detail(id) // ['invoice-text-blocks', 'detail', id]
```

## TypeScript Types

Defined in `@/features/invoices/types/invoice-text-blocks.types.ts`:

- `InvoiceTextBlock` — Full row type
- `CreateInvoiceTextBlockInput` — Create payload
- `UpdateInvoiceTextBlockInput` — Update payload
- `PayerWithTextBlocks` — Extended payer type
- `GroupedTextBlocks` — { intro: [], outro: [] }

## PDF Generation

### Component Props

`InvoicePdfCoverBody` now accepts optional text props:

```typescript
interface InvoicePdfCoverBodyProps {
  // ... other props ...
  introText?: string | null;  // Einleitung text
  outroText?: string | null;  // Schlussformel text
}
```

### Usage

The `InvoicePdfDocument` accepts these props and passes them to `InvoicePdfCoverBody`:

```tsx
<InvoicePdfDocument
  invoice={invoice}
  paymentQrDataUrl={qrUrl}
  introText={resolvedIntroText}
  outroText={resolvedOutroText}
/>
```

If no text is provided, hardcoded defaults are used.

## Default Text (Hardcoded Fallbacks)

### Einleitung (Intro)

> vielen Dank für Ihr Vertrauen. Nachfolgend berechnen wir Ihnen die erbrachten Personenbeförderungsleistungen gemäß den vereinbarten Konditionen.

### Schlussformel (Outro)

> Wir bedanken uns herzlich für Ihr Vertrauen in unsere Dienstleistungen und stehen Ihnen bei Fragen oder Anliegen gerne zur Verfügung. Bitte kontaktieren Sie uns gerne hierzu unter {phone}.

## Salutation Logic

The salutation (Anrede) is auto-detected based on the recipient:

- **Client billed** (`per_client` or `single_trip` mode with client):
  - If `client.greeting_style = 'Herr'`: "Sehr geehrter Herr {last_name},"
  - If `client.greeting_style = 'Frau'`: "Sehr geehrte Frau {last_name},"
  - Otherwise: "Sehr geehrte Damen und Herren,"

- **Payer billed** (default): "Sehr geehrte Damen und Herren,"

## Row Level Security (RLS)

The `invoice_text_blocks` table has RLS policies ensuring users can only:
- View blocks belonging to their company
- Create blocks for their company
- Update/delete blocks belonging to their company

## Best Practices

1. **Company defaults first**: Set up company-wide defaults before linking to payers
2. **Meaningful names**: Use descriptive names like "Standard", "Förmlich-Behörde", "Freundlich-Privat"
3. **Character limits**: UI enforces 2000 characters per block
4. **Testing**: Preview PDFs to see text in context before saving

## Migration

Created migration: `20260401190000_create_invoice_text_blocks.sql`

- Creates `invoice_text_blocks` table
- Adds columns to `payers` table
- Adds RLS policies
- Adds column comments

## Relationship to PDF-Vorlagen (Phase 6)

Text templates (`invoice_text_blocks`) and PDF-Vorlagen (`pdf_vorlagen`) are **separate systems** that both affect the invoice PDF:

| System | Controls | Table | Priority chain |
|--------|----------|-------|----------------|
| Text templates | Intro / outro text content | `invoice_text_blocks` | payer default → company default → hardcoded |
| PDF-Vorlagen | Column layout (which columns, what order, grouped vs flat) | `pdf_vorlagen` | invoice override → payer Vorlage → company default → system constants |

Both are resolved independently in `InvoicePdfDocument` and passed as separate props to `InvoicePdfCoverBody`. They do not interact — a Vorlage does not reference a text template and vice versa.
