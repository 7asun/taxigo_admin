---
name: split payment groups
overview: Add collapsed ReviewTable group rendering for split-payment ready rows while preserving Sammelzahlung behavior when expanded. The change will also make split-payment selection all-or-nothing and update the module docs to reflect the new display model.
todos:
  - id: selection-split-key
    content: Update selectionKeyFor and countSelectedInvoices for splitPaymentKey.
    status: completed
  - id: display-groups
    content: Replace groupReadyRows with typed ReadyDisplayGroup builder.
    status: completed
  - id: collapse-state
    content: Add collapsed-by-default group expansion state.
    status: completed
  - id: multi-collapse
    content: Add chevron and conditional child rendering to Sammelzahlung groups.
    status: completed
  - id: split-render
    content: Render split-payment group headers and child rows.
    status: completed
  - id: docs-verify
    content: Update docs and run final build and tests.
    status: completed
isProject: false
---

# Split Payment Group Rendering

## Files To Change
- `src/features/bank-reconciliation/hooks/use-zahlungsabgleich.ts`
- `src/features/bank-reconciliation/components/review-table.tsx`
- `docs/bank-reconciliation-module.md`

## Current Anchors
- `ReviewTable` currently clusters only by `row.groupKey` in `groupReadyRows()` and treats split-payment rows as singles.
- `selectionKeyFor()` currently returns `row.groupKey ?? row.rowKey`, so split-payment rows can be selected independently.
- `docs/bank-reconciliation-module.md` currently documents split-payment ReviewTable grouping as deferred.

## Implementation Plan
1. Update ready-row selection in `use-zahlungsabgleich.ts`.
   - Change `selectionKeyFor()` to return `row.groupKey ?? row.splitPaymentKey ?? row.rowKey`.
   - Extend `countSelectedInvoices()` with `seenSplitKeys` so split-payment groups count as one invoice regardless of row count.
   - Keep Sammelzahlung counting unchanged: `groupKey` rows still count `groupSize`.
   - Add concise why comments explaining that split payments are many bank rows for one invoice and must be selected together.
   - Gate: run `bun run build`.

2. Replace `groupReadyRows()` in `review-table.tsx` with a typed display model.
   - Add `ReadyDisplayGroup` union:
     - `single`: one normal row
     - `multiInvoice`: rows sharing `groupKey`
     - `splitPayment`: rows sharing `splitPaymentKey`
   - Implement `buildReadyDisplayGroups()` with priority `groupKey`, then `splitPaymentKey`, then single.
   - Do not build a `splitPayment` group if all rows have `matchedInvoice === null`; this should not happen because matcher guards require an invoice, but the UI must not render a misleading header with invoice `—` and `0,00 €`. Such rows should fall back to the existing single-row path.
   - Replace `groups.map(...)` with a `switch`/branch on `group.kind`.
   - Gate: run `bun run build`.

3. Add collapsed-by-default group state in `review-table.tsx`.
   - Import `useCallback`, `useState`, and `ChevronDown`; check existing imports first and avoid duplicate React imports.
   - Add `expandedGroupKeys: Set<string>` and `toggleGroupExpand(key)`.
   - Treat missing key from the set as collapsed; expanded child rows render only when the key is present.
   - Apply this to both `multiInvoice` and `splitPayment`; singles are unaffected.
   - Gate: run `bun run build`.

4. Add collapse support to existing Sammelzahlung rendering.
   - Preserve existing expanded arithmetic exactly:
     - `bankAmount = firstRow.bankRow.betrag`
     - `invoiceSum = sum(row.matchedInvoice?.total ?? 0)`
     - `diff = bankAmount - invoiceSum`
   - Add a final chevron `TableCell` in the header row.
   - Add one empty `<TableHead className='w-8' />` as the last header cell so the table header has the same 8-column shape as group rows.
   - The chevron button must include both `aria-label` and `aria-expanded={expandedGroupKeys.has(group.key)}`.
   - Render child rows only when expanded.
   - Add an empty trailing `TableCell` to each child row so columns align.
   - Update the empty-state `colSpan` and table header to account for the chevron column.
   - Gate: run `bun run build`.

5. Render split-payment groups in `review-table.tsx`.
   - Header math:
     - `bankAmount = sum(row.bankRow.betrag)`
     - `invoiceAmount = firstRow.matchedInvoice?.total ?? 0`
     - `diff = bankAmount - invoiceAmount`
   - Header fields:
     - checkbox keyed by `group.key`
     - date from `firstRow.splitPaymentPaidAt`, formatted with `formatBuchungstag()` exactly like single rows and Sammelzahlung headers
     - beneficiary as `—`
     - invoice number from `firstRow.matchedInvoice?.invoiceNumber`
     - invoice amount as the single invoice total
     - bank amount as summed partial payments
     - diff as summed bank minus invoice total
     - chevron toggle identical to Sammelzahlung
   - The chevron button must include both `aria-label` and `aria-expanded={expandedGroupKeys.has(group.key)}`.
   - If the first split row has `matchedInvoice === null`, do not render a split-payment header; the display-group builder should already have prevented this and fallen back to single rows.
   - Child rows show bank-transaction details: booking date, beneficiary, position, individual partial amount, and empty cells for shared invoice/diff/chevron alignment.
   - Add why comments explaining the inverse accounting model.
   - Gate: run `bun run build`.

6. Update docs and verify.
   - Update `docs/bank-reconciliation-module.md` to remove the deferred ReviewTable caveat for split-payment group rendering.
   - Document the three ready display kinds, collapsed-by-default chevron behavior, split-payment inverse math, and updated selection/counting model.
   - Update the file map/deferred section so split-payment ReviewTable grouping is no longer listed as deferred.
   - Verify the temporary debug `console.log('[Zahlungsabgleich] blockReason:', ...)` is absent from `match-invoices.ts`; no edit should be needed unless it is present.
   - Final gate: run `bun run build` and `bun test`.

## Invariants
- Only the three scoped files are modified unless the debug log is unexpectedly present.
- No matching, parsing, normalisation, warning dialog, or API behavior changes.
- Existing Sammelzahlung values and child-row layout remain identical when expanded, except for the new chevron column.
- Split-payment groups are selected/deselected as one unit and count as one invoice.
- Groups are collapsed by default; single rows do not participate in collapse state.