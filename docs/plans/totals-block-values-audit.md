# Totals Block — Blank Values Audit (post–Fix 1)

**Date:** 2026-05-19  
**Symptom:** After Fix 1 (PDF `computeRow` materialisation) and Fix 2 (always render three rows), the Summenblock shows all three label rows but values are `—`. Synthetic keys are `null` at PDF render time while the builder table still shows correct per-row amounts.

**Files read:**

- `src/features/angebote/lib/angebot-formula-engine.ts` (full)
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` (post-fix, incl. temporary debug log)
- `src/features/angebote/lib/angebot-column-presets.ts` (full)
- `src/features/angebote/types/angebot.types.ts` (full)
- `src/features/angebote/lib/resolve-angebot-table-schema.ts` (`profileToAngebotColumnDefs`)
- `src/features/angebote/lib/angebot-formula-engine.test.ts` (full)
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` (`cellRawValue`, `coerceLineItemData`)
- `src/features/angebote/api/angebote.api.ts` (`mapLineItemFromDb`, `mapAngebotHeaderFromDb`)
- `supabase/migrations/20260505131500_angebot_input_mode.sql`

**Temporary debug:** `AngebotPdfDocument.tsx` L165–178 (`// DEBUG REMOVE`) — remove after browser confirmation.

---

## 1. What does `resolveAngebotPdfColumnSchema` return?

**File:** `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`  
**Function:** `resolveAngebotPdfColumnSchema(angebot)`

```57:71:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
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

### Source of truth (precedence)

| Priority | Source | Origin |
|----------|--------|--------|
| 1 | `angebot.table_schema_snapshot` | Frozen JSON copy of Vorlage columns at offer **create** time (DB column on `angebote`) |
| 2 | `angebot.pdf_column_override` | Legacy pre–Phase-2a offers |
| 3 | `ANGEBOT_STANDARD_COLUMN_PROFILE` | Hard-coded fallback |

It does **not** read the live Vorlage at PDF time (except indirectly when the builder draft sets `table_schema_snapshot` to the current session `columnSchema`).

### Shape of each `AngebotColumnDef`

From `angebot.types.ts` / `angebotColumnDefSchema`:

```64:77:src/features/angebote/types/angebot.types.ts
export const angebotColumnDefSchema = z.object({
  id: z.string().min(1),
  header: z.string().max(20),
  preset: angebotColumnPresetSchema,
  required: z.boolean().optional(),
  formula: z.string().nullable().optional(),
  role: angebotColumnRoleSchema.nullable().optional()
});
```

### Is `role` populated?

**Depends on path:**

**A) Modern offers (`table_schema_snapshot`):** Each column **may** have `role` if the admin assigned it in the Angebotsvorlage editor (`angebot-vorlage-editor-panel.tsx`). Roles are **not** inferred from `preset` — `angebot-column-presets.ts` only provides layout/UI metadata, not automatic roles.

**B) Legacy profile (`profileToAngebotColumnDefs`):** Columns are built **without** a `role` property:

```45:59:src/features/angebote/lib/resolve-angebot-table-schema.ts
export function profileToAngebotColumnDefs(
  profile: AngebotColumnProfile
): AngebotColumnDef[] {
  return profile.columns.map((key) => {
    const cat = ANGEBOT_COLUMN_MAP[key];
    return {
      id: angebotKeyToSchemaColumnId(key),
      header: cat.label,
      preset: catalogFormatToPreset(cat.format, ...),
      required: false
    };
  });
}
```

Legacy IDs: `col_leistung`, `col_anfahrtkosten`, `col_price_first_5km`, `col_price_per_km_after_5`, `col_notes` (`angebot-legacy-column-ids.ts`).

### What `resolveRoleValues` expects

```56:71:src/features/angebote/lib/angebot-formula-engine.ts
export function resolveRoleValues(row: RowData, columns: AngebotColumnDef[]) {
  const result: ResolvedRoleValues = {};
  for (const col of columns) {
    if (!col.role) continue;
    const raw = row[col.id];
    // ... parse to number or null per col.role
  }
  return result;
}
```

**Contract:** For each column with a non-empty `role`, read `row[col.id]` (column **id**, not role name). If no columns have `unit_price` / `tax_rate` roles, `computeNetAmount` returns `null` and synthetics are `null`.

### Builder vs PDF schema (draft edit)

Builder `columnSchema` (`angebot-builder/index.tsx` L159–167):

- Draft edit: **live Vorlage columns** (`liveEditColumnSchema`) when available, else `resolveAngebotPdfColumnSchema(initialAngebot)`.
- PDF on draft preview: `resolveAngebotPdfColumnSchema(draftAngebot)` uses `draftAngebot.table_schema_snapshot`, which the builder sets to the **same** `columnSchema` (L414).

For **saved** PDF download (detail view), PDF uses the **frozen** snapshot only — not the live Vorlage.

---

## 2. What does `resolveRoleValues` receive at PDF render time?

**Trace (Fix 1 block):** `AngebotPdfDocument.tsx` L145, L164–182

```typescript
const columnSchema = resolveAngebotPdfColumnSchema(angebot);
const inputMode = angebot.input_mode ?? 'net';
computeRow(item.data, columnSchema, inputMode);
```

### Roles present?

- **If snapshot / profile has roles assigned:** e.g. `unit_price`, `tax_rate`, `distance_km`, `net_amount`, …
- **If legacy profile or Vorlage without role assignment:** **no** `unit_price` / `tax_rate` columns in the iteration — `resolveRoleValues` returns `{}` for inputs → `computeNetAmount` → `null`.

### Column `id` vs `item.data` keys

**Yes — by design** `item.data` keys are `AngebotColumnDef.id` values:

```163:164:src/features/angebote/types/angebot.types.ts
  /** Keys are {@link AngebotColumnDef.id} from the parent offer snapshot. */
  data: Record<string, string | number | null>;
```

`resolveRoleValues` reads `row[col.id]`, not `row[col.role]`.

**Mismatch risk:** If `table_schema_snapshot` column IDs changed (new Vorlage UUIDs) but `item.data` still holds old IDs, `row[col.id]` is empty for input roles even though the table might still show **stored** computed cells under old IDs.

---

## 3. What does `item.data` look like for a saved line item?

### Declared type

`AngebotLineItemRow.data`: `Record<string, string | number | null>` keyed by **column id** (see above).

Legacy typed columns on the row (`leistung`, `anfahrtkosten`, …) are **separate** fields; new writes go to `data` only (`angebote.api.ts` L341 comment).

### API normalisation

`mapLineItemFromDb` parses JSONB string or object into a plain object (`angebote.api.ts` L37–56). Client-side `angebot.line_items[].data` is normally an object after fetch.

### Builder `item.data` on edit

`lineItemsFromAngebotRows` (`use-angebot-builder.ts` L58–68): if `data` is empty, copies legacy typed fields into `data` under `ANGEBOT_LEGACY_COLUMN_IDS.*`.

On each input change, `updateLineItemWithComputed` merges `computeRow` patch (including `__net_amount__`, role column ids, etc.) into `item.data`.

### Builder display vs PDF totals

**Builder Step 2** reads computed cells from **`item.data[col.id]` only** (no legacy fallback):

```239:239:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
              const raw = item.data[col.id];
```

**PDF table** uses **`coerceLineItemData` + `legacyFallback`**:

```180:191:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
function cellRawValue(item, col, _rowIndex) {
  const data = coerceLineItemData(item);
  const fromData = data[col.id];
  if (fromData !== undefined && fromData !== null && fromData !== '') {
    return fromData;
  }
  return legacyFallback(item, col.id);
}
```

**Fix 1 totals path** uses **`item.data` directly** — no coercion, no legacy fallback:

```181:182:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
          ...item.data,
          ...computeRow(item.data, columnSchema, inputMode)
```

**Asymmetry:** The PDF table can show currency values from `item.anfahrtkosten` etc. while `computeRow(item.data, …)` sees an empty `data` object and returns null synthetics.

---

## 4. Does `angebot.input_mode` exist on the DB row?

**Yes — persisted.**

```124:124:src/features/angebote/types/angebot.types.ts
  input_mode: 'net' | 'gross';
```

Migration `supabase/migrations/20260505131500_angebot_input_mode.sql`:

```sql
ADD COLUMN input_mode text NOT NULL DEFAULT 'net';
ADD CONSTRAINT angebote_input_mode_check CHECK (input_mode IN ('net', 'gross'));
```

API mapping (`angebote.api.ts` L114–116, L281, L381): read/create/update map `input_mode` / `inputMode`.

Builder draft (Fix 3) sets `input_mode: inputMode` on `draftAngebot` (`index.tsx` L378–380).

**PDF default:** `angebot.input_mode ?? 'net'` is correct for persisted offers. Wrong totals only if the quote is **`gross`** but `input_mode` is missing on the object passed to PDF (e.g. old test fixtures) — then gross prices would be interpreted as net. That would **inflate** totals, not blank them. Blank totals are not explained by `input_mode` defaulting to `'net'`.

---

## 5. Is `computeRow` the right function? Builder wrapper?

### Builder path

**File:** `angebot-builder/index.tsx` — `updateLineItemWithComputed`

```240:252:src/features/angebote/components/angebot-builder/index.tsx
  const updateLineItemWithComputed = useCallback((index, patch) => {
    const mergedData = { ...currentItem.data, ...(patch.data ?? {}) };
    const computedPatch = computeRow(mergedData, columnSchema, inputMode);
    updateLineItem(index, {
      ...patch,
      data: { ...mergedData, ...computedPatch }
    });
  }, [lineItems, columnSchema, updateLineItem, inputMode]);
```

**No extra math** beyond merge + `computeRow`. The wrapper only:

1. Merges user patch into `data`
2. Calls `computeRow(mergedData, columnSchema, inputMode)`
3. Persists merged result into builder state

### `inputMode` parameter

Required for **Brutto-Eingabe** (`computeRow` L116–158). Default `'net'` is correct when mode is net. PDF must pass `angebot.input_mode` (Fix 1 does).

### What Fix 1 is missing (vs builder)

Builder always passes a **fully merged** `mergedData` object. PDF passes **`item.data` only** — not coerced, not legacy-backed. That is **less** than the builder, not more.

---

## 6. `computeRow` output at PDF render time (debug)

### Instrumentation added

`AngebotPdfDocument.tsx` L165–178 (`// DEBUG REMOVE`) — logs first line item when `show_totals_block` is true.

**Note:** `@react-pdf/renderer` may run the document in a context where `console.log` appears in the **browser devtools** (builder preview) or server terminal (SSR). Reproduce by opening the builder PDF preview with Summenblock enabled and at least one line item.

### Simulated reproduction (same code paths as debug log)

Run locally with `bun -e` against `computeRow` + `profileToAngebotColumnDefs` — output below is **verbatim** from this repo (2026-05-19). Use it when browser capture is unavailable; confirm in devtools when possible.

#### Scenario A — Legacy profile schema, empty `data`, values only on typed columns

*(PDF table can still show amounts via `legacyFallback`; totals cannot.)*

```
=== Scenario A: legacy profile schema (no roles) ===
[totals-debug] columnSchema roles: [
  {
    id: "col_position",
    role: undefined,
  }, {
    id: "col_leistung",
    role: undefined,
  }, {
    id: "col_anfahrtkosten",
    role: undefined,
  }, {
    id: "col_price_first_5km",
    role: undefined,
  }, {
    id: "col_price_per_km_after_5",
    role: undefined,
  }
]
[totals-debug] first item.data keys: []
[totals-debug] computeRow result for first row: {
  __net_amount__: null,
  __tax_amount__: null,
  __gross_amount__: null,
}
```

#### Scenario B — Snapshot with roles, input keys in `data`

```
=== Scenario B: snapshot with roles, data populated ===
[totals-debug] columnSchema roles: [
  {
    id: "desc",
    role: "description",
  }, {
    id: "km",
    role: "distance_km",
  }, {
    id: "unit",
    role: "unit_price",
  }, {
    id: "tax",
    role: "tax_rate",
  }, {
    id: "net",
    role: "net_amount",
  }
]
[totals-debug] first item.data keys: [ "desc", "km", "unit", "tax" ]
[totals-debug] computeRow result for first row: {
  net: 20,
  __net_amount__: 20,
  __tax_amount__: 3.8,
  __gross_amount__: 23.799999999999997,
}
```

#### Scenario C — Roles on schema, `data` only has computed column ids (no inputs)

*(Builder/PDF table can still **display** stored `net`/`tax`/`gross` cells from `item.data`; `computeRow` recalculates from inputs → null.)*

```
=== Scenario C: roles on schema but only computed keys in data (stale) ===
[totals-debug] columnSchema roles: [
  {
    id: "desc",
    role: "description",
  }, {
    id: "km",
    role: "distance_km",
  }, {
    id: "unit",
    role: "unit_price",
  }, {
    id: "tax",
    role: "tax_rate",
  }, {
    id: "net",
    role: "net_amount",
  }
]
[totals-debug] first item.data keys: [ "net", "tax", "gross" ]
[totals-debug] computeRow result for first row: {
  net: null,
  __net_amount__: null,
  __tax_amount__: null,
  __gross_amount__: null,
}
```

---

## Most likely root cause

Fix 1 correctly calls `computeRow`, but it feeds the engine a **different row payload than the PDF table uses**. `AngebotPdfCoverBody.cellRawValue` resolves values through `coerceLineItemData(item)` and `legacyFallback(item, col.id)`, so the table can show correct per-row currency while `computeRow(item.data, columnSchema, …)` in `AngebotPdfDocument.tsx` sees an empty or input-incomplete `item.data` map and writes `__net_amount__: null`, `__tax_amount__: null`, `__gross_amount__: null`. A second common case is a **`columnSchema` with no formula roles** (legacy `profileToAngebotColumnDefs` path or Vorlage columns never assigned `unit_price` / `tax_rate`), which makes `resolveRoleValues` skip all inputs regardless of visible cell values. A third case is **stale `item.data`** that only stores computed-role column ids without current input-role ids (Scenario C): the UI shows stored computed cells, but recalculation at PDF time returns null.

**Single fix location:** `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` — in the Fix 1 materialisation block, build each row with the **same data resolution as `cellRawValue`** (extract/share `coerceLineItemData` + legacy fallback, or a small `resolveRowDataForEngine(item): RowData` helper used by both the table and totals). Do **not** change `computeRow` / `computeAngebotTotals`. Optionally align `table_schema_snapshot` with roles for legacy offers (data migration / Vorlage roles) — that is a separate product decision.

**Remove** `// DEBUG REMOVE` logs after one browser confirmation.

---

## Resolution (2026-05-19)

**Status:** Resolved

| Step | File | Change |
|------|------|--------|
| 1 | `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | Exported `resolveRowDataForEngine` — same `coerceLineItemData` + `legacyFallback` chain as `cellRawValue` |
| 2 | `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` | Totals materialisation uses `resolveRowDataForEngine` before `computeRow`; debug logs removed |

`bun run build` passes with zero type errors after each step.

**Note:** Legacy-profile offers (schema without `unit_price` / `tax_rate` roles) may still show `—` in the Summenblock — the engine cannot derive tax/net without roles. That is expected; this fix aligns row **data** with the table, not role assignment on the Vorlage.
