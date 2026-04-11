# Invoicing Module & Builder Architecture

> See [access-control.md](access-control.md) for the full role-based access control architecture.


This document outlines the technical architecture, business logic, and UI flows of the Taxigo **Invoicing Module** (`src/features/invoices`). 

The system is designed with a strict emphasis on **legal compliance (Immutability per §14 UStG)**, **efficiency (Bulk processing)**, and **error prevention (Inline warnings & price editors)**.

---

## 1. Core Architectural Principles

### 1.1 Snapshot Pattern (Immutability)
Invoicing in Germany requires that once an invoice is issued, it **cannot be altered**.
To enforce this, the architecture heavily relies on the **Snapshot Pattern**:
- When an invoice is created, all underlying trip data (descriptions, distances, prices, passenger names, addresses, and tax rates) is **copied** into the `invoice_line_items` table.
- The `invoice_line_items` table does **not** rely on foreign key JOINs to the `trips` or `clients` tables to render the PDF. 
- If a dispatcher later corrects a misspelling on a passenger's name in the `trips` table, the already-issued invoice remains mathematically and historically frozen.

### 1.2 The Storno Flow (Cancellations)
Because invoices are immutable, any mistake requires a formal cancellation (**Stornorechnung**).
- When a user confirms "Stornieren", the app calls [`createStornorechnung`](../src/features/invoices/lib/storno.ts), which invokes the Postgres function **`public.create_storno_invoice`** in a **single transaction**:
  1. Inserts a new Storno invoice row (`status = 'draft'`, new `RE-YYYY-MM-NNNN` from `generateNextInvoiceNumber`, `cancels_invoice_id` → original).
  2. Inserts mirrored line items (negated money fields; `quantity` unchanged) from a JSONB payload built in TypeScript.
  3. Updates the original invoice to `status = 'corrected'` and sets `cancelled_at` / `updated_at`.
- There is **no** separate `updateInvoiceStatus('cancelled')` step; if any step fails, Postgres rolls back all of them.

### 1.3 Invoice numbers (`RE-YYYY-MM-NNNN`)

Human-readable numbers are generated in [`src/features/invoices/lib/invoice-number.ts`](src/features/invoices/lib/invoice-number.ts) at **final insert time** (new invoice or Stornorechnung), using the machine date at that moment as the **issue month**:

- **Format**: `RE-{year}-{2-digit-month}-{4-digit-sequence}` (e.g. `RE-2026-04-0002`).
- **Sequence**: Increments within each calendar month, then resets to `0001` in the next month.
- **Uniqueness**: Enforced by a unique constraint on `invoices.invoice_number`.
- **Legacy**: Older rows may still show `RE-YYYY-NNNN`; they do not participate in the monthly `LIKE` query for the next number. New issuances use only the new shape.

### 1.4 Client reference fields (Bezugszeichen)

Fahrgast-specific reference lines (e.g. Versichertennummer, Unser Zeichen) are stored on `clients.reference_fields` as an ordered JSON array of `{ label, value }`. They are **not** read from the live client row when rendering an issued invoice PDF.

- **Snapshot:** On `createInvoice`, when `client_id` is set, the API loads `clients.reference_fields`, normalises it (strip empty labels, validate with Zod), and persists the result on `invoices.client_reference_fields_snapshot`. `NULL` means no bar; the app does not store an empty JSON array for “no fields”.
- **PDF:** [`InvoicePdfDocument`](../src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx) renders [`InvoicePdfReferenceBar`](../src/features/invoices/components/invoice-pdf/invoice-pdf-reference-bar.tsx) **only** when the snapshot parses to a non-empty array. Placement: full width directly **below** the cover header (Rechnungsdaten block) and **above** the subject / cover body, with vertical spacing consistent with other cover elements.
- **Modes:** Logic is keyed on **`client_id`**, not invoice `mode`. Today only `per_client` sets `client_id`; if other modes gain a client scope later, the same snapshot + PDF path applies.
- **Storno:** [`createStornorechnung`](../src/features/invoices/lib/storno.ts) / `create_storno_invoice` copies `client_reference_fields_snapshot` from the original invoice so the Storno PDF matches the corrected document’s layout.

### 1.5 Trip Invoice Status Badge

The **Fahrten** list ([`trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx)) shows a per-trip **Rechnungsstatus** column so dispatchers can see invoicing state without opening each trip.

- **Data source:** The RSC PostgREST query embeds `invoice_line_items` on each trip via `invoice_line_items!invoice_line_items_trip_id_fkey(...)`, nested with `invoices(status, paid_at, sent_at)`. Only rows with a non-null `trip_id` appear (manual line items are excluded by the FK relationship).
- **Resolution logic** ([`trip-invoice-status-badge.tsx`](../src/features/trips/components/trip-invoice-status-badge.tsx)): aggregate across all embedded line items — **paid** > **sent** > **draft** > **uninvoiced** (Nicht abger.). Invoices in **`cancelled`** or **`corrected`** are ignored when computing the badge.
- **Storno:** After a Storno, the original invoice is `corrected` (ignored) and the Stornorechnung exists as **`draft`** until sent or paid, so the trip correctly shows **Entwurf** for the open Storno invoice.
- **List filter:** URL param `invoice_status` (`trips-filters-bar.tsx`) restricts rows to trips whose effective status matches. The RSC prefers Postgres RPC **`trip_ids_matching_invoice_effective_status`** (migration `20260411140000_trip_ids_matching_invoice_effective_status.sql`). If the RPC is not deployed yet (**PGRST202**), [`resolveInvoiceStatusTripFilter`](../src/features/trips/lib/resolve-invoice-status-trip-filter.ts) falls back to a paginated read of `invoice_line_items` + the same effective-status rules (`paid` / `sent` / `draft` use `.in('id', …)`; **uninvoiced** uses `.not('id', 'in', …)` for trips that have any draft/sent/paid line). Apply the migration for better performance on large datasets.

---

## 2. The Invoice Builder Wizard (State Machine)

The creation of new invoices is handled entirely by a client-side **5-step** wizard (`InvoiceBuilder`). Transacting intermediate data on the client ensures the database is only touched once the user fully confirms the final layout.

**Lifted state:** `builderColumnProfile` (resolved `PdfColumnProfile`) is lifted to `invoice-builder/index.tsx` so the live PDF preview hook (`use-invoice-builder-pdf-preview.tsx`) can consume it from Step 1 onwards. Initialized to `resolvePdfColumnProfile(null, null, null)` (system default) so the preview is always valid before Step 4 is reached.

### Step 1: Mode Selection (`Step1Mode`)
Defines the aggregation strategy for fetching trips:
- **Monatlich / Zeitraum**: Fetches all trips for a selected Payer (Kostenträger) regardless of the client.
- **Einzelfahrt**: Targets one specific trip.
- **Fahrgast (per_client)**: Inverts the flow. The dispatcher selects a `Client` first, and the system dynamically computes and surfaces only the historical `payer + billing_variant` combinations that this specific passenger has used.

### Step 2: Parameter Collection (`Step2Params`)
Collects `payer_id`, `Date Range`, and optional billing scope fields.
- Relies heavily on Zod for form validation.
- Due to the dynamic nature of the `per_client` mode, hidden fields (like `billing_variant_id`) gracefully parse `nullish()` values out of Zod but are strictly cast to `string | null` before executing backend data fetches to prevent silent validation failures.

**Mode semantics:**
- **monthly / single_trip**: `billing_variant_id` remains `null` (no Unterart picker). Optional “Abrechnungsart” sets `billing_type_id` (family) only.
- **per_client**: the dispatcher selects a **Fahrgast** first, then picks a historical `{ payer_id + billing_variant_id }` combination labelled with the **Unterart** name.

### Step 3: Line Item Engine (`Step3LineItems`)
This is the heart of the verifier. The wizard queries the real `trips` matching the Step 2 parameters, and temporarily projects them into `BuilderLineItem` objects.
- **1-to-1 Mapping**: Every trip translates into one distinct line item.
- **Detailed Visibility**: The table renders the exact `pickup_address` → `dropoff_address` route so the dispatcher can visually verify the trip.
- **Inline Editing**: If a trip has no price (`unit_price === null`), the row receives a ⚠️ Warning Badge. The dispatcher can click the "Fehlt" button to inject the price locally—without having to leave the wizard.

### Step 4: PDF-Vorlage (`Step4Vorlage`)

Allows the dispatcher to select a PDF-Vorlage and optionally override the column layout for this specific invoice before confirming.

- Inherits the Vorlage from the selected Kostenträger (payer) if one is assigned, otherwise falls back to the company default, then the system default.
- Displays a live PDF preview that updates in real time as columns are changed.
- The dispatcher must click **"Weiter zur Bestätigung"** (`pdfStepAcknowledged`) to unlock Step 5 — this ensures conscious review of the PDF layout before committing.
- Column overrides selected here are saved to `invoices.pdf_column_override` at invoice creation time (immutable snapshot, same pattern as line items).

### Step 5: Bestätigung (`Step4Confirm`)

Calculates the final Netto and Brutto summaries using a tax breakdown (separating 7% and 19% items). It overrides the default `payment_due_days` (inherited from the Company Profile) if needed, and officially triggers the DB insertion.

### Phase 5 & 5b (complete) — PDF hardening + builder shell

- **Recipient / §14:** `InvoicePdfDocument` uses frozen `rechnungsempfaenger_snapshot` per [docs/rechnungsempfaenger.md](rechnungsempfaenger.md) (dual block for `per_client`, snapshot-only window for `monthly` / `single_trip`, payer fallback + `console.warn` when snapshot is missing on legacy rows).
- **Appendix table:** [`invoice-pdf-appendix.tsx`](../src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx) — fixed columns (Datum, Fahrgast, Von/Nach, Strecke, Netto, MwSt., Brutto, KTS, Fahrer, Hin/Rück); line net uses `price_resolution_snapshot.net` when present ([`invoice-pdf-line-amounts.ts`](../src/features/invoices/components/invoice-pdf/lib/invoice-pdf-line-amounts.ts)); KTS rows show €0 + note.
- **Trip meta snapshot:** Optional JSONB `invoice_line_items.trip_meta_snapshot` (migration `20260407120000_invoice_line_items_trip_meta_snapshot.sql`) — frozen driver + direction for PDF, **separate** from `price_resolution_snapshot`. **Creating** invoices requires this migration applied so `insertLineItems` can persist the column.
- **Detail fetch:** `getInvoiceDetail` loads line items with `line_items:invoice_line_items(*)` so PostgREST does not fail if optional columns are not migrated yet; after migration, `(*)` still returns `trip_meta_snapshot`.
- **Builder preview:** `/dashboard/invoices/new` loads a full `company_profiles` row and passes `companyProfile` into `InvoiceBuilder`. [`use-invoice-builder-pdf-preview.tsx`](../src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx) runs [`build-draft-invoice-detail-for-pdf.ts`](../src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts) + [`usePDF`](https://react-pdf.org/hooks#usepdf) (600 ms debounce) from **step 3** when line items exist; [`invoice-builder-pdf-panel.tsx`](../src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx) shows the iframe (desktop right column; mobile Sheet via **Vorschau**).

### Phase 6 (complete) — Dynamic PDF-Vorlagen (column layout system)

#### Overview

Phase 6 introduced a fully configurable PDF column system. Dispatchers and admins can now control which columns appear in the main invoice table and the appendix, in what order, and with what layout (grouped by route vs. flat per-trip). Dedicated reference: [pdf-vorlagen.md](pdf-vorlagen.md).

#### Database additions (6a)

- `pdf_vorlagen` — company-scoped Vorlage definitions: `main_columns` (ordered `text[]`), `appendix_columns` (ordered `text[]`), `main_layout` (`grouped` | `flat` | `single_row` | `grouped_by_billing_type`), `is_default`, `name`. RLS scoped to `company_id`.
- `payers.pdf_vorlage_id` — assigns a preferred Vorlage to a Kostenträger.
- `invoices.pdf_column_override` — JSONB snapshot of the full resolved `PdfColumnProfile` at invoice creation time (immutable, mirrors the line-item snapshot pattern).

#### 4-level resolution chain

Priority order (highest to lowest):

1. `invoices.pdf_column_override` — per-invoice dispatcher override (frozen at creation)
2. `payers.pdf_vorlage_id` → linked `pdf_vorlagen` row
3. `pdf_vorlagen WHERE is_default = true` — company-wide default Vorlage
4. `SYSTEM_DEFAULT_*` constants in `pdf-column-catalog.ts` — hardcoded app fallback

Implemented in `resolve-pdf-column-profile.ts`. The resolver returns `main_columns` **exactly as stored** — it never filters by layout compatibility. Layout filtering happens only at render time in `InvoicePdfCoverBody` via `mainTableKeys`.

#### Single source of truth — `pdf-column-catalog.ts`

Every PDF column is defined once in `PDF_COLUMN_CATALOG`. No other file defines column metadata independently. Adding a new column requires only one new entry here.

Column flags:

- `flatOnly: true` — only valid in flat main layout (trip-level fields like `client_name`, `trip_date`, `pickup_address`, `dropoff_address`, `distance_km`, `driver_name`, `billing_variant`, `description`, `unit_price_net`, `billing_type`)
- `groupedOnly: true` — only valid in grouped layout (`route_leistung`, `quantity`)
- `appendixOnly: true` — not shown in main page pickers

#### Dynamic PDF renderer (6e)

`InvoicePdfCoverBody` renders:

- **Grouped** (`main_layout: 'grouped'`): `InvoicePdfSummaryRow[]` from `buildInvoicePdfSummary()` — grouped-safe columns only
- **Single row** (`main_layout: 'single_row'`): one `InvoicePdfSummaryRow` from `buildInvoicePdfSingleRow()` (same column pool as grouped; all trips collapsed)
- **Nach Abrechnungsart** (`main_layout: 'grouped_by_billing_type'`): `InvoicePdfSummaryRow[]` from `buildInvoicePdfGroupedByBillingType()` — one row per `(billing_variant_name ?? billing_variant_code ?? 'Unbekannt', tax_rate)` combination; uses the same grouped column pool
- **Flat** (`main_layout: 'flat'`): `InvoiceLineItemRow[]` — per-trip columns

`InvoicePdfAppendix` always renders flat line items regardless of `main_layout`. Auto-switches to landscape when `appendix_columns.length > APPENDIX_LANDSCAPE_THRESHOLD`.

#### Key rendering rules (hard-won fixes)

- `mainTableKeys` is the **single source array** for `calcColumnWidths`, the header row, and all data rows. Using different arrays for any of these three causes column misalignment after drag reorder.
- `@react-pdf/renderer` flex rows require `width: '100%'` on row containers and `minWidth: 0, overflow: 'hidden'` on cells or columns overflow and misalign.
- PostgREST returns JSONB columns (`trip_meta_snapshot`, `price_resolution_snapshot`) as strings despite TypeScript typing them as objects. `coerceLineItemJsonbSnapshots` parses them once per row before any `renderCellValue` call.
- Per-line net for grouping and aggregates uses **`(unit_price × quantity) + (approach_fee_net ?? 0)`** (`lineNetEurForPdfLineItem`). Do not use `price_resolution_snapshot.net` for that total — it is base-only and may be null. Where a single gross-backed net is needed, `total_price / (1 + tax_rate)` still matches the stored line gross.

#### Phase 9 — grouped_by_billing_type layout

Fourth `main_layout` value: groups invoice cover rows by Abrechnungsart instead of route.

**`main_layout` modes:**

| `main_layout` | Description |
|---|---|
| `grouped` | Grouped by route (Hinfahrt/Rückfahrt address pairs) |
| `flat` | One row per trip |
| `single_row` | All trips collapsed into one summary row |
| `grouped_by_billing_type` | One row per (Abrechnungsart, MwSt.-Satz) combination — if a billing type has trips at both 7% and 19%, they appear as two separate rows |

**Grouping key:** `billing_variant_name ?? billing_variant_code ?? 'Unbekannt'` combined with `tax_rate`, where `billing_variant_name` is the snapshotted **Unterart** name. This composite key guarantees every output row has exactly one tax rate — no approximations, no hidden mixed-rate scenarios.

**`from`/`to` fields:** set to empty `CanonicalPlace`; origin/destination addresses are not meaningful at billing-category level.

**`total_km`:** `null` when any trip in the group has a null `distance_km` (rendered as `—`); mirrors route-group semantics.

**Snapshot fields (hierarchy):**
- `invoice_line_items.billing_variant_name` = **Unterart** name snapshot (immutable)
- `invoice_line_items.billing_type_name` = **Abrechnungsfamilie** name snapshot (immutable)
- `invoices.billing_variant_id` = Unterart scope when variant-scoped; `null` otherwise

#### Phase 8 — Anfahrtspreis + extended summary

- **`single_row`:** third `main_layout` — entire invoice as **one** summary row (label from payer + period on the cover, not a `subject` field).
- **`InvoicePdfSummaryRow`:** adds `total_km`, `has_null_km`, `approach_costs_net`, `transport_costs_net`, `total_costs_gross` (transport net = total line net minus summed approach; gross uses the same tax rounding as the rest of the PDF).
- **Catalog keys** (grouped / `single_row`): `trip_count`, `total_km`, `approach_costs`, `transport_costs`, `total_net`, `total_gross`; flat layout can expose `approach_fee_line` where applicable. See `pdf-column-catalog.ts` and [anfahrtspreis.md](anfahrtspreis.md).

#### Storno behavior

`storno.ts` passes `pdf_column_override` into **`create_storno_invoice`**, which persists it on the Storno row in the same transaction as line items and the original `corrected` update. Per §14 UStG, a Stornorechnung must mirror the layout of the original.

#### Settings UI

Route: `/dashboard/abrechnung/vorlagen` (PDF & Layout tab; legacy `/dashboard/settings/pdf-vorlagen` redirects)

- PanelList of all company Vorlagen (left) + editor panel (right)
- dnd-kit sortable column chips for reordering
- Separate column pickers for main page and appendix
- Layout radio: `gruppiert`, `eine Zeile (Gesamtübersicht)`, `pro Fahrt`, `nach Abrechnungsart`
- Switching layout migrates existing columns: surviving valid keys are kept, incompatible columns dropped, never leaves list empty

#### Payer assignment

Kostenträger detail sheet includes a PDF-Vorlage Select in the settings section. Changing this sets `payers.pdf_vorlage_id`. All future invoices for this payer will use the assigned Vorlage unless the dispatcher overrides in Step 4.

---

## 3. Pricing & Tax Calculation Layer

Tax and price logic is abstracted away from the UI into dedicated service files.

### 3.1 Tax Rate Resolution (`lib/tax-calculator.ts`)
Automatically determines the German MwSt rate:
- Trips under 50km receive `7%` (ermäßigter Steuersatz für Personennahverkehr)
- Trips over 50km receive `19%`
- Trips with unknown distance default to `7%` (conservative fallback)

### 3.2 Price Resolution (`lib/price-calculator.ts`)

The `resolveTripPrice()` function follows a strict **3-tier precedence hierarchy** when determining the billable price for a trip:

#### Price Precedence (Highest → Lowest)

| Priority | Source | Field | Description |
|----------|--------|-------|-------------|
| **1. Highest** | Client price tag | `clients.price_tag` | **Stored as BRUTTO** (gross price incl. tax). Automatically converted to NETTO during invoicing. Applies to ALL trips of this client. |
| **2. Fallback** | Trip price | `trips.price` | **Stored as NETTO** (net price without tax). Manually entered per trip. Only used when client has no `price_tag`. |
| **3. Last resort** | Manual entry | `null` | No price available. Dispatcher must enter price manually in Step 3. |

#### Key Behaviors

- **`clients.price_tag` wins automatically**: If a client has a `price_tag` set, it takes precedence over any manually entered `trips.price`
- **Visual indicator in Step 3**: The invoice builder shows a badge indicating which price source was used:
  - "Kunden-Preis" (green badge) — price from `clients.price_tag`
  - "Fahrt-Preis" (blue badge) — price from `trips.price`
- **Consistent pricing**: Setting a `price_tag` on a client ensures all their trips use the same price, eliminating the need to manually enter prices for every trip

#### Brutto → Netto Conversion

When a `price_tag` is used, the system automatically converts from **brutto** (stored) to **netto** (invoice line item):

```
netto = brutto / (1 + tax_rate)
```

**Example**: Client has `price_tag = 25.00 €`, trip qualifies for 19% tax:
- **Netto** (stored in line item): 25.00 / 1.19 = **21.01 €**
- **Tax** (7% or 19%): 21.01 × 0.19 = **3.99 €**
- **Brutto** (matches price_tag): 21.01 + 3.99 = **25.00 €** ✓

#### Example Scenarios

| Client has `price_tag` | Trip has `price` | Tax Rate | Result (Netto) | Source Badge |
|------------------------|------------------|----------|----------------|--------------|
| 25.00 € (brutto) | 30.00 € (netto) | 19% | **21.01 €** | Kunden-Preis |
| null | 30.00 € (netto) | 19% | **30.00 €** | Fahrt-Preis |
| 25.00 € (brutto) | null | 7% | **23.36 €** | Kunden-Preis |
| null | null | — | **null** ⚠️ | Fehlt (manual entry required) |

---

## 4. API & PDF Generation

### Data Fetching Constraints (`invoices.api.ts`)
Due to strict foreign key relationships, complex objects like the `company_profile` cannot be recursively joined in a single PostgREST pass from the `invoices` table.
- `getInvoiceDetail` sequentially fetches the invoice (with payer, client, and **`line_items:invoice_line_items(*)`** — wildcard avoids errors when new line-item columns are added before every environment has run migrations), then fetches `company_profile` using the invoice's `company_id`.

### Invoice PDF (`@react-pdf/renderer`)

PDFs are generated in the browser with **`InvoicePdfDocument`** ([`src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`](../src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx)):

- **Detail page** — [`PDFDownloadLink`](https://react-pdf.org/components#pdfdownloadlink) wraps the same document for “PDF herunterladen”.
- **Preview** — dashboard route `src/app/dashboard/invoices/[id]/preview/page.tsx` uses `InvoicePdfPreview` + `PDFViewer`.

Styling is centralized in [`pdf-styles.ts`](../src/features/invoices/components/invoice-pdf/pdf-styles.ts) (A4 padding, DIN-oriented top margin, flex tables). Supporting utilities: `resolve-sender-font-size.ts`, `generate-payment-qr-data-url.ts`, `build-sepa-qr-payload.ts`.

## Logo im PDF-Header
### Struktur
Das Logo wird über `cp.logo_url` als `<Image>` in `brandStack` gerendert,
direkt im `headerLeft`-Block oberhalb von Slogan, Senderzeile und Empfängeradresse.

### Bekanntes react-pdf Verhalten
- Feste `height` auf `<Image>` + `objectFit: 'contain'` erzeugt toten Leerraum
  (die Box behält die volle Höhe, auch wenn das Bild nur einen Bruchteil davon ausfüllt)
- `objectFit: 'contain'` zentriert das Bild vertikal → Lücke ÜBER dem Logo

### Lösung (aktuell implementiert)
| Property | Wert | Warum |
|---|---|---|
| `width` | `220` | Horizontale Breite des Logos |
| `maxHeight` | `70` | Begrenzt Höhe ohne toten Raum |
| `objectFit` | `'contain'` | Seitenverhältnis bleibt erhalten |
| `alignSelf` | `'flex-start'` | Kein vertikales Dehnen im Flex-Container |
| `objectPositionY` | `0` | Bild beginnt oben, Leerraum fällt nach unten |

### Größe anpassen
`maxHeight = width / erwartetes_Seitenverhältnis`

Beispiel: Breites Logo (4:1) → `width: 220, maxHeight: 65`

### Kein Logo vorhanden
Wenn `cp.logo_url` null ist, rendert `brandStack` leer und der Briefkopf
(Senderzeile + Empfängeradresse) beginnt direkt am oberen Rand von `headerLeft`.
Das Layout ist identisch — kein Extra-Padding nötig.

#### PDF layout & codebase map

| Piece | File | Role |
|-------|------|------|
| Root composer | `InvoicePdfDocument.tsx` | `Document` + two `Page`s; recipient/salutation; totals + `buildInvoicePdfSummary` |
| Cover header | `invoice-pdf-cover-header.tsx` | Logo, sender line, address window, Rechnungsdaten |
| Cover body | `invoice-pdf-cover-body.tsx` | Dynamic main table: grouped (`InvoicePdfSummaryRow`) or flat (`InvoiceLineItemRow`); `mainTableKeys` as single source array for widths + header + body |
| Footer | `invoice-pdf-footer.tsx` | Fixed footer + `Seite x / y` |
| Appendix | `invoice-pdf-appendix.tsx` | Dynamic appendix: columns from `columnProfile.appendix_columns`; auto-landscape when > 7 columns; `coerceLineItemJsonbSnapshots` before render |
| Column catalog | `pdf-column-catalog.ts` | Single source of truth for all PDF column definitions; `flatOnly`, `groupedOnly`, `appendixOnly` flags |
| Column layout utils | `pdf-column-layout.ts` | `getNestedValue`, `coerceLineItemJsonbSnapshots`, `renderCellValue`, `renderGroupedCellValue`, `calcColumnWidths` |
| Profile resolver | `resolve-pdf-column-profile.ts` | 4-level resolution chain; returns profile as stored (no layout filtering) |
| Profile enricher | `enrich-invoice-detail-column-profile.ts` | Attaches `column_profile` to `InvoiceDetail` outside `invoices.api.ts` (frozen file) |
| Vorlage API | `pdf-vorlagen.api.ts` | CRUD for `pdf_vorlagen`; delete blocked if payer references it; `setDefaultVorlage` clears other defaults first |
| Draft adapter | `build-draft-invoice-detail-for-pdf.ts` | Synthetic `InvoiceDetail` for builder live preview only |
| Format helpers | `lib/invoice-pdf-format.ts` | EUR, dates, IBAN display, sender one-liner |
| Places / routes | `lib/invoice-pdf-places.ts` | Canonical addresses, hint map, airport label |
| Summary build | `lib/build-invoice-pdf-summary.ts` | Grouped routes, Hinfahrt/Rückfahrt labels, net line amount |

**Route Consolidation Logic:** The summary builder now matches routes by canonicalized addresses **only** (not by tax rate). This ensures Hinfahrt and Rückfahrt pairs consolidate properly even if they have different tax rates. The direction labels (Hinfahrt/Rückfahrt) are determined by the first occurrence order of the route.

**Key Normalization Strategy:** Place keys use `cityStem` (city without zip code) to ensure consistent matching. For example, "Taubenstraße 17, 26122 Oldenburg (Oldb)" becomes key: `taubenstraße 17|oldenburg oldb`. This ensures incomplete addresses that receive hints match complete addresses with the same canonical key, preventing fragmentation into 3 route groups instead of 2.

**Pages:** (1) summary + payment; (2) trip-detail appendix. Footer repeats on both; appendix uses a fixed header when content wraps.

---

## Invoice Email Draft

Feature: per-invoice editable email draft (subject + body) stored on the `invoices` table.

- **Columns:** `email_subject` TEXT, `email_body` TEXT, both nullable; mutable (same pattern as `notes`).
- **Migration:** `20260410190000_invoices_email_draft.sql`.
- **Generation:** [`src/features/invoices/lib/generate-invoice-email-draft.ts`](../src/features/invoices/lib/generate-invoice-email-draft.ts) — builds subject from `invoice_number` + `period_from` / `period_to`, body from `total` + due date (`created_at` + `payment_due_days`).
- **Recipient resolution for salutation:** `rechnungsempfaenger_snapshot` → `payer.name`.
- **UI:** [`invoice-email-draft.tsx`](../src/features/invoices/components/invoice-detail/invoice-email-draft.tsx) — collapsible panel, inline editable fields, per-field copy button, saves via `useSaveInvoiceEmailDraft` → `saveInvoiceEmailDraft` → invalidates `invoiceKeys.full(id)`.
- **Does not send email** — copy-paste only by design.

---

## 5. Security & RBAC Notes
- **`invoices` / `invoice_line_items`**: RLS restricts SELECT/INSERT/UPDATE to `accounts.role = 'admin'` rows whose `company_id` matches `current_user_company_id()` (see migration `20260401180000_invoices_invoice_line_items_rls.sql`). The next invoice number is allocated via RPC `invoice_numbers_max_for_prefix` (SECURITY DEFINER) so the sequence stays **global** across tenants while list/detail queries remain company-scoped.
- All endpoints rely on Supabase Row Level Security (RLS) bound to the active `company_id`.
- Sentry captures all PDF generation render faults and query lookup errors to ensure seamless administrative support.

---

*Architecture notes updated through Phase 6g (PDF-Vorlagen + dynamic column system).*
