import { format, addDays } from 'date-fns';
import { de } from 'date-fns/locale';

import {
  recipientFromRechnungsempfaengerSnapshot,
  salutationFromSnapshot
} from '@/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf';

import type { InvoiceDetail } from '../types/invoice.types';

// Formats a date range as "01.04.2026 – 30.04.2026"
function formatPeriod(from: string | null, to: string | null): string {
  if (!from && !to) return '–';
  const fmt = (d: string) => format(new Date(d), 'dd.MM.yyyy', { locale: de });
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  return from ? fmt(from) : fmt(to!);
}

// Formats a EUR amount as "1.234,56 €"
function formatEur(amount: number | null): string {
  if (amount === null) return '–';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(amount);
}

export interface InvoiceEmailDraft {
  subject: string;
  body: string;
}

const DEFAULT_EMAIL_SALUTATION = 'Sehr geehrte Damen und Herren,';

/**
 * Mirrors {@link InvoicePdfDocument} salutation resolution so email draft matches the PDF.
 */
function resolveEmailSalutation(invoice: InvoiceDetail): string {
  let line = salutationFromSnapshot(
    invoice.rechnungsempfaenger_snapshot,
    DEFAULT_EMAIL_SALUTATION
  );

  const isPerClientBilled = invoice.mode === 'per_client' && !!invoice.client;
  const snapPrimary = recipientFromRechnungsempfaengerSnapshot(
    invoice.rechnungsempfaenger_snapshot
  );

  if (
    line === DEFAULT_EMAIL_SALUTATION &&
    isPerClientBilled &&
    !snapPrimary &&
    invoice.client?.last_name
  ) {
    const client = invoice.client;
    if (client.greeting_style === 'Herr') {
      line = `Sehr geehrter Herr ${client.last_name},`;
    } else if (client.greeting_style === 'Frau') {
      line = `Sehr geehrte Frau ${client.last_name},`;
    }
  }

  return `${line}\n\n`;
}

export function generateInvoiceEmailDraft(
  invoice: InvoiceDetail
): InvoiceEmailDraft {
  const period = formatPeriod(invoice.period_from, invoice.period_to);
  const total = formatEur(invoice.total);
  const dueDate = format(
    addDays(new Date(invoice.created_at), invoice.payment_due_days ?? 14),
    'dd.MM.yyyy',
    { locale: de }
  );
  const salutation = resolveEmailSalutation(invoice);
  const subject = `Rechnung ${invoice.invoice_number} – Zeitraum ${period}`;
  const body = [
    salutation +
      `im Anhang erhalten Sie unsere Rechnung ${invoice.invoice_number} ` +
      `für den Zeitraum ${period}.`,
    '',
    `Rechnungsbetrag: ${total}`,
    `Zahlungsziel:    ${dueDate}`,
    '',
    `Bitte überweisen Sie den Betrag bis zum ${dueDate} auf das unten angegebene Konto.`,
    '',
    `Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.`,
    '',
    `Mit freundlichen Grüßen`
  ].join('\n');
  return { subject, body };
}
