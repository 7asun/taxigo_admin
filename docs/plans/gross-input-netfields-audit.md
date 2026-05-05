# Gross input — net-fields audit (roles + PDF wiring)
Date: 2026-05-05

Files reviewed completely:

- `src/features/angebote/lib/angebot-formula-engine.ts`
- `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- `src/features/angebote/types/angebot.types.ts`
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`
- `src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts`
- `src/features/angebote/components/angebot-builder/use-angebot-builder-pdf-preview.tsx`

Note: `src/features/angebote/pdf/` does **not** exist / contains **0 files** in this repo (glob returned no matches).

---

## Q1: Exact valid values for `AngebotColumnDef.role` today

`AngebotColumnDef.role` is constrained by the Zod enum `angebotColumnRoleSchema`.

File: `src/features/angebote/types/angebot.types.ts`

```45:60:src/features/angebote/types/angebot.types.ts
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

Therefore the exact role string set is:

- Input: `description`, `time`, `days`, `quantity`, `distance_km`, `unit_price`, `flat_rate`, `surcharge`, `tax_rate`
- Computed: `net_amount`, `tax_amount`, `gross_amount`

---

## Q2: Does PDF renderer use roles or hardcoded IDs/field names?

### Summary

The Angebot PDF table renderer **does not** use roles like `unit_price` / `flat_rate` / `surcharge` to locate values.

Instead it uses the **stored column schema IDs** (`AngebotColumnDef.id`) to read values from the JSONB `angebot_line_items.data` map, with a **legacy fallback** based on well-known legacy column IDs → typed DB fields (`leistung`, `anfahrtkosten`, etc.).

There is **no** hardcoded role-based lookup for `unit_price` / `flat_rate` / `surcharge` in the PDF. Those values are read strictly by `col.id` from `item.data` (or whatever legacy fallback mapping exists for that `col.id`).

### Exact code path for reading a cell value

File: `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`

1) PDF resolves the active schema (snapshot → legacy override → standard profile):

```54:69:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
export function resolveAngebotPdfColumnSchema(
  angebot: AngebotWithLineItems
): AngebotColumnDef[] {
  if (
    angebot.table_schema_snapshot &&
    angebot.table_schema_snapshot.length > 0
  ) {
    return angebot.table_schema_snapshot;
  }
  const legacy = angebot.pdf_column_override;
  if (legacy?.columns?.length) {
    return profileToAngebotColumnDefs(legacy);
  }
  return profileToAngebotColumnDefs(ANGEBOT_STANDARD_COLUMN_PROFILE);
}
```

2) That schema is passed into `AngebotPdfCoverBody`:

```142:145:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
  const columnSchema = resolveAngebotPdfColumnSchema(angebot);
```

```272:285:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
        <View style={styles.angebotPageBody} wrap>
          <AngebotPdfCoverBody
            ...
            lineItems={angebot.line_items}
            columnSchema={columnSchema}
            ...
          />
        </View>
```

File: `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`

3) For each row+column, the PDF calls `cellRawValue(item, col, idx)`:

```351:384:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
              {effectiveColumns.map((col) => {
                const w =
                  colWidths[col.id] ??
                  PDF_ZONES.columnWidthFloor;
                const raw = cellRawValue(item, col, idx);
                return (
                  <View key={col.id} style={{ width: w, ... }}>
                    <Text style={{ ... }}>
                      {renderCell(col, raw, idx)}
                    </Text>
                  </View>
                );
              })}
```

4) `cellRawValue` reads by **column ID**, not role:

```140:152:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
function cellRawValue(
  item: AngebotLineItemRow,
  col: AngebotColumnDef,
  _rowIndex: number
): string | number | null {
  if (col.id === ANGEBOT_POSITION_COLUMN_ID) return null;
  const data = coerceLineItemData(item);
  const fromData = data[col.id];
  if (fromData !== undefined && fromData !== null && fromData !== '') {
    return fromData;
  }
  return legacyFallback(item, col.id);
}
```

5) `legacyFallback` is also keyed by a **column ID**, mapped to typed fields:

```120:137:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
function legacyFallback(
  item: AngebotLineItemRow,
  colId: string
): string | number | null {
  switch (colId) {
    case ANGEBOT_LEGACY_COLUMN_IDS.leistung:
      return item.leistung;
    case ANGEBOT_LEGACY_COLUMN_IDS.anfahrtkosten:
      return item.anfahrtkosten;
    case ANGEBOT_LEGACY_COLUMN_IDS.price_first_5km:
      return item.price_first_5km;
    case ANGEBOT_LEGACY_COLUMN_IDS.price_per_km_after_5:
      return item.price_per_km_after_5;
    case ANGEBOT_LEGACY_COLUMN_IDS.notes:
      return item.notes;
    default:
      return null;
  }
}
```

### Where does the PDF read `unit_price` / `flat_rate` / `surcharge` specifically?

There is no role-specific path. The only read path is:

- `coerceLineItemData(item)` → `data[col.id]` (`cellRawValue`, above)

So `unit_price` / `flat_rate` / `surcharge` are rendered **only if** the offer’s `columnSchema` includes columns whose `id` keys correspond to those stored numeric values in `angebot_line_items.data`.

---

## Q3: Step 2 cell render loop — how input vs computed is identified

The per-cell decision is made by calling `isComputedColumn(col)`.

File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`

```205:233:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
          {columnSchema
            .filter((col) => col.id !== ANGEBOT_POSITION_COLUMN_ID)
            .map((col) => {
              const raw = item.data[col.id];
              const key = `${col.id}-${index}`;
              const layout = resolveColumnLayout(col);
              const computed = isComputedColumn(col);
              const showGrossWarning =
                inputMode === 'gross' &&
                (col.role === 'unit_price' ||
                  col.role === 'flat_rate' ||
                  col.role === 'surcharge') &&
                !hasTaxRateValue(item.data, columnSchema);
              return (
                <div key={key} className='space-y-1'>
                  <Label className='text-xs'>{col.header}</Label>
                  {computed ? (
                    <div ...>...</div>
                  ) : (
                    <>...</>
                  )}
```

The `isComputedColumn` implementation is in the engine file:

File: `src/features/angebote/lib/angebot-formula-engine.ts`

```176:193:src/features/angebote/lib/angebot-formula-engine.ts
const COMPUTED_ROLES = new Set<AngebotColumnRole>([
  'net_amount',
  'tax_amount',
  'gross_amount'
]);

export function isComputedColumn(col: AngebotColumnDef): boolean {
  return (
    col.role !== null && col.role !== undefined && COMPUTED_ROLES.has(col.role)
  );
}
```

---

## Q4: Does stored schema support arbitrary new role values?

No. `AngebotColumnDef.role` is constrained to a union type derived from the Zod enum:

File: `src/features/angebote/types/angebot.types.ts`

```45:62:src/features/angebote/types/angebot.types.ts
export const angebotColumnRoleSchema = z.enum([
  'description',
  'time',
  'days',
  'quantity',
  'distance_km',
  'unit_price',
  'flat_rate',
  'surcharge',
  'tax_rate',
  'net_amount',
  'tax_amount',
  'gross_amount'
]);

export type AngebotColumnRole = z.infer<typeof angebotColumnRoleSchema>;
```

And the `role` field on `AngebotColumnDef` is typed and validated against that enum:

```64:77:src/features/angebote/types/angebot.types.ts
export const angebotColumnDefSchema = z.object({
  ...
  , role: angebotColumnRoleSchema.nullable().optional()
});
```

Implication: adding any new role requires extending both:\n
- the Zod enum `angebotColumnRoleSchema` (runtime validation)\n
- the inferred TS union `AngebotColumnRole` (compile-time typing)\n
and then regenerating/wiring any downstream consumers.

