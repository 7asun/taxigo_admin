/**
 * Pure string and number formatting for invoice PDFs (React-PDF).
 *
 * Exports: EUR display, German short dates, IBAN grouping, and the one-line
 * sender string used under the logo (DIN-style compact return address).
 */

import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

import type { InvoiceDetail } from '../../../types/invoice.types';

export function formatInvoicePdfEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

export function formatInvoicePdfDate(iso: string): string {
  return format(new Date(iso), 'dd.MM.yyyy', { locale: de });
}

/** Groups IBAN for readability (DE… 4-character blocks). */
export function formatInvoicePdfIbanDisplay(
  iban: string | null | undefined
): string {
  if (!iban?.trim()) return '';
  const compact = iban.replace(/\s/g, '').toUpperCase();
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

/** One line: legal name | street nr | PLZ city (for sender line under logo). */
export function buildInvoicePdfSenderOneLine(
  cp: InvoiceDetail['company_profile']
): string {
  if (!cp) return '';
  const streetPart = [cp.street, cp.street_number]
    .filter(Boolean)
    .join(' ')
    .trim();
  const cityPart = [cp.zip_code, cp.city].filter(Boolean).join(' ').trim();
  const parts = [cp.legal_name, streetPart, cityPart].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );
  return parts.join(' | ');
}

/** Format time from ISO string (HH:mm) - converts to German local time (Europe/Berlin). */
export function formatInvoicePdfTime(iso: string): string {
  // Use Intl.DateTimeFormat to properly convert to German timezone
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(date);
}

/** Truncate for narrow PDF columns (e.g. Von/Nach). */
export function truncateInvoicePdfText(
  value: string | null | undefined,
  maxChars: number
): string {
  if (value == null || value === '') return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars - 1)}…`;
}
