/**
 * storno.ts
 *
 * Stornorechnung (cancellation invoice) builder.
 *
 * When an invoice is cancelled ("storniert"), a new invoice row is created
 * with all line items mirrored as negative amounts. This ensures the ledger
 * nets to zero for the billing period, as required by §14 Abs. 9 UStG.
 *
 * ─── Storno rules (§14 UStG) ──────────────────────────────────────────────
 *   1. A Stornorechnung must reference the original invoice number.
 *   2. All amounts must be negative (negating the original totals).
 *   3. The Storno gets its own sequential invoice number (RE-YYYY-MM-NNNN).
 *   4. The original invoice status is updated to 'corrected'.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Persistence is atomic: all DB writes run inside the Postgres function
 * `create_storno_invoice` (single transaction). If any step fails, Postgres
 * rolls back the entire Storno operation.
 */

import { createClient } from '@/lib/supabase/client';
import { generateNextInvoiceNumber } from './invoice-number';
import type { InvoiceRow, InvoiceLineItemRow } from '../types/invoice.types';

function negatePriceResolutionSnapshot(
  snap: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return snap;
  const o = { ...snap } as Record<string, unknown>;
  for (const k of ['net', 'gross', 'unit_price_net', 'approach_fee_net']) {
    const v = o[k];
    if (typeof v === 'number') o[k] = -Math.abs(v);
  }
  return o;
}

/**
 * Creates a Stornorechnung (cancellation invoice) for an existing invoice.
 *
 * Invoice numbering stays in TypeScript (`generateNextInvoiceNumber`) because
 * the RE-YYYY-MM-NNNN format and RPC to `invoice_numbers_max_for_prefix` live
 * in `invoice-number.ts`. Monetary negation and `negatePriceResolutionSnapshot`
 * stay in TypeScript so the SQL function stays a thin persistence layer.
 * `stornoNote` is built here because §14 UStG requires referencing the original
 * invoice number in the Storno document text.
 *
 * A single `supabase.rpc('create_storno_invoice', …)` performs: insert Storno
 * header, insert line items from JSONB, update original to `corrected` — all
 * in one implicit Postgres transaction.
 *
 * @param originalInvoice   - The full InvoiceRow to be cancelled.
 * @param originalLineItems - Line items of the original invoice.
 * @returns                   The newly created Stornorechnung ID.
 */
export async function createStornorechnung(
  originalInvoice: InvoiceRow,
  originalLineItems: InvoiceLineItemRow[]
): Promise<string> {
  const supabase = createClient();

  const stornoNumber = await generateNextInvoiceNumber();

  const stornoNote = [
    `Stornorechnung zu ${originalInvoice.invoice_number}`,
    originalInvoice.notes
      ? `Ursprüngliche Notiz: ${originalInvoice.notes}`
      : null
  ]
    .filter(Boolean)
    .join('\n');

  const stornoLineItems = originalLineItems.map((item) => ({
    trip_id: item.trip_id,
    position: item.position,
    line_date: item.line_date,
    description: `[Storno] ${item.description}`,
    client_name: item.client_name,
    pickup_address: item.pickup_address,
    dropoff_address: item.dropoff_address,
    distance_km: item.distance_km,
    unit_price: -Math.abs(item.unit_price),
    quantity: item.quantity,
    total_price: -Math.abs(item.total_price),
    approach_fee_net:
      item.approach_fee_net != null ? -Math.abs(item.approach_fee_net) : null,
    tax_rate: item.tax_rate,
    billing_variant_code: item.billing_variant_code,
    billing_variant_name: item.billing_variant_name,
    billing_type_name: item.billing_type_name ?? null,
    pricing_strategy_used: item.pricing_strategy_used,
    pricing_source: item.pricing_source,
    kts_override: item.kts_override,
    price_resolution_snapshot: negatePriceResolutionSnapshot(
      item.price_resolution_snapshot
    ),
    trip_meta_snapshot: item.trip_meta_snapshot ?? null
  }));

  const { data: stornoId, error } = await supabase.rpc(
    'create_storno_invoice',
    {
      p_company_id: originalInvoice.company_id,
      p_invoice_number: stornoNumber,
      p_payer_id: originalInvoice.payer_id,
      p_billing_type_id: originalInvoice.billing_type_id,
      p_billing_variant_id: originalInvoice.billing_variant_id,
      p_mode: originalInvoice.mode,
      p_client_id: originalInvoice.client_id,
      p_period_from: originalInvoice.period_from,
      p_period_to: originalInvoice.period_to,
      p_subtotal: -originalInvoice.subtotal,
      p_tax_amount: -originalInvoice.tax_amount,
      p_total: -originalInvoice.total,
      p_notes: stornoNote,
      p_payment_due_days: originalInvoice.payment_due_days,
      p_cancels_invoice_id: originalInvoice.id,
      p_rechnungsempfaenger_id: originalInvoice.rechnungsempfaenger_id,
      p_rechnungsempfaenger_snapshot:
        originalInvoice.rechnungsempfaenger_snapshot,
      p_client_reference_fields_snapshot:
        originalInvoice.client_reference_fields_snapshot ?? null,
      p_pdf_column_override: originalInvoice.pdf_column_override ?? null,
      p_original_invoice_id: originalInvoice.id,
      p_line_items: stornoLineItems
    }
  );

  if (error || stornoId == null) {
    throw new Error(
      `Stornorechnung konnte nicht erstellt werden: ${error?.message ?? 'keine Antwort'}`
    );
  }

  return stornoId as string;
}
