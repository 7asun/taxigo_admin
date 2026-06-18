# Audit — RE-2026-04-0005 / RE-2026-04-0006 blocked in Manuelle Prüfung (post-fix)

Date: 2026-06-18  
Status: Read-only audit. No code changes.

---

## Exact blockReason string (verbatim)

**Cannot be determined from static code analysis alone.** The `multiInvoiceBlockReason` field is set at runtime in `match-invoices.ts` line 89 from `resolution.blockReason`, which is the string emitted by whichever guard first fails inside `resolveMultiInvoiceTransaction()`. All four possible strings are:

| Guard | blockReason string emitted |
|-------|---------------------------|
| 1 (all missing) | `"Keine der Rechnungen wurde im System gefunden."` |
| 1 (partial) | `"Rechnung(en) nicht gefunden: RE-2026-04-0005"` or `-0006` |
| 2 (one not sent) | `"Rechnung RE-2026-04-0005 ist nicht im Status Versendet."` |
| 2 (both not sent) | `"2 Rechnungen sind nicht im Status Versendet: RE-2026-04-0005, RE-2026-04-0006"` |
| 3 | `"Die Rechnungen gehören zu unterschiedlichen Kostenträgern."` |
| 4 | `"Summe der Rechnungen (…) stimmt nicht mit dem Bankbetrag (…) überein."` |

Because the dialog shows **both invoice numbers and both amounts** (including the correct sum 1.075,70 €), it is rendering `matchedInvoices` — which is only populated when Guard 1 passes. Guard 1 is therefore ruled out.

**To confirm the exact string at runtime**: open DevTools → React DevTools → locate the warning `MatchedRow` for this bank transaction → read `multiInvoiceBlockReason`. Alternatively, add a single temporary `console.log(resolution.blockReason)` inside the `if (extractedNumbers.length > 1)` branch in `match-invoices.ts`.

---

## Which guard produced it (named, with line reference)

Guard 1 is ruled out (both invoices found and rendered). Based on the evidence available from code, the remaining candidates in probability order are:

**Most likely: Guard 2 (lines 66–77 of `resolve-multi-invoice-transaction.ts`)**  
The check is `invoices.filter((inv) => !sentByNumber.has(inv.invoiceNumber))`. After the Bug 1 supplement loop, Guard 2 can still fail if and only if both invoices have `status !== 'sent'` in the live DB. In that case `invoiceLookup` itself carries a non-sent status, the supplement loop condition `invoice.status === 'sent'` is false, the invoices are not added to `sentByNumber`, and Guard 2 fires.

**Secondary: Guard 3 (lines 79–88 of `resolve-multi-invoice-transaction.ts`)**  
The check is `new Set(invoices.map((inv) => inv.payerId)).size > 1`. If one invoice has no payer assigned (`payer_id IS NULL`, `payer` join returns null) and the other has a real UUID, or if both have different payer UUIDs, Guard 3 fires.

Guard 4 is ruled out — see Amount check section below.

---

## Pagination — confirmed cause or ruled out (with evidence)

**Pagination as the root cause is neither confirmed nor fully ruled out, but is less likely than originally assessed.**

Evidence from `listInvoices()` code (invoices.api.ts lines 62–111):

1. **No code-level default limit**: `query.limit()` is only applied when `params.limit != null && params.limit > 0` (line 103). The Zahlungsabgleich hook calls `listInvoices({ status: 'sent' })` — no `limit` field — so no JavaScript-level cap is applied.

2. **PostgREST server-side cap**: `createClient()` uses `createBrowserClient(url, anonKey)` with no custom `fetch` options, no `count` headers, and no `preferHeaders`. This means the only row cap comes from the Supabase project's PostgREST `max_rows` setting (default 1000 on managed Supabase). The exact limit for this project is not visible in client code.

3. **Order matters**: `.order('created_at', { ascending: false })` means if the result set is capped, **newer** invoices are returned first. A system with >1000 sent invoices at matching time would lose the oldest ones. For a small fleet operation, this may never be reached.

4. **The Bug 1 supplement loop is the correct mitigation** regardless of whether pagination is the trigger. It supplements `sentByNumber` from `invoiceLookup` for any invoice with `status === 'sent'` in the direct-by-number lookup. This works independently of how many sent invoices exist.

**Conclusion**: Pagination is a plausible mechanism (server cap + desc order could exclude April invoices from `sentByNumber`) but it is only relevant if the invoices are currently `status = 'sent'` in the DB. If their status is anything else, pagination is irrelevant — the supplement loop would not help in either case.

---

## invoiceLookup status values for both invoices

**Cannot be determined statically** — the status comes directly from the database row that `getInvoicesByNumbers` fetches.

Evidence from `getInvoicesByNumbers` (invoices.api.ts lines 579–603):

```ts
.select('id, invoice_number, total, status, payer_id, payer:payers(id, name)')
.in('invoice_number', numbers);
// ...
status: row.status as string,
```

The `status` field is fetched without filter — all statuses are returned. The value in `invoiceLookup` is the current live DB value.

**Critical conditional logic in the supplement loop** (match-invoices.ts lines 34–38):

```ts
for (const [number, invoice] of invoiceLookup.entries()) {
  if (invoice.status === 'sent' && !sentByNumber.has(number)) {
    sentByNumber.set(number, invoice);
  }
}
```

- If both invoices have `status === 'sent'` in the DB → supplement loop adds them → Guard 2 passes → Auto-resolution proceeds to Guard 3.
- If either invoice has `status !== 'sent'` (e.g. `'paid'`, `'draft'`, `'cancelled'`) → loop skips it → Guard 2 still fails → blockReason "Rechnung RE-2026-04-000X ist nicht im Status Versendet." → the Bug 1 fix does nothing.

**This is the single most important unknown**: the actual DB status of these two invoices determines whether Bug 1 helped at all.

---

## sentByNumber membership after Bug 1 fix

**Placement is correct**: the supplement loop runs at lines 28–38, before `bankRows.map()` at line 40, which means before `resolveMultiInvoiceTransaction()` is called at line 56. The `sentByNumber` Map passed to the helper on line 60 is already the supplemented version.

Whether the two invoices are IN `sentByNumber` at the time Guard 2 runs depends entirely on:
1. Whether `listInvoices({ status: 'sent' })` returned them (not paginated out), OR
2. Whether `invoiceLookup` has them with `status === 'sent'` (so the supplement loop adds them)

Both conditions hinge on the actual DB status. If the invoices are `sent`, at least one of the two paths will have them in `sentByNumber`. If they are not `sent`, neither path adds them, and Guard 2 fires.

---

## payerId values for both invoices (identical / different / null)

**Cannot be determined statically.** The mapping in `getInvoicesByNumbers` (line 600):

```ts
payerId: (payer?.id ?? row.payer_id ?? '') as string
```

This resolves as:
1. `payer?.id` — the UUID from the joined `payers` row. Non-null if the invoice has a `payer_id` FK that resolves to a real payers row.
2. `?? row.payer_id` — fallback to the raw FK column if the join returned null (e.g., payer was deleted).
3. `?? ''` — final fallback to empty string if both are null/undefined.

**Two scenarios that cause Guard 3 to fail:**

- **One invoice has a payer, the other does not**: payerIds are `'uuid-abc'` and `''` → `Set.size === 2` → Guard 3 fires → `"Die Rechnungen gehören zu unterschiedlichen Kostenträgern."`
- **Both invoices have different payers**: payerIds are `'uuid-abc'` and `'uuid-def'` → Guard 3 fires.

**Scenario where Guard 3 passes despite bad data:**

- **Both invoices have no payer**: payerIds are both `''` → `Set([''])`, size 1 → Guard 3 passes. This is a false pass but the subsequent guards still run.

---

## Amount check (exact numbers, floating point result)

**Guard 4 passes. This is not the cause.**

The `betrag` value is parsed from the German-formatted CSV string by `parseGermanAmount()` (parse-bank-csv.ts lines 31–34):

```ts
function parseGermanAmount(raw: string): number {
  const normalized = raw.trim().replace(/\./g, '').replace(',', '.');
  return parseFloat(normalized);
}
```

For the string `"1.075,70"`:
1. `.replace(/\./g, '')` → `"107570"` — wait, this removes ALL dots: `"1.075,70"` → removes the one dot → `"1075,70"`
2. `.replace(',', '.')` → `"1075.70"`
3. `parseFloat("1075.70")` → `1075.7`

So `bankRow.betrag = 1075.7`.

Invoice totals from the DB: `485.8` and `589.9` (as JS Numbers after `Number(row.total)`).

IEEE 754 double-precision arithmetic: `485.8 + 589.9` in V8 JavaScript evaluates to `1075.7000000000001` (due to representational error of repeating fractions). The check:

```
Math.abs(1075.7000000000001 − 1075.7) ≈ 1.14 × 10⁻¹³
```

This is eleven orders of magnitude below `AMOUNT_TOLERANCE = 0.01`. Guard 4 cannot fail for these specific values.

---

## Why June worked and April did not (data difference or code difference)

**There is no code-path difference between June and April invoices.** Both sets follow the identical execution path through `extractedNumbers.length > 1` → `resolveMultiInvoiceTransaction()` → same four guards in the same order.

**The difference is in the data.** Two candidate explanations, in order of probability:

**Explanation A (most likely): Invoice status in the DB differs.**  
The June test invoices (RE-2026-06-0014 through -0017) were presumably created recently and are in `status = 'sent'`. The April invoices (RE-2026-04-0005, -0006) may be in a different status — either already `paid` (processed via the old pre-refactor flow, perhaps manually or via a previous matching attempt), or in some other status. If their current status is not `sent`, Guard 2 fires regardless of the Bug 1 supplement loop.

**Explanation B: payerId differs between the two invoice sets.**  
The June invoices may have been created with a correctly populated `payer_id` FK, while the April invoices may have been created without a payer, or with different payers. Guard 3 fires if `payerId` differs between the two April invoices, even if Guard 2 passes.

These are mutually exclusive as the primary cause (whichever guard fails first wins), but could both be true simultaneously (Guard 2 fires before Guard 3 is even evaluated).

---

## Root Cause

The invoices RE-2026-04-0005 and RE-2026-04-0006 remain in the warning bucket because `resolveMultiInvoiceTransaction()` returns `ok: false`, and the exact guard that fails cannot be determined without inspecting the live DB state. The most evidence-supported explanation is that one or both invoices do not have `status = 'sent'` in the database at the time of matching — either because they were previously processed via a different path and are already `paid`, or because their status was manually changed. The Bug 1 supplement loop is correctly placed and correctly implemented: it runs before `resolveMultiInvoiceTransaction()` and correctly adds `sent` invoices from `invoiceLookup` to `sentByNumber`. However, the loop is conditional on `invoice.status === 'sent'`; if the invoices carry any other status in the DB, the loop has no effect and Guard 2 fires identically to before the fix. The Bug 2 escape-hatch fix (restoring `canMarkWarningRow` to return `true` when `matchedInvoices.length > 0`) should now cause the warning dialog to render a confirm checkbox for this row — since `matchedInvoices` has two entries and `matchedInvoice` (singular) is the first invoice. If the admin still reports "no checkbox," the most likely cause is that the browser has not picked up the new code (dev server hot-reload or hard refresh required). The auto-resolution block itself is a data-state issue, not a code logic error.

---

## Recommended Fix (approach only, no code)

**Step 1 — Identify the exact blockReason at runtime.** Add a temporary `console.log` inside the `extractedNumbers.length > 1` branch in `match-invoices.ts` to print `resolution.blockReason` for this specific bank row. This immediately tells you which guard failed and eliminates all speculation.

**Step 2a — If blockReason contains "Versendet" (Guard 2):**  
Check the DB status of RE-2026-04-0005 and RE-2026-04-0006 directly. If they are already `paid`, they should not be re-matched — the bank transaction is a duplicate import. If they are `sent` but Guard 2 fires anyway, the Bug 1 supplement loop is not working as expected (verify via breakpoint that the loop runs and finds both invoices). If pagination is confirmed as the mechanism (>1000 sent invoices), the supplement loop should fix it.

**Step 2b — If blockReason contains "Kostenträger" (Guard 3):**  
Check `invoices.payer_id` for both rows in the DB. One may have a NULL `payer_id`, causing `payerId = ''` while the other has a real UUID, making the payer set size 2. The fix is to ensure both invoices have the correct `payer_id` assigned in the DB — this is a data correction, not a code fix. Alternatively, a Guard 3 relaxation for the case where one or both `payerId` values are empty string `''` (treating empty as "unknown payer" rather than "different payer") can be considered, but only after understanding why the payer is missing.

**Step 3 — Verify the checkbox appears after hard refresh.** The Bug 2 Part A fix should already make the confirm checkbox visible for this row once the browser picks up the new code. Test by doing a hard refresh (Cmd+Shift+R) on the Zahlungsabgleich dialog page.
