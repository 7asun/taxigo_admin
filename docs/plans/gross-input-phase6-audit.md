# Gross Input (Brutto-Eingabe) — Phase 6 Audit
Date: 2026-05-05

This audit is based on complete reads of:

- `src/features/angebote/types/angebot.types.ts`
- `src/features/angebote/lib/angebot-formula-engine.ts`
- `src/features/angebote/lib/angebot-formula-engine.test.ts`
- `src/features/angebote/hooks/use-angebot-builder.ts`
- `src/features/angebote/components/angebot-builder/index.tsx`
- `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- `src/features/angebote/api/angebote.api.ts`
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`
- `docs/angebot-formula-engine.md`

And targeted searches for `input_mode` / `inputMode` / `gross_input` / `grossInput` / `isGross` including `supabase/migrations/`.

---

## 1) `computeRow` current signature and computation chain

### Signature (exact)

File: `src/features/angebote/lib/angebot-formula-engine.ts`

```83:83:src/features/angebote/lib/angebot-formula-engine.ts
export function computeRow(row: RowData, columns: AngebotColumnDef[]): RowData {
```

### Computation chain (inputs by role, order, and net → tax → gross)

- `computeRow` resolves role values first:

```84:84:src/features/angebote/lib/angebot-formula-engine.ts
  const v = resolveRoleValues(row, columns);
```

- It computes `netAmount` first via `computeNetAmount(v)`:

```87:87:src/features/angebote/lib/angebot-formula-engine.ts
  const netAmount = computeNetAmount(v);
```

- It then iterates columns and writes a patch for computed-role columns only:

```89:119:src/features/angebote/lib/angebot-formula-engine.ts
  for (const col of columns) {
    switch (col.role) {
      case 'net_amount':
        patch[col.id] = netAmount;
        break;
      case 'tax_amount': {
        if (
          netAmount === null ||
          v.tax_rate === null ||
          v.tax_rate === undefined
        ) {
          patch[col.id] = null;
        } else {
          patch[col.id] = netAmount * (v.tax_rate / 100);
        }
        break;
      }
      case 'gross_amount': {
        const taxRate = v.tax_rate ?? 0;
        if (netAmount === null) {
          patch[col.id] = null;
        } else {
          patch[col.id] = netAmount * (1 + taxRate / 100);
        }
        break;
      }
      default:
        // Input role or no role — do not touch.
        break;
    }
  }
```

### Does it currently have any concept of `input_mode` or gross-first calculation?

- No. `computeRow` has no `input_mode` parameter and does net-first computation only.

---

## 2) `resolveRoleValues` — what it reads

### Signature (exact)

File: `src/features/angebote/lib/angebot-formula-engine.ts`

```32:35:src/features/angebote/lib/angebot-formula-engine.ts
export function resolveRoleValues(
  row: RowData,
  columns: AngebotColumnDef[]
): ResolvedRoleValues {
```

### Exactly which role keys does it extract from a row?

- It extracts **all roles present in `columns`** (dynamic), by iterating columns and for each truthy `col.role` reading `row[col.id]` and parsing it as a number.

```37:46:src/features/angebote/lib/angebot-formula-engine.ts
  for (const col of columns) {
    if (!col.role) continue;
    const raw = row[col.id];
    if (raw === null || raw === undefined || raw === '') {
      result[col.role] = null;
    } else {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      result[col.role] = isFinite(n) ? n : null;
    }
  }
```

### Does it read `gross_amount` at all?

- Yes **if** the schema contains a column with `role === 'gross_amount'`, because it reads/parses `row[col.id]` for every role-bearing column (no role filtering).

---

## 3) `updateLineItemWithComputed` wiring

### Exact call site where `updateLineItemWithComputed` is invoked

File: `src/features/angebote/components/angebot-builder/index.tsx`

- It is passed to Step 2 as `onUpdate`:

```631:652:src/features/angebote/components/angebot-builder/index.tsx
            <Step2Positionen
              companyId={companyId}
              selectedVorlageId={selectedVorlageId}
              onVorlageChange={handleVorlageChange}
              onColumnPresetChange={handleColumnPresetChange}
              isEditMode={isEdit}
              columnSchema={columnSchema}
              hasNetAmountCol={hasNetAmountCol}
              items={lineItems}
              onUpdate={updateLineItemWithComputed}
              onDelete={deleteLineItem}
              onReorder={reorderLineItems}
              onAdd={addLineItem}
              showTotalsBlock={showTotalsBlock}
              onShowTotalsBlockChange={setShowTotalsBlock}
              totalsLabelNet={totalsLabelNet}
              totalsLabelTax={totalsLabelTax}
              totalsLabelGross={totalsLabelGross}
              onTotalsLabelNetChange={setTotalsLabelNet}
              onTotalsLabelTaxChange={setTotalsLabelTax}
              onTotalsLabelGrossChange={setTotalsLabelGross}
            />
```

- In `Step2Positionen`, each row wraps it as `onUpdate(idx, patch)`:

```558:568:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
              {items.map((item, idx) => (
                <SortableCard
                  key={`row-${idx}`}
                  index={idx}
                  item={item}
                  columnSchema={columnSchema}
                  canDelete={items.length > 1}
                  onUpdate={(patch) => onUpdate(idx, patch)}
                  onDelete={() => onDelete(idx)}
                />
              ))}
```

### What arguments does it receive?

File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`

```321:333:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
  onUpdate: (index: number, patch: Partial<BuilderLineItem>) => void;
```

### Is `columnSchema` passed at call time or captured via closure?

- Captured via closure in `updateLineItemWithComputed` and used in `computeRow(mergedData, columnSchema)`:

```235:250:src/features/angebote/components/angebot-builder/index.tsx
  const updateLineItemWithComputed = useCallback(
    (index: number, patch: Partial<(typeof lineItems)[number]>) => {
      const currentItem = lineItems[index];
      if (!currentItem) return;
      // Merge the incoming patch first, then run the engine on the full row.
      const mergedData = { ...currentItem.data, ...(patch.data ?? {}) };
      const computedPatch = computeRow(mergedData, columnSchema);
      // Merge computed values on top — input values always win over computed
      // for non-computed columns; computed columns are overwritten by engine.
      updateLineItem(index, {
        ...patch,
        data: { ...mergedData, ...computedPatch }
      });
    },
    [lineItems, columnSchema, updateLineItem]
  );
```

---

## 4) `input_mode` field — does it exist anywhere?

Searched for: `input_mode`, `inputMode`, `gross_input`, `grossInput`, `isGross`.

- `src/features/angebote/types/angebot.types.ts`: **no matches**
- `src/features/angebote/hooks/use-angebot-builder.ts`: **no matches**
- `src/features/angebote/components/angebot-builder/index.tsx`: **no matches**
- `src/features/angebote/api/angebote.api.ts`: **no matches**
- `supabase/migrations/`: **no matches**

Conclusion: `input_mode` (and the listed variants) is **fully net-new**.

---

## 5) `show_totals_block` pattern — exact implementation (reference for Phase 6)

### DB column name and type

Migration: `supabase/migrations/20260505115400_angebot_show_totals_block.sql`

```5:6:supabase/migrations/20260505115400_angebot_show_totals_block.sql
ALTER TABLE public.angebote
  ADD COLUMN show_totals_block boolean NOT NULL DEFAULT false;
```

- Column: `public.angebote.show_totals_block`
- Type: `boolean NOT NULL DEFAULT false`

### TS field name in `AngebotRow`

File: `src/features/angebote/types/angebot.types.ts`

```119:156:src/features/angebote/types/angebot.types.ts
export interface AngebotRow {
  id: string;
  company_id: string;
  angebot_number: string;
  status: AngebotStatus;
  show_totals_block: boolean;
  totals_label_net: string | null;
  totals_label_tax: string | null;
  totals_label_gross: string | null;
  // ...
}
```

### Hook state variable name and initial value logic

File: `src/features/angebote/hooks/use-angebot-builder.ts`

```110:114:src/features/angebote/hooks/use-angebot-builder.ts
  const initialShowTotalsBlockRef = useRef(initialShowTotalsBlock ?? false);
  const [showTotalsBlock, setShowTotalsBlock] = useState(
    initialShowTotalsBlockRef.current
  );
```

- State: `showTotalsBlock`
- Initial: `initialShowTotalsBlock ?? false` (via ref, then state init)

### How it is passed to `Step2Positionen`

File: `src/features/angebote/components/angebot-builder/index.tsx`

```631:652:src/features/angebote/components/angebot-builder/index.tsx
              showTotalsBlock={showTotalsBlock}
              onShowTotalsBlockChange={setShowTotalsBlock}
```

### How it is included in create payloads

File: `src/features/angebote/types/angebot.types.ts`

```209:236:src/features/angebote/types/angebot.types.ts
export interface CreateAngebotPayload {
  // ...
  showTotalsBlock: boolean;
  // ...
}
```

File: `src/features/angebote/components/angebot-builder/index.tsx`

```525:561:src/features/angebote/components/angebot-builder/index.tsx
    createAngebotMutation({
      // ...
      showTotalsBlock,
      // ...
    });
```

File: `src/features/angebote/api/angebote.api.ts`

```269:312:src/features/angebote/api/angebote.api.ts
  const { data: headerData, error: headerError } = await supabase
    .from('angebote')
    .insert({
      // ...
      show_totals_block: payload.showTotalsBlock ?? false,
      // ...
    })
```

### How it is included in update payloads (edit/save)

File: `src/features/angebote/components/angebot-builder/index.tsx`

```481:517:src/features/angebote/components/angebot-builder/index.tsx
    if (isEdit && initialAngebot) {
      const header: UpdateAngebotPayload = {
        // ...
        showTotalsBlock,
        // ...
      };
      saveEditMutation({ header, rows: lineItemsPayload() });
      return;
    }
```

File: `src/features/angebote/hooks/use-angebot-builder.ts` (dirty guard)

```202:207:src/features/angebote/hooks/use-angebot-builder.ts
      const dirty = showTotalsBlock !== initialShowTotalsBlockRef.current;
      await updateAngebot(
        angebotId,
        dirty ? { ...header, showTotalsBlock } : header
      );
```

File: `src/features/angebote/api/angebote.api.ts` (camelCase → snake_case mapping)

```359:370:src/features/angebote/api/angebote.api.ts
  const { showTotalsBlock, totalsLabelNet, totalsLabelTax, totalsLabelGross, ...rest } =
    payload;
  const updatePayload = {
    ...rest,
    ...(showTotalsBlock !== undefined && { show_totals_block: showTotalsBlock }),
    ...(totalsLabelNet !== undefined && { totals_label_net: totalsLabelNet }),
    ...(totalsLabelTax !== undefined && { totals_label_tax: totalsLabelTax }),
    ...(totalsLabelGross !== undefined && { totals_label_gross: totalsLabelGross }),
    updated_at: new Date().toISOString()
  };
```

---

## 6) `tax_rate` role column — how the engine reads it

File: `src/features/angebote/lib/angebot-formula-engine.ts`

- The engine does not use a hardcoded key. It finds role values via `resolveRoleValues` which reads `row[col.id]` for each role-bearing column.

```37:46:src/features/angebote/lib/angebot-formula-engine.ts
  for (const col of columns) {
    if (!col.role) continue;
    const raw = row[col.id];
    // ...
    result[col.role] = isFinite(n) ? n : null;
  }
```

- If **no column has role `tax_rate`**, then `v.tax_rate` remains **`undefined`**.
  - `tax_amount` becomes `null` when `v.tax_rate` is `null` or `undefined`:

```95:103:src/features/angebote/lib/angebot-formula-engine.ts
        if (
          netAmount === null ||
          v.tax_rate === null ||
          v.tax_rate === undefined
        ) {
          patch[col.id] = null;
        } else {
          patch[col.id] = netAmount * (v.tax_rate / 100);
        }
```

  - `gross_amount` uses `v.tax_rate ?? 0`, so missing tax rate behaves as 0%:

```107:112:src/features/angebote/lib/angebot-formula-engine.ts
        const taxRate = v.tax_rate ?? 0;
        // ...
        patch[col.id] = netAmount * (1 + taxRate / 100);
```

- No throw is present in these paths.

---

## 7) `gross_amount` role column — read or write?

- `gross_amount` is written as an output by `computeRow`:

```106:114:src/features/angebote/lib/angebot-formula-engine.ts
      case 'gross_amount': {
        const taxRate = v.tax_rate ?? 0;
        if (netAmount === null) {
          patch[col.id] = null;
        } else {
          patch[col.id] = netAmount * (1 + taxRate / 100);
        }
        break;
      }
```

- `gross_amount` is **not** used as an input for any other computation: `computeRow` only uses `computeNetAmount(v)` and `v.tax_rate`.
- `resolveRoleValues` can parse `gross_amount` from `row[col.id]` if present in schema, but `computeRow` does not consume `v.gross_amount`.

Direction today: inputs → `net_amount` → `tax_amount` + `gross_amount` (gross is not an upstream input).

---

## 8) Warning icon pattern — does one exist?

File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`

- There is **no** existing pattern for a cell-level warning icon + tooltip on an individual input cell.
- Existing related UI patterns:
  1) Computed cell display shows a literal `⚙` indicator (not a warning):

```200:209:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
                  {computed ? (
                    <div
                      className='bg-muted/30 border-border flex h-8 items-center justify-between gap-2 rounded-md border px-2 text-sm'
                      title='Wird automatisch berechnet'
                    >
                      <span className='text-muted-foreground truncate'>
                        {renderComputedDisplay(col, raw)}
                      </span>
                      <span className='text-muted-foreground text-xs'>⚙</span>
                    </div>
```

  2) Totals-enable hint shows an inline warning row using `AlertTriangle`:

```596:602:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
        {showTotalsHint ? (
          <p className='text-warning mt-1 flex items-center gap-1.5 text-xs'>
            <AlertTriangle className='h-3 w-3 shrink-0' />
            Weise einer Spalte die Rolle „Nettobetrag&quot; zu, um den Summenblock
            zu aktivieren.
          </p>
        ) : null}
```

  3) `Tooltip` components exist and are used (e.g. locked template picker), but not attached to cells as a warning.

Conclusion: cell-level warning icon + tooltip is **net-new** (but can reuse `Tooltip` + `AlertTriangle` patterns).

---

## 9) Recommendation — safest way to add `input_mode: 'net' | 'gross'` to `computeRow`

### How should `computeRow` receive input mode?

- Safest: add `input_mode` as an **explicit parameter** (or options object) to `computeRow`, defaulting to net behavior.
- Evidence: today the call is `computeRow(mergedData, columnSchema)` and `input_mode` is a quote-level setting (similar to `show_totals_block`), not a schema-derived value.

```241:241:src/features/angebote/components/angebot-builder/index.tsx
      const computedPatch = computeRow(mergedData, columnSchema);
```

### Gross mode with tax rate present — back-calculation order (per Phase 6 spec)

When `input_mode === 'gross'` and a `tax_rate` value exists:

1) Interpret the dispatcher-entered amount as `gross`.
2) Read `tax_rate` \(t\) from the `tax_rate` role column.
3) Back-calculate:

- `net = gross / (1 + tax_rate / 100)`
- `tax = gross - net`

4) Output patch should set computed-role values (`net_amount`, `tax_amount`, `gross_amount`) consistently with the above.

### Gross mode with tax rate missing/null — what should `computeRow` return?

Phase 6 spec: back-calculation is not possible; value stored as-is; UI shows warning icon + tooltip.

Engine-safe outputs (no guessing):

- `net_amount`: `null`
- `tax_amount`: `null`
- `gross_amount`: pass-through gross (the typed value), unchanged

This aligns with existing engine semantics of returning `null` when computation inputs are missing (e.g. `unit_price` missing → `net_amount = null`).

---

## Appendix: totals labels DB columns (for completeness)

Migration: `supabase/migrations/20260505102500_angebot_totals_labels.sql`

```5:8:supabase/migrations/20260505102500_angebot_totals_labels.sql
ALTER TABLE public.angebote
  ADD COLUMN totals_label_net   text,
  ADD COLUMN totals_label_tax   text,
  ADD COLUMN totals_label_gross text;
```

