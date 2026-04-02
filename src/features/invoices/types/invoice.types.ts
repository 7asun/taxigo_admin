/**
 * invoice.types.ts
 *
 * Canonical TypeScript types for the entire invoice feature.
 * All Supabase rows, API payloads, and form values are derived from here.
 *
 * Key design principle: ALL invoice data is a snapshot taken at creation time.
 * Edits to trips/clients/payers after invoicing MUST NOT change issued invoices.
 * This immutability matches German legal requirements (§14 UStG).
 *
 * ─── Table of Contents ────────────────────────────────────────────────────────
 *   1. Enums / union types
 *   2. Core row types (matching DB schema exactly)
 *   3. Enriched / joined types (for UI display)
 *   4. Zod schemas (for builder form validation)
 *   5. Invoice builder state machine types
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

// ─── 1. Enums / Union Types ────────────────────────────────────────────────────

/**
 * Invoice lifecycle states.
 *
 * State machine:
 *   draft ──→ sent ──→ paid
 *          └──→ cancelled  (triggers automatic Stornorechnung creation)
 *               corrected  (set on original when storniert; used for display only)
 */
export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'cancelled'
  | 'corrected';

/**
 * Controls how trips are collected and how the invoice is presented.
 *
 *  monthly     — all trips for a payer in a calendar month/custom range
 *  single_trip — one specific trip (trip_id referenced in line items)
 *  per_client  — all trips for one specific client within a payer
 */
export type InvoiceMode = 'monthly' | 'single_trip' | 'per_client';

// ─── 2. Core Row Types (DB-accurate) ──────────────────────────────────────────

/**
 * Mirrors the `invoices` table row exactly.
 * Used for raw Supabase responses before any joins.
 */
export interface InvoiceRow {
  id: string;
  company_id: string;
  invoice_number: string; // RE-YYYY-MM-NNNN
  payer_id: string;
  billing_type_id: string | null; // null = all billing types
  mode: InvoiceMode;
  client_id: string | null; // only for per_client mode
  period_from: string; // ISO date string
  period_to: string; // ISO date string
  status: InvoiceStatus;
  subtotal: number; // Nettobetrag (€)
  tax_amount: number; // MwSt-Betrag (€)
  total: number; // Bruttobetrag (€)
  notes: string | null;
  payment_due_days: number; // Zahlungsziel in Tagen
  created_by: string | null;
  created_at: string; // ISO timestamp
  updated_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancels_invoice_id: string | null; // FK to original invoice (Stornorechnung chain)
}

/**
 * Mirrors the `invoice_line_items` table row exactly.
 * IMPORTANT: fields are snapshots — do NOT join back to the `trips` table for display.
 */
export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  trip_id: string | null; // null for manually added items
  position: number; // 1-based sort order on PDF
  line_date: string | null; // ISO date string (trip's scheduled_at)
  description: string; // e.g. "Fahrt vom 01.03.2026 – Max Mustermann"
  client_name: string | null; // snapshot of passenger name
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_km: number | null; // driving distance (from trips.driving_distance_km)
  unit_price: number; // price per unit (per trip or per km)
  quantity: number; // usually 1; or distance_km for per-km pricing
  total_price: number; // Bruttobetrag snapshot = unit_price × quantity × (1 + tax_rate)
  tax_rate: number; // 0.07 or 0.19 (decimal fraction)
  billing_variant_code: string | null; // e.g. "V01"
  billing_variant_name: string | null; // e.g. "Vollversorgung"
  created_at: string;
}

// ─── 3. Enriched / Joined Types (for UI) ──────────────────────────────────────

/**
 * Invoice with joined payer name — used in the invoice list table.
 */
export interface InvoiceWithPayer extends InvoiceRow {
  payer: { id: string; name: string; number: string | number } | null;
  client?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    greeting_style: string | null;
    customer_number: string | number | null;
    street: string;
    street_number: string;
    zip_code: string;
    city: string;
    email: string | null;
  } | null;
}

/**
 * Full invoice detail: invoice row + all line items + payer + company profile.
 * Used on the invoice detail page and PDF generation.
 */
export interface InvoiceDetail extends InvoiceRow {
  payer: {
    id: string;
    name: string;
    number: string;
    // Address fields (added via migration 1 — nullable until filled in payer settings)
    street: string | null;
    street_number: string | null;
    zip_code: string | null;
    city: string | null;
    contact_person: string | null;
    email: string | null;
  } | null;
  client: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    greeting_style: string | null;
    customer_number: string | number | null;
    street: string;
    street_number: string;
    zip_code: string;
    city: string;
    email: string | null;
    phone: string | null;
  } | null;
  line_items: InvoiceLineItemRow[];
  company_profile: {
    legal_name: string;
    street: string;
    street_number: string;
    zip_code: string;
    city: string;
    tax_id: string | null;
    vat_id: string | null;
    bank_name: string | null;
    bank_iban: string | null;
    bank_bic: string | null;
    logo_url: string | null;
    slogan: string | null;
    phone: string | null;
    inhaber: string | null;
    email: string | null;
    website: string | null;
    default_payment_days: number;
  } | null;
  /** FK to invoice_text_blocks - selected intro block for this invoice */
  intro_block_id?: string | null;
  /** FK to invoice_text_blocks - selected outro block for this invoice */
  outro_block_id?: string | null;
  /** Rechnungsvorlagen - intro block content for PDF */
  intro_block?: { id: string; content: string } | null;
  /** Rechnungsvorlagen - outro block content for PDF */
  outro_block?: { id: string; content: string } | null;
}

/**
 * A trip row with only the fields needed for invoice line item building.
 * Avoids loading the full trip object unnecessarily.
 */
export interface TripForInvoice {
  id: string;
  scheduled_at: string | null; // used as line_date
  price: number | null; // manual driver price
  driving_distance_km: number | null; // for tax rate calculation
  billing_variant_id: string | null;
  billing_variant?: {
    id: string;
    code: string;
    name: string;
  } | null;
  // Client snapshot fields — includes price_tag for invoice price resolution
  // price_tag is the highest priority source for pricing
  client?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    // Default price for all trips of this client. Takes precedence over trip.price.
    price_tag: number | null;
  } | null;
  // Address snapshot fields
  pickup_address: string | null;
  dropoff_address: string | null;
}

// ─── 4. Zod Schemas (Invoice Builder Form) ────────────────────────────────────

/**
 * Zod schema for the invoice builder form.
 *
 * Separated from the row type because the form collects user intent
 * (payer choice, date range, mode) while the API builds the actual rows.
 *
 * NOTE: Use .nullable() only (not .nullable().optional()) to keep inferred
 * types as T|null, which matches RHF defaultValues. See company-settings.types.ts
 * for the canonical explanation of this pattern.
 */
export const invoiceBuilderSchema = z.object({
  // ── Step 1 — Mode selection ───────────────────────────────────────────────
  // NOTE: Zod v4 removed required_error — use the { message } shorthand instead
  mode: z.enum(['monthly', 'single_trip', 'per_client'] as const),

  // ── Step 2 — Parameters ───────────────────────────────────────────────────
  payer_id: z.string().uuid('Ungültige Payer-ID'),

  // Optional: filter trips to one billing_type within the payer
  // NULL means "all billing types for this payer"
  billing_type_id: z.string().uuid().nullable(),

  // Required only when mode === 'per_client'
  client_id: z.string().uuid().nullable(),

  // Date range (both required for all modes)
  period_from: z.string().min(1, 'Startdatum erforderlich'),
  period_to: z.string().min(1, 'Enddatum erforderlich'),

  // ── Step 4 — Invoice header / meta ───────────────────────────────────────
  // Rechnungsvorlagen: selected intro/outro text blocks for PDF
  intro_block_id: z.string().uuid().nullable().optional(),
  outro_block_id: z.string().uuid().nullable().optional(),

  // Overrides company_profiles.default_payment_days for this invoice
  payment_due_days: z
    .number({ message: 'Bitte eine Zahl eingeben' })
    .int()
    .min(1, 'Mindestens 1 Tag')
    .max(90, 'Maximal 90 Tage')
});

/** Inferred TypeScript type from the builder Zod schema. */
export type InvoiceBuilderFormValues = z.infer<typeof invoiceBuilderSchema>;

// ─── 5. Invoice Builder State Machine ─────────────────────────────────────────

/** The 4 steps of the invoice wizard. */
export type InvoiceBuilderStep = 1 | 2 | 3 | 4;

/**
 * A validated line item that the builder has prepared for saving.
 * Derived from TripForInvoice — but editable by the user in step 3.
 */
export interface BuilderLineItem {
  /** Source trip ID — null for manually added items. */
  trip_id: string | null;
  position: number;
  line_date: string | null;
  description: string;
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_km: number | null;
  unit_price: number | null; // null = still needs to be set (shows ⚠️)
  quantity: number;
  tax_rate: number; // 0.07 or 0.19
  billing_variant_code: string | null;
  billing_variant_name: string | null;

  /**
   * Indicates which price source was used for this line item.
   * 'client_price_tag' — from clients.price_tag (highest priority)
   * 'trip_price' — from trips.price (fallback)
   * null — no price set (manual entry required)
   */
  price_source: 'client_price_tag' | 'trip_price' | null;

  /**
   * Validation warnings for this line item.
   * Set by invoice-validators.ts. Shown as badges in step 3.
   */
  warnings: LineItemWarning[];
}

/**
 * Possible per-line-item warnings shown in step 3 (Positionen-Vorschau).
 *
 * 'missing_price'     — trips.price is null; dispatcher must fill in manually
 * 'missing_distance'  — driving_distance_km is null; tax rate defaulted to 7%
 * 'zero_price'        — price is 0; unusual, shown as info warning
 */
export type LineItemWarning =
  | 'missing_price'
  | 'missing_distance'
  | 'zero_price';

/** Tax breakdown grouped by rate — used in the totals block of the PDF. */
export interface TaxBreakdown {
  rate: number; // e.g. 0.07
  net: number; // sum of total_price where tax_rate === rate
  tax: number; // net × rate
}
