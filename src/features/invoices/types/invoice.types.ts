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

import type { PriceResolution } from '@/features/invoices/types/pricing.types';
import type { TripMetaSnapshot } from '@/features/invoices/lib/trip-meta-snapshot';
import type { PdfColumnProfile } from '@/features/invoices/types/pdf-vorlage.types';

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
  rechnungsempfaenger_id: string | null;
  /** Frozen recipient JSON at creation — §14 UStG; do not mutate after issue. */
  rechnungsempfaenger_snapshot: Record<string, unknown> | null;
  /**
   * Optional per-invoice PDF column layout override (Phase 6).
   * Null = resolve from Kostenträger Vorlage → company default → system fallback.
   */
  pdf_column_override?: Record<string, unknown> | null;
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
  total_price: number; // Bruttobetrag = (unit_price × quantity + approach_fee_net) × (1 + tax_rate)
  tax_rate: number; // 0.07 or 0.19 (decimal fraction)
  billing_variant_code: string | null; // e.g. "V01"
  billing_variant_name: string | null; // e.g. "Vollversorgung"
  /** Net Anfahrtspreis snapshot. Null before Phase 8 or when none — treat as 0. */
  approach_fee_net: number | null;
  created_at: string;
  pricing_strategy_used: string | null;
  pricing_source: string | null;
  kts_override: boolean;
  price_resolution_snapshot: Record<string, unknown> | null;
  /** Frozen trip PDF fields (driver, direction) — §14 UStG; separate from pricing snapshot. */
  trip_meta_snapshot?: TripMetaSnapshot | Record<string, unknown> | null;
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
    /** payers.pdf_vorlage_id — PDF column Vorlage; null = use company default / system */
    pdf_vorlage_id?: string | null;
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
    logo_path: string | null;
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
  /**
   * Resolved PDF column profile (not persisted). Populated when detail is loaded
   * for preview/PDF (Phase 6e); optional until then.
   */
  column_profile?: PdfColumnProfile;
}

/**
 * A trip row with only the fields needed for invoice line item building.
 * Avoids loading the full trip object unnecessarily.
 */
export interface TripForInvoice {
  id: string;
  payer_id: string;
  scheduled_at: string | null; // used as line_date
  price: number | null; // manual driver price
  driving_distance_km: number | null; // for tax rate calculation
  billing_variant_id: string | null;
  payer?: {
    rechnungsempfaenger_id: string | null;
  } | null;
  billing_variant?: {
    id: string;
    code: string;
    name: string;
    billing_type_id: string;
    rechnungsempfaenger_id: string | null;
    billing_type?: {
      /** Family name (e.g. "Krankenfahrt") — used by formatBillingDisplayLabel to promote "Standard" variants. */
      name: string | null;
      rechnungsempfaenger_id: string | null;
    } | null;
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
  /** Krankentransportschein — from trips.kts_document_applies */
  kts_document_applies: boolean;
  /** Keine Rechnung — trip should not be invoiced via TaxiGo */
  no_invoice_required: boolean;
  link_type: string | null;
  linked_trip_id: string | null;
  driver?: { name: string | null } | null;
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
    .max(90, 'Maximal 90 Tage'),

  rechnungsempfaenger_id: z.string().uuid().nullable().optional()
});

/** Inferred TypeScript type from the builder Zod schema. */
export type InvoiceBuilderFormValues = z.infer<typeof invoiceBuilderSchema>;

// ─── 5. Invoice Builder State Machine ─────────────────────────────────────────

/** The 4 steps of the invoice wizard. */
export type InvoiceBuilderStep = 1 | 2 | 3 | 4;

/**
 * A validated line item that the builder has prepared for saving.
 * Derived from TripForInvoice — but editable by the user in step 3.
 *
 * Pricing fields (`price_resolution`, `kts_override`, `unit_price`, `quantity`, …) are
 * produced by `buildLineItemsFromTrips` unless the user edits the net unit in step 3
 * (`applyManualUnitNetToResolution`).
 */
export interface BuilderLineItem {
  /** Source trip ID — null for manually added items. */
  trip_id: string | null;
  /** 1-based row order; assigned when building from the fetched trip list. */
  position: number;
  /** Snapshot of `trips.scheduled_at` (ISO) for display and PDF. */
  line_date: string | null;
  /** Human-readable line title built in `buildLineItemsFromTrips` (date + client). */
  description: string;
  /** Passenger name snapshot from `trips.client` at build time. */
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  /** `trips.driving_distance_km` — feeds tax rate and per-km strategies. */
  distance_km: number | null;
  /**
   * Net unit price for the line (€). Mirrors `price_resolution.unit_price_net` until the
   * user overrides in step 3; `null` means unresolved / missing (step-3 `missing_price`).
   */
  unit_price: number | null;
  /** Net Anfahrtspreis for this trip. Null if resolver omitted it (no rule fee or tag/KTS path). */
  approach_fee_net: number | null;
  /**
   * Billing quantity from `PriceResolution.quantity` (usually `1`; equals km for per-km rules).
   */
  quantity: number;
  /** VAT rate from `resolveTaxRate(driving_distance_km)` — not from the pricing rule. */
  tax_rate: number;
  /** From joined `billing_variants.code` on the trip. */
  billing_variant_code: string | null;
  /** From joined `billing_variants.name` on the trip. */
  billing_variant_name: string | null;
  /**
   * Copy of `trips.kts_document_applies` — informational badge; actual €0 KTS pricing is
   * reflected in `price_resolution` / `kts_override`.
   */
  kts_document_applies: boolean;
  /**
   * Copy of `trips.no_invoice_required` — soft advisory only; does not block the wizard.
   */
  no_invoice_warning: boolean;
  /**
   * Full output of `resolveTripPrice` for this trip (strategy, source, net, gross, notes).
   * Persisted as `invoice_line_items.price_resolution_snapshot` on insert; step-4 tooltips
   * read `strategy_used` and `source` from here.
   */
  price_resolution: PriceResolution;
  /**
   * `true` when `price_resolution.strategy_used === 'kts_override'` (KTS branch in
   * `resolveTripPrice`). Skips the `zero_price` validator warning for €0 lines.
   */
  kts_override: boolean;

  /**
   * Trip-only PDF snapshot; persisted as `trip_meta_snapshot` on insert — §14 UStG.
   */
  trip_meta: TripMetaSnapshot | null;

  /**
   * Legacy subset of `price_resolution.source` for incremental UI migration
   * (`client_price_tag` | `trip_price` only).
   * @deprecated Prefer `price_resolution.source` and DB `pricing_source`.
   */
  price_source: 'client_price_tag' | 'trip_price' | null;

  /**
   * Advisory codes from `validateLineItem` (missing price, distance, no-invoice trip, …).
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
  | 'zero_price'
  | 'no_invoice_trip';

/** Tax breakdown grouped by rate — used in the totals block of the PDF. */
export interface TaxBreakdown {
  rate: number; // e.g. 0.07
  net: number; // sum of total_price where tax_rate === rate
  tax: number; // net × rate
}
