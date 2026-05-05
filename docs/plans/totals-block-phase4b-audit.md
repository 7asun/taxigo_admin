# Totals Block (Phase 4b) — Audit

Scope (files read):

- `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- `src/features/angebote/hooks/use-angebot-builder.ts`
- `src/features/angebote/lib/angebot-formula-engine.ts`
- `src/features/angebote/types/angebot.types.ts`
- `docs/angebot-formula-engine.md`

---

## Q1: Where exactly is the totals block value computed today?

The **summing logic** for the totals block lives in the formula engine as:

- `computeAngebotTotals(rows, columns)` in `src/features/angebote/lib/angebot-formula-engine.ts`:

```195:230:src/features/angebote/lib/angebot-formula-engine.ts
export function computeAngebotTotals(
  rows: RowData[],
  columns: AngebotColumnDef[]
): {
  netTotal: number | null;
  taxTotal: number | null;
  grossTotal: number | null;
} {
  const netCol = columns.find((c) => c.role === 'net_amount');
  const taxCol = columns.find((c) => c.role === 'tax_amount');
  const grossCol = columns.find((c) => c.role === 'gross_amount');

  const sum = (col: AngebotColumnDef | undefined): number | null => {
    if (!col) return null;
    const values = rows
      .map((r) => r[col.id])
      .filter((v): v is number => typeof v === 'number' && isFinite(v));
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };

  return {
    netTotal: sum(netCol),
    taxTotal: sum(taxCol),
    grossTotal: sum(grossCol)
  };
}
```

Within the files in scope, **neither** `Step2Positionen` **nor** `useAngebotBuilder` compute totals for display; `Step2Positionen` only exposes the *toggle* and the *label inputs*.

Documentation explicitly states that Phase 4 totals computation is via `computeAngebotTotals` (and rendered in the PDF), not in the builder UI:

```151:156:docs/angebot-formula-engine.md
- `computeAngebotTotals(rows, columns)` lives in `src/features/angebote/lib/angebot-formula-engine.ts`.
- It sums `net_amount`, `tax_amount`, and `gross_amount` across all rows.
- It returns `null` for a total if the schema has no column with that computed role (or no numeric values were present), so the PDF can suppress rows cleanly.
```

---

## Q2: How does that computation locate net/tax/gross per row (role scan vs hardcoded ID)?

It locates the columns **by role** (scans `columns` for `col.role === ...`), then sums using those resolved column **IDs**:

```213:223:src/features/angebote/lib/angebot-formula-engine.ts
const netCol = columns.find((c) => c.role === 'net_amount');
const taxCol = columns.find((c) => c.role === 'tax_amount');
const grossCol = columns.find((c) => c.role === 'gross_amount');

const values = rows
  .map((r) => r[col.id])
  .filter((v): v is number => typeof v === 'number' && isFinite(v));
```

So: **role-based discovery**, then **ID-based extraction** (`r[col.id]`), not any hardcoded column IDs.

---

## Q3: What is the current guard that blocks enabling the totals block?

The guard is in `Step2Positionen` and blocks *only when the user tries to enable* the switch while the schema lacks a `net_amount` role column.

The exact condition is:

```746:755:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
onCheckedChange={(checked) => {
  // WHY: totals require a net_amount role column — block enabling until schema supports it.
  if (checked && !hasNetAmountCol) {
    setShowTotalsHint(true);
    return;
  }
  // WHY: hint is guidance-only and must never persist once the switch is off.
  setShowTotalsHint(false);
  onShowTotalsBlockChange(checked);
}}
```

`hasNetAmountCol` itself is computed in the builder parent as:

```369:372:src/features/angebote/components/angebot-builder/index.tsx
const hasNetAmountCol = useMemo(
  () => columnSchema.some((c) => c.role === 'net_amount'),
  [columnSchema]
);
```

So yes: the guard is specifically “**schema contains a `net_amount` role column**”.

---

## Q4: Do builder line items carry computed net/tax/gross in `item.data` even if those columns aren’t visible / in schema?

No. `computeRow` only writes computed values for **columns that exist in `columnSchema`**.

`computeRow` iterates over `columns` and only patches keys where a column with that computed role exists:

```141:171:src/features/angebote/lib/angebot-formula-engine.ts
for (const col of columns) {
  switch (col.role) {
    case 'net_amount':
      patch[col.id] = netAmount;
      break;
    case 'tax_amount': {
      // ...
      patch[col.id] = /* ... */;
      break;
    }
    case 'gross_amount': {
      // ...
      patch[col.id] = /* ... */;
      break;
    }
    default:
      // Input role or no role — do not touch.
      break;
  }
}
```

And `updateLineItemWithComputed` in the builder runs the engine with `columnSchema` and merges the result:

```238:250:src/features/angebote/components/angebot-builder/index.tsx
const mergedData = { ...currentItem.data, ...(patch.data ?? {}) };
const computedPatch = computeRow(mergedData, columnSchema, inputMode);
updateLineItem(index, {
  ...patch,
  data: { ...mergedData, ...computedPatch }
});
```

Therefore, if the schema has **no** `net_amount` / `tax_amount` / `gross_amount` role columns, there is **no place** for `computeRow` to write those computed values into `item.data`.

---

## Q5: What does the totals block currently render (net/tax/gross), and where?

Within `Step2Positionen` (builder Step 2), the “Summenblock” UI renders:

- the **toggle** (`showTotalsBlock`)
- and (when enabled) **three label input fields** (Netto/MwSt/Brutto labels)

It does **not** render any computed numeric totals in the builder UI.

The exact render path in Step 2 is:

```742:808:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
<Switch
  id='show-totals-block'
  checked={showTotalsBlock}
  onCheckedChange={(checked) => {
    if (checked && !hasNetAmountCol) {
      setShowTotalsHint(true);
      return;
    }
    setShowTotalsHint(false);
    onShowTotalsBlockChange(checked);
  }}
/>
...
{showTotalsBlock ? (
  <div className='mt-3 flex flex-col gap-2 pl-1'>
    <p className='text-muted-foreground text-xs font-medium'>
      Beschriftung der Summenzeilen
    </p>
    {[
      { label: 'Netto-Zeile', value: totalsLabelNet, onChange: onTotalsLabelNetChange },
      { label: 'MwSt-Zeile', value: totalsLabelTax, onChange: onTotalsLabelTaxChange },
      { label: 'Brutto-Zeile', value: totalsLabelGross, onChange: onTotalsLabelGrossChange }
    ].map(({ label, value, onChange }) => (
      <div key={label} className='flex items-center gap-2'>
        <span className='text-muted-foreground w-24 shrink-0 text-xs'>{label}</span>
        <Input value={value} onChange={(e) => onChange(e.target.value)} className='h-7 text-xs' maxLength={60} />
      </div>
    ))}
  </div>
) : null}
```

For the *actual* totals numbers (net subtotal, tax subtotal, gross total), the contract is documented as a **PDF totals block** powered by `computeAngebotTotals`:

```142:163:docs/angebot-formula-engine.md
## Phase 4 — PDF Totals Block
...
### Totals computation contract
- `computeAngebotTotals(rows, columns)` lives in `src/features/angebote/lib/angebot-formula-engine.ts`.
- It sums `net_amount`, `tax_amount`, and `gross_amount` across all rows.
...
### Render condition
The totals block renders only if **both** are true:
- `angebot.show_totals_block === true`
- the active column schema contains at least one column with role `net_amount`
```

So the totals block, when rendered (in the PDF), is intended to display **all three**: **net**, **tax**, and **gross**, subject to `null` suppression rules described above.

