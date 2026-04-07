/**
 * customer-number.ts
 *
 * Defines formatting utilities for Client Numbers (Fahrgäste)
 * and Payer Numbers (Kostenträger).
 *
 * Architecture Rule: These numbers are stored as pure INTEGER
 * in the database for maximum sorting and sequencing efficiency.
 * The string prefixes ('KND-NR-' and 'KTR-NR-') are purely visual
 * and are dynamically injected by this file during UI rendering.
 */

/**
 * Formats a raw integer ID from the `clients` table into the official Kundennummer format.
 *
 * @param number - The integer from clients.customer_number
 * @returns Formatted string (e.g. 'KND-NR-10042') or a fallback string
 */
export function formatClientNumber(
  number: number | string | null | undefined
): string {
  if (number == null || number === '') return '—';

  // If for some reason the database still returns a string with the prefix (e.g. legacy),
  // return it directly to avoid double-prefixing.
  if (typeof number === 'string' && number.startsWith('KND-NR-')) {
    return number;
  }

  return `KND-NR-${number}`;
}

/**
 * Formats a raw integer ID from the `payers` table into the official Kostenträgernummer format.
 *
 * @param number - The integer from payers.number
 * @returns Formatted string (e.g. 'KTR-NR-50042') or a fallback string
 */
export function formatPayerNumber(
  number: number | string | null | undefined
): string {
  if (number == null || number === '') return '—';

  // Safeguard for legacy strings
  if (typeof number === 'string' && number.startsWith('KTR-NR-')) {
    return number;
  }

  return `KTR-NR-${number}`;
}
