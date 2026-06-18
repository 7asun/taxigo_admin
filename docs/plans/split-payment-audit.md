# Audit — Split payment matching (Eigenanteil) + regex broadening

Date: 2026-06-18  
Status: Read-only audit. No code changes.

---

## Current regex and extractInvoiceNumbers() (verbatim)

The invoice-number regex is defined in `src/features/bank-reconciliation/lib/parse-bank-csv.ts`:

```ts
// why: word boundaries prevent partial matches; legacy RE-YYYY-NNNN not handled (see module doc)
export const INVOICE_NUMBER_REGEX = /\bRE-\d{4}-\d{2}-\d{4}\b/g;

export function extractInvoiceNumbers(verwendungszweck: string): string[] {
  const matches = [
    ...verwendungszweck.matchAll(new RegExp(INVOICE_NUMBER_REGEX.source, 'g'))
  ].map((m) => m[0]);
  return [...new Set(matches)];
}
```

`INVOICE_NUMBER_REGEX` is only used by `extractInvoiceNumbers()` in `parse-bank-csv.ts`. `extractInvoiceNumbers()` is then used by:

- `collectExtractedNumbers()` in `parse-bank-csv.ts`
- `matchInvoices()` in `match-invoices.ts`

No other production code reads the regex constant directly.

Current behavior:

- `RE-2026-04-0004` → `['RE-2026-04-0004']`
- `R:2026-04-0004` → `[]`
- `RE 2026-04-0004` → `[]`
- `RE2026-04-0004` → `[]`
- `RE2026040004` → `[]`

The function returns the raw matched string as-is. There is no normalization, no case folding, and no conversion to canonical `RE-YYYY-MM-NNNN`.

---

## Normalisation gap (yes/no + evidence)

**Yes, there is a normalization gap.** Broadening the regex alone is insufficient.

After parsing, extracted numbers are collected in `use-zahlungsabgleich.ts`:

```ts
const extractedNumbers = collectExtractedNumbers(bankRows);
const lookupRows = await getInvoicesByNumbers(extractedNumbers);
const invoiceLookup = new Map(
  lookupRows.map((inv) => [inv.invoiceNumber, inv])
);

const rawRows = matchInvoices(bankRows, sentInvoices, invoiceLookup);
```

`getInvoicesByNumbers()` queries database `invoice_number` values directly:

```ts
.in('invoice_number', numbers);
```

The database stores canonical invoice numbers like `RE-2026-04-0004`, and `invoiceLookup` is keyed by that canonical value:

```ts
lookupRows.map((inv) => [inv.invoiceNumber, inv])
```

If `extractInvoiceNumbers()` returned a non-canonical value like `R:2026-04-0004`, `RE 2026-04-0004`, or `RE2026040004`, the lookup would fail silently because `.in('invoice_number', numbers)` would not match the DB row and `invoiceLookup.get(nonCanonical)` would return `undefined`.

The correct change needs two parts in the parser layer:

1. Broaden detection to recognize accepted variants.
2. Normalize every accepted variant to canonical `RE-YYYY-MM-NNNN` before returning it from `extractInvoiceNumbers()`.

The rest of the reconciliation flow should continue to receive canonical invoice numbers only.

---

## Iteration model (map/pre-pass feasibility)

`matchInvoices()` receives the full `bankRows` array:

```ts
export function matchInvoices(
  bankRows: BankRow[],
  sentInvoices: MatchedInvoice[],
  invoiceLookup: Map<string, MatchedInvoice>
): MatchedRow[] {
  const sentByNumber = new Map(
    sentInvoices.map((inv) => [inv.invoiceNumber, inv])
  );

  // supplement sentByNumber...

  return bankRows.map((bankRow, index) => {
    const extractedNumbers = extractInvoiceNumbers(bankRow.verwendungszweck);
    const rowKey = String(index);
    // row-local routing...
  });
}
```

So the function has access to all rows, but today the actual matching is a row-local `bankRows.map(...)` pass. There is no current grouping across multiple bank transactions.

For split payment matching, a pre-pass is feasible inside `matchInvoices()` before the `return bankRows.map(...)`:

- Iterate all `bankRows` with their index.
- Extract numbers for each row.
- Consider only rows where `extractedNumbers.length === 1`.
- Build a `Map<invoiceNumber, Array<{ bankRow, index }>>`.
- For each invoice number, sum the `bankRow.betrag` values across rows.
- Compare that sum to `invoice.total` from `invoiceLookup`.
- Mark matching groups as resolved split-payment candidates for the main pass.

This would not require changing the public signature of `matchInvoices()`. It does require restructuring the internals from pure row-local matching to pre-pass + row-local rendering.

---

## Amount_mismatch row shape today

For a single-invoice row with a found invoice where the bank amount does not match the invoice total:

```ts
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
```

For a split payment row where the invoice is still `sent`, the produced row shape is:

```ts
{
  rowKey,
  bankRow,                         // contains the individual partial bank amount
  bucket: 'warning',
  extractedNumbers: ['RE-2026-04-0004'],
  matchedInvoice: lookupInvoice,   // full invoice is preserved
  warningReasons: ['amount_mismatch']
}
```

The extracted invoice number and matched invoice are not dropped. That means a post-pass could theoretically inspect `amount_mismatch` rows and group them. However, a pre-pass is cleaner because it can avoid producing transient warnings for rows that are known to be a valid split-payment group.

---

## MatchedRow additions needed for split payments

The existing `MatchedRow` can carry most raw data:

- `bankRow.betrag` already stores each individual transaction amount.
- `matchedInvoice` can point to the shared invoice.
- `extractedNumbers` can remain `['RE-2026-04-0004']`.
- `rowKey` can remain the CSV row index string.

But the current group metadata (`groupKey`, `groupPosition`, `groupSize`) is not safe to reuse blindly. In the existing `ReviewTable`, `groupKey` means “multi-invoice Sammelzahlung”: one bank row with multiple invoices. The group header calculates:

```ts
const bankAmount = firstRow.bankRow.betrag;
const invoiceSum = group.rows.reduce(
  (acc, r) => acc + (r.matchedInvoice?.total ?? 0),
  0
);
const diff = bankAmount - invoiceSum;
```

For split payments, that formula is wrong because there are multiple bank rows and one shared invoice. If two rows both reference the same invoice total, summing `matchedInvoice.total` would double-count the invoice total. The grouped display needs to sum `bankRow.betrag` across rows and compare that sum to the single invoice total.

Minimum additions to `MatchedRow`:

```ts
splitPaymentKey?: string;       // shared key for rows settling the same invoice
splitPaymentPosition?: number;  // 1-based position within the split group
splitPaymentSize?: number;      // total number of bank rows in the split group
```

Optionally, a more general future-proof shape would be:

```ts
paymentGroupKey?: string;
paymentGroupKind?: 'multi_invoice' | 'split_payment';
paymentGroupPosition?: number;
paymentGroupSize?: number;
```

But the minimum safe change for the planned feature is dedicated `splitPayment*` metadata so existing multi-invoice rendering and semantics remain untouched.

---

## Write path — double-mark risk and recommended guard

Today, `markRowsPaid()` loops over selected ready rows and updates each row’s `matchedInvoice`:

```ts
for (const row of rows) {
  const invoice = row.matchedInvoice;
  if (!invoice) continue;

  await updateStatus.mutateAsync({
    invoiceId: invoice.id,
    status: 'paid',
    paidAt: row.bankRow.buchungstagISO,
    suppressToast: true
  });
}
```

For split payments, if two ready rows both point to the same invoice, this would call `updateInvoiceStatus()` twice for the same `invoiceId`.

`updateInvoiceStatus()` does not guard on current status:

```ts
const { data, error } = await supabase
  .from('invoices')
  .update({ status, ...timestampUpdate, updated_at: now })
  .eq('id', id)
  .select()
  .single();
```

There is no `.eq('status', 'sent')` guard and no idempotency check. The second call would likely succeed and overwrite `paid_at` / `updated_at` again with the same `paidAt` if the same bank booking date is passed. It would not provide a clean “already paid” signal.

Cleanest approach:

- Keep one visible ready row per bank transaction.
- On confirm, deduplicate by `invoice.id` before calling `updateStatus.mutateAsync`.
- For split-payment groups, mark the shared invoice exactly once.
- Choose the `paidAt` deterministically. If all split rows share the same booking date, use that date. If dates differ, the product needs a rule (for example latest booking date, earliest booking date, or no auto-confirm across dates).

This dedupe should be local to the bank reconciliation confirm path, not in `updateInvoiceStatus()`. The API-level function is a general status transition helper and currently allows status overwrites from other invoice UI flows.

---

## Helper location and integration point

Natural helper path, following `resolve-multi-invoice-transaction.ts`:

```txt
src/features/bank-reconciliation/lib/resolve-split-payment.ts
```

Suggested responsibility:

- Pure helper.
- Receives grouped candidate rows for one invoice, the matched invoice, and tolerance.
- Verifies the invoice is currently open (`sent`), group size is at least 2, and `sum(bankRow.betrag)` equals `invoice.total` within `AMOUNT_TOLERANCE`.
- Returns either a resolved split-payment group or a block reason for diagnostics/tests.

Best integration point:

1. In `matchInvoices()`, run a pre-pass before `bankRows.map(...)`.
2. Build groups only from rows where `extractInvoiceNumbers(row.verwendungszweck)` returns exactly one canonical invoice number.
3. Use the helper to resolve groups.
4. Store resolved groups in a map keyed by row index or invoice number.
5. During the main `bankRows.map(...)`, if the row belongs to a resolved split-payment group, return a `ready` row with `matchedInvoice` set, `splitPaymentKey` set, and split position metadata.

Collision risk:

- Split-payment logic should only consider `extractedNumbers.length === 1`.
- Existing multi-invoice logic owns `extractedNumbers.length > 1`.
- With that rule, a bank row cannot be processed by both systems.

---

## Open risks or ambiguities

- **Date rule for split payments:** The example says both transactions are in the same CSV, but not necessarily the same booking date. The write path needs a rule for `paid_at` if dates differ.
- **Partial false positives:** Two unrelated partial transfers referencing the same invoice could sum to the invoice total accidentally. Requiring same CSV import, invoice `sent`, same invoice number, and exact sum within tolerance reduces this risk, but admin review should still show both rows before confirmation.
- **More than two split payments:** The model should support N bank rows, not only Eigenanteil + insurer.
- **Overpayment / underpayment:** Current requirement is exact full settlement only. Partial settlement tracking would require schema support and is out of scope.
- **Already-paid split groups:** If the shared invoice is already `paid`, the group should follow the existing `already_paid` skip behavior, not become a resolved split-payment ready group.
- **Regex normalization collisions:** A broader regex must avoid accidentally interpreting unrelated numeric sequences as invoice numbers. The parser should require a recognizable `R`/`RE` prefix for separated forms and normalize only unambiguous captures.
- **Current docs are stale for manual multi-invoice warnings:** `docs/bank-reconciliation-module.md` still says unresolved `multi_invoice` rows have no checkbox, but current code allows manual confirmation when `matchedInvoices` is populated. Not part of this audit’s requested change, but worth correcting later.

---

## Senior recommendation

Implement regex broadening as a parser-only change: `extractInvoiceNumbers()` should recognize supported variants and always return canonical `RE-YYYY-MM-NNNN` strings. Add unit tests for each real-world variant and for deduping equivalent variants in the same reference text.

Implement split payments as a separate pure helper (`resolve-split-payment.ts`) plus a pre-pass inside `matchInvoices()`. Keep split-payment groups distinct from multi-invoice groups with dedicated `splitPayment*` metadata, because the display math is inverse: multi-invoice is one bank row paying many invoices; split-payment is many bank rows paying one invoice. Finally, update `markRowsPaid()` to deduplicate invoice IDs before mutation so a confirmed split group marks the invoice paid exactly once. This keeps the existing multi-invoice path stable while adding the new behavior with clear, testable boundaries.
