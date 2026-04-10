/**
 * angebot-number.ts
 *
 * Generates the next Angebotsnummer in the format AG-{YYYY}-{MM}-{NNNN}.
 *
 * Sequence resets to 0001 at the start of each calendar month.
 * The RPC `angebot_numbers_max_for_prefix` is SECURITY DEFINER — it bypasses RLS
 * to find the MAX existing number for the current month prefix without leaking
 * other companies' data (it still enforces admin-only access).
 *
 * Mirror of src/features/invoices/lib/invoice-number.ts — keep in sync if the
 * invoice number format ever changes.
 */

import { createClient } from '@/lib/supabase/client';

const ANGEBOT_PREFIX = 'AG';

/**
 * Formats year, calendar month, and sequence into the canonical Angebotsnummer.
 *
 * @param year     - 4-digit year (e.g. 2026)
 * @param month    - Calendar month 1–12
 * @param sequence - Sequential integer (1-based, padded to 4 digits)
 * @returns Formatted Angebotsnummer string, e.g. "AG-2026-04-0001"
 *
 * @example
 *   formatAngebotNumber(2026, 4, 1)    // → "AG-2026-04-0001"
 *   formatAngebotNumber(2026, 12, 42)  // → "AG-2026-12-0042"
 */
export function formatAngebotNumber(
  year: number,
  month: number,
  sequence: number
): string {
  const paddedMonth = String(month).padStart(2, '0');
  const paddedSeq = String(sequence).padStart(4, '0');
  return `${ANGEBOT_PREFIX}-${year}-${paddedMonth}-${paddedSeq}`;
}

/**
 * Parses an existing Angebotsnummer string into its components.
 * Returns null if the string does not match the expected format.
 *
 * @example
 *   parseAngebotNumber("AG-2026-04-0042") // → { year: 2026, month: 4, sequence: 42 }
 *   parseAngebotNumber("INVALID")         // → null
 */
export function parseAngebotNumber(
  angebotNumber: string
): { year: number; month: number; sequence: number } | null {
  const match = angebotNumber.match(/^AG-(\d{4})-(\d{2})-(\d+)$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    sequence: parseInt(match[3], 10)
  };
}

/**
 * Generates the next available Angebotsnummer for the current calendar month.
 *
 * Calls DB RPC `angebot_numbers_max_for_prefix` for the highest global
 * angebot_number matching AG-{this year}-{this month}-*, then returns the next
 * number. Safe for concurrent use because:
 *   1. The DB has a UNIQUE constraint on angebot_number.
 *   2. Callers should retry once on a unique-violation error.
 *
 * @returns Promise resolving to the next formatted Angebotsnummer string.
 * @throws If the Supabase query fails with a non-zero error.
 */
export async function generateNextAngebotNumber(): Promise<string> {
  const supabase = createClient();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const monthPadded = String(currentMonth).padStart(2, '0');

  const ymPrefix = `${ANGEBOT_PREFIX}-${currentYear}-${monthPadded}-`;

  const { data: lastNumber, error } = await supabase.rpc(
    'angebot_numbers_max_for_prefix',
    { p_prefix: ymPrefix }
  );

  if (error) {
    throw new Error(
      `Angebotsnummer konnte nicht generiert werden: ${error.message}`
    );
  }

  if (!lastNumber) {
    return formatAngebotNumber(currentYear, currentMonth, 1);
  }

  const parsed = parseAngebotNumber(lastNumber);
  if (!parsed) {
    console.error('Unexpected angebot_number format in DB:', lastNumber);
    return formatAngebotNumber(currentYear, currentMonth, 1);
  }

  return formatAngebotNumber(currentYear, currentMonth, parsed.sequence + 1);
}
