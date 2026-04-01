/**
 * invoice-number.ts
 *
 * Generates and validates sequential invoice numbers in the format:
 *   RE-YYYY-MM-NNNN   (e.g. RE-2026-04-0001)
 *
 * Legal requirement: §14 Abs. 4 Nr. 4 UStG mandates a "fortlaufende Nummer"
 * (uninterrupted sequential number) on every invoice. Gaps are not permitted.
 *
 * ─── Implementation ───────────────────────────────────────────────────────
 * - The sequence is global (not per-payer). Decision: legal compliance is
 *   simpler with one sequence; per-payer numbering adds no legal benefit.
 * - The counter resets each calendar month: after RE-2026-04-0042 the next
 *   invoice in May is RE-2026-05-0001. The full string remains unique.
 * - Month and year are taken from the date at generation time (invoice
 *   creation / Storno insert) — i.e. the issue date for numbering purposes.
 * - Generation is done optimistically: RPC invoice_numbers_max_for_prefix
 *   (SECURITY DEFINER) returns the global MAX for the year-month prefix so
 *   numbering stays correct under per-company RLS. Race conditions are handled
 *   by the UNIQUE constraint on invoices.invoice_number (retry on conflict).
 * - Legacy rows may still use RE-YYYY-NNNN; they do not match the monthly
 *   LIKE filter and do not affect the next RE-YYYY-MM-* number.
 *
 * ─── Future extension point ───────────────────────────────────────────────
 * If per-payer sequences are ever needed, add a `payerId` parameter and
 * filter the MAX query by `payer_id`. The format would then become:
 *   RE-{PayerCode}-{YYYY}-{MM}-{NNNN}
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@/lib/supabase/client';

/** The prefix character(s) for all invoice numbers. */
const INVOICE_PREFIX = 'RE';

/**
 * Formats year, calendar month, and sequence into the canonical invoice number.
 *
 * @param year     - 4-digit year (e.g. 2026)
 * @param month    - Calendar month 1–12
 * @param sequence - Sequential integer (1-based, padded to 4 digits)
 * @returns Formatted invoice number string, e.g. "RE-2026-04-0001"
 *
 * @example
 *   formatInvoiceNumber(2026, 4, 1)    // → "RE-2026-04-0001"
 *   formatInvoiceNumber(2026, 12, 42)  // → "RE-2026-12-0042"
 */
export function formatInvoiceNumber(
  year: number,
  month: number,
  sequence: number
): string {
  const paddedMonth = String(month).padStart(2, '0');
  const paddedSeq = String(sequence).padStart(4, '0');
  return `${INVOICE_PREFIX}-${year}-${paddedMonth}-${paddedSeq}`;
}

/**
 * Parses an existing invoice number string into its components.
 * Returns null if the string does not match the expected format.
 *
 * @example
 *   parseInvoiceNumber("RE-2026-04-0042") // → { year: 2026, month: 4, sequence: 42 }
 *   parseInvoiceNumber("INVALID")         // → null
 */
export function parseInvoiceNumber(
  invoiceNumber: string
): { year: number; month: number; sequence: number } | null {
  const match = invoiceNumber.match(/^RE-(\d{4})-(\d{2})-(\d+)$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    sequence: parseInt(match[3], 10)
  };
}

/**
 * Generates the next available invoice number for the current calendar month.
 *
 * Calls DB RPC `invoice_numbers_max_for_prefix` for the highest global
 * invoice_number matching RE-{this year}-{this month}-*, then returns the next
 * number. Safe for
 * concurrent use because:
 *   1. The DB has a UNIQUE constraint on invoice_number.
 *   2. Callers should retry once on a unique-violation error.
 *
 * @returns Promise resolving to the next formatted invoice number string.
 *
 * @throws If the Supabase query fails with a non-zero error.
 */
export async function generateNextInvoiceNumber(): Promise<string> {
  const supabase = createClient();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const monthPadded = String(currentMonth).padStart(2, '0');

  // LIKE 'RE-2026-04-%' matches only this year-month series (not legacy RE-YYYY-NNNN).
  const ymPrefix = `${INVOICE_PREFIX}-${currentYear}-${monthPadded}-`;

  const { data: lastNumber, error } = await supabase.rpc(
    'invoice_numbers_max_for_prefix',
    { p_prefix: ymPrefix }
  );

  if (error) {
    throw new Error(
      `Rechnungsnummer konnte nicht generiert werden: ${error.message}`
    );
  }

  if (!lastNumber) {
    return formatInvoiceNumber(currentYear, currentMonth, 1);
  }

  const parsed = parseInvoiceNumber(lastNumber);
  if (!parsed) {
    console.error('Unexpected invoice_number format in DB:', lastNumber);
    return formatInvoiceNumber(currentYear, currentMonth, 1);
  }

  return formatInvoiceNumber(currentYear, currentMonth, parsed.sequence + 1);
}
