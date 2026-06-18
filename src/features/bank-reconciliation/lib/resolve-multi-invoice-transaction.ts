/**
 * resolve-multi-invoice-transaction.ts
 *
 * Pure helper that validates whether a bank row with N ≥ 2 extracted invoice
 * numbers can be auto-confirmed as a Sammelzahlung (group payment).
 *
 * No Supabase or React dependencies — testable in isolation via bun test.
 *
 * Guards (evaluated in order; first failure short-circuits with a blockReason):
 *   1. All invoice numbers exist in invoiceLookup.
 *   2. All invoices are present in sentByNumber (authoritative "currently open" set).
 *   3. All invoices belong to the same payer (compared by payerId, not display name).
 *   4. sum(invoice.total) === |bank.betrag| within AMOUNT_TOLERANCE.
 *
 * On success: { ok: true, invoices: MatchedInvoice[] }
 * On failure: { ok: false, blockReason: string, invoices?: MatchedInvoice[] }
 *   (invoices is set when some — but not all — were found, for UI context)
 */

import { AMOUNT_TOLERANCE } from '../types/reconciliation.types';
import type {
  BankRow,
  MatchedInvoice,
  MultiInvoiceResolution
} from '../types/reconciliation.types';

function formatEurDe(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

export function resolveMultiInvoiceTransaction(
  bankRow: BankRow,
  extractedNumbers: string[],
  invoiceLookup: Map<string, MatchedInvoice>,
  sentByNumber: Map<string, MatchedInvoice>
): MultiInvoiceResolution {
  // Guard 1 — all invoice numbers exist in the lookup (any status)
  const foundInvoices: MatchedInvoice[] = [];
  const missingNumbers: string[] = [];

  for (const num of extractedNumbers) {
    const inv = invoiceLookup.get(num);
    if (inv) {
      foundInvoices.push(inv);
    } else {
      missingNumbers.push(num);
    }
  }

  if (missingNumbers.length > 0) {
    return {
      ok: false,
      blockReason:
        missingNumbers.length === extractedNumbers.length
          ? 'Keine der Rechnungen wurde im System gefunden.'
          : `Rechnung(en) nicht gefunden: ${missingNumbers.join(', ')}`,
      invoices: foundInvoices.length > 0 ? foundInvoices : undefined
    };
  }

  const invoices = foundInvoices;

  // Guard 2 — all invoices are open (status === sent) via sentByNumber
  const notSent = invoices.filter(
    (inv) => !sentByNumber.has(inv.invoiceNumber)
  );
  if (notSent.length > 0) {
    return {
      ok: false,
      blockReason:
        notSent.length === 1
          ? `Rechnung ${notSent[0].invoiceNumber} ist nicht im Status Versendet.`
          : `${notSent.length} Rechnungen sind nicht im Status Versendet: ${notSent.map((i) => i.invoiceNumber).join(', ')}`,
      invoices
    };
  }

  // Guard 3 — all invoices belong to the same payer (by ID, not display name)
  const payerIds = new Set(invoices.map((inv) => inv.payerId));
  if (payerIds.size > 1) {
    return {
      ok: false,
      blockReason: 'Die Rechnungen gehören zu unterschiedlichen Kostenträgern.',
      invoices
    };
  }

  // Guard 4 — sum of invoice totals matches bank amount
  const invoiceSum = invoices.reduce((acc, inv) => acc + inv.total, 0);
  const bankAmount = Math.abs(bankRow.betrag);
  if (Math.abs(invoiceSum - bankAmount) > AMOUNT_TOLERANCE) {
    return {
      ok: false,
      blockReason: `Summe der Rechnungen (${formatEurDe(invoiceSum)}) stimmt nicht mit dem Bankbetrag (${formatEurDe(bankAmount)}) überein.`,
      invoices
    };
  }

  return { ok: true, invoices };
}
