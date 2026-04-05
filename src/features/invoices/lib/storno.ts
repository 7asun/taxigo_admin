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
 */

import { createClient } from '@/lib/supabase/client';
import { generateNextInvoiceNumber } from './invoice-number';
import type { InvoiceRow, InvoiceLineItemRow } from '../types/invoice.types';

function negatePriceResolutionSnapshot(
  snap: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return snap;
  const o = { ...snap } as Record<string, unknown>;
  for (const k of ['net', 'gross', 'unit_price_net']) {
    const v = o[k];
    if (typeof v === 'number') o[k] = -Math.abs(v);
  }
  return o;
}

/**
 * Creates a Stornorechnung (cancellation invoice) for an existing invoice.
 *
 * This function performs 3 DB writes in sequence:
 *   1. Insert new invoice row (Stornorechnung) with:
 *      - Negative totals (subtotal, tax_amount, total are negated)
 *      - `cancels_invoice_id` pointing to the original
 *      - Status = 'draft' (dispatcher reviews before sending)
 *   2. Insert mirrored line items with negative amounts.
 *   3. Update original invoice status to 'corrected'.
 *
 * NOTE: This is not an atomic DB transaction — if step 2 or 3 fails,
 * the Storno invoice will be in the DB without line items / the original
 * will not be marked as corrected. In practice this is acceptable for
 * the current phase; a DB function/RPC can make it atomic in Phase 2+.
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

  // ── Step 1: Generate a new invoice number for the Storno ────────────────
  const stornoNumber = await generateNextInvoiceNumber();

  // Build the Storno note referencing the original invoice
  const stornoNote = [
    `Stornorechnung zu ${originalInvoice.invoice_number}`,
    originalInvoice.notes
      ? `Ursprüngliche Notiz: ${originalInvoice.notes}`
      : null
  ]
    .filter(Boolean)
    .join('\n');

  // ── Step 2: Insert the Stornorechnung invoice row ────────────────────────
  const { data: stornoInvoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      company_id: originalInvoice.company_id,
      invoice_number: stornoNumber,
      payer_id: originalInvoice.payer_id,
      billing_type_id: originalInvoice.billing_type_id,
      mode: originalInvoice.mode,
      client_id: originalInvoice.client_id,
      period_from: originalInvoice.period_from,
      period_to: originalInvoice.period_to,

      // Storno-specific: all amounts are negated
      subtotal: -originalInvoice.subtotal,
      tax_amount: -originalInvoice.tax_amount,
      total: -originalInvoice.total,

      notes: stornoNote,
      payment_due_days: originalInvoice.payment_due_days,
      status: 'draft', // Dispatcher reviews before sending

      // FK chain: links this Storno back to the original
      cancels_invoice_id: originalInvoice.id,

      rechnungsempfaenger_id: originalInvoice.rechnungsempfaenger_id,
      rechnungsempfaenger_snapshot: originalInvoice.rechnungsempfaenger_snapshot
    })
    .select('id')
    .single();

  if (invoiceError || !stornoInvoice) {
    throw new Error(
      `Stornorechnung konnte nicht erstellt werden: ${invoiceError?.message}`
    );
  }

  // ── Step 3: Insert mirrored line items with negative amounts ─────────────
  if (originalLineItems.length > 0) {
    const stornoLineItems = originalLineItems.map((item) => ({
      invoice_id: stornoInvoice.id,
      trip_id: item.trip_id,
      position: item.position,
      line_date: item.line_date,
      description: `[Storno] ${item.description}`,
      client_name: item.client_name,
      pickup_address: item.pickup_address,
      dropoff_address: item.dropoff_address,
      distance_km: item.distance_km,
      // Negative amounts to net out the original
      unit_price: -Math.abs(item.unit_price),
      quantity: item.quantity,
      total_price: -Math.abs(item.total_price),
      tax_rate: item.tax_rate,
      billing_variant_code: item.billing_variant_code,
      billing_variant_name: item.billing_variant_name,
      pricing_strategy_used: item.pricing_strategy_used,
      pricing_source: item.pricing_source,
      kts_override: item.kts_override,
      price_resolution_snapshot: negatePriceResolutionSnapshot(
        item.price_resolution_snapshot
      ),
      trip_meta_snapshot: item.trip_meta_snapshot ?? null
    }));

    const { error: lineItemsError } = await supabase
      .from('invoice_line_items')
      .insert(stornoLineItems);

    if (lineItemsError) {
      // Log but don't throw — the Storno invoice header was created successfully
      // The dispatcher can review and re-add items manually if needed
      console.error('Storno line items could not be created:', lineItemsError);
    }
  }

  // ── Step 4: Mark the original invoice as 'corrected' ────────────────────
  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      status: 'corrected',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', originalInvoice.id);

  if (updateError) {
    // Log but don't throw — the Storno invoice is created and usable
    console.error('Could not mark original invoice as corrected:', updateError);
  }

  return stornoInvoice.id;
}
