/**
 * Buckets parsed bank rows against open invoices for Zahlungsabgleich review.
 */

import { AMOUNT_TOLERANCE } from '../types/reconciliation.types';
import type {
  BankRow,
  MatchedInvoice,
  MatchedRow,
  WarningReason
} from '../types/reconciliation.types';
import { extractInvoiceNumbers } from './parse-bank-csv';

function amountMatches(bankAmount: number, invoiceTotal: number): boolean {
  return Math.abs(Math.abs(bankAmount) - invoiceTotal) <= AMOUNT_TOLERANCE;
}

function formatEurDe(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

function buildMultiInvoiceWarningRow(
  rowKey: string,
  bankRow: BankRow,
  extractedNumbers: string[],
  options: {
    matchedInvoice: MatchedInvoice | null;
    matchedInvoices?: MatchedInvoice[];
    multiInvoiceResolved: boolean;
    multiInvoiceBlockReason?: string;
  }
): MatchedRow {
  return {
    rowKey,
    bankRow,
    bucket: 'warning',
    extractedNumbers,
    matchedInvoice: options.matchedInvoice,
    matchedInvoices: options.matchedInvoices,
    warningReasons: ['multi_invoice'],
    multiInvoiceResolved: options.multiInvoiceResolved,
    multiInvoiceBlockReason: options.multiInvoiceBlockReason
  };
}

function resolveMultiInvoiceRow(
  rowKey: string,
  bankRow: BankRow,
  extractedNumbers: string[],
  invoiceLookup: Map<string, MatchedInvoice>
): MatchedRow {
  if (extractedNumbers.length > 2) {
    return buildMultiInvoiceWarningRow(rowKey, bankRow, extractedNumbers, {
      matchedInvoice: null,
      multiInvoiceResolved: false,
      multiInvoiceBlockReason:
        'Mehr als zwei Rechnungsnummern — bitte manuell prüfen.'
    });
  }

  const [numberA, numberB] = extractedNumbers;
  const invoiceA = invoiceLookup.get(numberA);
  const invoiceB = invoiceLookup.get(numberB);

  if (!invoiceA || !invoiceB) {
    return buildMultiInvoiceWarningRow(rowKey, bankRow, extractedNumbers, {
      matchedInvoice: invoiceA ?? invoiceB ?? null,
      multiInvoiceResolved: false,
      multiInvoiceBlockReason:
        'Eine oder mehrere Rechnungen wurden nicht gefunden.'
    });
  }

  const matchedInvoices = [invoiceA, invoiceB];

  if (invoiceA.status !== 'sent' || invoiceB.status !== 'sent') {
    return buildMultiInvoiceWarningRow(rowKey, bankRow, extractedNumbers, {
      matchedInvoice: invoiceA,
      matchedInvoices,
      multiInvoiceResolved: false,
      multiInvoiceBlockReason:
        'Eine oder mehrere Rechnungen sind nicht im Status Versendet.'
    });
  }

  // payerId is not on MatchedInvoice today (getInvoicesByNumbers selects payer:name only).
  // Same-payer guard uses payerName; to use payerId, extend lookup select to payer:payers(id, name).
  if (invoiceA.payerName !== invoiceB.payerName) {
    return buildMultiInvoiceWarningRow(rowKey, bankRow, extractedNumbers, {
      matchedInvoice: invoiceA,
      matchedInvoices,
      multiInvoiceResolved: false,
      multiInvoiceBlockReason:
        'Die Rechnungen gehören zu unterschiedlichen Kostenträgern.'
    });
  }

  const invoiceSum = invoiceA.total + invoiceB.total;
  const bankAmount = Math.abs(bankRow.betrag);
  if (Math.abs(invoiceSum - bankAmount) > AMOUNT_TOLERANCE) {
    return buildMultiInvoiceWarningRow(rowKey, bankRow, extractedNumbers, {
      matchedInvoice: invoiceA,
      matchedInvoices,
      multiInvoiceResolved: false,
      multiInvoiceBlockReason: `Summe der Rechnungen (${formatEurDe(invoiceSum)}) stimmt nicht mit dem Bankbetrag (${formatEurDe(bankAmount)}) überein.`
    });
  }

  return buildMultiInvoiceWarningRow(rowKey, bankRow, extractedNumbers, {
    matchedInvoice: invoiceA,
    matchedInvoices,
    multiInvoiceResolved: true,
    multiInvoiceBlockReason: undefined
  });
}

export function matchInvoices(
  bankRows: BankRow[],
  sentInvoices: MatchedInvoice[],
  invoiceLookup: Map<string, MatchedInvoice>
): MatchedRow[] {
  const sentByNumber = new Map(
    sentInvoices.map((inv) => [inv.invoiceNumber, inv])
  );

  return bankRows.map((bankRow, index) => {
    const extractedNumbers = extractInvoiceNumbers(bankRow.verwendungszweck);
    const rowKey = String(index);

    if (extractedNumbers.length === 0) {
      return {
        rowKey,
        bankRow,
        bucket: 'ignored',
        extractedNumbers,
        matchedInvoice: null,
        warningReasons: []
      };
    }

    if (extractedNumbers.length > 1) {
      return resolveMultiInvoiceRow(
        rowKey,
        bankRow,
        extractedNumbers,
        invoiceLookup
      );
    }

    const number = extractedNumbers[0];
    const lookupInvoice = invoiceLookup.get(number);

    if (!lookupInvoice) {
      return {
        rowKey,
        bankRow,
        bucket: 'warning',
        extractedNumbers,
        matchedInvoice: null,
        warningReasons: ['not_found']
      };
    }

    const warningReasons: WarningReason[] = [];

    if (lookupInvoice.status !== 'sent') {
      warningReasons.push('already_paid');
    }

    const sentInvoice = sentByNumber.get(number);
    if (sentInvoice && !amountMatches(bankRow.betrag, sentInvoice.total)) {
      warningReasons.push('amount_mismatch');
    }

    if (warningReasons.length > 0) {
      return {
        rowKey,
        bankRow,
        bucket: 'warning',
        extractedNumbers,
        matchedInvoice: lookupInvoice,
        warningReasons
      };
    }

    return {
      rowKey,
      bankRow,
      bucket: 'ready',
      extractedNumbers,
      matchedInvoice: sentInvoice ?? lookupInvoice,
      warningReasons: []
    };
  });
}

export function mapInvoiceWithPayerToMatched(
  invoices: Array<{
    id: string;
    invoice_number: string;
    total: number;
    status: string;
    payer?: { name?: string } | null;
  }>
): MatchedInvoice[] {
  return invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    total: Number(inv.total),
    status: inv.status,
    payerName: inv.payer?.name?.trim() ?? '—'
  }));
}
