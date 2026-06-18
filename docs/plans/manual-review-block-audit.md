# Audit — RE-2026-04-0005 / RE-2026-04-0006 not resolving in Manuelle Prüfung

Date: 2026-06-17  
Status: Read-only audit. No code changes.

---

## Does the row reach the helper? (YES)

The routing condition in `match-invoices.ts` is:

```ts
// match-invoices.ts lines 32–43
if (extractedNumbers.length === 0) {
  return { bucket: 'ignored', ... };
}

if (extractedNumbers.length > 1) {
  const resolution = resolveMultiInvoiceTransaction(bankRow, extractedNumbers, invoiceLookup, sentByNumber);
  ...
}
```

There is **no early-return guard** before `extractedNumbers.length > 1`. A row with exactly two extracted numbers (`['RE-2026-04-0005', 'RE-2026-04-0006']`) follows this path line-by-line:

1. **Line 29**: `extractedNumbers = extractInvoiceNumbers(bankRow.verwendungszweck)` → `['RE-2026-04-0005', 'RE-2026-04-0006']` (length 2)
2. **Line 32**: `extractedNumbers.length === 0` → false, no early return
3. **Line 43**: `extractedNumbers.length > 1` → true (2 > 1)
4. **Lines 44–48**: `resolveMultiInvoiceTransaction(bankRow, extractedNumbers, invoiceLookup, sentByNumber)` is called
5. Since `resolution.ok` is false, falls through to the warning return on lines 68–78

The helper is definitely being called. The old string `"Mehr als zwei Rechnungsnummern — bitte manuell prüfen"` no longer exists anywhere in the codebase (it was inside the deleted `resolveMultiInvoiceRow()`). Whatever `multiInvoiceBlockReason` is displayed, it is one of the new German strings emitted by `resolveMultiInvoiceTransaction()`.

---

## Which guard fails? (GUARD 2 — most likely; Guard 3 possible)

The four guards in `resolveMultiInvoiceTransaction.ts` evaluate in order; the first failure short-circuits.

**Guard 1 (existence)**: both invoices almost certainly exist in `invoiceLookup`, because `invoiceLookup` is built from `getInvoicesByNumbers(extractedNumbers)` — a targeted fetch by invoice number. If they were truly missing, the warning dialog would not show invoice details (amounts, payer name) in its row. Since the row does render invoice detail, Guard 1 passes.

**Guard 2 (sentByNumber — most likely failure)**:

`sentByNumber` is built inside `matchInvoices()` from the `sentInvoices` argument:
```ts
// match-invoices.ts lines 24–26
const sentByNumber = new Map(
  sentInvoices.map((inv) => [inv.invoiceNumber, inv])
);
```

`sentInvoices` arrives from the hook, which calls `listInvoices({ status: 'sent' })` and pipes through `mapInvoiceWithPayerToMatched`. If `listInvoices` applies a default page limit (e.g. 100 rows ordered by newest first), then **older invoices like April 2026 entries may not be included in the result set**. They would be present in `invoiceLookup` (fetched directly by number) but absent from `sentByNumber`.

The guard check is:
```ts
// resolve-multi-invoice-transaction.ts lines 67–77
const notSent = invoices.filter((inv) => !sentByNumber.has(inv.invoiceNumber));
if (notSent.length > 0) {
  return {
    ok: false,
    blockReason: `Rechnung ${notSent[0].invoiceNumber} ist nicht im Status Versendet.`
    ...
  };
}
```

If `sentByNumber` does not contain RE-2026-04-0005, the `blockReason` would read:
`"Rechnung RE-2026-04-0005 ist nicht im Status Versendet."` — even though the invoice IS in `sent` status in the database.

**Guard 3 (payerId — secondary candidate)**:

`payerId` on `invoiceLookup` items is populated from `getInvoicesByNumbers` which now selects `payer:payers(id, name)`. If either invoice has a null `payer_id` foreign key in the database (invoice created before a payer was assigned, or the join returns null), then:

```ts
// invoices.api.ts
payerId: (payer?.id ?? row.payer_id ?? '') as string
```

...maps to `''` (empty string). If only one invoice has `payerId = ''` and the other has a real UUID (or vice versa), Guard 3 fires:
```
"Die Rechnungen gehören zu unterschiedlichen Kostenträgern."
```

If both are `''`, the set has size 1 and Guard 3 passes — but this may hide a real data problem.

**Guards 1 and 4**: Unlikely to be the failure here. The invoices exist (Guard 1), and the bank row was presumably matched by amount previously under the old system (Guard 4).

---

## DB state of RE-2026-04-0005 and RE-2026-04-0006

Cannot be confirmed statically from code alone — requires a live DB query. However, the code-path evidence allows the following deductions:

- Both invoices **exist in the DB**: they appear in `invoiceLookup` and the warning dialog renders their invoice numbers and amounts, meaning `getInvoicesByNumbers` returned them.
- Their **status in the DB is likely `sent`**: the admin is attempting to pay them, and they were not automatically moved to ready by single-invoice paths.
- Their **`payerId`** may be `''` (empty string) or a real UUID — this is determined by whether `invoices.payer_id` is populated in the DB and whether `payers` join returns a non-null row.

The `sentByNumber` map is the question mark: whether `listInvoices({ status: 'sent' })` actually returns April 2026 invoices depends on its pagination/ordering implementation.

---

## Amount check (numbers, result)

Cannot be determined statically — the CSV is not available for inspection. The assumption is that the bank betrag equals the sum of the two invoice totals (since the user reports these as a valid group payment that should resolve). If they are in warning rather than the old "ready after manual resolve" state, the amount check is not the first failure (Guards 1–3 are evaluated before Guard 4).

---

## Why manual confirm is blocked (exact code path)

This is the confirmed regression. The warning dialog checkbox is gated by `canMarkWarningRow()`:

```ts
// use-zahlungsabgleich.ts lines 94–99 (NEW implementation)
export function canMarkWarningRow(row: MatchedRow): boolean {
  if (!row.matchedInvoice) return false;
  if (row.warningReasons.includes('not_found')) return false;
  if (row.warningReasons.includes('multi_invoice')) return false;  // ← HARD BLOCK
  return true;
}
```

**Any row with `warningReasons: ['multi_invoice']` returns `false`**, regardless of whether invoices were found, amounts match, or the admin wants to override.

In `warning-rows-dialog.tsx` line 145–177:
```tsx
const markable = canMarkWarningRow(row);
// ...
{markable ? (
  <Checkbox ... />                          // ← never rendered for multi_invoice rows
) : isMultiInvoice && row.multiInvoiceBlockReason ? (
  <span>{row.multiInvoiceBlockReason}</span>  // ← block reason text shown instead
) : null}
```

So the admin sees the `multiInvoiceBlockReason` text in the first cell, but no checkbox. The confirm button counts `actionableSelectedCount` via the same `canMarkWarningRow` filter and remains disabled.

**Before the refactor**, `canMarkWarningRow` was:
```ts
// OLD implementation
export function canMarkWarningRow(row: MatchedRow): boolean {
  if (
    row.multiInvoiceResolved === true &&
    (row.matchedInvoices?.length ?? 0) > 0
  ) {
    return true;   // ← escape hatch: if multiInvoiceResolved was true, checkbox appeared
  }
  if (!row.matchedInvoice) return false;
  if (row.warningReasons.includes('not_found')) return false;
  if (row.warningReasons.includes('multi_invoice')) return false;
  return true;
}
```

The old code distinguished between `multiInvoiceResolved: true` (all guards passed → warning bucket with checkbox) and `multiInvoiceResolved: false` (guards failed → warning bucket without checkbox). The new code removed this distinction because resolved groups were moved to the ready bucket — but that only helps when guards pass. When guards fail, the escape hatch is now gone.

---

## Was the old manual-confirm path preserved? (NO)

Two changes broke the old path:

**1. `canMarkWarningRow` simplified**: The `multiInvoiceResolved === true` branch that returned `true` was deleted. Comment in the source: `"Warning rows actionable when a single invoice is matched (not multi-invoice resolved rows — those are in the ready bucket now)."` This reasoning is correct for the happy path but leaves no recourse for the unhappy path.

**2. `markWarningRowPaid` lost multi-invoice loop**: The old implementation iterated over `row.matchedInvoices` for multi-invoice rows:

```ts
// OLD markWarningRowPaid
if (row.multiInvoiceResolved && row.matchedInvoices?.length) {
  const perInvoice: BatchMarkPaidResult[] = [];
  for (const invoice of row.matchedInvoices) {
    await updateStatus.mutateAsync({ invoiceId: invoice.id, ... });
    perInvoice.push({ ... });
  }
  // ... aggregate result
}
```

The new `markWarningRowPaid` only handles `row.matchedInvoice` (single invoice):
```ts
// NEW markWarningRowPaid (use-zahlungsabgleich.ts lines 282–318)
const invoice = row.matchedInvoice;
if (!invoice) return { success: false, error: 'Keine Rechnung zugeordnet' };
await updateStatus.mutateAsync({ invoiceId: invoice.id, ... });
```

Even if a checkbox were shown, clicking confirm would only mark ONE invoice (`matchedInvoice`, which is `resolution.invoices?.[0]`), not both.

---

## Root Cause

The refactor correctly moved successfully-resolved Sammelzahlungen to the ready bucket, but assumed that "if guards fail → human cannot help either." This is incorrect. When Guard 2 fails because `listInvoices` pagination excludes older `sent` invoices (the most likely scenario for April 2026 invoices), the invoices are genuinely payable but the helper can't confirm it because they don't appear in `sentByNumber`. The old code had an escape hatch — `canMarkWarningRow` returned `true` for rows where `multiInvoiceResolved: true`, and `markWarningRowPaid` looped over `matchedInvoices` to mark both paid. Both of these were removed during the refactor with the assumption that they were no longer needed. The net effect is that any unresolved multi-invoice warning row (whether the guard failure is real or spurious) is now completely frozen: no checkbox, no confirm button, and even if a checkbox were somehow triggered, only one of the N invoices would be marked paid.

---

## Recommended Fix

Two independent fixes are needed:

**Fix A — `sentByNumber` coverage (eliminate the root cause of Guard 2 spurious failures)**  
Investigate whether `listInvoices({ status: 'sent' })` paginates and caps the result set. If so, it should either fetch all pages or accept an explicit list of invoice numbers to look up. An alternative is to enrich `sentByNumber` by merging it with `invoiceLookup`: if an invoice is in `invoiceLookup` with `status === 'sent'`, treat it as sent regardless of whether `listInvoices` returned it. This ensures older invoices in `sent` status are not falsely blocked by Guard 2.

**Fix B — restore the manual-confirm escape hatch for unresolved multi-invoice warning rows**  
`canMarkWarningRow` should return `true` for warning rows where `matchedInvoices` is populated and the admin has explicitly selected the row — regardless of which guard failed and regardless of `multiInvoiceResolved`. The admin is the last human check and should not be locked out. Correspondingly, `markWarningRowPaid` should be restored to iterate over `matchedInvoices` (not just `matchedInvoice`) when `matchedInvoices.length > 0`, matching the old implementation. This is a pure regression fix that restores the pre-refactor behaviour for the unhappy path without affecting the new ready-bucket promotion for the happy path.
