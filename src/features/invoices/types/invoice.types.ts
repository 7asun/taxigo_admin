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

import type {
  BillingPricingRuleLike,
  PriceResolution
} from '@/features/invoices/types/pricing.types';
import type { TripMetaSnapshot } from '@/features/invoices/lib/trip-meta-snapshot';
import type { PdfColumnProfile } from '@/features/invoices/types/pdf-vorlage.types';
import type { ClientReferenceField } from '@/features/clients/lib/client-reference-fields.schema';
import type { TripStatus } from '@/lib/trip-status';

// ─── 1. Enums / Union Types ────────────────────────────────────────────────────

/**
 * Per-trip billing inclusion state tracked in the invoice builder.
 *
 * For normal trips: included = true (default); set to false when admin opts out.
 *   reason = exclusion reason (required when included = false).
 * For cancelled trips: included = false (default); set to true when admin opts in.
 *   reason = billing reason (required when included = true).
 */
export type BillingInclusionState = {
  included: boolean;
  reason: string;
};

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
  /** Optional Unterart scope (billing_variants.id). NULL = multi-variant invoice. */
  billing_variant_id: string | null;
  mode: InvoiceMode;
  client_id: string | null; // only for per_client mode
  period_from: string; // ISO date string
  period_to: string; // ISO date string
  status: InvoiceStatus;
  subtotal: number; // Nettobetrag (€)
  tax_amount: number; // MwSt-Betrag (€)
  total: number; // Bruttobetrag (€)
  notes: string | null;
  email_subject: string | null;
  email_body: string | null;
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
   * Frozen copy of clients.reference_fields at creation — §14 UStG; PDF reads this only.
   * Null when client_id is null or client had no reference fields.
   */
  client_reference_fields_snapshot: ClientReferenceField[] | null;
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
  /**
   * Distance in km used for pricing and VAT for this line (manual → client override → routing).
   * Snapshotted at creation; see docs/manual-km-overrides.md.
   */
  effective_distance_km: number | null;
  /**
   * Snapshot of trips.driving_distance_km at creation — routing provider only, never manual.
   */
  original_distance_km: number | null;
  unit_price: number; // price per unit (per trip or per km)
  quantity: number; // usually 1; or distance_km for per-km pricing
  total_price: number; // Bruttobetrag = (unit_price × quantity + approach_fee_net) × (1 + tax_rate)
  tax_rate: number; // 0.07 or 0.19 (decimal fraction)
  billing_variant_code: string | null; // e.g. "V01"
  billing_variant_name: string | null; // e.g. "Vollversorgung"
  /** Snapshot of billing_types.name (Abrechnungsfamilie) at invoice creation. */
  billing_type_name?: string | null;
  /** Net Anfahrtspreis snapshot. Null before Phase 8 or when none — treat as 0. */
  approach_fee_net: number | null;
  created_at: string;
  pricing_strategy_used: string | null;
  pricing_source: string | null;
  kts_override: boolean;
  price_resolution_snapshot: Record<string, unknown> | null;
  /** Frozen trip PDF fields (driver, direction) — §14 UStG; separate from pricing snapshot. */
  trip_meta_snapshot?: TripMetaSnapshot | Record<string, unknown> | null;
  /**
   * When false this line item is excluded from invoice totals.
   * Persisted for audit trail and PDF appendix — never deleted.
   * Default true (DB DEFAULT TRUE). Normal trips only; opted-in cancelled trips
   * always have billing_included = true with is_cancelled_trip = true.
   * Optional because pre-migration rows from the DB won't have this column yet.
   */
  billing_included?: boolean;
  /** Mandatory exclusion reason when billing_included = false. Null for included rows. */
  billing_exclusion_reason?: string | null;
  /**
   * True when this row was sourced from a cancelled trip that the admin opted in for billing.
   * These rows render only in the Stornierte Fahrten billed block — not in the Haupttabelle.
   * Optional because pre-migration rows from the DB won't have this column yet.
   */
  is_cancelled_trip?: boolean;
  /** Mandatory billing reason when is_cancelled_trip = true and billing_included = true. */
  cancelled_billing_reason?: string | null;
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
    reference_fields?: ClientReferenceField[] | null;
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
    /**
     * payers.revision_invoices_enabled — gates whether this Kostenträger's DRAFT
     * invoices may be re-opened/edited. Drives the detail-page "Bearbeiten" entry.
     */
    revision_invoices_enabled?: boolean;
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
    reference_fields?: ClientReferenceField[] | null;
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
  /** Canonical trip lifecycle (`trips.status`); excluded from billing when `cancelled`. */
  status: TripStatus;
  scheduled_at: string | null; // used as line_date
  /** On `trips` rows after Phase 2, DB `net_price` is generated; readers still use this for display math. */
  net_price: number | null;
  /** Transport net only — P3/P4 in resolveTripPrice. */
  base_net_price: number | null;
  approach_fee_net: number | null;
  /** Taxameter gross on trip — resolveTripPrice P0 when set. */
  manual_gross_price: number | null;
  /** Admin KM override on trip; Phase 2 writeback. NULL = use routing / client catalog. */
  manual_distance_km: number | null;
  driving_distance_km: number | null; // for tax rate calculation
  billing_variant_id: string | null;
  payer?: {
    rechnungsempfaenger_id: string | null;
    manual_km_enabled: boolean;
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
  /**
   * Denormalized passenger display name on `trips` when not Stammdaten-linked.
   * Fetched for invoice snapshots; see `buildLineItemsFromTrips` fallback when `client` is absent.
   */
  client_name?: string | null;
  // Client snapshot fields — includes price_tag for invoice price resolution
  // price_tag is the highest priority source for pricing
  client?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    // Default price for all trips of this client. Takes precedence over trip.price.
    price_tag: number | null;
    reference_fields?: ClientReferenceField[] | null;
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

/**
 * Narrow trip shape for cancelled rows used in the invoice builder and PDF appendix.
 *
 * The base shape covers passive €0 appendix rows (narrow DB fetch).
 * The extended shape — used when the builder fetches pricing fields for opt-in billing
 * — additionally carries TripForInvoice-compatible pricing fields (all optional so
 * narrow fetches remain valid).
 */
export interface CancelledTripRow {
  id: string;
  payer_id?: string;
  scheduled_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  /** DB `trips.canceled_reason_notes`; passive appendix sub-line only. */
  canceled_reason_notes: string | null;
  client?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    /** Client price tag — populated for billing opt-in pricing resolution only. */
    price_tag?: number | null;
    reference_fields?: ClientReferenceField[] | null;
  } | null;
  driver?: { name: string | null } | null;
  /** Denormalized name on the trip row (fallback when client join is absent). */
  client_name?: string | null;

  // ── Extended pricing fields — populated by billing-opt-in fetch only ─────────
  // All optional; narrow (passive) fetches leave these undefined.
  net_price?: number | null;
  base_net_price?: number | null;
  approach_fee_net?: number | null;
  manual_gross_price?: number | null;
  manual_distance_km?: number | null;
  driving_distance_km?: number | null;
  billing_variant_id?: string | null;
  kts_document_applies?: boolean;
  no_invoice_required?: boolean;
  link_type?: string | null;
  linked_trip_id?: string | null;
  payer?: {
    rechnungsempfaenger_id: string | null;
    manual_km_enabled: boolean;
  } | null;
  billing_variant?: {
    id: string;
    code: string;
    name: string;
    billing_type_id: string;
    rechnungsempfaenger_id: string | null;
    billing_type?: {
      name: string | null;
      rechnungsempfaenger_id: string | null;
    } | null;
  } | null;
}

/**
 * Builder-layer enrichment of `CancelledTripRow`.
 * The hook holds `BuilderCancelledTripRow[]` internally; Step 3 and PDF preview receive this type.
 *
 * - `billingInclusion` is always set at fetch-time: `{ included: false, reason: '' }` by default.
 * - Pricing fields are populated when the admin opts a trip in (via `handleCancelledTripInclusionChange`).
 */
export interface BuilderCancelledTripRow extends CancelledTripRow {
  /** why: runtime inclusion state — not persisted until createInvoice; default opted-out. */
  billingInclusion: BillingInclusionState;

  // ── Pricing state (populated on opt-in, cleared on opt-out) ─────────────────
  price_resolution?: PriceResolution | null;
  resolved_rule?: BillingPricingRuleLike | null;
  unit_price?: number | null;
  tax_rate?: number;
  quantity?: number;
  approach_fee_gross?: number | null;
  effective_distance_km?: number | null;
  original_distance_km?: number | null;
  kts_override?: boolean;
  trip_meta?: TripMetaSnapshot | null;
  billing_variant_code?: string | null;
  billing_variant_name?: string | null;
  billing_type_name?: string | null;

  // ── Override state (mirrors BuilderLineItem) ─────────────────────────────────
  manualGrossTotal?: number | null;
  manualApproachFeeGross?: number | null;
  isManualOverride?: boolean;
  manualDistanceKm?: number | null;
  isManualKmOverride?: boolean;
  originalPriceResolution?: PriceResolution;
  /**
   * When true (default), approach fee from the pricing rule is included in the
   * calculated gross. Flag-only when isManualOverride is true — no reprice.
   * Defaults to true on opt-in.
   */
  includeApproachFee?: boolean;
}

/**
 * Minimal PDF-only shape for opted-out normal trips shown in the
 * "Ausgeschlossene Fahrten" appendix section.
 */
export interface ExcludedTripRow {
  line_date: string | null;
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  billing_exclusion_reason: string;
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

  /**
   * Monthly / single_trip: optional subset of Abrechnungsfamilien (billing_types.id).
   * NULL or empty = all types for the payer. A single UUID header cannot represent this scope — use this array; monthly insert keeps billing_type_id null.
   */
  billing_type_ids: z.array(z.string().uuid()).nullable(),

  /**
   * Optional: scope trips to exactly one Unterart (billing_variants.id).
   * NULL means "all Unterarten" (subject to billing_type_id filter if present).
   */
  billing_variant_id: z.string().uuid().nullable(),

  /**
   * Monthly / standard mode only: optional subset of Unterarten (billing_variants.id)
   * under the single billing type in scope (`billing_type_ids.length === 1` or per_client `billing_type_id`).
   * NULL or empty = all variants of that type.
   * Fetch-only; never persisted on invoices.billing_variant_id.
   */
  billing_variant_ids: z.array(z.string().uuid()).nullable(),

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
  /**
   * Snapshot of `trips.driving_distance_km` for Step 3 / PDF / detail display.
   * Pricing and VAT use `effective_distance_km`.
   */
  distance_km: number | null;
  /**
   * Effective distance used for pricing and VAT in this line item.
   * Resolved from: manual_distance_km → client_km_overrides → driving_distance_km.
   * Snapshotted to invoice_line_items.effective_distance_km on insert.
   */
  effective_distance_km: number | null;

  /**
   * Snapshot of trips.driving_distance_km at build time — the routing provider value.
   * Always preserved regardless of any override. Displayed read-only in Step 3
   * alongside the manual KM input. Snapshotted to invoice_line_items.original_distance_km.
   */
  original_distance_km: number | null;

  /**
   * `payers.manual_km_enabled` at build time — Step 3 shows KM input when true.
   * Same payer for all rows in a session; avoids threading payer through Step 3 props.
   */
  manual_km_enabled?: boolean;

  // ── In-session KM override (set by admin in Step 3) ─────────────────────────

  /**
   * KM value committed by the admin in this builder session via the Step 3
   * inline input. null = not overridden in this session.
   * Written back to trips.manual_distance_km on invoice save (fire-and-forget)
   * so the same effective KM pre-resolves in future sessions.
   */
  manualDistanceKm?: number | null;

  /**
   * true when the admin has committed a KM override via applyKmOverride in
   * this session. Drives the amber "KM manuell" badge and × reset button.
   */
  isManualKmOverride?: boolean;
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
  /** VAT rate from `resolveTaxRate(effective_distance_km)` — not from the pricing rule. */
  tax_rate: number;
  /** From joined `billing_variants.code` on the trip. */
  billing_variant_code: string | null;
  /** From joined `billing_variants.name` on the trip. */
  billing_variant_name: string | null;
  /** From joined `billing_types.name` via billing_variants.billing_type (family label). */
  billing_type_name: string | null;
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
   * Rule passed to `resolveTripPrice` at build time so `applyKmOverride` can reprice with a
   * new effective KM without inferring config from the snapshot. Null when no active rule applied.
   */
  resolved_rule?: BillingPricingRuleLike | null;
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

  /**
   * Billing inclusion state for this trip.
   * Default: `{ included: true, reason: '' }` (all normal trips are included by default).
   * When the admin opts out, `included` becomes false and `reason` is the required text.
   * Opted-out rows stay in the array — they are never spliced; they are excluded from totals only.
   */
  billingInclusion: BillingInclusionState;

  // ── Gross override fields (set by admin in Step 3) ──────────────────────────

  /**
   * Gross representation of `approach_fee_net × (1 + tax_rate)`; pre-computed at
   * build time in `buildLineItemsFromTrips`. Used to pre-fill the Anfahrt input
   * in edit mode without requiring a runtime multiplication.
   */
  approach_fee_gross?: number | null;

  /**
   * Snapshot of the engine-computed `PriceResolution` before any admin override.
   * Used by `resetLineItemOverride` to restore the original pricing.
   * Always set by `buildLineItemsFromTrips`; optional here only to avoid breaking
   * existing code paths before initialization.
   */
  originalPriceResolution?: PriceResolution;

  /**
   * Admin-entered gross total (transport + Anfahrt combined). `null` = not overridden;
   * engine-priced value is used instead.
   */
  manualGrossTotal?: number | null;

  /**
   * Admin-entered Anfahrtskosten gross. `null` = not overridden.
   */
  manualApproachFeeGross?: number | null;

  /**
   * `true` when the admin has committed a gross override via `applyGrossOverride`.
   * Drives the amber "Manuell" badge and the × reset button in Step 3.
   */
  isManualOverride?: boolean;
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

/**
 * Minimal shape required for `calculateInvoiceTotals`.
 * Both `BuilderLineItem` and opted-in `BuilderCancelledTripRow` satisfy this structurally.
 */
export interface TotalsLineShape {
  price_resolution: PriceResolution;
  tax_rate: number;
  quantity: number;
  approach_fee_net: number | null;
  unit_price: number | null;
  manualGrossTotal?: number | null;
}

/** Tax breakdown grouped by rate — used in the totals block of the PDF. */
export interface TaxBreakdown {
  rate: number; // e.g. 0.07
  net: number; // sum of total_price where tax_rate === rate
  tax: number; // net × rate
}
