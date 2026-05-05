# Draft quote column refresh audit (Angebot-Builder)

Date: 2026-05-05

Scope: read-only audit of the Angebot (quote) builder create/edit behaviour around **column schema hydration** and **`table_schema_snapshot` persistence**, based strictly on current code and migrations (no guesses).

Files read:

- `src/features/angebote/components/angebot-builder/index.tsx`
- `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- `src/features/angebote/hooks/use-angebot-builder.ts`
- `src/features/angebote/hooks/use-angebot-vorlagen.ts`
- `src/features/angebote/types/angebot.types.ts`
- `src/features/angebote/lib/angebot-column-presets.ts`
- `src/features/angebote/api/angebote.api.ts`
- `src/features/angebote/components/angebot-detail-view.tsx`
- `supabase/migrations/20260409150000_create_angebote.sql`
- `supabase/migrations/20260413120000_angebot_flexible_table.sql`
- `supabase/migrations/20260414100000_angebot_column_presets.sql`
- `src/types/database.types.ts` (note: does **not** currently contain an `angebote` table type entry; see “DB types gap”)

---

## 1) `resolveAngebotPdfColumnSchema` — exact logic, sources, null handling

Implementation:

- File: `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- Lines: 48–63

Exact precedence logic:

1. If `angebot.table_schema_snapshot` exists and has length > 0 → **return `angebot.table_schema_snapshot`**
2. Else if `angebot.pdf_column_override?.columns?.length` (legacy pre-Phase-2a) → `profileToAngebotColumnDefs(legacy)`
3. Else → `profileToAngebotColumnDefs(ANGEBOT_STANDARD_COLUMN_PROFILE)`

Citation:

```48:63:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
export function resolveAngebotPdfColumnSchema(
  angebot: AngebotWithLineItems
): AngebotColumnDef[] {
  // Precedence: table_schema_snapshot (Phase 2a+) → pdf_column_override (legacy, pre–Phase-2a offers only) → standard profile fallback. Remove step 2 once all offers have a snapshot.
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

Answer to “What does it return if `tableschemasnapshot` is empty or null?”:

- If `table_schema_snapshot` is **null**, **undefined**, or **empty array** → it falls back to `pdf_column_override` (if present) else standard profile converted via `profileToAngebotColumnDefs(...)`.

---

## 2) `columnSchema` in edit mode — what `initialAngebot` fields are actually consumed?

Where `columnSchema` is set in edit mode:

- File: `src/features/angebote/components/angebot-builder/index.tsx`
- Lines: 132–137

Citation:

```132:137:src/features/angebote/components/angebot-builder/index.tsx
  const columnSchema = useMemo(() => {
    if (isEdit && initialAngebot) {
      return resolveAngebotPdfColumnSchema(initialAngebot);
    }
    return createColumnSchema;
  }, [isEdit, initialAngebot, createColumnSchema]);
```

Fields of `initialAngebot` consumed by `resolveAngebotPdfColumnSchema(...)`:

- **Reads** `initialAngebot.table_schema_snapshot`
- If that is missing/empty, **reads** `initialAngebot.pdf_column_override`
- Does **not** read `initialAngebot.angebot_vorlage_id` at all

Evidence:

- Resolver code uses only `angebot.table_schema_snapshot` and `angebot.pdf_column_override` (and the constant standard profile), not `angebot_vorlage_id`. See `AngebotPdfDocument.tsx` lines 48–63 above.

---

## 3) `handleVorlageChange` early return — what else is blocked in edit mode?

`handleVorlageChange` is blocked in edit mode:

- File: `src/features/angebote/components/angebot-builder/index.tsx`
- Lines: 183–205

Citation (early return and the blocked side-effects):

```183:205:src/features/angebote/components/angebot-builder/index.tsx
  const handleVorlageChange = useCallback(
    (id: string, columns: AngebotColumnDef[]) => {
      if (isEdit) return;
      // ...
      setSelectedVorlageId(id);
      setCreateColumnSchema(Array.isArray(columns) ? columns : []);
      resetLineItems();
    },
    [isEdit, lineItems, resetLineItems]
  );
```

So in edit mode, these side-effects never run:

- `setSelectedVorlageId(id)`
- `setCreateColumnSchema(...)`
- `resetLineItems()`
- Plus the “dirty rows” detection + toast warning inside that function (lines 186–198)

`handleColumnPresetChange` is also blocked in edit mode:

- File: `src/features/angebote/components/angebot-builder/index.tsx`
- Lines: 207–215

Citation:

```207:215:src/features/angebote/components/angebot-builder/index.tsx
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

Other edit-mode blocks inside Step 2:

- Step 2 has an effect that auto-selects a default Vorlage when the vorlagen list loads, but it returns early when `isEditMode` is true.
  - File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
  - Lines: 281–293 (`useEffect`), specifically the `if (isEditMode) return;` at line 283.

Citation:

```281:293:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
  useEffect(() => {
    if (isEditMode) return;
    if (selectedVorlageId != null) return;
    if (vorlagen.length === 0) return;
    const def = vorlagen.find((v) => v.is_default) ?? vorlagen[0];
    if (!def) return;
    const cols = def.columns;
    const safeCols = (Array.isArray(cols) ? cols : []).filter(
      (c) => c.id !== ANGEBOT_POSITION_COLUMN_ID
    );
    onVorlageChange(def.id, safeCols);
  }, [isEditMode, selectedVorlageId, vorlagen, onVorlageChange]);
```

---

## 4) `lineItemsFromAngebotRows` — what happens to existing row `data` when schema changes?

`lineItemsFromAngebotRows` does **not** apply any schema-based transformation. It essentially:

- sorts rows by `position`
- for each line item:
  - clones persisted `li.data` as-is (`let data = { ...li.data }`)
  - only if that cloned record is empty (`Object.keys(data).length === 0`), it backfills data from legacy scalar columns (`leistung`, `anfahrtkosten`, etc.) using `ANGEBOT_LEGACY_COLUMN_IDS`.
- returns builder items with `data` unchanged beyond the above empty-record legacy backfill

File and citation:

- File: `src/features/angebote/hooks/use-angebot-builder.ts`
- Lines: 45–70

```45:70:src/features/angebote/hooks/use-angebot-builder.ts
export function lineItemsFromAngebotRows(
  rows: AngebotLineItemRow[]
): BuilderLineItem[] {
  if (!rows.length) {
    return [newEmptyLineItem(1)];
  }
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return sorted.map((li, i) => {
    let data = { ...li.data };
    if (Object.keys(data).length === 0) {
      data = {
        [ANGEBOT_LEGACY_COLUMN_IDS.leistung]: li.leistung || null,
        [ANGEBOT_LEGACY_COLUMN_IDS.anfahrtkosten]: li.anfahrtkosten,
        [ANGEBOT_LEGACY_COLUMN_IDS.price_first_5km]: li.price_first_5km,
        [ANGEBOT_LEGACY_COLUMN_IDS.price_per_km_after_5]:
          li.price_per_km_after_5,
        [ANGEBOT_LEGACY_COLUMN_IDS.notes]: li.notes
      };
    }
    return {
      position: i + 1,
      data
    };
  });
}
```

Therefore:

- **Preserves** existing `data` keys/values as-is (no dropping), unless the record is empty and needs legacy backfill.
- **Does not** initialize missing keys for new schema columns.
- **Does not** delete keys for removed schema columns.

---

## 5) `saveEditMutation` — what is in `UpdateAngebotPayload` and is snapshot updated on edit save?

### 5a) `UpdateAngebotPayload` definition

`UpdateAngebotPayload` is explicitly defined to omit immutable fields, including:

- `angebot_vorlage_id`
- `table_schema_snapshot`
- `pdf_column_override`

File/citation:

- File: `src/features/angebote/types/angebot.types.ts`
- Lines: 194–210

```194:210:src/features/angebote/types/angebot.types.ts
export type UpdateAngebotPayload = Partial<
  Omit<
    AngebotRow,
    | 'id'
    | 'company_id'
    | 'angebot_number'
    | 'created_at'
    | 'updated_at'
    | 'angebot_vorlage_id'
    | 'table_schema_snapshot'
    | 'pdf_column_override'
  >
>;
```

Additionally, `AngebotRow`’s comment claims snapshot is immutable after create:

- File: `src/features/angebote/types/angebot.types.ts`
- Lines: 105–110

```105:110:src/features/angebote/types/angebot.types.ts
  angebot_vorlage_id: string | null;
  /**
   * Frozen copy of angebot_vorlagen.columns written at creation time. Immutable after create — updateAngebot must never overwrite this field.
   */
  table_schema_snapshot: AngebotColumnDef[] | null;
```

### 5b) What `saveEditMutation` writes

`saveEditMutation` performs:

1. `updateAngebot(angebotId, header)` — where `header` is `UpdateAngebotPayload`
2. `replaceAngebotLineItems(angebotId, rows)`

It does **not** include any snapshot or template id update in the header payload.

File/citation:

- File: `src/features/angebote/hooks/use-angebot-builder.ts`
- Lines: 149–176 (mutation body)

```149:176:src/features/angebote/hooks/use-angebot-builder.ts
  const { mutate: saveEditMutation, isPending: isSavingEdit } = useMutation({
    mutationFn: async ({
      header,
      rows
    }: {
      header: UpdateAngebotPayload;
      rows: CreateAngebotPayload['line_items'];
    }) => {
      if (!angebotId) {
        throw new Error('angebotId fehlt.');
      }
      await updateAngebot(angebotId, header);
      await replaceAngebotLineItems(angebotId, rows);
    },
    // ...
  });
```

### 5c) `updateAngebot` DB write behaviour

`updateAngebot(...)` updates only what you pass, plus `updated_at`.

It does **not** write `table_schema_snapshot` (and explicitly documents it must not).

File/citation:

- File: `src/features/angebote/api/angebote.api.ts`
- Lines: 332–353

```332:353:src/features/angebote/api/angebote.api.ts
export async function updateAngebot(
  id: string,
  payload: UpdateAngebotPayload
): Promise<AngebotRow> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('angebote')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw toQueryError(error);
  return mapAngebotHeaderFromDb(data as Record<string, unknown>);
}
```

Conclusion (Q5):

- **`tableschemasnapshot` / `table_schema_snapshot` is NOT included in the update payload sent to Supabase on edit save.**
- Based on current code, it is **never updated after creation** (unless a separate path exists outside these files; none found in this audit set).

---

## 6) `useAngebotVorlagenList` — does it include `columns[]`, and where is it called?

Hook:

- File: `src/features/angebote/hooks/use-angebot-vorlagen.ts`
- Lines: 24–31

It returns a React Query `useQuery(...)` calling `listAngebotVorlagen(companyId)`. The hook itself does not reshape the returned data.

Citation:

```24:31:src/features/angebote/hooks/use-angebot-vorlagen.ts
export function useAngebotVorlagenList(companyId: string) {
  // Query key from angebotKeys.vorlagen — see src/query/keys/angebote.ts
  return useQuery({
    queryKey: angebotKeys.vorlagen.list(companyId),
    queryFn: () => listAngebotVorlagen(companyId),
    enabled: Boolean(companyId),
    staleTime: 60_000
  });
}
```

Evidence that the returned list items include `columns: AngebotColumnDef[]`:

- Step 2 code reads `v.columns` and treats it like an array of column defs.
  - File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
  - Lines: 288–292 and 308–315

Citation:

```286:315:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
    const def = vorlagen.find((v) => v.is_default) ?? vorlagen[0];
    // ...
    const cols = def.columns;
    const safeCols = (Array.isArray(cols) ? cols : []).filter(
      (c) => c.id !== ANGEBOT_POSITION_COLUMN_ID
    );
    onVorlageChange(def.id, safeCols);
  // ...
  function handleSelectTemplate(id: string) {
    const v = vorlagen.find((x) => x.id === id);
    const cols = v?.columns;
    const safeCols = (Array.isArray(cols) ? cols : []).filter(
      (c) => c.id !== ANGEBOT_POSITION_COLUMN_ID
    );
    onVorlageChange(id, safeCols);
  }
```

Where the hook is called:

- It is called in `Step2Positionen` (always, regardless of edit/create, because it is not conditional).
  - File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
  - Lines: 272–274

Citation:

```272:274:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
  const { data: vorlagen = [], isLoading: vorlagenLoading } =
    useAngebotVorlagenList(companyId);
```

It is **not** called in `src/features/angebote/components/angebot-builder/index.tsx` (no usage found in the file; it only passes `companyId` into Step 2).

---

## 7) Live Vorlage columns availability in edit mode — is there any code path that reads them for schema?

Finding: **No**.

In edit mode, builder column schema is sourced from:

- `resolveAngebotPdfColumnSchema(initialAngebot)` → which reads **only** `table_schema_snapshot` (or legacy profile fallback), not the Vorlage.
  - `index.tsx` lines 132–137
  - `AngebotPdfDocument.tsx` lines 48–63

In edit mode, the only place that fetches Vorlagen (`Step2Positionen`) does so for display/label purposes:

- It computes `lockedVorlageLabel` via `vorlagen.find((x) => x.id === selectedVorlageId)?.name`
  - File: `step-2-positionen.tsx` lines 277–279

Citation:

```276:279:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
  const selectValue = selectedVorlageId ?? '';
  const lockedVorlageLabel =
    vorlagen.find((x) => x.id === selectedVorlageId)?.name ??
    'Gespeicherte Vorlage';
```

But it does **not** use `vorlagen.find(...).columns` to set schema in edit mode because:

- The “auto-pick default” effect early-returns when `isEditMode` is true (lines 282–293).
- `onVorlageChange(...)` is wired to `handleVorlageChange(...)` which itself early-returns when `isEdit` is true (`index.tsx` line 185).

Therefore, there is **no active path** in edit mode that uses live Vorlage columns to drive `columnSchema`.

---

## 8) Line item data compatibility — what if live Vorlage has an additional column not present in snapshot?

There are two distinct realities:

### 8a) What happens *today* in edit mode (without schema refresh)

The builder’s `columnSchema` is derived from snapshot/legacy fallback only (not live template). Therefore:

- A new column added to the Vorlage later is **not rendered** in the edit builder UI, because the builder never reads it.

Evidence: `index.tsx` uses `resolveAngebotPdfColumnSchema(initialAngebot)` for edit mode schema; see section 2.

### 8b) If the builder *did* switch to a schema that includes a new column id

The Step 2 row renderer reads `raw = item.data[col.id]` and renders empty value when missing:

- File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- Lines: 141–165 (text input example)

Citation:

```141:165:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
          {columnSchema
            .filter((col) => col.id !== ANGEBOT_POSITION_COLUMN_ID)
            .map((col) => {
              const raw = item.data[col.id];
              // ...
              return (
                <div key={key} className='space-y-1'>
                  <Label className='text-xs'>{col.header}</Label>
                  {layout.pdfRenderType === 'text' ? (
                    <Input
                      // ...
                      value={raw != null ? String(raw) : ''}
                      onChange={(e) =>
                        onUpdate({
                          data: {
                            ...item.data,
                            [col.id]: e.target.value || null
                          }
                        })
                      }
                    />
                  ) : null}
```

So if `item.data[col.id]` is `undefined` (new column not in existing rows), it renders as `''` (empty string) and does not crash.

Conclusion (Q8):

- With a refreshed schema, existing rows would **render empty** for new columns (no crash) and will be populated only if the user types a value (or if data is explicitly initialized elsewhere).

---

## 9) `table_schema_snapshot` write path — create vs edit payloads (exact Supabase payloads)

### 9a) Create path writes snapshot

Builder create path includes `tableSchemaSnapshot: columnSchema` in the `createAngebotMutation` payload:

- File: `src/features/angebote/components/angebot-builder/index.tsx`
- Lines: 388–419 (payload), specifically lines 416–418

Citation:

```388:419:src/features/angebote/components/angebot-builder/index.tsx
    createAngebotMutation({
      // ...
      angebotVorlageId: selectedVorlageId,
      tableSchemaSnapshot: columnSchema,
      line_items: lineItemsPayload()
    });
```

Then the API insert to Supabase writes `angebot_vorlage_id` and `table_schema_snapshot` into the `angebote` row:

- File: `src/features/angebote/api/angebote.api.ts`
- Lines: 261–297, specifically 287–294

Citation:

```261:297:src/features/angebote/api/angebote.api.ts
  const { data: headerData, error: headerError } = await supabase
    .from('angebote')
    .insert({
      // ...
      angebot_vorlage_id: payload.angebotVorlageId ?? null,
      table_schema_snapshot: payload.tableSchemaSnapshot.map((c) => ({
        id: c.id,
        header: c.header,
        preset: c.preset,
        required: c.required,
        formula: c.formula
      })),
      // Explicitly null — new offers use table_schema_snapshot. pdf_column_override is a legacy field for pre-Phase-2a rows only.
      pdf_column_override: null
    })
```

### 9b) Edit save path does NOT write snapshot

Edit save (`saveEditMutation`) only calls:

- `updateAngebot(angebotId, header)` where `header` is `UpdateAngebotPayload` (cannot include snapshot by type)
- `replaceAngebotLineItems(...)`

No snapshot write exists in this mutation.

Evidence:

- Mutation body in `use-angebot-builder.ts` lines 149–176 (see section 5b)
- `updateAngebot` comment explicitly says never overwrite the snapshot (api file lines 332–337)

Citation of immutability comment:

```332:337:src/features/angebote/api/angebote.api.ts
/**
 * Partially updates an Angebot header row.
 * Does not touch line items — use replaceAngebotLineItems for that.
 *
 * Template and schema snapshot are immutable after creation. Only line item data and metadata fields (subject, dates, text blocks, status) are updated here. Never overwrite angebot_vorlage_id, table_schema_snapshot, or pdf_column_override.
 */
```

Conclusion (Q9):

- Snapshot is written on **create** (builder → `createAngebot` insert).
- Snapshot is written on **edit**: **no** (not via `saveEditMutation` nor `updateAngebot`).

---

## 10) Senior recommendation — safest strategy to re-hydrate from live Vorlage on edit open, preserve data, init new columns, and update snapshot on save

### 10a) Ground truth constraints from the current codebase

1. **Current PDF + detail view are snapshot-driven**:
   - Resolver precedence is `table_schema_snapshot` first (`AngebotPdfDocument.tsx` 48–63).
2. **The code and types explicitly enforce snapshot immutability after create**:
   - `UpdateAngebotPayload` omits `table_schema_snapshot` and `angebot_vorlage_id` (`angebot.types.ts` 194–210).
   - API update function documents “Never overwrite … table_schema_snapshot” (`angebote.api.ts` 332–337).
3. **Builder edit mode currently blocks any template-based schema changes**:
   - `handleVorlageChange` returns early when `isEdit` (`index.tsx` 183–205).
   - Step 2 default-template effect returns early in edit mode (`step-2-positionen.tsx` 282–293).
4. **Line item `data` is schema-agnostic**:
   - `lineItemsFromAngebotRows` preserves `li.data` as-is (`use-angebot-builder.ts` 45–70).
   - Step 2 renderer treats missing keys as empty and never assumes presence (`step-2-positionen.tsx` 141–165 et al.).

### 10b) Safest schema re-hydration strategy (aligned with your desired behaviour)

To meet: (a) preserve existing data for still-existing columns, (b) init new columns with null/empty for existing rows, and (c) update snapshot on save:

- **Schema source of truth in edit mode**:
  - When opening a draft in edit mode, resolve the **live Vorlage** matching `initialAngebot.angebot_vorlage_id`.
  - Use that Vorlage’s `columns` (normalized to `AngebotColumnDef[]`) as the schema for the builder UI.
  - Keep the Vorlage selector read-only as today.

- **Row data reconciliation**:
  - For each existing line item row:
    - Keep `data` values for any column IDs that are still present in the new schema.
    - For any newly added column IDs (present in schema but missing in `data`), initialize to `null` (or omit the key; UI already treats missing as empty, but explicit `null` can be clearer and avoids ambiguity with `" "`).
    - Decide how to handle “extra” keys (present in `data` but not in schema):
      - **Conservative (recommended)**: keep them in the `data` object so no information is lost (even if the column was removed). They simply won’t render because they are not in `columnSchema`.
      - If you require strictness, you can drop them, but that is destructive and should likely be avoided for drafts.

- **Persisting the refreshed snapshot**:
  - On edit save, include the refreshed schema in the update write by explicitly updating `angebote.table_schema_snapshot`.
  - This is currently impossible with `UpdateAngebotPayload` as defined (`angebot.types.ts` 194–210) and the current `updateAngebot` contract (`angebote.api.ts` 332–337). So implementing the desired behaviour will require changing that “immutable snapshot” policy for drafts (or adding a dedicated “refresh snapshot” update path).

### 10c) Edge cases you need to explicitly think about

- **Deleted columns**:
  - Live Vorlage removed a column that exists in existing rows’ `data`.
  - With conservative reconciliation, the values remain stored but become hidden (no crash).
  - If you drop keys, you will permanently lose draft data.

- **Renamed column IDs**:
  - There is no “rename” concept unless migrations/UX guarantee stable ids. If admins effectively “rename” by creating a new column id and deleting the old one, reconciliation cannot map old values → new id automatically.
  - Any mapping would require explicit “column rename mapping” metadata (not present in current schema).

- **Template `angebot_vorlage_id` missing / deleted template**:
  - If `initialAngebot.angebot_vorlage_id` is null or the template no longer exists, you need a fallback:
    - Use `table_schema_snapshot` (current behaviour) as last resort.
    - Or fall back to default template, but that can silently change the draft’s schema (risk).

- **Non-draft statuses**:
  - Your requirement says “draft quote opened in edit mode”. If non-draft offers are editable in UI, you may want to restrict snapshot refresh to `status === 'draft'` only, to avoid retroactively changing “sent”/accepted offers’ snapshot.
  - Current builder edit mode is `isEdit = !!initialAngebot` and does not check status (`index.tsx` 109–110).

### 10d) DB/types alignment note (“DB types gap”)

- `src/types/database.types.ts` as currently checked does not include a `Tables.angebote` entry (no matches found for `angebote:` / `public.angebote` in this audit).
- Schema truth for `angebote.angebot_vorlage_id` and `angebote.table_schema_snapshot` is present in migrations:
  - `supabase/migrations/20260413120000_angebot_flexible_table.sql` lines 48–60 add both columns and document snapshot usage.

Citation:

```48:60:supabase/migrations/20260413120000_angebot_flexible_table.sql
ALTER TABLE public.angebote
  ADD COLUMN angebot_vorlage_id uuid
    REFERENCES public.angebot_vorlagen(id) ON DELETE SET NULL;

ALTER TABLE public.angebote
  ADD COLUMN table_schema_snapshot jsonb;

COMMENT ON COLUMN public.angebote.table_schema_snapshot IS
  'Frozen copy of angebot_vorlagen.columns at offer creation time (Phase 2a: immutable after insert; PDF uses this, not live template).';

COMMENT ON COLUMN public.angebote.angebot_vorlage_id IS
  'Template chosen at offer creation (audit FK; immutable after insert in Phase 2a). PDF resolves columns from table_schema_snapshot.';
```

---

## Appendix: the core contradiction that causes the bug

Your “problem statement” matches the current code and comments:

- Both the **UI** and **PDF schema resolution** are snapshot-driven in edit mode.
- The **edit save pipeline** intentionally never updates the snapshot.

So, even if admins update the Vorlage columns, an existing draft offer’s schema cannot refresh because:

- No code path reads the Vorlage’s live `columns` for edit-mode schema.
- Even if you did, the system currently prevents writing `table_schema_snapshot` on edit.

---

## Resolution (implemented)

This audit’s “core contradiction” has been resolved **for draft offers only** without changing create mode or non-draft edit behaviour:

- **Draft edit schema source**: `AngebotBuilder` now prefers live `angebot_vorlagen.columns` (matched by `initialAngebot.angebot_vorlage_id`) when `initialAngebot.status === 'draft'`. If the Vorlage is missing/empty, it falls back to the existing snapshot-driven `resolveAngebotPdfColumnSchema(initialAngebot)` path.\n  - File: `src/features/angebote/components/angebot-builder/index.tsx`
- **Row data reconciliation**: when the live schema loads, existing rows get `null` initialized for any *new* column IDs; existing values are untouched; orphaned keys are kept.\n  - File: `src/features/angebote/components/angebot-builder/index.tsx`
- **Draft-only snapshot refresh on save**: edit saves can now persist the refreshed schema back to `angebote.table_schema_snapshot` via a dedicated API function guarded by `.eq('status','draft')`.\n  - Files:\n    - `src/features/angebote/api/angebote.api.ts` (`updateDraftAngebotSchema`)\n    - `src/features/angebote/hooks/use-angebot-builder.ts` (optional `liveColumnSchema`)\n+- **Non-draft offers untouched**: `UpdateAngebotPayload` and `updateAngebot()` remain unchanged; snapshots for non-draft offers cannot be overwritten by the normal edit path.\n  - Files:\n    - `src/features/angebote/types/angebot.types.ts`\n    - `src/features/angebote/api/angebote.api.ts`

Files changed:

- `src/features/angebote/types/angebot.types.ts` (added `DraftSchemaRefreshPayload`)\n- `src/features/angebote/api/angebote.api.ts` (added `updateDraftAngebotSchema`)\n- `src/features/angebote/hooks/use-angebot-builder.ts` (added optional `liveColumnSchema` and draft-only snapshot persist)\n- `src/features/angebote/components/angebot-builder/index.tsx` (draft live schema hydration + one-time reconciliation)\n- `docs/plans/draft-quote-column-refresh-audit.md` (this section)\n- `docs/angebot-builder.md` (new doc; see next section in implementation plan)

