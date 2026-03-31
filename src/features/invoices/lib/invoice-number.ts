/**
 * invoice-number.ts
 *
 * Generates and validates sequential invoice numbers in the format:
 *   RE-YYYY-NNNN   (e.g. RE-2026-0001)
 *
 * Legal requirement: §14 Abs. 4 Nr. 4 UStG mandates a "fortlaufende Nummer"
 * (uninterrupted sequential number) on every invoice. Gaps are not permitted.
 *
 * ─── Implementation ───────────────────────────────────────────────────────
 * - The sequence is global (not per-payer). Decision: legal compliance is
 *   simpler with one sequence; per-payer numbering adds no legal benefit.
 * - The year resets the counter: RE-2025-0047 → RE-2026-0001 on Jan 1.
 * - Generation is done optimistically: query the MAX invoice_number for the
 *   current year and increment. Race conditions are prevented by the
 *   UNIQUE constraint on invoices.invoice_number (DB will reject duplicates).
 *
 * ─── Future extension point ───────────────────────────────────────────────
 * If per-payer sequences are ever needed, add a `payerId` parameter and
 * filter the MAX query by `payer_id`. The format would then become:
 *   RE-{PayerCode}-{YYYY}-{NNNN}
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@/lib/supabase/client';

/** The prefix character(s) for all invoice numbers. */
const INVOICE_PREFIX = 'RE';

/**
 * Formats a year + sequence number into the canonical invoice number string.
 *
 * @param year     - 4-digit year (e.g. 2026)
 * @param sequence - Sequential integer (1-based, padded to 4 digits)
 * @returns Formatted invoice number string, e.g. "RE-2026-0001"
 *
 * @example
 *   formatInvoiceNumber(2026, 1)   // → "RE-2026-0001"
 *   formatInvoiceNumber(2026, 42)  // → "RE-2026-0042"
 *   formatInvoiceNumber(2026, 999) // → "RE-2026-0999"
 */
export function formatInvoiceNumber(year: number, sequence: number): string {
  // Zero-pad the sequence to at least 4 digits (supports up to 9999 invoices/year)
  const paddedSeq = String(sequence).padStart(4, '0');
  return `${INVOICE_PREFIX}-${year}-${paddedSeq}`;
}

/**
 * Parses an existing invoice number string into its components.
 * Returns null if the string does not match the expected format.
 *
 * @example
 *   parseInvoiceNumber("RE-2026-0042") // → { year: 2026, sequence: 42 }
 *   parseInvoiceNumber("INVALID")      // → null
 */
export function parseInvoiceNumber(
  invoiceNumber: string
): { year: number; sequence: number } | null {
  const match = invoiceNumber.match(/^RE-(\d{4})-(\d+)$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    sequence: parseInt(match[2], 10)
  };
}

/**
 * Generates the next available invoice number for the current calendar year.
 *
 * Queries the `invoices` table for the highest-numbered invoice in the current
 * year, then returns the next number. This is safe for concurrent use because:
 *   1. The DB has a UNIQUE constraint on invoice_number.
 *   2. Callers should retry once on a unique-violation error.
 *
 * @returns Promise resolving to the next formatted invoice number string.
 *
 * @throws If the Supabase query fails with a non-zero error.
 */
export async function generateNextInvoiceNumber(): Promise<string> {
  const supabase = createClient();
  const currentYear = new Date().getFullYear();

  // Build the year prefix to filter only this year's invoices.
  // LIKE 'RE-2026-%' is index-friendly on the invoice_number TEXT column.
  const yearPrefix = `${INVOICE_PREFIX}-${currentYear}-`;

  const { data, error } = await supabase
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', `${yearPrefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Rechnungsnummer konnte nicht generiert werden: ${error.message}`
    );
  }

  if (!data) {
    // No invoices exist for this year yet → start at 1
    return formatInvoiceNumber(currentYear, 1);
  }

  // Parse the last number and increment
  const parsed = parseInvoiceNumber(data.invoice_number);
  if (!parsed) {
    // Unexpected format in DB — fall back to a safe default
    console.error(
      'Unexpected invoice_number format in DB:',
      data.invoice_number
    );
    return formatInvoiceNumber(currentYear, 1);
  }

  return formatInvoiceNumber(currentYear, parsed.sequence + 1);
}
