---
todos:
  - id: part1-migration
    content: "Add supabase/migrations/20260413120000_angebot_flexible_table.sql — angebot_vorlagen, FKs, data jsonb, backfill, default templates, RLS, grants, comments (deprecated typed columns). Seed all companies (Decision 1)."
  - id: part2-types
    content: "Extend angebot.types.ts — AngebotColumnType, AngebotColumnDef, AngebotVorlageRow, BuilderLineItem.data, snapshots, legacy catalog comments; add shared legacy column ID constants module. Percent 0–100 JSDoc; @deprecated pdf_column_override (Decisions 2, 5)."
  - id: part3-api-keys
    content: "Add angebot-vorlagen.api.ts + useAngebotVorlagen hooks; extend angebotKeys.vorlagen factory; invalidate on mutations."
  - id: part4-widths
    content: "Implement calcAngebotColumnWidths(columns) in angebot-pdf-columns.ts with fully commented 6-step algorithm; document 515pt vs invoice 499pt rationale."
  - id: part5-pdf
    content: "Refactor AngebotPdfCoverBody + AngebotPdfDocument for columnSchema + data jsonb + legacy fallbacks; header flexWrap wrap; wire preview hook. Snapshot precedence + percent ÷100 (Decisions 2, 5)."
  - id: part6-step2-hook
    content: "Dynamic Step2Positionen + useAngebotBuilder (data merge, newEmptyLineItem); AngebotBuilder draft payload + section2Complete + submit payloads. section2Complete first non-integer column; percent input note (Decisions 2, 3)."
  - id: part7-step3
    content: "Step3Details template Select + React Query + template change reset + toast; link to Angebotsvorlagen route. Template Select disabled in edit mode (Decision 4)."
  - id: part8-settings-page
    content: "New route app/dashboard/abrechnung/angebot-vorlagen + AngebotVorlageEditorPanel + list panel; nav-config entry. Snapshot immutability note (Decision 4)."
  - id: part9-create-api
    content: "Update createAngebot / replaceAngebotLineItems / getAngebot types + inserts for angebot_vorlage_id, table_schema_snapshot, line data only. pdf_column_override null; immutable snapshot (Decisions 4, 5)."
  - id: part10-docs
    content: "Update docs/angebote-module.md, docs/pdf-vorlagen.md; add docs/angebote-vorlagen.md; regenerate types if applicable."
---

# Phase 2a — Angebot flexible table builder (schema, templates, dynamic PDF, dynamic Step 2)

This plan covers **Phase 2a only**: database + types + APIs + dynamic PDF + dynamic Step 2 cards + template picker + settings page shell. **Phase 2b** (full spreadsheet grid) is out of scope.

---

## Files read

Every path below was read in full unless noted. Line counts are total lines per `wc -l` at plan authoring time.

| File | Lines | Notes |
|------|------:|-------|
| [docs/angebote-module.md](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/docs/angebote-module.md) | 265 | |
| [docs/pdf-vorlagen.md](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/docs/pdf-vorlagen.md) | 184 | |
| [docs/invoices-module.md](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/docs/invoices-module.md) | 354 | |
| [docs/pricing-engine.md](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/docs/pricing-engine.md) | 197 | |
| [src/features/angebote/types/angebot.types.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/types/angebot.types.ts) | 108 | |
| [src/features/angebote/components/angebot-builder/step-2-positionen.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/step-2-positionen.tsx) | 237 | |
| [src/features/angebote/components/angebot-builder/step-3-details.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/step-3-details.tsx) | 111 | |
| [src/features/angebote/components/angebot-builder/index.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/index.tsx) | 497 | |
| [src/features/angebote/hooks/use-angebot-builder.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/hooks/use-angebot-builder.ts) | 176 | |
| [src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts) | 128 | |
| [src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx) | 281 | |
| [src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx) | 158 | |
| [src/features/angebote/api/angebote.api.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/api/angebote.api.ts) | 257 | |
| [src/features/invoices/lib/pdf-column-catalog.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/lib/pdf-column-catalog.ts) | 462 | |
| [src/features/invoices/lib/resolve-pdf-column-profile.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/lib/resolve-pdf-column-profile.ts) | 131 | |
| [src/features/invoices/components/invoice-pdf/pdf-column-layout.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/invoice-pdf/pdf-column-layout.ts) | 386 | **Actual path** (not `src/features/invoices/lib/pdf-column-layout.ts`). |
| [src/features/invoices/components/pdf-vorlagen/vorlage-editor-panel.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/pdf-vorlagen/vorlage-editor-panel.tsx) | 462 | |
| [src/features/invoices/components/pdf-vorlagen/column-picker.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/pdf-vorlagen/column-picker.tsx) | 100 | |
| [src/features/invoices/components/pdf-vorlagen/sortable-pdf-column-list.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/pdf-vorlagen/sortable-pdf-column-list.tsx) | 145 | |
| [src/features/invoices/api/pdf-vorlagen.api.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/api/pdf-vorlagen.api.ts) | 262 | **Actual path** (not `src/features/pdf-vorlagen/api/...`). |
| [src/app/dashboard/abrechnung/vorlagen/page.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/app/dashboard/abrechnung/vorlagen/page.tsx) | 39 | |
| [src/query/keys/angebote.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/query/keys/angebote.ts) | 28 | |
| [src/query/keys/invoices.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/query/keys/invoices.ts) | 97 | `pdfVorlagen` keys at L86–90. |
| [supabase/migrations/20260409150000_create_angebote.sql](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/supabase/migrations/20260409150000_create_angebote.sql) | 180 | Creates `angebot_line_items`. |
| [supabase/migrations/20260408120001_pdf_vorlagen.sql](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/supabase/migrations/20260408120001_pdf_vorlagen.sql) | 136 | Creates `pdf_vorlagen`. |

### Missing (paths from the brief that do not exist)

- `src/features/invoices/lib/pdf-column-layout.ts` — **missing**; use `src/features/invoices/components/invoice-pdf/pdf-column-layout.ts`.
- `src/features/pdf-vorlagen/components/vorlage-editor-panel.tsx` — **missing**.
- `src/features/pdf-vorlagen/components/column-picker.tsx` — **missing**.
- `src/features/pdf-vorlagen/components/sortable-pdf-column-list.tsx` — **missing**.
- `src/features/pdf-vorlagen/api/pdf-vorlagen.api.ts` — **missing**.
- `src/query/keys/pdf-vorlagen.ts` — **missing**; PDF Vorlagen keys live in [src/query/keys/invoices.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/query/keys/invoices.ts) (`invoiceKeys.pdfVorlagen`).

### Latest migration timestamp (for new filename)

After `find supabase/migrations -name "*.sql" | sort | tail -1`, the latest file at plan time was **`20260412150000_fix_cpt_rls.sql`**. The new migration should sort **after** that, e.g. **`20260413120000_angebot_flexible_table.sql`** (adjust if newer migrations land before implementation).

---

## Architecture decisions

1. **`table_schema_snapshot` on `angebote` (immutable per offer)**  
   **Rationale:** Matches `invoices.pdf_column_override` / line-item snapshot philosophy: changing a company template must not rewrite historical customer-facing PDFs. The selected `angebot_vorlage_id` records *which* template was chosen; the snapshot records the exact column schema at creation/edit-save time.

2. **Row values in `angebot_line_items.data` (jsonb), keyed by stable column `id`**  
   **Rationale:** Avoids endless `ALTER TABLE` for new pricing dimensions; supports arbitrary templates. Typed columns remain temporarily for backward compatibility and migration safety.

3. **Do not drop typed columns in Phase 2a**  
   **Rationale:** Reduces blast radius for any code, ad-hoc SQL, or reporting still reading `leistung` / `anfahrtkosten`. Deprecate with SQL comments; remove in a later major migration once all readers use `data`.

4. **Weight-based widths targeting **515pt** usable width (product requirement)**  
   **Rationale:** Angebot PDF already documents 515pt in [angebot-pdf-columns.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts). Invoice main table uses **499pt** inner width ([pdf-column-layout.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/invoice-pdf/pdf-column-layout.ts) L36–37). **Inline-comment requirement:** document in `calcAngebotColumnWidths` why Angebot uses 515 vs invoice 499 (different page/body padding assumptions — verify against `styles.angebotPage` / `tableHeader` padding during implementation).

5. **Reuse invoice Vorlagen *patterns*, not the `pdf_vorlagen` table**  
   **Rationale:** Invoice columns are keys into `PDF_COLUMN_MAP`; Angebote need **admin-defined headers** and stable UUID column ids. A parallel `angebot_vorlagen` table keeps domains separated and avoids polluting invoice PDF keys.

6. **Well-known legacy column IDs (shared SQL + TS)**  
   **Rationale:** Backfill and PDF fallback must use identical strings. Define once in TS (`ANGEBOT_LEGACY_COLUMN_IDS` or similar) and **duplicate literals in SQL** with a comment pointing to the TS module as SSOT for app code.

---

## Resolved decisions

Summaries below match the five former open questions; see affected Parts for implementation detail.

1. **Default template seed scope** — Seed the standard 5-column `angebot_vorlagen` row for **every** `public.companies` row (with `NOT EXISTS` guard), not only companies that already have Angebote. **Updated:** Part 1 (migration seed SQL + comment).

2. **Percent storage format** — Store `percent` cells as **0–100** (what the admin types); **divide by 100 in PDF `renderCell`** before `formatTaxRate` / locale formatting. **Updated:** Part 2 (type-level JSDoc), Part 5 (renderer), Part 6 (percent input comment).

3. **`section2Complete` rule** — True when **at least one row** has a non-empty value in the **first column whose `type !== 'integer'`**; if no such column exists, fall back to **any non-empty `data` value in any row**; if `columnSchema` is empty, false. **Updated:** Part 6 (`index.tsx` / hook derivation + inline comment).

4. **Template locked after creation (Phase 2a)** — `angebot_vorlage_id` and `table_schema_snapshot` are set at first create and **not** changeable when editing an existing offer; template switching UX is Phase 2b. **`updateAngebot` must not overwrite** those columns. **Updated:** Part 1 (SQL comments on snapshot FK), Part 7 (disabled Select + Tooltip), Part 8 (settings: editing templates does not alter issued offers), Part 9 (API contract).

5. **`pdf_column_override` deprecation** — **`table_schema_snapshot` always wins** when present. **`pdf_column_override`** is read only as a **legacy fallback** when snapshot is null (pre–Phase 2a rows). **`createAngebot` sets `pdf_column_override: null` explicitly** for all new offers. **Updated:** Part 2 (`@deprecated` on field), Part 5 (resolution order + comment block), Part 9 (insert + `updateAngebot` omission).

---

## Part 1 — DB migration

**New file:** `supabase/migrations/20260413120000_angebot_flexible_table.sql` (timestamp adjust if needed).

### SQL outline (full structure)

```sql
-- =============================================================================
-- angebot_vorlagen: company-scoped offer table templates (column schema only)
-- =============================================================================
CREATE TABLE public.angebot_vorlagen (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           REFERENCES public.companies(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  is_default             boolean NOT NULL DEFAULT false,
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

CREATE UNIQUE INDEX angebot_vorlagen_company_default_idx
  ON public.angebot_vorlagen(company_id)
  WHERE is_default = true;

COMMENT ON TABLE public.angebot_vorlagen IS
  'Reusable Angebot (offer) table templates: ordered column schema for builder + PDF.';

COMMENT ON COLUMN public.angebot_vorlagen.columns IS
  'JSON array of { id, header, type, weight, minWidth, required?, formula? }. See migration header.';

-- =============================================================================
-- angebote: link + frozen schema snapshot
-- =============================================================================
ALTER TABLE public.angebote
  ADD COLUMN angebot_vorlage_id uuid
    REFERENCES public.angebot_vorlagen(id) ON DELETE SET NULL;

ALTER TABLE public.angebote
  ADD COLUMN table_schema_snapshot jsonb;

COMMENT ON COLUMN public.angebote.table_schema_snapshot IS
  'Frozen copy of angebot_vorlagen.columns at offer creation time (Phase 2a: immutable after insert; PDF uses this, not live template).';

COMMENT ON COLUMN public.angebote.angebot_vorlage_id IS
  'Template chosen at offer creation (audit FK; immutable after insert in Phase 2a). PDF resolves columns from table_schema_snapshot.';

-- =============================================================================
-- angebot_line_items: flexible cell storage
-- =============================================================================
ALTER TABLE public.angebot_line_items
  ADD COLUMN data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.angebot_line_items.data IS
  'Cell values keyed by column id from angebote.table_schema_snapshot.';

-- DEPRECATED: migrated into data jsonb; drop in next major migration after all readers switched.
COMMENT ON COLUMN public.angebot_line_items.leistung IS
  'DEPRECATED: use data->>''col_leistung'' (see well-known IDs in migration). Nullable transition TBD.';

COMMENT ON COLUMN public.angebot_line_items.anfahrtkosten IS
  'DEPRECATED: use data->''col_anfahrtkosten''.';

COMMENT ON COLUMN public.angebot_line_items.price_first_5km IS
  'DEPRECATED: use data->''col_price_first_5km''.';

COMMENT ON COLUMN public.angebot_line_items.price_per_km_after_5 IS
  'DEPRECATED: use data->''col_price_per_km_after_5''.';

COMMENT ON COLUMN public.angebot_line_items.notes IS
  'DEPRECATED: use data->>''col_notes''.';

-- Optional: ALTER ... ALTER COLUMN ... DROP NOT NULL on typed columns if we want new rows to omit them entirely.
-- Phase 2a recommendation: keep NOT NULL only on leistung if it remains — **implementation must align** with API inserting empty string vs null.

-- =============================================================================
-- Well-known column IDs (must match TS constant module)
-- =============================================================================
-- col_leistung, col_anfahrtkosten, col_price_first_5km, col_price_per_km_after_5, col_notes

-- =============================================================================
-- Backfill: copy typed scalars into data jsonb
-- =============================================================================
UPDATE public.angebot_line_items li
SET data = COALESCE(li.data, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
       'col_leistung', to_jsonb(li.leistung),
       'col_anfahrtkosten', to_jsonb(li.anfahrtkosten),
       'col_price_first_5km', to_jsonb(li.price_first_5km),
       'col_price_per_km_after_5', to_jsonb(li.price_per_km_after_5),
       'col_notes', to_jsonb(li.notes)
     ));

-- =============================================================================
-- Seed default template for every company (Phase 2a resolved decision)
-- =============================================================================
-- Seed for all companies so the builder is immediately usable — not just companies with existing offers.
-- Re-runnable: insert only when this company has no angebot_vorlagen row yet.
--
-- INSERT INTO public.angebot_vorlagen (company_id, name, description, is_default, columns, updated_at)
-- SELECT c.id, 'Standard', NULL, true, '<five-column JSON array with well-known ids>'::jsonb, now()
-- FROM public.companies c
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.angebot_vorlagen av WHERE av.company_id = c.id
-- );
-- (Use actual JSON for columns: same shape as TS seed / migration constants.)

-- =============================================================================
-- RLS (mirror angebote: admin + company_id)
-- =============================================================================
ALTER TABLE public.angebot_vorlagen ENABLE ROW LEVEL SECURITY;

CREATE POLICY angebot_vorlagen_select_company_admin ON public.angebot_vorlagen
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY angebot_vorlagen_insert_company_admin ON public.angebot_vorlagen
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY angebot_vorlagen_update_company_admin ON public.angebot_vorlagen
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY angebot_vorlagen_delete_company_admin ON public.angebot_vorlagen
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.angebot_vorlagen TO authenticated, service_role;
```

### Inline comment requirements (Part 1)

- **Every** well-known column id string literal in SQL must reference in a comment the TS module where the same constants are defined (e.g. `src/features/angebote/lib/angebot-legacy-column-ids.ts`).
- **DEPRECATED** column comments must state: what replaced them, when they can be dropped (“after all reads use `data` + snapshot”).
- **RLS policies**: one-line comment referencing that this mirrors `angebote` / `angebot_line_items` company isolation pattern from [20260409150000_create_angebote.sql](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/supabase/migrations/20260409150000_create_angebote.sql).
- **Seed `INSERT`**: inline SQL comment restating that templates are created for **all** `companies` so first-time builder users always have a default (ties to **Resolved decisions** §1).

---

## Part 2 — Types

**Modify:** [src/features/angebote/types/angebot.types.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/types/angebot.types.ts)

**Add new module:** `src/features/angebote/lib/angebot-legacy-column-ids.ts`

```ts
/** Stable ids for legacy 5-column offers; must match supabase/migrations/..._angebot_flexible_table.sql */
export const ANGEBOT_LEGACY_COLUMN_IDS = {
  leistung: 'col_leistung',
  anfahrtkosten: 'col_anfahrtkosten',
  price_first_5km: 'col_price_first_5km',
  price_per_km_after_5: 'col_price_per_km_after_5',
  notes: 'col_notes'
} as const;
```

### Signatures / shapes to add

```ts
/**
 * Cell types for offer line columns.
 * - **percent**: values are stored as **0–100** (user-facing input). Divide by 100 at PDF render time before calling `formatTaxRate` (see Part 5).
 */
export type AngebotColumnType =
  | 'text'
  | 'integer'
  | 'currency'
  | 'currency_per_km'
  | 'percent';

export interface AngebotColumnDef {
  id: string;
  header: string;
  type: AngebotColumnType;
  weight: number;
  minWidth: number;
  required?: boolean;
  /** Reserved for Phase 2b+ calculated columns */
  formula?: string | null;
}

export interface AngebotVorlageRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  columns: AngebotColumnDef[];
  created_at: string;
  updated_at: string;
}

// Payload types for API (mirror PdfVorlageCreatePayload / Update)
export interface AngebotVorlageCreatePayload { /* ... */ }
export interface AngebotVorlageUpdatePayload { /* ... */ }
```

- **`AngebotRow` / `AngebotWithLineItems`:** add `angebot_vorlage_id: string | null`, `table_schema_snapshot: AngebotColumnDef[] | null`.
- **`pdf_column_override` on `AngebotRow`:** keep field for DB compatibility; add **`@deprecated Use table_schema_snapshot. Only present on offers created before Phase 2a migration; new offers use null.`**
- **`AngebotLineItemRow`:** add `data: Record<string, string | number | null>` (or stricter Zod-inferred type); keep legacy typed fields during transition.
- **`CreateAngebotPayload`:** add `angebot_vorlage_id?: string | null`, `table_schema_snapshot: AngebotColumnDef[]`; extend line item type to include `data`; ensure payload documents **`pdf_column_override` omitted or null** for new creates (Part 9).
- **Legacy PDF path:** Keep `ANGEBOT_STANDARD_COLUMN_PROFILE` + `ANGEBOT_COLUMN_CATALOG` as **final** fallback; `pdf_column_override` only when `table_schema_snapshot` is null — precedence fully specified in Part 5 / Resolved decisions §5.

**Zod:** add `angebotColumnDefSchema` + `angebotColumnDefArraySchema` for API boundary validation (mirror `pdfColumnKeyArraySchema` style in invoice types).

### Inline comment requirements (Part 2)

- On `table_schema_snapshot`: why it exists and when it is written (**at create only in Phase 2a**; immutable on edit — ties **Resolved decisions** §4).
- On `data`: keys are `AngebotColumnDef.id` from snapshot; legacy fallbacks documented in PDF/UI modules, not only here.
- On `formula`: “not evaluated in Phase 2a” if present.
- On **`AngebotColumnType` / `percent`**: JSDoc must state storage **0–100** and that PDF divides by 100 (**Resolved decisions** §2).

---

## Part 3 — Angebot Vorlagen API and query keys

**New file:** `src/features/angebote/api/angebot-vorlagen.api.ts`

Planned exports (mirror [pdf-vorlagen.api.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/api/pdf-vorlagen.api.ts)):

```ts
export async function listAngebotVorlagen(companyId: string): Promise<AngebotVorlageRow[]>;
export async function getAngebotVorlage(id: string): Promise<AngebotVorlageRow | null>;
export async function createAngebotVorlage(payload: AngebotVorlageCreatePayload): Promise<AngebotVorlageRow>;
export async function updateAngebotVorlage(id: string, payload: AngebotVorlageUpdatePayload): Promise<AngebotVorlageRow>;
export async function deleteAngebotVorlage(id: string): Promise<void>;
export async function setDefaultAngebotVorlage(id: string, companyId: string): Promise<void>;
```

- **`listAngebotVorlagen`:** `.order('is_default', { ascending: false }).order('name')` (PostgREST: may need two sorts or client sort — document chosen approach in code comments).
- **`setDefaultAngebotVorlage`:** same clear-then-set pattern as `setDefaultVorlage` in pdf-vorlagen.api.ts.
- **`deleteAngebotVorlage`:** count rows for `company_id`; if last template, throw user-facing error (German message, match `deletePdfVorlage` style).

**New hooks file:** `src/features/angebote/hooks/use-angebot-vorlagen.ts` (mirror [use-pdf-vorlagen.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/hooks/use-pdf-vorlagen.ts)) — toast + invalidate `angebotKeys.vorlagen.list(companyId)`.

**Modify:** [src/query/keys/angebote.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/query/keys/angebote.ts)

```ts
export const angebotKeys = {
  all: ['angebote'] as const,
  list: () => ['angebote', 'list'] as const,
  detail: (id: string) => ['angebote', 'detail', id] as const,
  vorlagen: {
    all: ['angebot-vorlagen'] as const,
    list: (companyId: string) => ['angebot-vorlagen', 'list', companyId] as const,
    detail: (id: string) => ['angebot-vorlagen', 'detail', id] as const
  }
};
```

### Inline comment requirements (Part 3)

- Every `useQuery` / `invalidateQueries` must reference `angebotKeys.vorlagen.*` in a short comment.
- `rowFromDb` must coerce `columns` through Zod and explain PostgREST jsonb typing.

---

## Part 4 — Auto-fitting width calculation

**Modify:** [src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-pdf/angebot-pdf-columns.ts)

### Planned signature

```ts
export function calcAngebotColumnWidths(
  columns: AngebotColumnDef[]
): Record<string, number>;
```

### Algorithm (must appear as numbered comments above the implementation)

1. `availableWidth = 515` (pt).
2. `totalWeight = sum(columns.map(c => c.weight))` (guard `totalWeight > 0`).
3. `rawWidth[colId] = (weight / totalWeight) * availableWidth`.
4. `clampedWidth[colId] = max(rawWidth, col.minWidth)`.
5. If `sum(clampedWidth) > availableWidth`: compute overflow; find flexible columns where `rawWidth > minWidth`; distribute reduction proportional to weight among flexible only; repeat clamp to `minWidth` until convergence or single pass per product spec (**comment if iterative vs single pass** — implement exactly as spec; if single pass insufficient, document iteration cap).
6. If `sum(clampedWidth) < availableWidth`: **spec says table fills 515pt** — add comment and redistribution logic (e.g. distribute spare to columns proportional to weight above min) so final sum equals `availableWidth`.

### Inline comment requirements (Part 4)

- **Every step** of the algorithm (including edge cases: zero columns, one column, all mins exceed available) has a comment.
- Explain deviation from invoice `calcColumnWidths` ([pdf-column-layout.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/invoice-pdf/pdf-column-layout.ts) L366–385): invoice uses catalog `defaultWidthPt` scaling; Angebot uses **weight + minWidth floor + overflow redistribution**.

---

## Part 5 — Dynamic PDF renderer

**Modify:** [AngebotPdfCoverBody.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx)

### New / updated props

```ts
export interface AngebotPdfCoverBodyProps {
  // ...existing subject, salutation inputs, lineItems ...
  columnSchema: AngebotColumnDef[];
  introText: string | null;
  outroText: string | null;
}
```

- Remove / stop using `columnKeys: AngebotColumnKey[]` as the primary driver; **or** keep internal mapping from schema order (schema defines order).
- `const colWidths = calcAngebotColumnWidths(columnSchema)`.
- **Header row:** for each `col`, render `col.header`; set container / `Text` styles so **`flexWrap: 'wrap'`** applies (per requirement). Add comment: long admin labels must wrap, not truncate.
- **Body cells:** `renderCell(col, rawValue)` branching on `col.type`:
  - `text` → string as-is (empty → em dash)
  - `integer` → format integer
  - `currency` → reuse `formatEur` (existing)
  - `currency_per_km` → existing per-km formatter pattern
  - `percent` → **Percent values are stored as 0–100 (user-facing). Divide by 100 before formatting** — e.g. `formatTaxRate(Number(raw) / 100)` or equivalent locale-safe path; add that exact sentence as an inline comment on the branch.
- **Value resolution:** `const raw = item.data?.[col.id] ?? legacyFallback(item, col.id)` where `legacyFallback` maps well-known ids to `item.leistung`, etc. **Temporary until typed columns dropped.**

**Modify:** [AngebotPdfDocument.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx)

- Resolve `columnSchema` in this **strict order** (add a single comment block above the resolver):
  1. **`angebot.table_schema_snapshot`** — primary for all offers that have it (Phase 2a+).
  2. **`angebot.pdf_column_override` → map to `AngebotColumnDef[]`** — **only when `table_schema_snapshot` is null** (pre–Phase 2a / legacy rows). Implement a small helper that turns legacy `AngebotColumnProfile` + `ANGEBOT_COLUMN_CATALOG` labels/widths into schema-shaped defs if needed.
  3. **`ANGEBOT_STANDARD_COLUMN_PROFILE` + `ANGEBOT_COLUMN_CATALOG`** — final fallback when both snapshot and override are absent.
  - Comment block text (required): *"Precedence: table_schema_snapshot (Phase 2a+) → pdf_column_override (legacy, pre–Phase 2a offers only) → standard profile fallback. Remove step 2 once all offers have a snapshot."*
- Pass `columnSchema` into `AngebotPdfCoverBody`.

**Modify:** [use-angebot-builder-pdf-preview.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/use-angebot-builder-pdf-preview.tsx) (not in original read list but **required** for preview parity)

- Extend params to accept resolved `columnSchema` / `table_schema_snapshot` for draft angebot; ensure `draftAngebot` line items include `data` for preview.

### Inline comment requirements (Part 5)

- **Precedence block** for `columnSchema` resolution (snapshot → legacy `pdf_column_override` → standard) as specified above — ties **Resolved decisions** §5.
- Every fallback branch (`table_schema_snapshot` null, `data[col]` missing, typed column fallback) explains **what**, **why**, **removal condition**.
- **`percent` branch**: must include *"Percent values are stored as 0–100 (user-facing). Divide by 100 before formatting."* (**Resolved decisions** §2).
- Note PostgREST may return `data` as stringified JSON — if observed, add coercion helper with comment (mirror `coerceLineItemJsonbSnapshots` rationale from [pdf-column-layout.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/invoice-pdf/pdf-column-layout.ts) L90–113).

---

## Part 6 — Dynamic Step 2 UI + builder hook

**Modify:** [step-2-positionen.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/step-2-positionen.tsx)

### New props

```ts
export interface Step2PositionenProps {
  columnSchema: AngebotColumnDef[];
  items: BuilderLineItem[];
  onUpdate: (index: number, patch: Partial<BuilderLineItem>) => void;
  // ... onDelete, onReorder, onAdd unchanged
}
```

- Inside `SortableCard`, map `columnSchema` → inputs:
  - `text` → `<Input type="text" />` — comment: free text, no step
  - `integer` → `<Input type="number" step={1} />` — comment: whole numbers only
  - `currency` | `currency_per_km` → `<Input type="number" step="0.01" min={0} />` — comment: aligns with € inputs today
  - `percent` → `<Input type="number" step={0.1} min={0} max={100} />` — comment: **Storage is 0–100; no conversion needed on input.** (**Resolved decisions** §2)
- Bind `value` from `item.data[col.id]`; `onChange` merges into `item.data` via `onUpdate(index, { data: { ...item.data, [col.id]: parsed } }) }`.
- **Empty schema:** show `"Keine Spalten definiert — bitte zuerst eine Angebotsvorlage auswählen."`
- Keep dnd-kit row reorder and add/delete behavior ([step-2-positionen.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/step-2-positionen.tsx) L188–234).

**Modify:** [use-angebot-builder.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/hooks/use-angebot-builder.ts)

- Extend `BuilderLineItem` with `data: Record<string, string | number | null>`.
- `newEmptyLineItem`: `data: {}`.
- `addLineItem` / `deleteLineItem` / `reorderLineItems`: preserve `data` per row.
- `updateLineItem`: deep-merge `data` when patch contains `data`.
- `lineItemsFromAngebotRows`: hydrate `data` from DB; if empty, build from legacy typed columns using `ANGEBOT_LEGACY_COLUMN_IDS`.
- **`columnSchema` in hook API:** Pass `columnSchema: AngebotColumnDef[]` into `useAngebotBuilder` options (resolved in `AngebotBuilder` from selected Vorlage query). The hook **returns** the same `columnSchema` alongside line item mutators so consumers (Step 2, payload builders) can destructure one object. **Do not** duplicate-fetch the Vorlage inside the hook unless builder state is refactored away.

**Modify:** [index.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/index.tsx)

- Replace `pdfColumnProfile` / `ANGEBOT_STANDARD_COLUMN_PROFILE` usage for preview with **`table_schema_snapshot` resolution**:
  - Edit mode: load from `initialAngebot.table_schema_snapshot`.
  - Create mode: derive from selected template columns.
- `draftAngebot` line items must include `data` (currently only typed fields — [index.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/index.tsx) L211–220).
- `lineItemsPayload`: include `data` only (stop sending deprecated typed columns for **new** saves — aligns with Part 9).
- **Edit save (`saveEditMutation` header):** do **not** include `angebot_vorlage_id`, `table_schema_snapshot`, or `pdf_column_override` — they are immutable after creation (Part 9 / **Resolved decisions** §4–§5). Remove current `pdf_column_override: pdfColumnProfile` from the edit path once snapshot-driven preview is wired.
- `section2Complete`: **if `columnSchema.length === 0` → false.** Otherwise find the **first** column in `columnSchema` where `type !== 'integer'`; require **at least one row** with a non-empty `data[col.id]` (after trim / null check). If **every** column is `integer`, fall back: **at least one row** has any non-empty value in `data` for any column id. Add inline comment: *integer columns (e.g. Pos.) are skipped as the primary “description” signal; first non-integer is the Leistung-equivalent.* (**Resolved decisions** §3)

### Inline comment requirements (Part 6)

- Each input `type`/`step`/`min`/`max` has a one-line rationale comment.
- Template change reset: comment that switching schema clears rows to avoid key collisions (**create mode only** in Phase 2a — see Part 7).
- `section2Complete`: comment documenting first non-integer column rule + all-integer fallback (**Resolved decisions** §3).

---

## Part 7 — Template selection in Step 3

**Modify:** [step-3-details.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-builder/step-3-details.tsx)

- Add props: `companyId`, `selectedVorlageId`, `onVorlageChange`, `hasLineDataDirty`, **`isEditMode: boolean`** (true when `initialAngebot` is set), **`lockedVorlageLabel?: string`** (optional display name when locked).
- `useQuery({ queryKey: angebotKeys.vorlagen.list(companyId), queryFn: () => listAngebotVorlagen(companyId) })`.
- `<Select>`: auto-pick row where `is_default` on first load (comment: matches invoice patterns).
- **Phase 2a — template locked after creation:** when `isEditMode`, render `<Select disabled>` (or read-only `Input` showing current template name) with **`Tooltip`**: *"Die Vorlage kann nach dem Erstellen nicht mehr geändert werden."* No `onVorlageChange` in edit mode.
- **Create mode only:** on template change, if existing row data non-empty, `toast.warning` with exact German copy from spec; parent resets `lineItems`.
- Link “Vorlagen verwalten →”: point to `/dashboard/abrechnung/angebot-vorlagen`; if route not deployed yet, use `Button variant="link" disabled` + `Tooltip` (“Demnächst”) — **after Part 8 route exists, enable**.

**Modify:** `AngebotBuilder` to wire Step 3 outputs into schema + line reset.

### Inline comment requirements (Part 7)

- Reference `angebotKeys.vorlagen.list` next to `useQuery`.
- Explain why template change clears `lineItems` (comment in parent handler — **create flow only**; edit flow cannot change template per **Resolved decisions** §4).
- **Disabled Select + Tooltip** in edit mode: inline comment referencing Phase 2a lock.

---

## Part 8 — Angebotsvorlagen settings page + nav

**New route:** [src/app/dashboard/abrechnung/angebot-vorlagen/page.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/app/dashboard/abrechnung/angebot-vorlagen/page.tsx)  
Mirror [vorlagen/page.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/app/dashboard/abrechnung/vorlagen/page.tsx): auth, `accounts.company_id`, render client page component.

**New components (suggested split):**

- `src/features/angebote/components/angebot-vorlagen/angebot-vorlagen-settings-page.tsx` — list + editor shell (mirror [pdf-vorlagen-settings-page.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/pdf-vorlagen/pdf-vorlagen-settings-page.tsx)).
- `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx` — name, description, default checkbox, column editor, live width preview calling `calcAngebotColumnWidths`.
- `src/features/angebote/components/angebot-vorlagen/sortable-angebot-column-list.tsx` — reuse pattern from [sortable-pdf-column-list.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/components/pdf-vorlagen/sortable-pdf-column-list.tsx) (dnd-kit); items are `AngebotColumnDef` (id + header + …).
- **Add column UX:** inline form: header string, `Select` type, weight `Slider` 1–5 (default 2 maps to `weight: 2`), required toggle — on submit, `crypto.randomUUID()` for new `id`.

**Nav:** [src/config/nav-config.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/config/nav-config.ts) — under Abrechnung children near “Vorlagen”, add `{ title: 'Angebotsvorlagen', url: '/dashboard/abrechnung/angebot-vorlagen' }`.

- **Immutability note (UX copy / dev comment):** editing or deleting a template in this settings UI **does not change** existing offers — each `angebote` row keeps its own `table_schema_snapshot` (**Resolved decisions** §4). Surface this in editor help text or a short muted note under the save button.

### Inline comment requirements (Part 8)

- Document minimum 1 column guard vs delete on chips.
- Live preview: comment that widths are **pt** from `calcAngebotColumnWidths`, show % = `width / 515`.
- **Template vs issued offers:** comment or UI string that live template edits do not retroactively alter saved Angebote (snapshot isolation).

---

## Part 9 — createAngebot API update

**Modify:** [angebote.api.ts](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/api/angebote.api.ts)

- `createAngebot` insert payload includes:
  - `angebot_vorlage_id: payload.angebotVorlageId ?? null`
  - `table_schema_snapshot: payload.tableSchemaSnapshot` (JSON array)
  - **`pdf_column_override: null` explicitly** — comment: *"Explicitly null — new offers use `table_schema_snapshot`. `pdf_column_override` is a legacy field for pre–Phase 2a rows."* (**Resolved decisions** §5)
- Line insert shape:
  - `data: item.data` (json)
  - Typed columns: insert **null or empty** with comment “deprecated; not used for new rows”
- `replaceAngebotLineItems`: same for edit flow (line `data` only; typed columns deprecated).
- **`updateAngebot`:** must **never** write `angebot_vorlage_id`, `table_schema_snapshot`, or `pdf_column_override` — strip them from `UpdateAngebotPayload` / ignore if passed. Inline comment: *"Template and schema snapshot are immutable after creation. Only line item data and metadata fields are updated here."* (**Resolved decisions** §4). Header edits (recipient, subject, texts, etc.) continue to use this function.

### Inline comment requirements (Part 9)

- Comment block on snapshot + template id **immutable after insert** (Phase 2a); tie to **Resolved decisions** §4.
- **`pdf_column_override: null`** on create: comment ties to **Resolved decisions** §5.
- Every Supabase `.insert` for line items references `data` keys rule.

---

## Part 10 — Docs update checklist

| Doc | Change |
|-----|--------|
| [docs/angebote-module.md](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/docs/angebote-module.md) | Replace “Column profile system” with `AngebotColumnDef`, `angebot_vorlagen`, `table_schema_snapshot`, `data` jsonb; fix salutation vs [AngebotPdfCoverBody.tsx](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx); document weight-based widths (515pt); add template lifecycle + line item data model + legacy IDs. |
| [docs/pdf-vorlagen.md](/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/docs/pdf-vorlagen.md) | Fix `text[]` → `jsonb` for column arrays; add “Reuse in Angebote” (patterns/components vs domain tables). |
| **New:** `docs/angebote-vorlagen.md` | Full spec: DB tables, JSON schema, cascade (snapshot → template row → company default → system), width algorithm, route map, component map, RLS. |

---

## Open questions

All items **resolved** — see **[Resolved decisions](#resolved-decisions)**.

1. **Default template seed scope** — **Resolved:** seed for all `public.companies` with `NOT EXISTS` guard (§1).
2. **Percent storage format** — **Resolved:** store 0–100; divide by 100 in PDF `renderCell` (§2).
3. **`section2Complete` rule** — **Resolved:** first non-integer column across rows, with all-integer fallback (§3).
4. **Template after create** — **Resolved:** locked in Phase 2a; `updateAngebot` does not touch template/snapshot (§4).
5. **`pdf_column_override`** — **Resolved:** snapshot primary; legacy override when snapshot null; `createAngebot` sets override null (§5).

---

## Reference diagram (template → builder → PDF)

```mermaid
flowchart LR
  angebot_vorlagen[angebot_vorlagen]
  builder[AngebotBuilder]
  snapshot[angebote.table_schema_snapshot]
  lineData[angebot_line_items.data]
  pdf[AngebotPdfDocument]

  angebot_vorlagen -->|pick template| builder
  builder -->|save copy| snapshot
  builder -->|rows| lineData
  snapshot --> pdf
  lineData --> pdf
```
