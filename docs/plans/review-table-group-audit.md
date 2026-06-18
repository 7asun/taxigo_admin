# ReviewTable Group Rendering Audit For Split Payment UI

## Clustering logic (verbatim code + data structure)

Sammelzahlung groups are detected by `MatchedRow.groupKey`. `ReviewTable` does not inspect `matchedInvoices`, `multiInvoiceResolved`, or `groupSize` to decide whether a ready row belongs to a rendered group. The grouping logic is a local helper inside `review-table.tsx`, outside the component render body but in the same module.

Verbatim clustering code:

```tsx
/**
 * Groups consecutive ready rows by groupKey.
 * Single-invoice rows have no groupKey and are returned as standalone groups of 1.
 */
function groupReadyRows(
  rows: MatchedRow[]
): Array<{ groupKey: string | null; rows: MatchedRow[] }> {
  const groups: Array<{ groupKey: string | null; rows: MatchedRow[] }> = [];

  for (const row of rows) {
    if (row.groupKey) {
      const existing = groups.find((g) => g.groupKey === row.groupKey);
      if (existing) {
        existing.rows.push(row);
      } else {
        groups.push({ groupKey: row.groupKey, rows: [row] });
      }
    } else {
      groups.push({ groupKey: null, rows: [row] });
    }
  }

  return groups;
}
```

The grouped display unit is not a synthetic header object. It is a plain object:

```ts
{ groupKey: string | null; rows: MatchedRow[] }
```

This is built once per render:

```tsx
const groups = groupReadyRows(readyRows);
```

Then `groups.map(...)` renders either:

- a Sammelzahlung group when `group.groupKey && group.rows.length > 1`
- a single-row layout otherwise

Important consequence for split payments: `splitPaymentKey` is not part of clustering today. Split rows therefore fall into standalone `{ groupKey: null, rows: [row] }` units even if they share `splitPaymentKey`.

## Group header rendering (verbatim JSX + field mapping)

The group header is a separate `TableRow` returned before the child rows. It is not injected into a separately flattened list beforehand; the JSX returns an array containing the header followed by mapped child rows.

Verbatim header JSX:

```tsx
// Group header row
<TableRow
  key={`${selKey}-header`}
  className='bg-muted/40 font-medium'
>
  <TableCell>
    <Checkbox
      checked={isSelected}
      onCheckedChange={(checked) =>
        onToggleRow(selKey, checked === true)
      }
      aria-label={`Sammelzahlung ${groupSize} Rechnungen als bezahlt markieren`}
    />
  </TableCell>
  <TableCell className='text-sm'>
    {formatBuchungstag(firstRow.bankRow.buchungstagISO)}
  </TableCell>
  <TableCell className='max-w-[180px] truncate text-sm'>
    {firstRow.bankRow.beguenstigter || '—'}
  </TableCell>
  <TableCell className='text-muted-foreground text-sm'>
    {groupSize} Rechnungen
  </TableCell>
  <TableCell className='text-right tabular-nums'>
    {formatEur(invoiceSum)}
  </TableCell>
  <TableCell className='text-right tabular-nums'>
    {formatEur(bankAmount)}
  </TableCell>
  <TableCell
    className={cn(
      'text-right tabular-nums',
      diffNearZero
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-amber-600 dark:text-amber-400'
    )}
  >
    {formatEur(diff)}
  </TableCell>
</TableRow>
```

Header field mapping:

| Column | Value | Source |
|---|---|---|
| Checkbox | selected state for whole group | `selectedReadyKeys.has(selKey)` where `selKey = group.groupKey` |
| Buchungsdatum | one bank row date | `firstRow.bankRow.buchungstagISO` |
| Begünstigter | one bank row beneficiary | `firstRow.bankRow.beguenstigter` |
| Rechnungsnr. | count label | `${groupSize} Rechnungen` |
| Rechnungsbetrag | sum of all child invoice totals | `group.rows.reduce((acc, r) => acc + (r.matchedInvoice?.total ?? 0), 0)` |
| Bankbetrag | one bank row amount | `firstRow.bankRow.betrag` |
| Differenz | bank amount minus invoice sum | `bankAmount - invoiceSum` |

There is no shared component for the group header. The JSX is inline inside `groups.map(...)`.

## Child row rendering (verbatim JSX + column diff vs header)

Verbatim child-row JSX:

```tsx
// Per-invoice child rows
...group.rows.map((row) => {
  const invoiceTotal = row.matchedInvoice?.total ?? 0;
  const pos = row.groupPosition ?? 1;
  const size = row.groupSize ?? groupSize;
  return (
    <TableRow
      key={row.rowKey}
      className={cn(
        'border-l-2 border-l-transparent',
        isSelected && 'border-l-primary/30'
      )}
    >
      <TableCell />
      <TableCell />
      <TableCell />
      <TableCell className='font-mono text-sm'>
        <span className='text-muted-foreground mr-2 text-xs tabular-nums'>
          {pos}/{size}
        </span>
        {row.matchedInvoice?.invoiceNumber ?? '—'}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {formatEur(invoiceTotal)}
      </TableCell>
      <TableCell />
      <TableCell />
    </TableRow>
  );
})
```

Column differences versus the group header:

| Column | Header row | Child row |
|---|---|---|
| Checkbox | One checkbox | Empty |
| Buchungsdatum | First row date | Empty |
| Begünstigter | First row beneficiary | Empty |
| Rechnungsnr. | Count label (`N Rechnungen`) | `pos/size` + invoice number |
| Rechnungsbetrag | Sum of invoice totals | Individual invoice total |
| Bankbetrag | One bank row amount | Empty |
| Differenz | Group diff | Empty |

The checkbox exists only on the group header. Child rows are not individually selectable. Selecting or deselecting the header calls `onToggleRow(selKey, checked === true)`, where `selKey` is `group.groupKey`.

## Differenz formula (exact arithmetic for Sammelzahlung)

The current Sammelzahlung formula is calculated inline before the header JSX:

```tsx
const selKey = group.groupKey;
const isSelected = selectedReadyKeys.has(selKey);
const firstRow = group.rows[0];
const bankAmount = firstRow.bankRow.betrag;
const invoiceSum = group.rows.reduce(
  (acc, r) => acc + (r.matchedInvoice?.total ?? 0),
  0
);
const diff = bankAmount - invoiceSum;
const diffNearZero = Math.abs(diff) < 0.005;
const groupSize = group.rows.length;
```

Exact arithmetic:

```ts
bankAmount = firstRow.bankRow.betrag
invoiceSum = sum(group.rows[*].matchedInvoice?.total ?? 0)
diff = bankAmount - invoiceSum
```

The bank side is the amount from the first row's bank row. This is correct for Sammelzahlung because the group represents one bank transaction expanded into many invoice rows; every child row shares the same original `bankRow`.

The invoice side is the sum of the child rows' `matchedInvoice.total`.

There is no standalone Differenz component. The calculation is hardcoded in `ReviewTable`, and the final cell only receives the already-computed `diff`.

For split payments, this formula must invert the aggregation:

```ts
bankSide = sum(group.rows[*].bankRow.betrag)
invoiceSide = group.rows[0].matchedInvoice?.total ?? 0
diff = bankSide - invoiceSide
```

## Reuse assessment (can existing component handle split payment math?)

The existing rendering can be reused structurally, but not as-is. The current code has several Sammelzahlung-specific assumptions:

- Group detection only checks `groupKey`; it ignores `splitPaymentKey`.
- The header assumes one bank row and many invoices: `bankAmount = firstRow.bankRow.betrag`, `invoiceSum = reduce(matchedInvoice.total)`.
- The header label is hardcoded as `{groupSize} Rechnungen`, which is wrong for split payment. Split payment should show one shared invoice once.
- Child rows assume each child represents an invoice: they display `row.matchedInvoice?.invoiceNumber`, `row.groupPosition`, `row.groupSize`, and `invoiceTotal`; bank columns are empty.
- The child position fields are `groupPosition/groupSize`; split rows use `splitPaymentPosition/splitPaymentSize`.
- The selected count in `ReviewTable` currently counts selected rows, not unique invoices. For split payment, selecting a two-row split group would display 2 Rechnungen even though one invoice is confirmed.

Minimum viable reuse: extract the inline group branch into a generic `renderGroup` path that is driven by a display group shape carrying:

```ts
type ReadyDisplayGroup =
  | { kind: 'single'; rows: [MatchedRow] }
  | { kind: 'multiInvoice'; key: string; rows: MatchedRow[] }
  | { kind: 'splitPayment'; key: string; rows: MatchedRow[] };
```

Then compute header values conditionally by `kind`.

A parallel component is not strictly necessary. A generic `GroupedReadyRows` or `ReadyGroupRows` component with `kind`-specific header math and child row rendering would keep duplication lower while avoiding hidden assumptions. Keeping one large inline branch with nested conditionals is possible but will become hard to audit.

## Checkbox and selection model

Sammelzahlung selection is group-level. The key function is:

```ts
/**
 * Returns the selection key for a ready row.
 * Group rows share a groupKey so one checkbox selects the whole group.
 * Single rows use their rowKey directly.
 */
export function selectionKeyFor(row: MatchedRow): string {
  return row.groupKey ?? row.rowKey;
}
```

Selection state shape:

```ts
// why: selection keys — groupKey for group rows, rowKey for singles
const [selectedReadyKeys, setSelectedReadyKeys] = useState<Set<string>>(
  () => new Set()
);
```

Toggle logic:

```ts
const toggleRow = useCallback((selectionKey: string, selected: boolean) => {
  setSelectedReadyKeys((prev) => {
    const next = new Set(prev);
    if (selected) {
      next.add(selectionKey);
    } else {
      next.delete(selectionKey);
    }
    return next;
  });
}, []);
```

Initial selection:

```ts
// Select all ready rows by their selection key (de-duplicated for groups)
const allReadyKeys = new Set(
  expandedRows
    .filter((r) => r.bucket === 'ready')
    .map(selectionKeyFor)
);
setSelectedReadyKeys(allReadyKeys);
```

Confirm selection:

```ts
const toMark = readyRows.filter((row) =>
  selectedReadyKeys.has(selectionKeyFor(row))
);
if (toMark.length === 0) return;
```

Sammelzahlung groups are enforced as one selectable unit because all expanded rows share `groupKey`, and `selectionKeyFor()` returns that same key for each child row.

Split payments are not currently enforced as one selectable unit. `selectionKeyFor()` ignores `splitPaymentKey`, so split rows use their individual `rowKey`s. That means an admin could deselect one partial payment row but leave another row in the same split group selected. Because `markRowsPaid()` deduplicates by invoice ID, confirming one selected split row is enough to mark the shared invoice paid. That prevents duplicate updates, but it does not enforce all-or-nothing group selection in the UI.

The selection-count logic also only understands `groupKey`:

```ts
export function countSelectedInvoices(
  readyRows: MatchedRow[],
  selectedKeys: Set<string>
): number {
  let count = 0;
  const seenGroupKeys = new Set<string>();

  for (const row of readyRows) {
    const key = selectionKeyFor(row);
    if (!selectedKeys.has(key)) continue;
    if (row.groupKey) {
      if (seenGroupKeys.has(row.groupKey)) continue;
      seenGroupKeys.add(row.groupKey);
      count += row.groupSize ?? 1;
    } else {
      count += 1;
    }
  }

  return count;
}
```

For split payment, this currently overcounts invoices because two selected split rows represent one invoice.

`ReviewTable` has a separate local count with the same limitation:

```tsx
// Total individual invoices that will be marked paid
const selectedInvoiceCount = readyRows.filter((r) =>
  selectedReadyKeys.has(selectionKeyFor(r))
).length;
```

Minimum guard needed for split payment selection: update `selectionKeyFor()` to return `row.splitPaymentKey` before `row.rowKey` for split rows, or introduce a more explicit selection key helper for ready display groups:

```ts
return row.groupKey ?? row.splitPaymentKey ?? row.rowKey;
```

Then update `countSelectedInvoices()` to count one invoice per split group, not one row per split row.

## Scroll and layout model

`ReviewTable` is a plain DOM table using the local `Table`, `TableHeader`, `TableBody`, `TableRow`, and `TableCell` components. There is no `react-window`, `tanstack-virtual`, or virtual item model in `review-table.tsx`.

Top-level ReviewTable layout:

```tsx
return (
  <div className='space-y-4'>
    <div className='rounded-md border'>
      <Table>
        <TableHeader>
          ...
        </TableHeader>
        <TableBody>
          ...
        </TableBody>
      </Table>
    </div>

    <p className='text-muted-foreground text-sm'>
      ...
    </p>
  </div>
);
```

There are no sticky table headers, max-height constraints, or internal overflow constraints in `ReviewTable` itself. Group headers and child rows are normal table rows.

`WarningRowsDialog` is not part of ready-row group rendering, but it demonstrates the modal scroll pattern for warning rows:

```tsx
<DialogContent className='flex max-h-[90vh] w-[95vw] !max-w-[1400px] flex-col gap-0 p-0'>
  <DialogHeader className='shrink-0 px-6 pt-6 pb-4'>
    <DialogTitle>Manuelle Prüfung erforderlich</DialogTitle>
  </DialogHeader>

  <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
    ...
  </div>

  <DialogFooter className='border-border shrink-0 border-t px-6 py-4 sm:justify-between'>
    ...
  </DialogFooter>
</DialogContent>
```

Adding split payment group rows to `ReviewTable` should not require virtualization changes. It only increases the number of normal table rows rendered.

## Minimum changes needed for split payment group rendering

1. Extend display grouping to include split payments.

Current grouping:

```ts
Array<{ groupKey: string | null; rows: MatchedRow[] }>
```

Recommended grouping:

```ts
type ReadyDisplayGroup =
  | { kind: 'single'; key: string; rows: [MatchedRow] }
  | { kind: 'multiInvoice'; key: string; rows: MatchedRow[] }
  | { kind: 'splitPayment'; key: string; rows: MatchedRow[] };
```

2. Cluster rows by `groupKey` for Sammelzahlung and by `splitPaymentKey` for split payments.

Priority should be:

```ts
if (row.groupKey) multiInvoice
else if (row.splitPaymentKey) splitPayment
else single
```

3. Update selection keys to make split payment all-or-nothing.

Minimum helper change:

```ts
export function selectionKeyFor(row: MatchedRow): string {
  return row.groupKey ?? row.splitPaymentKey ?? row.rowKey;
}
```

Then update `countSelectedInvoices()` to deduplicate `splitPaymentKey` and count one invoice per split group.

4. Compute group header values by group kind.

For Sammelzahlung:

```ts
bankAmount = firstRow.bankRow.betrag
invoiceAmount = sum(row.matchedInvoice?.total ?? 0)
diff = bankAmount - invoiceAmount
label = `${rows.length} Rechnungen`
```

For split payment:

```ts
bankAmount = sum(row.bankRow.betrag)
invoiceAmount = firstRow.matchedInvoice?.total ?? 0
diff = bankAmount - invoiceAmount
label = firstRow.matchedInvoice?.invoiceNumber ?? '—'
```

5. Render split-payment child rows with bank-transaction detail, not invoice detail.

For split child rows, the useful columns are:

- no checkbox
- `formatBuchungstag(row.bankRow.buchungstagISO)`
- `row.bankRow.beguenstigter`
- `splitPaymentPosition/splitPaymentSize` and optionally `row.bankRow.verwendungszweck`
- empty or repeated invoice total depending on density preference
- `row.bankRow.betrag`
- empty diff

6. Keep warning dialog unchanged unless a follow-up also wants split-payment warning handling. Split payment groups that resolve are ready rows; already-paid split rows intentionally fall through to existing single-invoice warning paths.

## Senior recommendation (Cursor's own assessment of cleanest approach)

Use a small explicit display-model refactor rather than forcing split payments through the Sammelzahlung `groupKey` model.

Reason: Sammelzahlung and split payment are mirror images:

- Sammelzahlung: one bank row -> many invoices
- Split payment: many bank rows -> one invoice

They can share the same visual pattern (header + children), but their accounting math and child-row semantics are inverted. Reusing the current inline branch without a typed `kind` would hide that inversion and invite subtle count/selection bugs.

Cleanest implementation:

1. Add `buildReadyDisplayGroups(readyRows)` local to `review-table.tsx` or a small sibling helper.
2. Return typed groups with `kind: 'single' | 'multiInvoice' | 'splitPayment'`.
3. Extract a small `renderGroupHeader(group)` path or `ReadyGroupHeader` component that receives explicit `bankAmount`, `invoiceAmount`, `diff`, `label`, `ariaLabel`, and `selectionKey`.
4. Keep separate child-row rendering for `multiInvoice` and `splitPayment` because the columns represent different things.
5. Update `selectionKeyFor()` and `countSelectedInvoices()` in `use-zahlungsabgleich.ts` so split payment groups are one selectable unit and count as one invoice.

This is the smallest change that respects the existing UI model while making split-payment behavior explicit and safe.
