/**
 * Shared types for bank CSV → invoice payment reconciliation (Zahlungsabgleich).
 */

/** Brutto amount tolerance when comparing bank transfer to invoice.total (€). */
export const AMOUNT_TOLERANCE = 0.01;

export type BankRow = {
  buchungstag: string;
  buchungstagISO: string;
  verwendungszweck: string;
  betrag: number;
  beguenstigter: string;
  rawLine: string;
};

export type ReconciliationBucket = 'ready' | 'warning' | 'ignored';

export type MatchedInvoice = {
  id: string;
  invoiceNumber: string;
  total: number;
  status: string;
  payerName: string;
  /** payers.id — used for same-payer guard in multi-invoice resolution. */
  payerId: string;
};

export type WarningReason =
  | 'multi_invoice'
  | 'amount_mismatch'
  | 'already_paid'
  | 'not_found';

export type MatchedRow = {
  rowKey: string;
  bankRow: BankRow;
  bucket: ReconciliationBucket;
  extractedNumbers: string[];
  matchedInvoice: MatchedInvoice | null;
  /** All invoices when a multi-invoice bank row is auto-resolved at match time. */
  matchedInvoices?: MatchedInvoice[];
  warningReasons: WarningReason[];
  /** Set by matcher for multi_invoice rows — UI/hook read only, no re-computation. */
  multiInvoiceResolved?: boolean;
  /** German explanation when multi_invoice cannot be auto-confirmed. */
  multiInvoiceBlockReason?: string;
  /**
   * Shared identifier for all MatchedRows that were expanded from a single
   * resolved multi-invoice bank transaction. Undefined for single-invoice rows.
   */
  groupKey?: string;
  /** 1-based position of this invoice within the group (e.g. 1, 2, 3, 4). */
  groupPosition?: number;
  /** Total number of invoices in the group (e.g. 4). */
  groupSize?: number;
  /**
   * Shared identifier for all MatchedRows that are part of the same
   * split-payment group (one invoice, multiple bank transactions).
   * Undefined for rows that are not part of a split payment.
   */
  splitPaymentKey?: string;
  /** 1-based position of this bank row within the split-payment group. */
  splitPaymentPosition?: number;
  /** Total number of bank rows in the split-payment group. */
  splitPaymentSize?: number;
  /** ISO booking date of the latest partial payment in the group (used as paidAt on confirm). */
  splitPaymentPaidAt?: string;
};

/**
 * Return value of resolveMultiInvoiceTransaction().
 * ok = true  → all guards passed; invoices contains the matched set.
 * ok = false → at least one guard failed; blockReason is a German explanation.
 */
export type MultiInvoiceResolution =
  | { ok: true; invoices: MatchedInvoice[] }
  | { ok: false; blockReason: string; invoices?: MatchedInvoice[] };

export type BatchMarkPaidResult = {
  invoiceId: string;
  invoiceNumber: string;
  success: boolean;
  error?: string;
};

export type DialogStep =
  | 'idle'
  | 'loading'
  | 'reviewing'
  | 'confirming'
  | 'done';

export class InvalidBankCsvFormatError extends Error {
  constructor(
    message = 'Ungültiges CSV-Format (erwartet: Sparkasse/CAMT052 mit Auftragskonto-Kopfzeile)'
  ) {
    super(message);
    this.name = 'InvalidBankCsvFormatError';
  }
}
