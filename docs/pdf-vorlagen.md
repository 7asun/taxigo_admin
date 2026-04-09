# PDF-Vorlagen (Spalten-Layout-System)

> See [access-control.md](access-control.md) for the full role-based access control architecture.


## Overview

PDF-Vorlagen define which columns appear in the invoice PDF main table and appendix, in what order, and with what layout mode (grouped by route or flat per-trip). A Vorlage is resolved automatically per invoice via a 4-level priority chain — no dispatcher action is required unless they want to override for a specific invoice.

## Resolution chain (priority order)

| Level | Source | When it wins |
|-------|--------|----------------|
| 1 | `invoices.pdf_column_override` | Dispatcher explicitly customised columns in builder Step 4 |
| 2 | `payers.pdf_vorlage_id` | Kostenträger has an assigned Vorlage |
| 3 | `pdf_vorlagen` where `is_default = true` | Company-wide default Vorlage exists |
| 4 | `SYSTEM_DEFAULT_*` in `pdf-column-catalog.ts` | No Vorlage configured at any level |

Implemented in [`src/features/invoices/lib/resolve-pdf-column-profile.ts`](../src/features/invoices/lib/resolve-pdf-column-profile.ts).

**Important:** The resolver returns `main_columns` exactly as stored. It never filters by layout compatibility — that is the renderer’s job. This preserves saved user preferences even if the system adds new `flatOnly` / `groupedOnly` flags later.

## Database schema

### Table: `pdf_vorlagen`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `company_id` | UUID | FK to `company_profiles` — multi-tenant scope |
| `name` | VARCHAR | Human-readable name (e.g. "Standard", "Reha Kompakt") |
| `main_columns` | `text[]` | Ordered list of column keys for the main page table |
| `appendix_columns` | `text[]` | Ordered list of column keys for the appendix table |
| `main_layout` | text | `grouped` or `flat` |
| `is_default` | boolean | At most one `true` per company (partial unique index) |
| `created_at` | timestamptz | Creation timestamp |

### Modified tables

| Table | Column | Description |
|-------|--------|-------------|
| `payers` | `pdf_vorlage_id` | FK to `pdf_vorlagen`; `ON DELETE SET NULL` |
| `invoices` | `pdf_column_override` | JSONB snapshot of full `PdfColumnProfile` at creation; immutable |

## Column catalog

All available columns are defined in [`src/features/invoices/lib/pdf-column-catalog.ts`](../src/features/invoices/lib/pdf-column-catalog.ts). This is the single source of truth — no other file defines column metadata independently.

### Column flags

| Flag | Meaning |
|------|---------|
| `flatOnly: true` | Only valid in flat main layout. Not shown in grouped picker. |
| `groupedOnly: true` | Only valid in grouped layout. Not shown in flat picker. |
| `appendixOnly: true` | Not shown in main page pickers at all. |

### Layout-safe columns (main page — grouped)

| Key | Label | Notes |
|-----|-------|-------|
| `position` | Pos. | Group number |
| `route_leistung` | Route / Leistung | `descriptionPrimary` + `descriptionSecondary`; `groupedOnly` |
| `quantity` | Menge | Trip count per group; `groupedOnly` |
| `tax_rate` | MwSt. | |
| `net_price` | Netto | Derived: `total_price / (1 + tax_rate)` |
| `gross_price` | Brutto | `total_price` |

### Flat-only columns (main page — flat / appendix)

| Key | Label | Notes |
|-----|-------|-------|
| `trip_date` | Datum | `line_date` |
| `client_name` | Fahrgast | `client_name` |
| `description` | Beschreibung | `description` |
| `pickup_address` | Von | |
| `dropoff_address` | Nach | |
| `distance_km` | Strecke | formatted as `x km` |
| `driver_name` | Fahrer | from `trip_meta_snapshot.driver_name` |
| `trip_direction` | Hin/Rück | from `trip_meta_snapshot.direction` |
| `billing_variant` | Abrechnungsart | `billing_variant_name` |
| `billing_type` | Familie | `billing_variant_code` |
| `unit_price_net` | Einzelpreis | `unit_price` |
| `net_price` | Netto | derived (see above) |
| `tax_rate` | MwSt. | |
| `gross_price` | Brutto | `total_price` |

## Layout modes

### Grouped (`main_layout: 'grouped'`)

The main page table groups trips by route (Hinfahrt/Rückfahrt pairs). Each row is one route group with a Menge (trip count) and aggregated totals. Data comes from `buildInvoicePdfSummary()` → `InvoicePdfSummaryRow[]`. Only columns without `flatOnly: true` are valid here.

### Flat (`main_layout: 'flat'`)

The main page table shows one row per trip. Data comes from `InvoiceLineItemRow[]` directly. All columns except `groupedOnly` columns are valid here.

### Appendix

Always flat — renders `InvoiceLineItemRow[]` regardless of `main_layout`. Auto-switches to landscape when `appendix_columns.length > APPENDIX_LANDSCAPE_THRESHOLD` (7), defined in `pdf-column-catalog.ts`.

## Key technical notes

### Single source array rule

`mainTableKeys` (derived from `columnProfile.main_columns`, filtered for layout compatibility) must be the same array passed to:

- `calcColumnWidths(mainTableKeys, false)`
- the header row `.map()`
- every data row `.map()`

Using different arrays for any of these causes column misalignment after drag reorder.

### JSONB coercion

PostgREST can return `trip_meta_snapshot` and `price_resolution_snapshot` as JSON strings despite TypeScript typing them as objects. Always call `coerceLineItemJsonbSnapshots(item)` once per row before passing to `renderCellValue`.

### Net price derivation

`net_price` is always derived as `total_price / (1 + tax_rate)` in the PDF renderer. Do not use `price_resolution_snapshot.net` — it is absent for several pricing strategies (`time_based`, `no_price`, `kts_override`, etc.) and would produce empty cells.

### Storno

`storno.ts` copies `pdf_column_override` from the original invoice. Per §14 UStG, a Stornorechnung must mirror the layout of the original invoice.

## UI locations

### Settings — Vorlagen-Verwaltung

- **Route:** `/dashboard/settings/pdf-vorlagen`
- List of all company Vorlagen (PanelList pattern)
- Editor: column picker, dnd-kit sortable chips, layout radio
- Switching layout migrates existing selected columns; never leaves list empty

### Payer detail

- **Route:** `/dashboard/payers` → select payer → PDF-Vorlage section
- Sets `payers.pdf_vorlage_id`
- Read-only column preview derived from the selected Vorlage

### Invoice builder — Step 4

- Dispatcher selects or overrides Vorlage for this specific invoice
- Live PDF preview updates in real time
- Override saved to `invoices.pdf_column_override` at creation (immutable)

## Related files

| Area | Path |
|------|------|
| Column catalog | `src/features/invoices/lib/pdf-column-catalog.ts` |
| Column layout utils | `src/features/invoices/components/invoice-pdf/pdf-column-layout.ts` |
| Profile resolver | `src/features/invoices/lib/resolve-pdf-column-profile.ts` |
| Profile enricher | `src/features/invoices/lib/enrich-invoice-detail-column-profile.ts` |
| Vorlage API | `src/features/invoices/api/pdf-vorlagen.api.ts` |
| Cover body (renderer) | `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` |
| Appendix (renderer) | `src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx` |
| Settings page | `src/app/dashboard/settings/pdf-vorlagen/page.tsx` |
| Builder Step 4 | `src/features/invoices/components/invoice-builder/step-4-vorlage.tsx` |
| DB migration | `supabase/migrations/20260408120001_pdf_vorlagen.sql` |

Added in Phase 6. Updated through Phase 6g.
