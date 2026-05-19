# Global / Default Tax Rate — Audit (Angebote Summenblock)

**Date:** 2026-05-19  
**Question:** Does a global or default tax rate already exist in the data model that could be passed to `computeRow` as a fallback when no per-row `tax_rate` column is present in `columnSchema`?

**Files read:**

- `src/features/angebote/types/angebot.types.ts`
- `supabase/migrations/` (92 files listed; all `angebote*` / `angebot*` migrations reviewed; three most recent migrations read in full)
- `src/features/angebote/api/angebote.api.ts`
- `src/features/company-settings/types/company-settings.types.ts`
- `supabase/migrations/20260331110000_create_company_profiles.sql`
- `src/features/angebote/hooks/use-angebot-builder.ts`
- `src/features/angebote/api/angebot-vorlagen.api.ts`
- `src/features/angebote/lib/angebot-formula-engine.ts`
- `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`

---

## Migration inventory (`supabase/migrations/`)

**Total:** 92 SQL migration files (alphabetical/chronological mix; newest by timestamp prefix below).

**Three most recent (read in full — unrelated to Angebote tax):**

| File | Purpose |
|------|---------|
| `20260514160000_trip_presets_column_order.sql` | Adds `column_order jsonb` to `trip_presets` |
| `20260514150000_trip_presets.sql` | Creates `trip_presets` (saved trips list views) |
| `20260514130000_trips_performance_indexes.sql` | Composite indexes on `trips` |

**All Angebot-related migrations (tax-relevant review):**

| Migration | Tax-related content |
|-----------|---------------------|
| `20260409150000_create_angebote.sql` | Creates `angebote` / `angebot_line_items` — **no tax rate columns** |
| `20260413120000_angebot_flexible_table.sql` | `angebot_vorlagen`, `table_schema_snapshot`, `data` jsonb — **no tax rate on header** |
| `20260414100000_angebot_column_presets.sql` | Preset migration on `columns` JSON — **no `role` / tax fields on table** |
| `20260505102500_angebot_totals_labels.sql` | `totals_label_*` text only |
| `20260505115400_angebot_show_totals_block.sql` | `show_totals_block boolean` |
| `20260505131500_angebot_input_mode.sql` | `input_mode` — comment mentions row `tax_rate` **role**, not a DB column |

No migration adds `tax_rate`, `mwst`, `mwst_satz`, `vat_rate`, `default_tax_rate`, or `steuer` to `angebote`, `angebot_vorlagen`, or `angebot_line_items`.

---

## 1. `angebote` table — is there a tax rate field?

### TypeScript: `AngebotRow`

**File:** `src/features/angebote/types/angebot.types.ts`  
**Type:** `AngebotRow` (L119–157)

Header fields on a quote:

```119:157:src/features/angebote/types/angebot.types.ts
export interface AngebotRow {
  id: string;
  company_id: string;
  angebot_number: string;
  status: AngebotStatus;
  input_mode: 'net' | 'gross';
  show_totals_block: boolean;
  totals_label_net: string | null;
  totals_label_tax: string | null;
  totals_label_gross: string | null;
  // ... recipient + meta fields ...
  angebot_vorlage_id: string | null;
  table_schema_snapshot: AngebotColumnDef[] | null;
  pdf_column_override: AngebotColumnProfile | null;
  created_at: string;
  updated_at: string;
}
```

**Finding:** No `tax_rate`, `mwst`, `default_tax_rate`, or similar on the offer row. Tax is only expressible via:

- A column in `table_schema_snapshot` with `role: 'tax_rate'` and per-row values in `line_items[].data[col.id]`, or
- Engine-derived `__tax_amount__` after `computeRow` (which still requires resolving `tax_rate` from schema + row data).

### SQL: initial + follow-up migrations

**Create** — `supabase/migrations/20260409150000_create_angebote.sql` (L16–49): recipient fields, `subject`, `offer_date`, `intro_text`, `outro_text`, `pdf_column_override` only.

**Later columns on `angebote`:**

- `angebot_vorlage_id`, `table_schema_snapshot` — `20260413120000_angebot_flexible_table.sql`
- `show_totals_block` — `20260505115400_angebot_show_totals_block.sql`
- `totals_label_net` / `totals_label_tax` / `totals_label_gross` — `20260505102500_angebot_totals_labels.sql` (`totals_label_tax` is a **label string**, not a rate)
- `input_mode` — `20260505131500_angebot_input_mode.sql`

### API create/update

**File:** `src/features/angebote/api/angebote.api.ts` (L275–319)

Insert payload includes `input_mode`, `show_totals_block`, `totals_label_*`, `table_schema_snapshot` — **no tax rate field**.

**Verdict:** **No** quote-level tax rate in DB or types.

---

## 2. Vorlage / template — is there a tax rate field?

### TypeScript: `AngebotVorlageRow`

**File:** `src/features/angebote/types/angebot.types.ts` (L92–101)

```92:101:src/features/angebote/types/angebot.types.ts
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
```

Tax can only appear **inside** `columns[]` as:

- `role: 'tax_rate'` on one column definition, and/or
- `preset: 'percent'` on a column (layout only — **not** auto-assigned as `tax_rate` role).

### SQL: `angebot_vorlagen`

**File:** `supabase/migrations/20260413120000_angebot_flexible_table.sql` (L8–33)

```sql
CREATE TABLE public.angebot_vorlagen (
  id           uuid PRIMARY KEY ...,
  company_id   uuid NOT NULL REFERENCES public.companies(id) ...,
  name         text NOT NULL,
  description  text,
  is_default   boolean NOT NULL DEFAULT false,
  columns      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ...
);
```

No top-level `default_tax_rate` / `mwst_satz` column on the template table.

**Default seed template** (same migration, L107–156): five legacy columns (`col_leistung`, `col_anfahrtkosten`, …) with **no `role` field** in the seed JSON — matches the “Standard” Vorlage that cannot drive MwSt totals without admin role assignment.

### API

**File:** `src/features/angebote/api/angebot-vorlagen.api.ts` — maps `columns` via `angebotColumnDefArraySchema`; no separate tax field on create/update.

**Verdict:** **No** Vorlage-level default tax rate. Only per-template **column schema** (optional `role: 'tax_rate'` per column).

---

## 3. Company / profile — is there a global tax rate field?

### TypeScript: `CompanyProfile`

**File:** `src/features/company-settings/types/company-settings.types.ts` (L25–67)

Tax-related fields:

```38:40:src/features/company-settings/types/company-settings.types.ts
  // Tax identifiers — at least one must be set for valid invoices
  tax_id: string | null; // Steuernummer (e.g. "123/456/78901")
  vat_id: string | null; // USt-IdNr (e.g. "DE123456789")
```

Other defaults: `default_payment_days` (invoice Zahlungsziel) — **not** a VAT percentage.

### SQL: `company_profiles`

**File:** `supabase/migrations/20260331110000_create_company_profiles.sql` (L49–59)

```sql
  tax_id   TEXT,   -- Steuernummer
  vat_id   TEXT,   -- USt-Identifikationsnummer
  ...
  default_payment_days  INTEGER NOT NULL DEFAULT 14,
```

Comments describe **identifiers** for §14 UStG invoices, not an applicable MwSt **percentage** for pricing.

**Verdict:** **No** company-wide default MwSt-Satz (7% / 19%) for offers. `tax_id` / `vat_id` are registration numbers, not rates.

**Related (out of scope for Angebote):** Invoices use per-line `tax_rate` on `invoice_line_items` (decimal 0.07 / 0.19) and trip pricing — different module, not wired to `computeRow` for Angebote.

---

## 4. `use-angebot-builder.ts` — is tax rate state managed anywhere?

**File:** `src/features/angebote/hooks/use-angebot-builder.ts`

State owned by the hook:

| State | Purpose |
|-------|---------|
| `lineItems` | Per-row `data` map (column ids → values) |
| `inputMode` | `'net' \| 'gross'` |
| `showTotalsBlock` | Summenblock on/off |
| `totalsLabelNet` / `totalsLabelTax` / `totalsLabelGross` | PDF row **labels** only |
| `columnSchema` | Passed in from parent (Vorlage / snapshot) |

```34:36:src/features/angebote/hooks/use-angebot-builder.ts
export const DEFAULT_TOTALS_LABEL_NET = 'Summe Netto';
export const DEFAULT_TOTALS_LABEL_TAX = 'zzgl. MwSt';
export const DEFAULT_TOTALS_LABEL_GROSS = 'Gesamtbetrag (Brutto)';
```

`DEFAULT_TOTALS_LABEL_TAX` is copy for the totals block label, **not** a numeric rate.

**Grep** for `taxRate`, `tax_rate`, `mwstSatz`, `steuer`, `vat` in this file: **no matches** except `DEFAULT_TOTALS_LABEL_TAX` (string constant).

Tax rate values live only in `lineItems[i].data[columnId]` when the Vorlage includes a `tax_rate` role column and the user fills it (via `updateLineItemWithComputed` in the parent builder).

**Verdict:** **No** separate builder state for a global or quote-level tax rate.

---

## 5. `computeRow` signature — fallback tax rate today?

**File:** `src/features/angebote/lib/angebot-formula-engine.ts`  
**Function:** `computeRow`

### Current signature

```107:111:src/features/angebote/lib/angebot-formula-engine.ts
export function computeRow(
  row: RowData,
  columns: AngebotColumnDef[],
  inputMode: InputMode = 'net'
): RowData {
```

**Parameters today:**

1. `row` — cell map keyed by column id  
2. `columns` — schema; `resolveRoleValues` reads `row[col.id]` only for columns that have `role` set  
3. `inputMode` — optional, default `'net'` (gross-input conversion only)

**No** `options`, `defaults`, or `fallbackTaxRate` parameter.

### How tax is resolved internally

```112:115:src/features/angebote/lib/angebot-formula-engine.ts
  const v = resolveRoleValues(row, columns);
  ...
  const taxRate = v.tax_rate;
```

```161:166:src/features/angebote/lib/angebot-formula-engine.ts
  const taxAmount =
    netAmount === null || v.tax_rate === null || v.tax_rate === undefined
      ? null
      : netAmount * (v.tax_rate / 100);
  const grossAmount =
    netAmount === null ? null : netAmount * (1 + (v.tax_rate ?? 0) / 100);
```

- `tax_rate` must come from a column with `role === 'tax_rate'` in `columns` and a parseable value in `row[col.id]`.
- If missing: `tax_amount` / `__tax_amount__` are `null`; `gross` uses `(v.tax_rate ?? 0)` so gross can equal net when rate is absent (not the same as “19% applied”).

### What would need to change for a fallback

Minimal options (not implemented):

1. **Fourth parameter** e.g. `defaultTaxRatePercent: number | null` — after `resolveRoleValues`, set `v.tax_rate ??= defaultTaxRatePercent` when column role absent.
2. **Options object** — `{ inputMode?, defaultTaxRate? }` for forward compatibility.
3. **Caller-side patch** — merge `{ [syntheticTaxColId]: 19 }` into `row` before `computeRow` without engine changes (fragile; needs a column id or engine change anyway).

Call sites to update: `angebot-builder/index.tsx` (`updateLineItemWithComputed`), `AngebotPdfDocument.tsx` (totals materialisation), tests in `angebot-formula-engine.test.ts`.

**Verdict:** **No** fallback today; extension is a small, explicit API change plus a persisted or configured rate source.

---

## 6. UI inputs for tax rate outside the column table?

**Search scope:** `src/features/angebote/` for MwSt / Steuer / tax / vat outside per-row column cells.

### Found — not a global rate control

| Location | What it is |
|----------|------------|
| `step-2-positionen.tsx` L789 | Summenblock toggle label text: “Netto / MwSt / Brutto” |
| `step-2-positionen.tsx` L805 | Label input: **“MwSt-Zeile”** (customises PDF row title, not rate) |
| `step-2-positionen.tsx` L67–77, L396, L447 | `hasTaxRateValue` + warnings when **Brutto-Eingabe** is on but row has no `tax_rate` column value |
| `angebot-vorlage-editor-panel.tsx` | **Role** picker per column (`tax_rate` as column role) — defines schema, not a single global % |
| `angebot-column-presets.ts` L181–185 | `ANGEBOT_COLUMN_ROLE_UI.tax_rate` metadata for Vorlage editor |
| `angebot-builder/index.tsx` L590 | Hint to set company **Steuernummer** (`tax_id`) for PDF header — not MwSt % |

### Per-row tax entry (in table)

When a Vorlage column has `role: 'tax_rate'` and `preset: 'percent'`, Step 2 renders a normal numeric input in the line-item card (`step-2-positionen.tsx` — same loop as other columns, not a separate global field).

### Not found

- No quote-level “Standard-MwSt-Satz” field in Step 1/2/3  
- No company-settings field for default VAT %  
- No disconnected form control storing a rate that `computeRow` could read today  

**Verdict:** **No** existing global tax-rate UI for Angebote. Only column-role assignment + per-row cells, plus Summenblock **label** customization.

---

## Exists or build from scratch?

**Build from scratch** (for a true global/quote-level fallback usable by `computeRow`).

There is **no** persisted field today that stores a default MwSt percentage for Angebote on:

- `angebote` (quote),
- `angebot_vorlagen` (template header),
- `company_profiles` (company),
- or `useAngebotBuilder` state.

The only working path is **operational/configuration**, not data inheritance:

1. Add a column with `role: 'tax_rate'` to the Angebotsvorlage (Vorlage editor → Rolle → “MwSt-Satz”, `preset: 'percent'`), so `table_schema_snapshot` includes that role and dispatchers enter % per row; **or**
2. Introduce a **new** persisted default (recommended targets: `angebote.default_tax_rate` and/or `angebot_vorlagen.default_tax_rate`, plus optional company-level `default_vat_percent` if product wants company-wide default), wire builder/PDF UI, extend `computeRow` (or pre-merge into `resolvedData`) with an explicit fallback parameter, and map it in `angebote.api.ts`.

`company_profiles.tax_id` / `vat_id` are **Steuernummer / USt-IdNr** — unsuitable as a numeric rate fallback without a separate field.

Until (1) or (2), Summenblock MwSt/Brutto will remain `—` when `resolveRoleValues` cannot find `tax_rate` — regardless of Fix 1 `computeRow` materialisation or `resolveRowDataForEngine`, because the engine correctly refuses to invent a rate.

---

## Resolution (2026-05-19)

**Status:** Resolved — option **(2)** from “Exists or build from scratch?” was implemented (quote-level field on `angebote`, engine options, Step 2 UI behind Summenblock toggle).

| Layer | Resolution |
|-------|------------|
| DB | Migration [`20260519103000_angebot_default_tax_rate.sql`](../../supabase/migrations/20260519103000_angebot_default_tax_rate.sql) adds nullable `angebote.default_tax_rate`. |
| Types / API | `default_tax_rate` on `AngebotRow`; create/update payloads accept `defaultTaxRate` (camelCase); [`angebote.api.ts`](../../src/features/angebote/api/angebote.api.ts) maps read/write. |
| Engine | `computeRow(row, columns, inputMode?, options?)` with `options.fallbackTaxRate`; **`resolveRoleValues` unchanged** — precedence applied after resolution inside `computeRow`. |
| Builder | [`use-angebot-builder.ts`](../../src/features/angebote/hooks/use-angebot-builder.ts) holds `defaultTaxRate`; Step 2 Summenblock section ([`step-2-positionen.tsx`](../../src/features/angebote/components/angebot-builder/step-2-positionen.tsx)) — input **only** when `showTotalsBlock`. |
| PDF | [`AngebotPdfDocument.tsx`](../../src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx) passes `fallbackTaxRate: angebot.default_tax_rate` into totals-path `computeRow`. |
| Tests | [`angebot-formula-engine.test.ts`](../../src/features/angebote/lib/angebot-formula-engine.test.ts) — fallback vs per-row precedence. |

**Remaining limits:** Net totals still require pricing inputs (`unit_price`, etc.) per formula engine rules. Per-row `tax_rate` still overrides the quote default when present.

**Docs:** [`docs/angebot-formula-engine.md`](../angebot-formula-engine.md), [`docs/angebote-module.md`](../angebote-module.md).
