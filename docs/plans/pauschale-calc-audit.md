# Pauschale Calculation Audit — Quote Builder Step 2

## Root cause hypothesis

A pure **Pauschale** row does not calculate because `Pauschale` is stored as the column role `flat_rate`, but `computeNetAmount()` still requires `unit_price` to be present before it will compute any net amount.

## Evidence

### Preliminary note: requested file name

`step-2-positionen-2.tsx` was not present in the workspace. The only matching Step 2 file is:

```text
src/features/angebote/components/angebot-builder/step-2-positionen.tsx
```

Search evidence:

```text
src/features/angebote/components/angebot-builder/step-2-positionen.tsx
```

### 1. Where is `Pauschale` defined?

`Pauschale` is a string literal label inside a const object, not a TypeScript enum. The stored value is not `"Pauschale"`; selecting the role stores the role string `"flat_rate"`.

`src/features/angebote/lib/angebot-column-presets.ts:132-175`

```ts
export const ANGEBOT_COLUMN_ROLE_UI: Record<
  AngebotColumnRole,
  {
    label: string;
    group: 'input' | 'computed';
    description: string;
  }
> = {
  // ...
  flat_rate: {
    label: 'Pauschale',
    group: 'input',
    description: 'Fester Betrag unabhängig von der Strecke'
  },
```

The allowed stored role values are defined by a Zod enum in `angebot.types.ts`; `flat_rate` is the exact persisted/validated role value.

`src/features/angebote/types/angebot.types.ts:45-60`

```ts
export const angebotColumnRoleSchema = z.enum([
  // Input roles
  'description',
  'time',
  'days',
  'quantity',
  'distance_km',
  'unit_price',
  'flat_rate',
  'surcharge',
  'tax_rate',
  // Computed roles
  'net_amount',
  'tax_amount',
  'gross_amount'
]);
```

The template editor renders role options using the object key as `value`, so selecting the label `Pauschale` stores `"flat_rate"`.

`src/features/angebote/lib/angebot-column-presets.ts:207-215`

```ts
export const ANGEBOT_ROLE_INPUT_OPTIONS = (
  Object.entries(ANGEBOT_COLUMN_ROLE_UI) as [
    AngebotColumnRole,
    AngebotColumnRoleUi
  ][]
)
  .filter(([, v]) => v.group === 'input')
  .map(([k, v]) => ({ value: k, label: v.label, description: v.description }));
```

`src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx:216-221`

```tsx
<Select
  disabled={disabled}
  value={value ?? '__none__'}
  onValueChange={(v) =>
    onChange(v === '__none__' ? null : (v as AngebotColumnRole))
  }
>
```

The value exactly matches conditional checks elsewhere. Step 2 recognizes `flat_rate` for gross-input UI behavior:

`src/features/angebote/components/angebot-builder/step-2-positionen.tsx:243-253`

```tsx
const showGrossWarning =
  inputMode === 'gross' &&
  (col.role === 'unit_price' ||
    col.role === 'flat_rate' ||
    col.role === 'surcharge') &&
  !hasTaxRateValue(item.data, columnSchema);
const isGrossPriceInput =
  inputMode === 'gross' &&
  (col.role === 'unit_price' ||
    col.role === 'flat_rate' ||
    col.role === 'surcharge');
```

The formula engine also recognizes `flat_rate` during gross-to-net conversion:

`src/features/angebote/lib/angebot-formula-engine.ts:169-179`

```ts
const divisor = canConvertGrossInputs ? 1 + taxRate / 100 : null;
const convertedV =
  canConvertGrossInputs && divisor
    ? {
        ...v,
        // WHY: only prices are tax-inclusive; distance and quantity are units, never converted.
        unit_price:
          v.unit_price != null ? v.unit_price / divisor : v.unit_price,
        flat_rate: v.flat_rate != null ? v.flat_rate / divisor : v.flat_rate,
        surcharge: v.surcharge != null ? v.surcharge / divisor : v.surcharge
      }
    : v;
```

### 2. Where is the row total calculated?

The live builder calculation starts in the parent `AngebotBuilder`, not inside `Step2Positionen`. Every row update is merged, passed to `computeRow()`, then saved back into `lineItems`.

`src/features/angebote/components/angebot-builder/index.tsx:243-257`

```tsx
const updateLineItemWithComputed = useCallback(
  (index: number, patch: Partial<(typeof lineItems)[number]>) => {
    const currentItem = lineItems[index];
    if (!currentItem) return;
    // Merge the incoming patch first, then run the engine on the full row.
    const mergedData = { ...currentItem.data, ...(patch.data ?? {}) };
    const computedPatch = computeRow(mergedData, columnSchema, inputMode, {
      fallbackTaxRate: defaultTaxRate
    });
    // Merge computed values on top — input values always win over computed
    // for non-computed columns; computed columns are overwritten by engine.
    updateLineItem(index, {
      ...patch,
      data: { ...mergedData, ...computedPatch }
    });
  },
```

The actual single-row net/tax/gross computation is in `computeRow()`, which calls `computeNetAmount()`.

`src/features/angebote/lib/angebot-formula-engine.ts:206-237`

```ts
const netAmount = computeNetAmount(convertedV);
const taxAmount =
  netAmount === null || effectiveTax === undefined
    ? null
    : netAmount * (effectiveTax / 100);
const grossAmount =
  netAmount === null ? null : netAmount * (1 + (effectiveTax ?? 0) / 100);

for (const col of columns) {
  switch (col.role) {
    case 'net_amount':
      patch[col.id] = netAmount;
      break;
    case 'tax_amount': {
      patch[col.id] = taxAmount;
      break;
    }
    case 'gross_amount': {
      patch[col.id] = grossAmount;
      break;
    }
    default:
      // Input role or no role — do not touch.
      break;
  }
}

patch[SYNTHETIC_NET_KEY] = netAmount;
patch[SYNTHETIC_TAX_KEY] = taxAmount;
patch[SYNTHETIC_GROSS_KEY] = grossAmount;
```

`computeRow()` branches on computed output roles (`net_amount`, `tax_amount`, `gross_amount`) and on gross-input conversion roles (`unit_price`, `flat_rate`, `surcharge`). It does not branch by a row-level `positionType` because this codebase does not have a row-level `positionType` for Angebote.

The failing formula is `computeNetAmount()`:

`src/features/angebote/lib/angebot-formula-engine.ts:120-130`

```ts
export function computeNetAmount(v: ResolvedRoleValues): number | null {
  // unit_price is the minimum required input — without it we cannot compute.
  if (v.unit_price === null || v.unit_price === undefined) return null;

  const distanceKm = v.distance_km ?? 0;
  const flatRate = v.flat_rate ?? 0;
  const surcharge = v.surcharge ?? 0;
  const quantity = v.quantity ?? null;

  const base = distanceKm * v.unit_price + flatRate + surcharge;
  return quantity !== null ? base * quantity : base;
}
```

This fails for Pauschale-only rows because `flat_rate` can be present, but `unit_price` is `null`/`undefined`; the early return prevents the formula from ever reaching `flatRate`.

The tests document that behavior directly:

`src/features/angebote/lib/angebot-formula-engine.test.ts:61-67`

```ts
it('computeNetAmount — unit_price missing → null', () => {
  const v = {
    distance_km: 10,
    quantity: 2,
    flat_rate: 5
  };
  expect(computeNetAmount(v)).toBeNull();
});
```

And the gross-mode Pauschale test has to inject `unit_price: 0` to make a flat-rate calculation work:

`src/features/angebote/lib/angebot-formula-engine.test.ts:200-214`

```ts
it('tax_rate=7: flat_rate entered as gross → engine converts to net before computing', () => {
  const columns: AngebotColumnDef[] = [
    col('flat', 'Pauschale', 'betrag', 'flat_rate'),
    col('unit', 'Preis', 'betrag', 'unit_price'),
    col('tax', 'MwSt', 'percent', 'tax_rate'),
    col('net', 'Netto', 'betrag', 'net_amount'),
    col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
    col('gross', 'Brutto', 'betrag', 'gross_amount')
  ];

  // unit_price required; set 0 so net is computed from flat_rate only.
  const row = { unit: 0, flat: 107, tax: 7 };
  const patch = computeRow(row, columns, 'gross');
```

### 3. What input fields does a Pauschale row expose?

There is no row-level visibility branch for Pauschale in Step 2. `SortableCard` renders every column from the selected template schema except the auto `Pos.` column.

`src/features/angebote/components/angebot-builder/step-2-positionen.tsx:236-242`

```tsx
{columnSchema
  .filter((col) => col.id !== ANGEBOT_POSITION_COLUMN_ID)
  .map((col) => {
    const raw = item.data[col.id];
    const key = `${col.id}-${index}`;
    const layout = resolveColumnLayout(col);
    const computed = isComputedColumn(col);
```

The input widget is selected by layout render type, not by `positionType`. A Pauschale role normally uses a `betrag` preset, which resolves to `pdfRenderType: 'currency'`.

`src/features/angebote/lib/angebot-column-presets.ts:44-50`

```ts
betrag: {
  width: { mode: 'fixed', pt: 65 },
  align: 'right',
  pdfRenderType: 'currency',
  inputStep: 0.01,
  inputMin: 0
},
```

Currency fields render an editable number input unless the column is computed. In net-input mode this is the visible Pauschale amount field.

`src/features/angebote/components/angebot-builder/step-2-positionen.tsx:327-438`

```tsx
{layout.pdfRenderType === 'currency' ||
layout.pdfRenderType === 'currency_per_km' ? (
  isGrossPriceInput ? (
    // gross-mode UI omitted here
  ) : (
    <div className='flex items-center gap-2'>
      <Input
        className='h-8 text-sm'
        type='number'
        step={layout.inputStep ?? 0.01}
        min={layout.inputMin}
        value={
          raw != null &&
          raw !== '' &&
          !Number.isNaN(Number(raw))
            ? String(raw)
            : ''
        }
        onChange={(e) => {
          const t = e.target.value;
          onUpdate({
            data: {
              ...item.data,
              [col.id]: t === '' ? null : parseFloat(t)
            }
          });
        }}
      />
```

No required calculation input is explicitly hidden when `flat_rate` is selected. The problem is that the engine requires `unit_price`, but a Pauschale-only template/row may legitimately not include or populate any `unit_price` column. In that case, `resolveRoleValues()` sets only the roles present in the schema/data, and `computeNetAmount()` returns `null`.

`src/features/angebote/lib/angebot-formula-engine.ts:90-105`

```ts
export function resolveRoleValues(
  row: RowData,
  columns: AngebotColumnDef[]
): ResolvedRoleValues {
  const result: ResolvedRoleValues = {};
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
  return result;
}
```

### 4. What happens to the row value on type change?

The only per-offer selector inside Step 2 changes the column **preset**, not the semantic role. It updates `columnSchema` and does not reset row values.

`src/features/angebote/components/angebot-builder/step-2-positionen.tsx:696-704`

```tsx
// Per-offer preset override — updates draft columnSchema only. Does NOT mutate the saved Vorlage template.
<Select
  value={col.preset}
  onValueChange={(v) =>
    onColumnPresetChange(
      col.id,
      v as AngebotColumnPreset
    )
  }
>
```

`src/features/angebote/components/angebot-builder/index.tsx:348-354`

```tsx
const handleColumnPresetChange = useCallback(
  (columnId: string, preset: AngebotColumnPreset) => {
    if (isEdit) return;
    setCreateColumnSchema((prev) =>
      prev.map((c) => (c.id === columnId ? { ...c, preset } : c))
    );
  },
  [isEdit]
);
```

The actual role selector is in the template editor. Changing a column role to `flat_rate` mutates the template column definition only; it does not reset line-item row values because it is not operating on quote builder rows.

`src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx:412-421`

```tsx
<RoleSelect
  value={col.role ?? null}
  onChange={(value) => {
    setColumns((prev) =>
      prev.map((c) =>
        c.id === col.id
          ? { ...c, role: value ?? undefined }
          : c
      )
    );
  }}
/>
```

Adding a new template column with role `flat_rate` stores the selected role and then clears the new-column form state, not any quote line-item data.

`src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx:255-273`

```tsx
function handleAddColumn() {
  const h = newHeader.trim();
  if (!h) return;
  // col_position is a reserved auto-column — prevent admins from creating a manual duplicate.
  if (reservedPosHeaderError) return;
  setColumns((prev) => [
    ...prev,
    {
      id: crypto.randomUUID(),
      header: h.slice(0, 20),
      preset: newPreset,
      required: newRequired,
      role: newRole ?? undefined
    }
  ]);
  setNewHeader('');
  setNewPreset('beschreibung');
  setNewRequired(false);
  setNewRole(null);
}
```

The builder does reset row data when the selected template changes, but that is schema switching, not selecting Pauschale inside a row.

`src/features/angebote/components/angebot-builder/index.tsx:324-344`

```tsx
const handleVorlageChange = useCallback(
  (id: string, columns: AngebotColumnDef[]) => {
    if (isEdit) return;
    const dirty = lineItems.some((row) =>
      Object.values(row.data).some((v) => {
        if (v == null) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'number') return !Number.isNaN(v);
        return true;
      })
    );
    if (dirty) {
      toast.warning(
        'Vorlage gewechselt — bestehende Zeilendaten wurden zurückgesetzt.'
      );
    }
    // Switching schema clears all line item data — column IDs from the old schema are incompatible with the new schema.
    setSelectedVorlageId(id);
    setCreateColumnSchema(Array.isArray(columns) ? columns : []);
    resetLineItems();
  },
```

I did not find evidence of a type-change reset defaulting quantity or unit price to `0` and silently killing Pauschale calculations. The opposite is true: the current tests show Pauschale only calculates when a `unit_price` role is present and set to `0`.

### 5. How does the totals block read row values?

In the live preview and PDF render path, `AngebotPdfDocument` materializes each row through `computeRow()` and then aggregates with `computeAngebotTotals()`.

`src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx:161-185`

```tsx
const totalsData = angebot.show_totals_block
  ? (() => {
      const inputMode = angebot.input_mode ?? 'net';
      const rowsForTotals = angebot.line_items.map((item) => {
        const resolvedData = resolveRowDataForEngine(item, columnSchema);
        return {
          ...resolvedData,
          ...computeRow(resolvedData, columnSchema, inputMode, {
            fallbackTaxRate: angebot.default_tax_rate
          })
        };
      });
      return {
        ...computeAngebotTotals(rowsForTotals, columnSchema),
        labelNet: angebot.totals_label_net ?? DEFAULT_TOTALS_LABEL_NET,
```

`computeAngebotTotals()` sums numeric synthetic keys first, then falls back to visible computed-role columns. It does not filter or skip rows based on `positionType` or `flat_rate`.

`src/features/angebote/lib/angebot-formula-engine.ts:271-298`

```ts
export function computeAngebotTotals(
  rows: RowData[],
  columns: AngebotColumnDef[]
): {
  netTotal: number | null;
  taxTotal: number | null;
  grossTotal: number | null;
} {
  const sumKey = (key: string): number | null => {
    const values = rows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === 'number' && isFinite(v));
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };

  const netCol = columns.find((c) => c.role === 'net_amount');
  const taxCol = columns.find((c) => c.role === 'tax_amount');
  const grossCol = columns.find((c) => c.role === 'gross_amount');

  return {
    netTotal: sumKey(SYNTHETIC_NET_KEY) ?? (netCol ? sumKey(netCol.id) : null),
    taxTotal: sumKey(SYNTHETIC_TAX_KEY) ?? (taxCol ? sumKey(taxCol.id) : null),
    grossTotal:
      sumKey(SYNTHETIC_GROSS_KEY) ?? (grossCol ? sumKey(grossCol.id) : null)
  };
}
```

The PDF totals block displays the totals it receives; if the engine returns `null`, it renders an em dash rather than a calculated amount.

`src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx:521-549`

```tsx
<View style={styles.totalsRow}>
  <Text style={styles.totalsLabel}>{totalsData.labelNet}</Text>
  <Text style={styles.totalsValue}>
    {totalsData.netTotal !== null
      ? formatEur(totalsData.netTotal)
      : '—'}
  </Text>
</View>
```

So Pauschale rows are not excluded by the totals block. They arrive with `__net_amount__`, `__tax_amount__`, and `__gross_amount__` as `null` because `computeNetAmount()` returned `null`.

### 6. Console, TypeScript, TODO/FIXME, commented-out branches

No IDE linter diagnostics were reported for the audited files:

```text
No linter errors found.
```

The only console warning in the direct builder path is unrelated to Pauschale; it warns when `companyId` is missing and templates cannot load.

`src/features/angebote/components/angebot-builder/index.tsx:129-135`

```tsx
useEffect(() => {
  if (!companyId) {
    console.warn(
      '[AngebotBuilder] companyId is missing — Vorlagen query is disabled and templates cannot load.'
    );
  }
}, [companyId]);
```

The TODO/FIXME scan under `src/features/angebote` found no commented-out Pauschale branch in the calculation logic. The only TODO surfaced in the broader Angebote scan was unrelated to PDF Brief mode.

`src/features/angebote/components/angebot-detail-view.tsx:612`

```tsx
{/* TODO: 'Als Brief' falls back to digital until Brief mode (DIN 5008 header redesign) is implemented — see docs/plans/pdf-architecture-audit.md */}
```

## Affected files

| Filename | Status | What needs to change |
|---|---|---|
| `src/features/angebote/lib/angebot-formula-engine.ts` | Implemented | Added exported `hasComputeablePrice()` as the single row-computability guard; updated `computeNetAmount()` so `flat_rate` and `surcharge` can compute without requiring `unit_price`. |
| `src/features/angebote/lib/angebot-formula-engine.test.ts` | Implemented | Updated the old missing-`unit_price` expectation and added helper, Pauschale-only net, and Pauschale-only gross conversion regression coverage. |
| `docs/angebot-formula-engine.md` | Implemented | Documented `hasComputeablePrice()` and its role as the single computable-row guard. |
| `src/features/angebote/components/angebot-builder/index.tsx` | No change needed | This already recomputes rows on every update and passes `fallbackTaxRate`. |
| `src/features/angebote/components/angebot-builder/step-2-positionen.tsx` | No change needed | This already renders `flat_rate` as a price input and recognizes it in gross mode. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` | No change needed | Totals already materialize rows via `computeRow()`. |

## Senior-level recommendation

This is a formula invariant bug, not a type mismatch and not a row reset bug. `Pauschale` correctly maps to `flat_rate`, and that role is recognized by the UI and formula engine, but `computeNetAmount()` has an outdated guard that treats `unit_price` as mandatory for all row shapes.

The minimal fix is to make `computeNetAmount()` require at least one price-bearing input that can contribute to the base:

- If `unit_price` is present, keep `distance_km * unit_price`.
- If `flat_rate` is present, include it even when `unit_price` is absent.
- If `surcharge` is present, decide whether surcharge-only rows are valid; if yes, include it under the same rule, otherwise keep surcharge as additive only when another base exists.
- Continue returning `null` when no usable price input exists, so empty rows still render empty instead of misleading zeroes.

The key regression test should be: `{ flat_rate: 100, tax_rate: 19 }` produces net `100`, tax `19`, gross `119` without requiring a fake `unit_price: 0`.
