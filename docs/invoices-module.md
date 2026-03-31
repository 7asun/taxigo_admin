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

Tax logic is abstracted away from the UI into dedicated service files:
- **`lib/tax-calculator.ts`**: Automatically determines the German MwSt rate. E.g., trips under 50km receive `7%` (ermäßigter Steuersatz für Personennahverkehr), while trips over 50km receive `19%`.
- **`lib/price-calculator.ts`**: Resolves the exact `unit_price`, prioritizing manual driver overrides (`trips.price`), followed by recurring rule logic, and finally falling back to `null` if the dispatcher needs to manually quote it.

---

## 4. API & PDF Generation

### Data Fetching Constraints (`invoices.api.ts`)
Due to strict foreign key relationships, complex objects like the `company_profile` cannot be recursively joined in a single PostgREST pass from the `invoices` table.
- `getInvoiceDetail` sequentially fetches the invoice (with payloads and snapshot lines), and then cleanly fetches the `company_profile` using the invoice's `company_id`.

### The PDF Engine (`/api/invoices/[id]/pdf`)
- We use `@react-pdf/renderer` directly on the server (Next.js App Router API).
- The `InvoiceDocument` component outputs a pure stream of bytes (`renderToStream`), ensuring the client immediately receives a high-quality, universally compatible PDF Blob.
- Heavy reliance on CSS-like styling in React-PDF (Flexbox) ensures perfect A4 alignment for German window envelopes (DIN-Brief).

---

## 5. Security & RBAC Notes
- All endpoints rely on Supabase Row Level Security (RLS) bound to the active `company_id`.
- Sentry captures all PDF generation render faults and query lookup errors to ensure seamless administrative support.

---

*Phase 2 Documentation Finalized - v2.0 Architecture*
