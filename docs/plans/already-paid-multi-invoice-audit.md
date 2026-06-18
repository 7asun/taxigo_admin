# Audit — Multi-invoice already-paid rows not routed to skip bucket on re-upload

Date: 2026-06-18  
Status: Read-only audit. No code changes.

---

## Single-invoice already-paid path (exact code, line references)

`match-invoices.ts` lines 96–130. After the `extractedNumbers.length > 1` branch is skipped (because `length === 1`):

```ts
// line 96
const number = extractedNumbers[0];
const lookupInvoice = invoiceLookup.get(number);

// line 99 — not found guard (produces 'not_found', unrelated)
if (!lookupInvoice) { ... }

// line 110
const warningReasons: WarningReason[] = [];

// line 112 — already-paid detection
if (lookupInvoice.status !== 'sent') {
  warningReasons.push('already_paid');    // ← single string addition
}

// line 121
if (warningReasons.length > 0) {
  return {
    rowKey,
    bankRow,
    bucket: 'warning',                   // ← bucket is 'warning', NOT 'ignored'
    extractedNumbers,
    matchedInvoice: lookupInvoice,
    warningReasons                        // ← ['already_paid']
  };
}
```

**The bucket used is `'warning'`, not `'ignored'`.** The "skip" behaviour is entirely in the UI layer:

- `review-table.tsx` line 83–86: `alreadyPaidSkipCount` counts warning rows with `warningReasons.includes('already_paid')` and shows them in the footer as `"X bereits bezahlt übersprungen."`.
- `countManualReviewWarnings()` (review-table.tsx lines 34–39) excludes these rows from the manual-review count, so they do not inflate the "Manuelle Prüfung anzeigen" button count.
- `warning-rows-dialog.tsx` lines 101–107: `alreadyPaidCount` collects them for the banner message, and `visibleRows` filters them OUT of the table body, so the admin never sees them as actionable items.

**Result**: the row carries `warningReasons: ['already_paid']` and that single tag drives all three UI exclusion paths.

---

## Multi-invoice already-paid path (what exists today — nothing)

`match-invoices.ts` lines 55–93. The entire branch for `extractedNumbers.length > 1`:

```ts
// line 55
if (extractedNumbers.length > 1) {
  const resolution = resolveMultiInvoiceTransaction(
    bankRow,
    extractedNumbers,
    invoiceLookup,    // ← contains status for every found invoice
    sentByNumber
  );

  // (temporary console.log at line 64)

  if (resolution.ok) { ... }          // ready bucket path

  // line 82 — ONLY failure path for multi-invoice rows
  return {
    rowKey,
    bankRow,
    bucket: 'warning',
    extractedNumbers,
    matchedInvoice: resolution.invoices?.[0] ?? null,
    matchedInvoices: resolution.invoices,
    warningReasons: ['multi_invoice'],  // ← always 'multi_invoice', never 'already_paid'
    multiInvoiceResolved: false,
    multiInvoiceBlockReason: resolution.blockReason
  };
}
```

**There is no already-paid detection anywhere in this branch.** Whether the invoices are `paid`, `draft`, `cancelled`, or any other non-`sent` status, the branch always:
1. Calls `resolveMultiInvoiceTransaction()`, which fires Guard 2 and returns `ok: false`.
2. Returns `bucket: 'warning'` with `warningReasons: ['multi_invoice']` — never `['already_paid']`.
3. Sets `multiInvoiceBlockReason` to the Guard 2 string.

Because the row never carries `'already_paid'` in its `warningReasons`, none of the three UI exclusion paths (skip counter, manual-review filter, warning dialog filter) recognise it as a paid skip — so it appears as a live manual-review item on every re-upload.

**The helper itself also has no already-paid awareness.** Guard 2 (`resolve-multi-invoice-transaction.ts` lines 66–77) checks only whether `sentByNumber.has(inv.invoiceNumber)`. It does not inspect the `status` field of the found invoices, and its return type does not distinguish "not sent because paid" from "not sent because any other reason." The `blockReason` string is the only signal, and the caller does not parse it.

---

## Available data at the routing decision point

At the point where `extractedNumbers.length > 1` is evaluated inside `bankRows.map()`:

| Data | Available | Contains status? |
|------|-----------|-----------------|
| `invoiceLookup` | Yes — Map\<invoiceNumber, MatchedInvoice\> | Yes — `status` field is fetched by `getInvoicesByNumbers` and mapped directly |
| `sentByNumber` | Yes — Map\<invoiceNumber, MatchedInvoice\> | Yes (same structure), but only contains `sent` invoices + supplement |
| `bankRow` | Yes | N/A |
| `extractedNumbers` | Yes | N/A |

`invoiceLookup` is the authoritative source: it fetches ALL invoices by number (regardless of status) and carries `status` as a first-class field. The check `extractedNumbers.every(n => invoiceLookup.get(n)?.status === 'paid')` is fully expressible **before** calling `resolveMultiInvoiceTransaction()` and requires no new data.

---

## Skip bucket shape and footer count logic

The single-invoice skip shape is:
```ts
{
  bucket: 'warning',
  warningReasons: ['already_paid'],
  matchedInvoice: lookupInvoice,
  extractedNumbers: [number],
  matchedInvoices: undefined,       // not set for single-invoice rows
  multiInvoiceResolved: undefined,
  multiInvoiceBlockReason: undefined
}
```

**Footer count (`review-table.tsx` lines 83–86 + 265–266):**
```ts
const alreadyPaidSkipCount = warningRows.filter(
  (row) =>
    row.bucket === 'warning' && row.warningReasons.includes('already_paid')
).length;
// Renders: "{alreadyPaidSkipCount} bereits bezahlt übersprungen."
```

**Warning dialog exclusion (`warning-rows-dialog.tsx` lines 101–107):**
```ts
const alreadyPaidCount = rows.filter((row) =>
  row.warningReasons.includes('already_paid')
).length;

const visibleRows = rows.filter(
  (row) => !row.warningReasons.includes('already_paid')
);
// alreadyPaidCount drives the banner; visibleRows excludes them from the table
```

**Manual-review button exclusion (`review-table.tsx` lines 34–39 via `countManualReviewWarnings`):**
```ts
return rows.filter(
  (row) =>
    row.bucket === 'warning' && !row.warningReasons.includes('already_paid')
).length;
// Only non-already_paid warnings drive the "Manuelle Prüfung anzeigen (N)" button
```

All three exclusion paths are keyed on a single condition: `warningReasons.includes('already_paid')`. **No changes to any of these three UI files are required to fix the multi-invoice case** — they will automatically handle a multi-invoice warning row that carries `'already_paid'` in its `warningReasons`.

---

## Recommended fix location: Option A (pre-flight check in `match-invoices.ts`)

### Option A — Pre-flight check before calling the helper

Add a check inside the `extractedNumbers.length > 1` branch, **before** calling `resolveMultiInvoiceTransaction()`. If every extracted number maps to a `paid` invoice in `invoiceLookup`, return a `bucket: 'warning'` row with `warningReasons: ['already_paid']` — identical to the single-invoice shape, extended with `matchedInvoices` for UI context.

**Verdict: Recommended.**

Rationale:
- `invoiceLookup` is already available and already carries `status`.
- The helper is never called for this case, which is correct: auto-resolution is meaningless for already-paid invoices.
- All three UI exclusion paths pick up the row automatically by tag, with zero further changes.
- The condition `extractedNumbers.every(n => invoiceLookup.get(n)?.status === 'paid')` handles the edge case correctly: if any number is absent from `invoiceLookup` (i.e., not found), `?.status === 'paid'` is `false`, the condition fails, and the row falls through to the helper normally (Guard 1 will fire).

### Option B — New return type from the helper

Add a distinct signal to `MultiInvoiceResolution` for the "all already paid" case so the caller can branch.

**Verdict: Not recommended.**

`resolveMultiInvoiceTransaction()` is a pure validation function whose job is to determine whether an auto-resolution is safe. Already-paid detection is a pre-routing concern in the calling layer, not a resolution validation. Adding routing semantics to the helper couples it to the caller's UI concerns and complicates both its signature and its unit tests.

### Option C — Inspect `multiInvoiceBlockReason` string

Parse the Guard 2 blockReason string in the caller to detect "all paid" and reroute.

**Verdict: Not recommended.** String parsing as a control-flow mechanism is fragile, locale-sensitive, and defeats the purpose of having typed return values.

---

## Proposed fix approach (plain language, no code)

**In `match-invoices.ts`, inside the `extractedNumbers.length > 1` branch, before calling `resolveMultiInvoiceTransaction()`:**

1. Attempt to look up every extracted number in `invoiceLookup`.
2. Check whether every single lookup succeeded AND every found invoice carries `status === 'paid'`. If any number is missing from `invoiceLookup`, or if any found invoice is not `'paid'`, do nothing — fall through to the existing helper call.
3. If the condition is true (all N invoices found and all `paid`), return a warning row with `warningReasons: ['already_paid']` as the **only** reason. Set `matchedInvoice` to the first found invoice and `matchedInvoices` to all found invoices (for UI context in the warning dialog, consistent with how the multi-invoice path populates `matchedInvoices`).
4. Do not call `resolveMultiInvoiceTransaction()` for this case.

This change requires touching **only `match-invoices.ts`**. No changes are needed in:
- `resolve-multi-invoice-transaction.ts` — the helper is not affected
- `warning-rows-dialog.tsx` — already filters `already_paid` rows correctly
- `review-table.tsx` — already counts `already_paid` skip rows correctly
- `use-zahlungsabgleich.ts` — no routing logic changes required

After the fix: re-uploading a CSV with RE-2026-04-0005 and RE-2026-04-0006 (both `paid`) will produce a `warningReasons: ['already_paid']` row, increment `alreadyPaidSkipCount` in the footer, suppress the row from the warning dialog table, and keep the "Manuelle Prüfung anzeigen" button count accurate.
