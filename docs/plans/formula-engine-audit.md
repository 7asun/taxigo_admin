# Formula Engine Audit (Angebot Builder) — Baseline

Date: 2026-05-05  
Scope: current state of Angebot column schema (`angebot_vorlagen.columns` + `angebote.table_schema_snapshot`), `formula` field, preset system, builder UI, Angebot PDF rendering, and invoice totals block reference implementation.

This document answers the questions A–G with **exact file paths, line numbers, and literal values found**.

---

## A. The `formula` field on `AngebotColumnDef`

### A1) Exact TypeScript type of `formula` on `AngebotColumnDef`

- **File**: `src/features/angebote/types/angebot.types.ts`
- **Zod schema**: `formula: z.string().nullable().optional()`

```34:41:src/features/angebote/types/angebot.types.ts
export const angebotColumnDefSchema = z.object({
  id: z.string().min(1),
  header: z.string().max(20),
  preset: angebotColumnPresetSchema,
  required: z.boolean().optional(),
  /** Reserved for Phase 2b+ calculated columns. Not evaluated in Phase 2a — store null. */
  formula: z.string().nullable().optional()
});
```

- **Inferred TS type**: `AngebotColumnDef = z.infer<typeof angebotColumnDefSchema> & { preset: AngebotColumnPreset }`

```52:54:src/features/angebote/types/angebot.types.ts
export type AngebotColumnDef = z.infer<typeof angebotColumnDefSchema> & {
  preset: AngebotColumnPreset;
};
```

So **`formula` is `string | null | undefined`** (because it is both `nullable()` and `optional()`).

---

### A2) All usages of `.formula` and `formula:` in `src/features/angebote/`

Search results (matches from `src/features/angebote/**`):

- **`src/features/angebote/types/angebot.types.ts`**
  - `formula: z.string().nullable().optional()` at **L40**
  - Doc comment mentions formula reserved at **L50**
- **`src/features/angebote/lib/angebot-column-presets.ts`**
  - Reads `rec.formula` while normalizing legacy/mixed column objects at **L187–193** and **L215–221**
- **`src/features/angebote/api/angebot-vorlagen.api.ts`**
  - Serializes `formula: c.formula` into `angebot_vorlagen.columns` payload at **L56**
- **`src/features/angebote/api/angebote.api.ts`**
  - Validates/serializes `formula: c.formula` for `angebote.table_schema_snapshot` at **L256**, **L294–295**, **L374–375**

Exact lines:

```37:41:src/features/angebote/types/angebot.types.ts
  preset: angebotColumnPresetSchema,
  required: z.boolean().optional(),
  /** Reserved for Phase 2b+ calculated columns. Not evaluated in Phase 2a — store null. */
  formula: z.string().nullable().optional()
});
```

```185:222:src/features/angebote/lib/angebot-column-presets.ts
      return {
        id,
        header: clampHeader20(headerRaw),
        preset,
        required: rec.required === true ? true : undefined,
        formula:
          rec.formula === null
            ? null
            : typeof rec.formula === 'string'
              ? rec.formula
              : undefined
      };
    }
  }
  // ...
  return {
    id,
    header: clampHeader20(headerRaw || defaultHeaderForPreset(preset)),
    preset,
    required: rec.required === true ? true : undefined,
    formula:
      rec.formula === null
        ? null
        : typeof rec.formula === 'string'
          ? rec.formula
          : undefined
  };
}
```

```48:57:src/features/angebote/api/angebot-vorlagen.api.ts
function stripLegacyKeys(
  cols: AngebotVorlageCreatePayload['columns']
): AngebotVorlageCreatePayload['columns'] {
  return cols.map((c) => ({
    id: c.id,
    header: c.header,
    preset: c.preset,
    required: c.required,
    formula: c.formula
  }));
}
```

```250:258:src/features/angebote/api/angebote.api.ts
  angebotColumnDefArraySchema.parse(
    payload.tableSchemaSnapshot.map((c) => ({
      id: c.id,
      header: c.header,
      preset: c.preset,
      required: c.required,
      formula: c.formula
    }))
  );
```

```286:296:src/features/angebote/api/angebote.api.ts
      table_schema_snapshot: payload.tableSchemaSnapshot.map((c) => ({
        id: c.id,
        header: c.header,
        preset: c.preset,
        required: c.required,
        formula: c.formula
      })),
```

```365:375:src/features/angebote/api/angebote.api.ts
    .update({
      table_schema_snapshot: snapshot.map((c) => ({
        id: c.id,
        header: c.header,
        preset: c.preset,
        required: c.required,
        formula: c.formula
      })),
      updated_at: new Date().toISOString()
    })
```

---

### A3) Is `formula` read/evaluated anywhere (PDF/builder/utils), or written but never consumed?

Findings from the read files above:

- **Written / persisted**:
  - Included in write payloads for `angebot_vorlagen.columns` (`stripLegacyKeys`) and `angebote.table_schema_snapshot` (create + draft refresh) as `formula: c.formula`.
    - `src/features/angebote/api/angebot-vorlagen.api.ts` **L48–57**
    - `src/features/angebote/api/angebote.api.ts` **L250–258**, **L286–296**, **L365–375**
- **Read but not evaluated**:
  - Only read during **normalization** (`normalizeLegacyColumn`) to preserve string/null if present.
    - `src/features/angebote/lib/angebot-column-presets.ts` **L187–193**, **L215–221**
- **Not evaluated anywhere**:
  - In the Angebot builder (`step-2-positionen.tsx`, `angebot-builder/index.tsx`, `use-angebot-builder.ts`) there is **no read** of `col.formula` and no computation engine.
  - In the Angebot PDF renderer, `col.formula` is **not referenced**; rendering depends on `resolveColumnLayout(col)` (derived from `col.preset`) and `item.data[col.id]`.
    - `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` uses `resolveColumnLayout(col)` at **L163–189**; no `.formula`.

Conclusion: **`formula` is currently written (and preserved during normalization) but never consumed/evaluated for calculations** in the builder or PDF.

---

### A4) What values are stored in `formula` in the DB? Migration + seed/fixtures

#### Migration that introduced the stored schema mention of `formula`

- **File**: `supabase/migrations/20260413120000_angebot_flexible_table.sql`
- **Commented documented shape for `angebot_vorlagen.columns` includes** `"formula": null` and says it’s reserved.

```15:33:supabase/migrations/20260413120000_angebot_flexible_table.sql
  -- JSON array of column definition objects. Documented shape (SQL comment):
  -- [
  --   {
  --     "id": "col_uuid",
  --     "header": "Anfahrtkosten",
  --     "type": "currency" | "currency_per_km" | "text" | "integer" | "percent",
  --     "weight": 2,
  --     "minWidth": 60,
  --     "required": false,
  --     "formula": null
  --   }
  -- ]
  -- Phase 2a: "formula" is reserved for future calculated columns — omit or null.
  columns                jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT angebot_vorlagen_columns_is_array
    CHECK (jsonb_typeof(columns) = 'array')
);
```

#### Seed default template values (what gets stored)

The seed `jsonb_build_object(...)` blocks **do not set** a `formula` key at all (so it is omitted, not set to null).

```115:156:supabase/migrations/20260413120000_angebot_flexible_table.sql
  jsonb_build_array(
    jsonb_build_object(
      'id', 'col_leistung',
      'header', 'Leistung',
      'type', 'text',
      'weight', 3,
      'minWidth', 100,
      'required', false
    ),
    jsonb_build_object(
      'id', 'col_anfahrtkosten',
      'header', 'Anfahrtkosten',
      'type', 'currency',
      'weight', 1,
      'minWidth', 52,
      'required', false
    ),
    // ... remaining columns ...
  ),
```

#### Preset migration preserves existing `formula` values (if any)

- **File**: `supabase/migrations/20260414100000_angebot_column_presets.sql`
- Both migrations that rewrite JSON keep `'formula', (col->'formula')`:

```12:39:supabase/migrations/20260414100000_angebot_column_presets.sql
UPDATE public.angebot_vorlagen
SET columns = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', col->>'id',
          'header', LEFT(COALESCE(col->>'header', ''), 20),
          'preset',
            CASE
              WHEN col->>'type' = 'currency' THEN 'betrag'
              WHEN col->>'type' = 'currency_per_km' THEN 'preis_km'
              WHEN col->>'type' = 'integer' THEN 'anzahl'
              WHEN col->>'type' = 'percent' THEN 'percent'
              WHEN col->>'type' = 'text' AND COALESCE((col->>'weight')::int, 0) >= 3 THEN 'beschreibung'
              WHEN col->>'type' = 'text' THEN 'notiz'
              ELSE 'notiz'
            END,
          'required', (col->'required'),
          'formula', (col->'formula')
        )
      )
    )
    FROM jsonb_array_elements(columns) AS col
  ),
  '[]'::jsonb
)
WHERE jsonb_path_exists(columns, '$[*].type');
```

**DB stored values baseline**:
- Seeded templates: `formula` key is **absent**.
- Migration docs recommend: **omit or null**.
- There are **no seed/fixture files** in the provided set that write a non-null formula string.

---

## B. The `preset` system and role concept

### B5) All current valid values of `AngebotColumnPreset`, with label + `pdfRenderType`

**Preset union**:

```6:12:src/features/angebote/lib/angebot-column-presets.ts
export type AngebotColumnPreset =
  | 'beschreibung'
  | 'betrag'
  | 'preis_km'
  | 'notiz'
  | 'anzahl'
  | 'percent';
```

**Labels** come from `COLUMN_PRESET_UI`:

```77:122:src/features/angebote/lib/angebot-column-presets.ts
export const COLUMN_PRESET_UI: Record<
  AngebotColumnPreset,
  {
    label: string;
    emoji: string;
    description: string;
    adminSelectable: boolean;
  }
> = {
  beschreibung: { label: 'Beschreibung', emoji: '📝', /* ... */ adminSelectable: true },
  betrag: { label: 'Betrag (€)', emoji: '💶', /* ... */ adminSelectable: true },
  preis_km: { label: 'Preis / km', emoji: '📍', /* ... */ adminSelectable: true },
  notiz: { label: 'Notiz', emoji: '💬', /* ... */ adminSelectable: true },
  anzahl: { label: 'Anzahl', emoji: '#', /* ... */ adminSelectable: true },
  percent: { label: 'Prozent', emoji: '%', /* ... */ adminSelectable: false }
};
```

**`pdfRenderType`** is part of `COLUMN_PRESET_SPECS`:

```32:75:src/features/angebote/lib/angebot-column-presets.ts
export const COLUMN_PRESET_SPECS: Record<
  AngebotColumnPreset,
  AngebotColumnLayoutSpec
> = {
  beschreibung: { /* ... */ pdfRenderType: 'text' },
  betrag: { /* ... */ pdfRenderType: 'currency' },
  preis_km: { /* ... */ pdfRenderType: 'currency_per_km' },
  notiz: { /* ... */ pdfRenderType: 'text' },
  anzahl: { /* ... */ pdfRenderType: 'integer' },
  percent: { /* ... */ pdfRenderType: 'percent' }
};
```

So the complete mapping is:
- **`beschreibung`** → label `"Beschreibung"` → `pdfRenderType: 'text'`
- **`betrag`** → label `"Betrag (€)"` → `pdfRenderType: 'currency'`
- **`preis_km`** → label `"Preis / km"` → `pdfRenderType: 'currency_per_km'`
- **`notiz`** → label `"Notiz"` → `pdfRenderType: 'text'`
- **`anzahl`** → label `"Anzahl"` → `pdfRenderType: 'integer'`
- **`percent`** → label `"Prozent"` → `pdfRenderType: 'percent'`

Note: the Zod enum used in Angebot schema validation mirrors the same literal list:

```25:32:src/features/angebote/types/angebot.types.ts
const angebotColumnPresetSchema = z.enum([
  'beschreibung',
  'betrag',
  'preis_km',
  'notiz',
  'anzahl',
  'percent'
]);
```

---

### B6) Presets that overlap with proposed semantic roles

Closest overlaps (by meaning implied in labels + render types):
- **`anzahl`** (“Anzahl”, integer) — overlaps with a role like `quantity`
  - `src/features/angebote/lib/angebot-column-presets.ts` **L60–66** (integer)
- **`betrag`** (“Betrag (€)”, currency) — overlaps with a role like `unit_price` or a generic money field
  - `src/features/angebote/lib/angebot-column-presets.ts` **L41–47**
- **`preis_km`** (“Preis / km”, currency_per_km) — overlaps with a role like `unit_price_per_km`
  - `src/features/angebote/lib/angebot-column-presets.ts` **L48–54**
- **`percent`** (“Prozent”, percent) — overlaps with `tax_rate` or any percent role
  - `src/features/angebote/lib/angebot-column-presets.ts` **L67–74**

There is **no** preset that corresponds to computed totals like `net_amount` / `tax_amount` / `gross_amount`.

---

### B7) Is `AngebotColumnPreset` used beyond display formatting and `pdfRenderType` resolution?

Yes, but only for **format/layout selection**, not for calculations:

- **PDF rendering** uses `resolveColumnLayout(col).pdfRenderType` to decide how to format the cell:
  - `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` **L163–189**
- **Builder input control** uses `layout.pdfRenderType` to pick input type and parsing:
  - `src/features/angebote/components/angebot-builder/step-2-positionen.tsx` **L150–232**
- **Schema completion heuristic** in builder uses a specific preset (`anzahl`) to decide “content present”:
  - `src/features/angebote/components/angebot-builder/index.tsx` **L288–293** (`firstNonAnzahl = columnSchema.find((c) => c.preset !== 'anzahl')`)

```288:293:src/features/angebote/components/angebot-builder/index.tsx
  const section2Complete = useMemo(() => {
    if (columnSchema.length === 0) return false;
    const firstNonAnzahl = columnSchema.find((c) => c.preset !== 'anzahl');
    // section2Complete skips anzahl (positional/count) columns when checking for content — mirrors previous integer-type check.
```

No code branches on presets to perform any pricing math; presets currently represent **layout + input/render type**, not business semantics.

---

### B8) Where are `COLUMN_PRESET_UI` and `resolveColumnLayout` called? (all call sites found)

From the `src/features/angebote/**` search results:

- `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
  - imports `COLUMN_PRESET_UI`, `resolveColumnLayout` at **L55–58**
  - uses `resolveColumnLayout(col)` at **L146**
  - uses `COLUMN_PRESET_UI[...]` for labels/emoji/adminSelectable at **L412**, **L431–442**
- `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`
  - imports `COLUMN_PRESET_UI`, `resolveColumnLayout` at **L53–57**
  - uses `resolveColumnLayout(col)` at **L136–145**, **L246–248**
  - uses `COLUMN_PRESET_UI[...]` at **L61–63**, **L264–266**, **L324–326**, **L389–390**
- `src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx`
  - uses `COLUMN_PRESET_UI[...]` at **L169–174**
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`
  - uses `resolveColumnLayout` at **L26**, **L163**, **L193**
- `src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts`
  - uses `resolveColumnLayout` at **L17**, **L148–149**
- `src/features/angebote/components/angebot-detail-view.tsx`
  - uses `resolveColumnLayout` at **L46**, **L164**, **L195**

---

## C. The Vorlage editor UI

### C9) Files that make up the Vorlage editor (`src/features/angebote/components/angebot-vorlagen/`)

Folder contents (4 files):
- `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`
  - Editor for a single Vorlage: name/description/default flag; add/edit/reorder/remove columns; width preview; save/delete/set-default actions.
  - (See header comment) **L3–7**
- `src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-panel.tsx`
  - Left list panel with search + selection + “Neue Vorlage”.
  - **L11–17**
- `src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-settings-page.tsx`
  - Page composition: loads list, wires mutations, holds selectedId, seeds “Neue Angebotsvorlage”.
  - **L52–141**
- `src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx`
  - Sortable UI for the column list (DnD chips + remove button).
  - **L114–184**

---

### C10) How column addition UI works; all admin fields and mapping to `AngebotColumnDef`

**Column add form state**:

- `newHeader: string` (Input, max 20 chars)
- `newPreset: AngebotColumnPreset` (Select)
- `newRequired: boolean` (Checkbox)

Defined in:

```92:101:src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx
  const [newHeader, setNewHeader] = useState('');
  const [newPreset, setNewPreset] =
    useState<AngebotColumnPreset>('beschreibung');
  const [newRequired, setNewRequired] = useState(false);
```

**On add**, the new `AngebotColumnDef` is created as:
- `id: crypto.randomUUID()`
- `header: h.slice(0, 20)`
- `preset: newPreset`
- `required: newRequired`
- **No `formula` field is set** here (so it remains `undefined` in memory unless later filled elsewhere).

```186:203:src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx
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
        required: newRequired
      }
    ]);
    setNewHeader('');
    setNewPreset('beschreibung');
    setNewRequired(false);
  }
```

Other Vorlage-level fields the admin can edit:
- `name` (Input) → Vorlage `name`
  - **L209–216**
- `description` (Textarea) → Vorlage `description`
  - **L217–225**
- `markDefault` (Checkbox) → Vorlage `is_default`
  - **L227–236**
- Column list ordering via DnD (`SortableAngebotColumnList`) → Vorlage `columns` order
  - **L238–340**
- Per-column edit fields:
  - Column header Input (max 20) → `AngebotColumnDef.header`
    - **L266–288**
  - Preset Select → `AngebotColumnDef.preset`
    - **L295–336**
  - Required is only set during “add column”; there is no per-column required toggle in the edit list UI in this file.

---

### C11) Is there UI to set/display `formula` on a column?

No. In the Vorlage editor files read:
- No input field references `formula`
- No rendering of `col.formula`

The column add and edit flows only manipulate: `id`, `header`, `preset`, `required`.
See `handleAddColumn` block (no `formula`) at **L186–203** in `angebot-vorlage-editor-panel.tsx`.

---

### C12) How is the column list persisted? (DB column name + migration)

Persisted as a **JSONB column** on `angebot_vorlagen`:
- Table: `public.angebot_vorlagen`
- Column: `columns jsonb NOT NULL DEFAULT '[]'::jsonb`
- Migration: `supabase/migrations/20260413120000_angebot_flexible_table.sql`

```8:33:supabase/migrations/20260413120000_angebot_flexible_table.sql
CREATE TABLE public.angebot_vorlagen (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           REFERENCES public.companies(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  is_default             boolean NOT NULL DEFAULT false,
  columns                jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT angebot_vorlagen_columns_is_array
    CHECK (jsonb_typeof(columns) = 'array')
);
```

Additionally, each Angebot stores a **frozen snapshot** on `angebote`:
- Column: `table_schema_snapshot jsonb`
- Added in the same migration:

```48:59:supabase/migrations/20260413120000_angebot_flexible_table.sql
ALTER TABLE public.angebote
  ADD COLUMN angebot_vorlage_id uuid
    REFERENCES public.angebot_vorlagen(id) ON DELETE SET NULL;

ALTER TABLE public.angebote
  ADD COLUMN table_schema_snapshot jsonb;
```

---

## D. The invoice totals block

### D13) Where is the invoice PDF totals block (Netto / MwSt / Brutto) rendered?

- **File**: `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx`
- **Component**: `InvoicePdfCoverBody`
- Totals block is rendered in the body after table rows:

```292:322:src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx
      <View
        style={[
          styles.totalsSection,
          { marginTop: PDF_ZONES.totalsSectionMarginTop } // margin above totals block
        ]}
        wrap={false}
      >
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Summe Nettobeträge</Text>
          <Text style={styles.totalsValue}>
            {formatInvoicePdfEur(subtotal)}
          </Text>
        </View>
        {breakdown.map((b) => (
          <View key={b.rate} style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>
              zzgl. Umsatzsteuer {formatTaxRate(b.rate)}
            </Text>
            <Text style={styles.totalsValue}>{formatInvoicePdfEur(b.tax)}</Text>
          </View>
        ))}
        <View style={styles.totalsGrandSpacer} />
        <View style={styles.totalsGrandRow} wrap={false}>
          <Text style={styles.totalsGrandLabel}>
            Bruttobetrag (Zahlungsbetrag)
          </Text>
          <Text style={styles.totalsGrandValue}>
            {formatInvoicePdfEur(total)}
          </Text>
        </View>
      </View>
```

---

### D14) What data shape does the invoice totals block consume?

It consumes **pre-calculated totals passed as props**:
- `subtotal: number`
- `total: number`
- `breakdown: { rate: number; tax: number }[]`

Defined in `InvoicePdfCoverBodyProps`:

```49:64:src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx
export interface InvoicePdfCoverBodyProps {
  // ...
  subtotal: number;
  total: number;
  breakdown: { rate: number; tax: number }[];
  // ...
}
```

The values are produced upstream in `InvoicePdfDocument` via `calculateInvoiceTotals(...)`:

```332:334:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
  const { subtotal, total, breakdown } =
    calculateInvoiceTotals(lineItemsForCalc);
```

So the totals block itself **does not compute** totals from line items inline; it renders the props.

---

### D15) Are invoice line items structured like Angebot line items (`data: Record<string, unknown>`)?

No. Invoice line items use a **fixed schema** (`InvoiceLineItemRow`) with named fields:

```106:134:src/features/invoices/types/invoice.types.ts
export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  trip_id: string | null;
  position: number;
  line_date: string | null;
  description: string;
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_km: number | null;
  unit_price: number;
  quantity: number;
  total_price: number;
  tax_rate: number;
  // ...
  price_resolution_snapshot: Record<string, unknown> | null;
  trip_meta_snapshot?: TripMetaSnapshot | Record<string, unknown> | null;
}
```

By contrast, Angebot line items store a dynamic table payload in `data: Record<string, string | number | null>`:

```118:129:src/features/angebote/types/angebot.types.ts
export interface AngebotLineItemRow {
  id: string;
  angebot_id: string;
  position: number;
  /** Keys are {@link AngebotColumnDef.id} from the parent offer snapshot. */
  data: Record<string, string | number | null>;
  leistung: string;
  anfahrtkosten: number | null;
  price_first_5km: number | null;
  price_per_km_after_5: number | null;
  notes: string | null;
  created_at: string;
}
```

---

### D16) Is the invoice totals block reusable or embedded in the PDF document?

It is **embedded directly** in `InvoicePdfCoverBody` (not extracted into a standalone component).
The block is a `<View>` with styles and simple `<Text>` rows (see D13 snippet).

Reusability assessment based on current implementation:
- The rendered shape is already “Angebot-like” (net + tax + gross totals block), but **it assumes invoice semantics** (`breakdown` by tax rate, strings like “Summe Nettobeträge”, “zzgl. Umsatzsteuer”, “Bruttobetrag (Zahlungsbetrag)”).
- It could be extracted with minimal effort into a shared PDF component if Angebote adopt the same totals props shape (net/tax/gross + per-rate breakdown), but as of now Angebots PDFs explicitly state they have **no totals row** (see `AngebotPdfCoverBody.tsx` comment **L15–16**).

---

## E. PDF column rendering (Angebot)

### E17) In `AngebotPdfDocument.tsx`, how are column values rendered per row?

`AngebotPdfDocument.tsx` resolves a column schema and passes it to the cover body:

```48:63:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
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

Per-row rendering occurs in `AngebotPdfCoverBody.tsx`:
- It reads `item.data[col.id]` (after coercion) via `cellRawValue(...)`
- It transforms based on preset layout via `resolveColumnLayout(col).pdfRenderType` in `renderCell(...)`
- It falls back to legacy typed fields if missing from `data` (temporary bridge)

Key read path:

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

Transformation layer (formatting is based on preset):

```154:189:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
function renderCell(
  col: AngebotColumnDef,
  raw: string | number | null,
  rowIndex: number
): string {
  if (col.id === ANGEBOT_POSITION_COLUMN_ID) {
    return String(rowIndex + 1);
  }
  const layout = resolveColumnLayout(col);
  switch (layout.pdfRenderType) {
    case 'text': { /* ... returns '—' or String(raw) ... */ }
    case 'integer': { /* ... */ }
    case 'currency': { /* ... */ }
    case 'currency_per_km': { /* ... */ }
    case 'percent': { /* ... */ }
    default:
      return '—';
  }
}
```

So: **it reads `item.data[col.id]` (with coercion + legacy fallback) and then formats based on `preset` via `resolveColumnLayout`.**

---

### E18) Any existing concept of "read-only" / "computed" columns?

In the provided files:

- **Builder form**: no computed/read-only columns concept exists for Angebots columns.
  - Inputs are generated for every schema column (excluding `col_position`), based on `layout.pdfRenderType`, and are editable.
  - `col_position` is an auto column and is rendered as a read-only number (not stored in `data`), but it’s not “computed” from other values; it’s positional.
    - `step-2-positionen.tsx` **L132–140** (Pos. display)
    - `AngebotPdfCoverBody.tsx` **L159–162** (Pos. uses `rowIndex + 1`)
- **PDF renderer**: no computed columns concept; it prints formatted cell values and renders `—` for missing.

Therefore, **read-only computed columns (net/tax/gross) would be net-new behavior** for both builder and offer PDF.

---

### E19) How does Angebot PDF handle null/undefined values?

It is defensive and renders an em dash `'—'` for missing/invalid values:

- In `renderCell`, for `text` and `integer`, explicit checks:
  - `if (raw == null || raw === '') return '—';`
  - `parseInt` / `parseFloat` failures fall back to `'—'`
  - `currency` / `currency_per_km` call `formatEur(null)` which returns `'—'` (see `formatEur` **L74–80**)

Examples:

```165:176:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
    case 'text': {
      if (raw == null || raw === '') return '—';
      return String(raw);
    }
    case 'integer': {
      if (raw == null || raw === '') return '—';
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      return Number.isFinite(n) ? String(n) : '—';
    }
    case 'currency': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return formatEur(Number.isFinite(n) ? n : null);
    }
```

So it **does not crash**; it renders `'—'`.

---

## F. DB schema — `angebot_vorlagen`

### F20) Exact DB schema of `angebot_vorlagen` (columns + types + constraints)

Defined in:
- **Migration**: `supabase/migrations/20260413120000_angebot_flexible_table.sql`

Table definition:

```8:33:supabase/migrations/20260413120000_angebot_flexible_table.sql
CREATE TABLE public.angebot_vorlagen (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           REFERENCES public.companies(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  is_default             boolean NOT NULL DEFAULT false,
  columns                jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT angebot_vorlagen_columns_is_array
    CHECK (jsonb_typeof(columns) = 'array')
);
```

Additional constraints / indexes:

- Partial unique index: only one default per company

```35:37:supabase/migrations/20260413120000_angebot_flexible_table.sql
CREATE UNIQUE INDEX angebot_vorlagen_company_default_idx
  ON public.angebot_vorlagen(company_id)
  WHERE is_default = true;
```

---

### F21) Any DB-level validation of `angebot_vorlagen.columns` JSON structure?

Yes, but minimal:
- It checks only that `columns` is a JSON array:

```31:33:supabase/migrations/20260413120000_angebot_flexible_table.sql
  CONSTRAINT angebot_vorlagen_columns_is_array
    CHECK (jsonb_typeof(columns) = 'array')
);
```

There are **no DB check constraints** validating per-element keys (`id`, `header`, `preset`, etc.) or types.

---

### F22) Is there a `role` field anywhere in the existing `columns` JSON structure?

No. In:
- The documented JSON shape comment includes `id/header/type/weight/minWidth/required/formula` (no role) at **L15–27** in `20260413120000_angebot_flexible_table.sql`.
- The preset migration rewrites to `{ id, header, preset, required, formula }` (no role) at **L12–33** in `20260414100000_angebot_column_presets.sql`.
- The TS type `AngebotColumnDef` includes only `id`, `header`, `preset`, `required?`, `formula?` (no role) at `src/features/angebote/types/angebot.types.ts` **L34–54**.

So `role` would be **net-new**.

---

## G. Cursor’s senior recommendation (based on the findings above)

### G23) Minimal changes to `AngebotColumnDef` to support roles: repurpose `formula` or add `role`?

Baseline facts:
- `formula` is explicitly documented as “reserved” and “not evaluated” (TS doc + migration comment).
  - `src/features/angebote/types/angebot.types.ts` **L39–41**, **L50–51**
  - `supabase/migrations/20260413120000_angebot_flexible_table.sql` **L27–28**
- There is already normalization + persistence that carries `formula` through untouched.
  - `normalizeLegacyColumn` preserves `rec.formula` (string/null/undefined) at **L187–193**, **L215–221** in `angebot-column-presets.ts`
  - APIs serialize `formula: c.formula` into both templates and snapshots at:
    - `src/features/angebote/api/angebot-vorlagen.api.ts` **L48–57**
    - `src/features/angebote/api/angebote.api.ts` **L250–258**, **L286–296**, **L365–375**

Recommendation (minimal + lowest migration risk):
- **Add a new field** (e.g. `role?: AngebotColumnRole | null`) alongside `preset`, and keep `formula` untouched for its intended future use.

Why (grounded in current state):
- Repurposing `formula` to mean `role` would conflate two different concepts and contradict the existing docs and migration comments that it is reserved for calculated expressions (“calculated columns”).
- Adding `role` is additive, keeps backward compatibility, and avoids rewriting existing JSONB (which is currently only validated as “array” at DB level).

So: **do not repurpose `formula`**; **add `role` as net-new**.

---

### G24) Is the existing preset system a good foundation for roles, or fundamentally different concerns?

Based on current usage, presets are fundamentally **presentation + input/render typing**:
- `pdfRenderType` drives:
  - Builder input widget selection + parsing (`step-2-positionen.tsx` **L150–232**)
  - PDF formatting (`AngebotPdfCoverBody.tsx` **L163–189**)
- Presets also encode layout width/align (`COLUMN_PRESET_SPECS`, `resolveColumnLayout`) not semantics.

Roles, as described in your goal, are **semantic meaning for calculation** (distance, unit_price, tax_rate, net/gross).

Recommendation:
- Keep **preset** and **role** separate:
  - **preset**: UI/PDF formatting & layout
  - **role**: formula engine semantics and read-only computed behavior

---

### G25) Highest-risk part of implementing this feature (engine vs UI vs reactivity vs PDF)

From the baseline:
- There is currently **no computed column concept** in builder or PDF (E18).
- Builder stores arbitrary `data[col.id]` values and formats by preset only.
- Angebot PDF currently has **no totals block** (explicitly stated):

```15:16:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
 * No totals row — offers are informational pricing documents, not tax invoices.
 * Tax calculation (§14 UStG) is the invoice's responsibility, not the offer's.
```

Highest-risk area (implementation standpoint): **builder form reactivity + data model migration for computed/read-only columns**.

Why:
- It requires introducing derived values per row (net/tax/gross) and ensuring they stay consistent with edits (quantity/unit_price/tax_rate).
- It also requires ensuring persisted `data` either stores computed results (snapshot) or recomputes at render time consistently across UI and PDF.
- PDF rendering itself is comparatively low-risk because it already handles missing values robustly and formats by a render type; once computed values exist in `data`, printing them is straightforward.

Secondary risks:
- Vorlage editor needs to support selecting roles and enforcing constraints (e.g., only one `tax_rate` role, computed columns read-only).
- Backward compatibility: existing offers/templates have no roles and may have omitted `formula`.

---

## Appendix: Additional baseline notes (directly observed)

- **Auto “Pos.” column is never stored**; it is injected at render time:
  - `src/features/angebote/lib/angebot-auto-columns.ts` **L3–16**
  - `supabase/migrations/20260413120000_angebot_flexible_table.sql` mentions “col_position is never stored” in seed comment **L113–115**
- Angebot builder Step 2 stores row values in `item.data[col.id]` and parses based on `layout.pdfRenderType`:
  - `src/features/angebote/components/angebot-builder/step-2-positionen.tsx` **L141–232**

---

## Phase 1 — Completed (AngebotColumnRole wiring)

Phase 1 adds an inert, optional semantic `role` field to `AngebotColumnDef` and wires it through all persistence layers that already carry `formula`:

- **Changed files**:
  - `src/features/angebote/types/angebot.types.ts` (adds `AngebotColumnRole` + `angebotColumnRoleSchema` + `role` on `angebotColumnDefSchema`)
  - `src/features/angebote/lib/angebot-column-presets.ts` (preserves `role` in `normalizeLegacyColumn`; drops unknown roles to `undefined`)
  - `src/features/angebote/api/angebot-vorlagen.api.ts` (serializes `role` via `stripLegacyKeys`)
  - `src/features/angebote/api/angebote.api.ts` (serializes `role` in snapshot writes: create + draft refresh + schema parse gate)
- **New file**:
  - `docs/angebot-formula-engine.md`

No UI, engine logic, computed column behavior, totals block, or PDF changes are introduced in Phase 1.

---

## Phase 2 — Completed (Vorlage editor role picker UI)

Phase 2 adds UI controls to assign `AngebotColumnRole` per column in the Angebotsvorlage editor, plus a soft warning for duplicate roles, and role badges in the sortable chips. Roles remain inert (no engine logic, no read-only enforcement).

- **Changed files**:
  - `src/features/angebote/lib/angebot-column-presets.ts` (adds `ANGEBOT_COLUMN_ROLE_UI` + ordered option arrays)
  - `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx` (role picker in add form + per-column edit list; duplicate warning; persists `role` as `undefined`)
  - `src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx` (renders role badge in chips; computed roles prefixed with `⚙`)
  - `docs/angebot-formula-engine.md` (documents Phase 2 UI + semantics)

---

## Phase 3 — Completed (Formula engine + live builder recompute)

Phase 3 introduces a pure TypeScript formula engine module and wires it into the Angebot builder so computed-role columns recalculate live on every dispatcher input change. Computed columns are rendered read-only in the builder (no inputs). PDF preview behavior is unchanged (still the existing debounced auto-regeneration).

- **Changed files**:
  - `src/features/angebote/components/angebot-builder/index.tsx` (adds `updateLineItemWithComputed` to recompute derived columns on every input change)
  - `src/features/angebote/components/angebot-builder/step-2-positionen.tsx` (renders computed-role columns as read-only display; formats by `pdfRenderType`)
  - `docs/angebot-formula-engine.md` (documents Phase 3 and marks it done)
- **New files**:
  - `src/features/angebote/lib/angebot-formula-engine.ts` (pure formula engine: `resolveRoleValues`, `computeNetAmount`, `computeRow`, `isComputedColumn`)
  - `src/features/angebote/lib/angebot-formula-engine.test.ts` (unit tests; Bun runner)

---

## Phase 4 — Completed (Angebot PDF totals block)

Phase 4 adds an opt-in totals block (“Summenblock”) to Angebot PDFs. The setting is stored per quote (`angebote.show_totals_block`, default false), exposed in the builder as a Step 2 switch, and rendered in the PDF only when enabled and the schema includes a `net_amount` role column.

- **Changed files**:
  - `src/features/angebote/types/angebot.types.ts` (adds `show_totals_block` to `AngebotRow`; adds `showTotalsBlock` to create/update payloads)
  - `src/features/angebote/api/angebote.api.ts` (maps `show_totals_block` in DB↔TS; serializes create/update without leaking camelCase to Supabase)
  - `src/features/angebote/hooks/use-angebot-builder.ts` (adds `showTotalsBlock` state + initial value; persists on save)
  - `src/features/angebote/components/angebot-builder/index.tsx` (wires flag into hook, create/update payloads, and draft preview row)
  - `src/features/angebote/components/angebot-builder/step-2-positionen.tsx` (adds “Summenblock im Angebot anzeigen …” switch below the line items table)
  - `src/features/angebote/lib/angebot-formula-engine.ts` (adds `computeAngebotTotals`)
  - `src/features/angebote/lib/angebot-formula-engine.test.ts` (adds totals computation tests)
  - `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` (computes `totalsData` and passes it to cover body)
  - `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` (renders totals block using shared PDF styles)
  - `docs/angebot-formula-engine.md` (documents Phase 4 and marks it done)
- **New file**:
  - `supabase/migrations/20260505115400_angebot_show_totals_block.sql`

---

## Phase 4b — Completed (Conditional enable + editable totals labels)

Phase 4b refines the Phase 4 totals block with a guarded toggle (only enable when a `net_amount` role column exists) and per-quote editable label fields stored on `angebote`. The PDF uses the stored labels verbatim, falling back to exported defaults when DB values are null.

- **Changed files**:
  - `supabase/migrations/20260505102500_angebot_totals_labels.sql` (adds three nullable label columns)
  - `src/features/angebote/types/angebot.types.ts` (adds `totals_label_*` to `AngebotRow`; adds camelCase label fields to create/update payloads)
  - `src/features/angebote/api/angebote.api.ts` (maps label columns DB↔TS; create/update mapping without leaking camelCase keys)
  - `src/features/angebote/hooks/use-angebot-builder.ts` (exports default label constants; adds builder label state)
  - `src/features/angebote/components/angebot-builder/index.tsx` (wires initial + current label state into draft preview + create/update payloads; computes `hasNetAmountCol`)
  - `src/features/angebote/components/angebot-builder/step-2-positionen.tsx` (blocks toggle enable when schema lacks `net_amount`; shows inline warning only on attempted enable; renders 3 label inputs when enabled)
  - `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` (imports exported defaults; passes label strings via `totalsData`)
  - `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` (renders totals labels from `totalsData` instead of hardcoded strings)
  - `docs/angebot-formula-engine.md` (documents the Phase 4b patch)

---

## Phase 6 — Completed (Quote-level Netto/Brutto input mode)

Phase 6 adds a per-quote input mode toggle that reinterprets entered prices as either net (default) or gross. In gross mode, the engine converts the entered price inputs (`unit_price`, `flat_rate`, `surcharge`) to net-equivalents using the row’s `tax_rate` before running the existing net-first computation chain. Missing/non-numeric tax rate shows a UI warning on the affected price inputs; `tax_rate = 0` is valid and does not warn.

- **Changed files**:
  - `supabase/migrations/20260505131500_angebot_input_mode.sql` (adds `angebote.input_mode` with NOT NULL default + CHECK constraint)
  - `src/features/angebote/types/angebot.types.ts` (adds `input_mode` to `AngebotRow`; adds camelCase `inputMode` to create/update payloads)
  - `src/features/angebote/api/angebote.api.ts` (maps `input_mode` DB↔TS; create/update mapping without leaking camelCase keys)
  - `src/features/angebote/lib/angebot-formula-engine.ts` (adds `InputMode` and extends `computeRow` with gross-mode pre-conversion of price inputs)
  - `src/features/angebote/lib/angebot-formula-engine.test.ts` (adds gross-mode test cases incl. `tax_rate = 0` semantics)
  - `src/features/angebote/hooks/use-angebot-builder.ts` (adds `inputMode` state with dirty guard; wires to create/update payloads)
  - `src/features/angebote/components/angebot-builder/index.tsx` (passes `inputMode` through; calls `computeRow(..., inputMode)`; passes toggle props to Step 2; includes `inputMode` in create payload)
  - `src/features/angebote/components/angebot-builder/step-2-positionen.tsx` (adds input-mode toggle and warning icon+tooltip on price inputs when gross mode lacks usable `tax_rate`)
  - `docs/angebot-formula-engine.md` (documents Phase 6 and marks it done)

