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
import { resolveMultiInvoiceTransaction } from './resolve-multi-invoice-transaction';
import { resolveSplitPayment } from './resolve-split-payment';

function amountMatches(bankAmount: number, invoiceTotal: number): boolean {
  return Math.abs(Math.abs(bankAmount) - invoiceTotal) <= AMOUNT_TOLERANCE;
}

export function matchInvoices(
  bankRows: BankRow[],
  sentInvoices: MatchedInvoice[],
  invoiceLookup: Map<string, MatchedInvoice>
): MatchedRow[] {
  const sentByNumber = new Map(
    sentInvoices.map((inv) => [inv.invoiceNumber, inv])
  );

  // why: listInvoices({ status: 'sent' }) is ordered by created_at desc and capped
  // by the Supabase/PostgREST default row limit. Older invoices may be absent from
  // sentByNumber even though their DB status is genuinely 'sent'. invoiceLookup is
  // fetched directly by invoice number (getInvoicesByNumbers) — unbounded and always
  // authoritative for the specific numbers on this bank row. Supplement here so
  // resolveMultiInvoiceTransaction() does not falsely fail Guard 2 for old invoices.
  for (const [number, invoice] of invoiceLookup.entries()) {
    if (invoice.status === 'sent' && !sentByNumber.has(number)) {
      sentByNumber.set(number, invoice);
    }
  }

  // ── Split-payment pre-pass ──────────────────────────────────────────────────
  // Group bank rows that reference exactly one invoice number and where that
  // invoice is currently 'sent'. Groups of size ≥ 2 are candidates for split
  // payment resolution (one invoice settled by multiple partial transactions).
  const splitGroupsByInvoice = new Map<string, number[]>();
  for (let i = 0; i < bankRows.length; i++) {
    const nums = extractInvoiceNumbers(bankRows[i].verwendungszweck);
    if (nums.length !== 1) continue;
    const inv = invoiceLookup.get(nums[0]);
    if (!inv || inv.status !== 'sent') continue;
    const existing = splitGroupsByInvoice.get(nums[0]) ?? [];
    existing.push(i);
    splitGroupsByInvoice.set(nums[0], existing);
  }

  type SplitMeta = {
    splitPaymentKey: string;
    splitPaymentPosition: number;
    splitPaymentSize: number;
    splitPaymentPaidAt: string;
    invoice: MatchedInvoice;
  };
  const resolvedSplitRows = new Map<number, SplitMeta>();
  for (const [invoiceNumber, rowIndexes] of splitGroupsByInvoice.entries()) {
    if (rowIndexes.length < 2) continue;
    const invoice = invoiceLookup.get(invoiceNumber) as MatchedInvoice;
    const groupBankRows = rowIndexes.map((i) => bankRows[i]);
    const result = resolveSplitPayment({ bankRows: groupBankRows, invoice });
    if (!result.ok) continue;
    const key = `split:${invoiceNumber}`;
    rowIndexes.forEach((rowIdx, pos) => {
      resolvedSplitRows.set(rowIdx, {
        splitPaymentKey: key,
        splitPaymentPosition: pos + 1,
        splitPaymentSize: rowIndexes.length,
        splitPaymentPaidAt: result.paidAt,
        invoice
      });
    });
  }
  // ── End split-payment pre-pass ──────────────────────────────────────────────

  return bankRows.map((bankRow, index) => {
    const extractedNumbers = extractInvoiceNumbers(bankRow.verwendungszweck);
    const rowKey = String(index);

    // Check if this row is part of a resolved split-payment group
    const splitMeta = resolvedSplitRows.get(index);
    if (splitMeta) {
      return {
        rowKey,
        bankRow,
        bucket: 'ready',
        extractedNumbers,
        matchedInvoice: splitMeta.invoice,
        warningReasons: [],
        splitPaymentKey: splitMeta.splitPaymentKey,
        splitPaymentPosition: splitMeta.splitPaymentPosition,
        splitPaymentSize: splitMeta.splitPaymentSize,
        splitPaymentPaidAt: splitMeta.splitPaymentPaidAt
      } satisfies MatchedRow;
    }

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
      // Pre-flight: if all referenced invoices are already paid, tag as already_paid
      // so the three UI exclusion paths (footer count, warning dialog filter,
      // manual-review button count) silently skip this row — identical behaviour
      // to single-invoice already-paid rows. Do not call the helper: auto-resolution
      // is meaningless for already-settled invoices.
      if (
        extractedNumbers.every(
          (number) => invoiceLookup.get(number)?.status === 'paid'
        )
      ) {
        return {
          rowKey,
          bankRow,
          bucket: 'warning',
          extractedNumbers,
          matchedInvoice: invoiceLookup.get(extractedNumbers[0]) ?? null,
          matchedInvoices: extractedNumbers
            .map((number) => invoiceLookup.get(number))
            .filter((inv): inv is MatchedInvoice => inv !== undefined),
          warningReasons: ['already_paid'],
          multiInvoiceResolved: false
        };
      }

      const resolution = resolveMultiInvoiceTransaction(
        bankRow,
        extractedNumbers,
        invoiceLookup,
        sentByNumber
      );

      if (resolution.ok) {
        // Resolved group → ready bucket; hook will expand into per-invoice rows
        return {
          rowKey,
          bankRow,
          bucket: 'ready',
          extractedNumbers,
          matchedInvoice: resolution.invoices[0],
          matchedInvoices: resolution.invoices,
          warningReasons: [],
          multiInvoiceResolved: true,
          // groupKey is the CSV row index; hook uses this to expand + assign positions
          groupKey: rowKey
        };
      }

      // Unresolvable group → warning bucket
      return {
        rowKey,
        bankRow,
        bucket: 'warning',
        extractedNumbers,
        matchedInvoice: resolution.invoices?.[0] ?? null,
        matchedInvoices: resolution.invoices,
        warningReasons: ['multi_invoice'],
        multiInvoiceResolved: false,
        multiInvoiceBlockReason: resolution.blockReason
      };
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
    payer_id?: string | null;
    payer?: { id?: string; name?: string } | null;
  }>
): MatchedInvoice[] {
  return invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    total: Number(inv.total),
    status: inv.status,
    payerName: inv.payer?.name?.trim() ?? '—',
    payerId: inv.payer?.id ?? inv.payer_id ?? ''
  }));
}
