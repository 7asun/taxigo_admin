# Invoicing Module & Builder Architecture

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
- When a user clicks "Stornieren", the system:
  1. Marks the original invoice as `cancelled`.
  2. Generates a completely new invoice document (the Stornorechnung) with a new, sequential invoice number.
  3. Mirrors the exact snapshot line items, but **inverts** their quantities and totals (e.g., `1` → `-1`, `20.00€` → `-20.00€`).
  4. Links them historically via the `cancels_invoice_id` foreign key.

### 1.3 Invoice numbers (`RE-YYYY-MM-NNNN`)

Human-readable numbers are generated in [`src/features/invoices/lib/invoice-number.ts`](src/features/invoices/lib/invoice-number.ts) at **final insert time** (new invoice or Stornorechnung), using the machine date at that moment as the **issue month**:

- **Format**: `RE-{year}-{2-digit-month}-{4-digit-sequence}` (e.g. `RE-2026-04-0002`).
- **Sequence**: Increments within each calendar month, then resets to `0001` in the next month.
- **Uniqueness**: Enforced by a unique constraint on `invoices.invoice_number`.
- **Legacy**: Older rows may still show `RE-YYYY-NNNN`; they do not participate in the monthly `LIKE` query for the next number. New issuances use only the new shape.

---

## 2. The Invoice Builder Wizard (State Machine)

The creation of new invoices is handled entirely by a client-side 4-Step Wizard (`InvoiceBuilder`). Transacting intermediate data on the client ensures the database is only touched once the user fully confirms the final layout.

### Step 1: Mode Selection (`Step1Mode`)
Defines the aggregation strategy for fetching trips:
- **Monatlich / Zeitraum**: Fetches all trips for a selected Payer (Kostenträger) regardless of the client.
- **Einzelfahrt**: Targets one specific trip.
- **Fahrgast (per_client)**: Inverts the flow. The dispatcher selects a `Client` first, and the system dynamically computes and surfaces only the historical `payer + billing_variant` combinations that this specific passenger has used.

### Step 2: Parameter Collection (`Step2Params`)
Collects `payer_id`, `billing_variant_id`, and `Date Range`.
- Relies heavily on Zod for form validation.
- Due to the dynamic nature of the `per_client` mode, hidden fields (like `billing_variant_id`) gracefully parse `nullish()` values out of Zod but are strictly cast to `string | null` before executing backend data fetches to prevent silent validation failures.

### Step 3: Line Item Engine (`Step3LineItems`)
This is the heart of the verifier. The wizard queries the real `trips` matching the Step 2 parameters, and temporarily projects them into `BuilderLineItem` objects.
- **1-to-1 Mapping**: Every trip translates into one distinct line item.
- **Detailed Visibility**: The table renders the exact `pickup_address` → `dropoff_address` route so the dispatcher can visually verify the trip.
- **Inline Editing**: If a trip has no price (`unit_price === null`), the row receives a ⚠️ Warning Badge. The dispatcher can click the "Fehlt" button to inject the price locally—without having to leave the wizard.

### Step 4: Confirmation (`Step4Confirm`)
Calculates the final Netto and Brutto summaries using a tax breakdown (separating 7% and 19% items). It overrides the default `payment_due_days` (inherited from the Company Profile) if needed, and officially triggers the DB insertion.

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
- `getInvoiceDetail` sequentially fetches the invoice (with payloads and snapshot lines), and then cleanly fetches the `company_profile` using the invoice's `company_id`.

### Invoice PDF (`@react-pdf/renderer`)

PDFs are generated in the browser with **`InvoicePdfDocument`** ([`src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`](../src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx)):

- **Detail page** — [`PDFDownloadLink`](https://react-pdf.org/components#pdfdownloadlink) wraps the same document for “PDF herunterladen”.
- **Preview** — dashboard route `src/app/dashboard/invoices/[id]/preview/page.tsx` uses `InvoicePdfPreview` + `PDFViewer`.

Styling is centralized in [`pdf-styles.ts`](../src/features/invoices/components/invoice-pdf/pdf-styles.ts) (A4 padding, DIN-oriented top margin, flex tables). Supporting utilities: `resolve-sender-font-size.ts`, `generate-payment-qr-data-url.ts`, `build-sepa-qr-payload.ts`.

#### PDF layout & codebase map

| Piece | File | Role |
|-------|------|------|
| Root composer | `InvoicePdfDocument.tsx` | `Document` + two `Page`s; recipient/salutation; totals + `buildInvoicePdfSummary` |
| Cover header | `invoice-pdf-cover-header.tsx` | Logo, sender line, address window, Rechnungsdaten |
| Cover body | `invoice-pdf-cover-body.tsx` | Subject, summary table, VAT totals, payment + optional SEPA QR |
| Footer | `invoice-pdf-footer.tsx` | Fixed footer + `Seite x / y` |
| Appendix | `invoice-pdf-appendix.tsx` | Fixed appendix header + per–line-item table |
| Format helpers | `lib/invoice-pdf-format.ts` | EUR, dates, IBAN display, sender one-liner |
| Places / routes | `lib/invoice-pdf-places.ts` | Canonical addresses, hint map, airport label |
| Summary build | `lib/build-invoice-pdf-summary.ts` | Grouped routes, Hinfahrt/Rückfahrt labels, net line amount |

**Route Consolidation Logic:** The summary builder now matches routes by canonicalized addresses **only** (not by tax rate). This ensures Hinfahrt and Rückfahrt pairs consolidate properly even if they have different tax rates. The direction labels (Hinfahrt/Rückfahrt) are determined by the first occurrence order of the route.

**Key Normalization Strategy:** Place keys use `cityStem` (city without zip code) to ensure consistent matching. For example, "Taubenstraße 17, 26122 Oldenburg (Oldb)" becomes key: `taubenstraße 17|oldenburg oldb`. This ensures incomplete addresses that receive hints match complete addresses with the same canonical key, preventing fragmentation into 3 route groups instead of 2.

**Pages:** (1) summary + payment; (2) trip-detail appendix. Footer repeats on both; appendix uses a fixed header when content wraps.

---

## 5. Security & RBAC Notes
- **`invoices` / `invoice_line_items`**: RLS restricts SELECT/INSERT/UPDATE to `accounts.role = 'admin'` rows whose `company_id` matches `current_user_company_id()` (see migration `20260401180000_invoices_invoice_line_items_rls.sql`). The next invoice number is allocated via RPC `invoice_numbers_max_for_prefix` (SECURITY DEFINER) so the sequence stays **global** across tenants while list/detail queries remain company-scoped.
- All endpoints rely on Supabase Row Level Security (RLS) bound to the active `company_id`.
- Sentry captures all PDF generation render faults and query lookup errors to ensure seamless administrative support.

---

*Phase 2 Documentation Finalized - v2.0 Architecture*
