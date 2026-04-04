/**
 * invoice-line-items.api.ts
 *
 * Service for building and persisting invoice line items.
 *
 * The central function `buildLineItemsFromTrips` converts raw trip rows into
 * invoice line item snapshots. This is where the data is **frozen** — after
 * this function runs, the line items are independent of the trips table and
 * will not change even if the trips are later edited.
 *
 * ─── Snapshot principle ────────────────────────────────────────────────────
 * Line items are always created FROM trips, never edited after creation.
 * If the data is wrong, the invoice must be storniert and a new one created.
 * This is intentional — it matches German legal requirements for invoice
 * immutability (§14 UStG: Rechnungen dürfen nicht nachträglich geändert werden).
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { resolveTaxRate } from '../lib/tax-calculator';
import { resolveTripPrice } from '../lib/price-calculator';
import { validateLineItems } from '../lib/invoice-validators';
import type {
  TripForInvoice,
  BuilderLineItem,
  InvoiceLineItemRow,
  TaxBreakdown
} from '../types/invoice.types';

// ─── Fetch trips for the invoice builder ──────────────────────────────────────

export interface FetchTripsForBuilderParams {
  payer_id: string;
  billing_type_id?: string | null; // null = all billing types
  period_from: string; // ISO date string
  period_to: string; // ISO date string
  client_id?: string | null; // only for per_client mode
}

/**
 * Fetches trips for inclusion in an invoice, scoped by payer, date range,
 * and optionally by billing_type and client.
 *
 * Joins billing_variant and client (including price_tag) for name/code snapshot data.
 * The client.price_tag is the highest priority source for pricing.
 *
 * @param params - Filter parameters from the builder step 2.
 * @returns       Array of TripForInvoice objects ready for line item building.
 */
export async function fetchTripsForBuilder(
  params: FetchTripsForBuilderParams
): Promise<TripForInvoice[]> {
  const supabase = createClient();

  let query = supabase
    .from('trips')
    .select(
      `
      id,
      scheduled_at,
      price,
      driving_distance_km,
      billing_variant_id,
      pickup_address,
      dropoff_address,
      kts_document_applies,
      no_invoice_required,
      billing_variant:billing_variants(id, code, name),
      client:clients(id, first_name, last_name, price_tag)
    `
    )
    // Filter by payer directly on the trips table
    .eq('payer_id', params.payer_id)
    // Date range filter on scheduled_at (include full last day)
    .gte('scheduled_at', params.period_from)
    .lte('scheduled_at', params.period_to + 'T23:59:59.999Z')
    .order('scheduled_at', { ascending: true });

  // Optional: filter to one billing_type within the payer
  if (params.billing_type_id) {
    query = query.eq('billing_variant_id', params.billing_type_id);
  }

  // Optional: filter by client (per_client mode)
  if (params.client_id) {
    query = query.eq('client_id', params.client_id);
  }

  const { data, error } = await query;

  if (error) throw toQueryError(error);
  return (data ?? []) as unknown as TripForInvoice[];
}

// ─── Build line items ─────────────────────────────────────────────────────────

/**
 * Converts trip rows into BuilderLineItem objects (in-memory, not yet saved).
 *
 * This function:
 *   1. Resolves the billable price using resolveTripPrice()
 *      - client.price_tag has HIGHEST priority
 *      - trips.price is the fallback
 *   2. Resolves the tax rate using resolveTaxRate()
 *   3. Builds a human-readable description string
 *   4. Attaches validation warnings via validateLineItems()
 *
 * The result is what the user sees in step 3 (Positionen-Vorschau).
 *
 * @param trips - Raw trip rows from fetchTripsForBuilder().
 * @returns      Line items with price_source and warnings attached.
 */
export function buildLineItemsFromTrips(
  trips: TripForInvoice[]
): BuilderLineItem[] {
  const rawItems = trips.map((trip, index) => {
    // ── Tax rate resolution ──────────────────────────────────────────────
    // Tax rate must be resolved FIRST because it's needed to convert
    // client.price_tag from brutto to netto
    const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);

    // ── Price resolution ─────────────────────────────────────────────────
    // resolveTripPrice follows the hierarchy:
    //   1. client.price_tag (brutto, converted to netto using taxRate)
    //   2. trips.price (already netto, used as fallback)
    //   3. null (requires manual entry)
    const { unitPrice, quantity, totalPrice, source } = resolveTripPrice(
      trip,
      taxRate
    );

    // ── Client name snapshot ─────────────────────────────────────────────
    const clientName = trip.client
      ? [trip.client.first_name, trip.client.last_name]
          .filter(Boolean)
          .join(' ')
      : null;

    // ── Human-readable description ───────────────────────────────────────
    // Format: "Fahrt vom 01.03.2026 – Max Mustermann"
    // If date is unknown, falls back to "Fahrt (kein Datum)"
    const dateStr = trip.scheduled_at
      ? new Date(trip.scheduled_at).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })
      : null;

    const description = [
      dateStr ? `Fahrt vom ${dateStr}` : 'Fahrt (kein Datum)',
      clientName
    ]
      .filter(Boolean)
      .join(' – ');

    return {
      trip_id: trip.id,
      position: index + 1, // 1-based
      line_date: trip.scheduled_at,
      description,
      client_name: clientName,
      pickup_address: trip.pickup_address,
      dropoff_address: trip.dropoff_address,
      distance_km: trip.driving_distance_km,
      unit_price: unitPrice,
      quantity,
      tax_rate: taxRate,
      billing_variant_code: trip.billing_variant?.code ?? null,
      billing_variant_name: trip.billing_variant?.name ?? null,
      kts_document_applies: trip.kts_document_applies === true,
      no_invoice_required: trip.no_invoice_required === true,
      // Track which price source was used for this line item
      // 'client_price_tag' — from clients.price_tag (highest priority)
      // 'trip_price' — from trips.price (fallback)
      // null — no price set
      price_source: source,
      // totalPrice handled separately (not part of BuilderLineItem; computed on save)
      _totalPrice: totalPrice // internal — used in calculateTotals()
    } as BuilderLineItem & { _totalPrice: number | null };
  });

  return validateLineItems(rawItems);
}

// ─── Calculate invoice totals ─────────────────────────────────────────────────

/**
 * Calculates invoice totals (subtotal, tax, grand total) and tax breakdown
 * from a list of builder line items.
 *
 * Items with null unit_price contribute 0 to the totals and will be flagged
 * with a 'missing_price' warning in validateLineItems.
 *
 * @param items - BuilderLineItem array (after user edits in step 3).
 * @returns       Subtotal, tax amount, total, and per-rate tax breakdown.
 */
export function calculateInvoiceTotals(items: BuilderLineItem[]): {
  subtotal: number;
  taxAmount: number;
  total: number;
  breakdown: TaxBreakdown[];
} {
  // Group net amounts by tax rate for the breakdown (7% + 19% shown separately)
  const byRate: Record<number, number> = {};

  let subtotal = 0;

  for (const item of items) {
    // Skip items that still have no price set
    const lineTotal =
      item.unit_price !== null ? item.unit_price * item.quantity : 0;

    subtotal += lineTotal;

    if (byRate[item.tax_rate] === undefined) {
      byRate[item.tax_rate] = 0;
    }
    byRate[item.tax_rate] += lineTotal;
  }

  // Build breakdown array (one entry per distinct tax rate)
  const breakdown: TaxBreakdown[] = Object.entries(byRate).map(
    ([rate, net]) => ({
      rate: parseFloat(rate),
      net: Math.round(net * 100) / 100,
      tax: Math.round(net * parseFloat(rate) * 100) / 100
    })
  );

  const taxAmount = breakdown.reduce((sum, b) => sum + b.tax, 0);
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total,
    breakdown
  };
}

// ─── Persist line items ───────────────────────────────────────────────────────

/**
 * Inserts line items for a newly created invoice into the DB.
 *
 * Must be called AFTER createInvoice() — the invoice_id is required.
 * Items are inserted in a single batch insert for performance.
 *
 * @param invoiceId - UUID of the parent invoice row.
 * @param items     - Builder line items (after user review in step 3).
 * @returns          The inserted line item rows.
 */
export async function insertLineItems(
  invoiceId: string,
  items: BuilderLineItem[]
): Promise<InvoiceLineItemRow[]> {
  const supabase = createClient();

  const rows = items.map((item) => ({
    invoice_id: invoiceId,
    trip_id: item.trip_id,
    position: item.position,
    line_date: item.line_date,
    description: item.description,
    client_name: item.client_name,
    pickup_address: item.pickup_address,
    dropoff_address: item.dropoff_address,
    distance_km: item.distance_km,
    // Default missing prices to 0 (user was warned by 'missing_price' badge)
    unit_price: item.unit_price ?? 0,
    quantity: item.quantity,
    total_price: (item.unit_price ?? 0) * item.quantity * (1 + item.tax_rate),
    tax_rate: item.tax_rate,
    billing_variant_code: item.billing_variant_code,
    billing_variant_name: item.billing_variant_name
  }));

  const { data, error } = await supabase
    .from('invoice_line_items')
    .insert(rows)
    .select();

  if (error) throw toQueryError(error);
  return (data ?? []) as unknown as InvoiceLineItemRow[];
}
