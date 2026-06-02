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
  /** Both invoices when a two-invoice bank row is auto-resolved at match time. */
  matchedInvoices?: MatchedInvoice[];
  warningReasons: WarningReason[];
  /** Set by matcher for multi_invoice rows — UI/hook read only, no re-computation. */
  multiInvoiceResolved?: boolean;
  /** German explanation when multi_invoice cannot be auto-confirmed. */
  multiInvoiceBlockReason?: string;
};

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
