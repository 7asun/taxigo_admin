---
name: split-payment-regex
overview: Implement invoice-number variant normalization and split-payment matching as scoped data-flow changes, while leaving dedicated split-payment ReviewTable rendering for a follow-up. The implementation will add pure helpers, preserve existing multi-invoice behavior, and gate each step with `bun run build`.
todos:
  - id: normalise-helper
    content: Create pure invoice-number normalization helper with Branch B before Branch A.
    status: completed
  - id: parser-wire
    content: Wire extractInvoiceNumbers to the normalizer while preserving deprecated regex export.
    status: completed
  - id: split-helper
    content: Create pure resolveSplitPayment helper for grouped single-invoice bank rows.
    status: completed
  - id: split-types
    content: Add optional splitPayment metadata fields to MatchedRow.
    status: completed
  - id: matcher-prepass
    content: Add split-payment pre-pass and ready-row routing in matchInvoices.
    status: completed
  - id: dedupe-confirm
    content: Deduplicate markRowsPaid invoice updates and use splitPaymentPaidAt.
    status: completed
  - id: docs-verify
    content: Update docs and verify with build plus tests.
    status: completed
isProject: false
---

# Regex Broadening And Split Payments

## Scope
- Add canonical invoice-number extraction for payer variants in `src/features/bank-reconciliation/lib/normalise-invoice-number.ts` and wire it into `src/features/bank-reconciliation/lib/parse-bank-csv.ts`.
- Add split-payment resolution for many bank rows settling one invoice in `src/features/bank-reconciliation/lib/resolve-split-payment.ts` and a pre-pass inside `src/features/bank-reconciliation/lib/match-invoices.ts`.
- Add optional `splitPayment*` metadata to `src/features/bank-reconciliation/types/reconciliation.types.ts`.
- Update `src/features/bank-reconciliation/hooks/use-zahlungsabgleich.ts` so ready-row confirmation deduplicates invoice IDs and uses the split group’s latest booking date.
- Update `docs/bank-reconciliation-module.md` to document the parser normalization and split-payment data flow.
- Preserve the already-paid multi-invoice pre-flight check added in the previous fix session exactly as-is. It lives inside the `extractedNumbers.length > 1` branch in `src/features/bank-reconciliation/lib/match-invoices.ts` and must not be overwritten while adding split-payment routing.
- Already-paid split groups are out of scope for new handling. Because the split pre-pass only considers invoices with `status === 'sent'`, already-paid split rows should fall through to the existing single-invoice already-paid / amount-mismatch routing unchanged.

## Current Code Anchors
- Parser currently returns raw exact matches only:
```24:29:src/features/bank-reconciliation/lib/parse-bank-csv.ts
export function extractInvoiceNumbers(verwendungszweck: string): string[] {
  const matches = [
    ...verwendungszweck.matchAll(new RegExp(INVOICE_NUMBER_REGEX.source, 'g'))
  ].map((m) => m[0]);
  return [...new Set(matches)];
}
```
- Matcher already has full `bankRows`, so a pre-pass can run before the row-local `map` without changing the public signature:
```19:23:src/features/bank-reconciliation/lib/match-invoices.ts
export function matchInvoices(
  bankRows: BankRow[],
  sentInvoices: MatchedInvoice[],
  invoiceLookup: Map<string, MatchedInvoice>
): MatchedRow[] {
```

## Execution Plan
1. Create `normalise-invoice-number.ts` with two clearly separated regex branches.
   - Branch B first: no-separator `RE2026040004` / `re2026040004`.
   - Branch A second: separated variants like `RE-2026-04-0004`, `R:2026-04-0004`, `RE 2026-04-0004`, `RE2026-04-0004`.
   - Return only deduped canonical `RE-YYYY-MM-NNNN` strings.
   - Run `bun run build`.

2. Update `parse-bank-csv.ts`.
   - Keep `INVOICE_NUMBER_REGEX` export, mark it deprecated, and delegate `extractInvoiceNumbers()` to `extractAndNormaliseInvoiceNumbers()`.
   - Confirm `collectExtractedNumbers()` remains unchanged because it already calls `extractInvoiceNumbers()`.
   - Run `bun run build`, then `bun test` so parser extraction regressions are caught before matcher work begins.

3. Create `resolve-split-payment.ts`.
   - Pure helper with `SplitPaymentInput` and `SplitPaymentResult`.
   - Validate at least two rows, invoice is `sent`, summed `bankRow.betrag` matches `invoice.total` within `AMOUNT_TOLERANCE`, and compute latest `buchungstagISO` as `paidAt`.
   - Run `bun run build`.

4. Extend `MatchedRow` in `reconciliation.types.ts`.
   - Add optional `splitPaymentKey`, `splitPaymentPosition`, `splitPaymentSize`, `splitPaymentPaidAt`.
   - Keep multi-invoice `groupKey` fields untouched so existing rendering stays stable.
   - Run `bun run build`.

5. Add split-payment pre-pass in `match-invoices.ts`.
   - Before `bankRows.map(...)`, group only rows where normalized extraction returns exactly one invoice number and that invoice exists with `status === 'sent'`.
   - Resolve groups of size 2+ with `resolveSplitPayment()`.
   - Store resolved metadata in `Map<rowIndex, ...>`.
   - At the start of the row-local pass, return a `ready` row for resolved split rows with `matchedInvoice` and the `splitPayment*` fields.
   - Leave the `extractedNumbers.length > 1` multi-invoice branch, including the previous already-paid multi-invoice pre-flight check, and the single-invoice already-paid path untouched.
   - Remove the temporary `console.log('[Zahlungsabgleich] blockReason:', ...)` if it is still present.
   - Run `bun run build`, then `bun test` so matcher regressions are caught before confirmation-flow changes.

6. Deduplicate ready confirmations in `use-zahlungsabgleich.ts`.
   - In `markRowsPaid()`, collect one update per invoice ID.
   - For rows with `splitPaymentKey`, use `splitPaymentPaidAt`; for all other rows, keep `bankRow.buchungstagISO`.
   - Preserve result reporting with one `BatchMarkPaidResult` per actual invoice update.
   - Do not alter warning confirmation logic.
   - Run `bun run build`.

7. Update docs and verify.
   - Document supported invoice number variants, canonical normalization, split-payment pre-pass, helper responsibility, `splitPayment*` fields, and confirmation deduplication in `docs/bank-reconciliation-module.md`.
   - Explicitly note that dedicated split-payment group rendering in `ReviewTable` is deferred.
   - Run final `bun run build`, then `bun test`.

## ReviewTable Caveat
Because split-payment rendering is deferred, this implementation will produce ready rows carrying the correct split metadata, but `ReviewTable` will still use its current single-row layout for them. The follow-up UI work should group rows by `splitPaymentKey`, show summed bank amounts against one invoice total, and adjust selected invoice count display for split groups.