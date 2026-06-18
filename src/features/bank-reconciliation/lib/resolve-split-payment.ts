/**
 * resolve-split-payment.ts
 *
 * Pure helper for split-payment (Eigenanteil) resolution.
 * A "split payment" is a single invoice settled by two or more separate bank
 * transactions across the same or different booking dates.
 *
 * Guards (must all pass for resolution to succeed):
 *   1. At least two bank rows in the group.
 *   2. The referenced invoice exists and has status === 'sent'.
 *   3. The sum of all betrag values matches invoice.total within AMOUNT_TOLERANCE.
 *
 * On success, paidAt is the ISO string of the latest buchungstagISO in the group
 * (the date the last partial payment arrived).
 */

import {
  AMOUNT_TOLERANCE,
  type BankRow,
  type MatchedInvoice
} from '../types/reconciliation.types';

export type SplitPaymentInput = {
  bankRows: BankRow[];
  invoice: MatchedInvoice;
};

export type SplitPaymentResult =
  | { ok: true; paidAt: string }
  | { ok: false; blockReason: string };

export function resolveSplitPayment(
  input: SplitPaymentInput
): SplitPaymentResult {
  const { bankRows, invoice } = input;

  // Guard 1 — need at least two partial payments to form a split group
  if (bankRows.length < 2) {
    return {
      ok: false,
      blockReason: 'Weniger als zwei Teilzahlungen in der Gruppe.'
    };
  }

  // Guard 2 — invoice must be open (sent)
  if (invoice.status !== 'sent') {
    return {
      ok: false,
      blockReason: `Rechnung ${invoice.invoiceNumber} hat Status „${invoice.status}", erwartet „sent".`
    };
  }

  // Guard 3 — sum of partial amounts must equal invoice total within tolerance
  const sum = bankRows.reduce((acc, row) => acc + row.betrag, 0);
  if (Math.abs(sum - invoice.total) > AMOUNT_TOLERANCE) {
    const diff = (sum - invoice.total).toFixed(2).replace('.', ',');
    return {
      ok: false,
      blockReason: `Summe der Teilzahlungen (${sum.toFixed(2).replace('.', ',')} €) weicht von Rechnungsbetrag (${invoice.total.toFixed(2).replace('.', ',')} €) um ${diff} € ab.`
    };
  }

  // paidAt = latest booking date in the group
  const paidAt = bankRows
    .map((r) => r.buchungstagISO)
    .sort()
    .at(-1) as string;

  return { ok: true, paidAt };
}
