# Totals Pipeline Audit — Vorlage → Row Engine → Summenblock

**Date:** 2026-05-19  
**Goal:** Trace the full path from Angebotsvorlage column definitions through per-row computation, totals aggregation, and PDF Summenblock rendering — and identify where “visible table columns” couples (or does not couple) to totals.

**Files read:**

- `src/features/angebote/lib/angebot-formula-engine.ts`
- `src/features/angebote/lib/angebot-column-presets.ts`
- `src/features/angebote/types/angebot.types.ts`
- `src/features/angebote/lib/angebot-auto-columns.ts`
- `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`
- `src/features/angebote/components/angebot-builder/index.tsx`
- `src/features/angebote/hooks/use-angebot-builder.ts`
- `docs/angebot-formula-engine.md`

---

## Part A — Angebotsvorlage and column system

### A1 — What column roles exist?

**Source of truth:** `angebotColumnRoleSchema` in `src/features/angebote/types/angebot.types.ts` (L45–60) and `ANGEBOT_COLUMN_ROLE_UI` in `src/features/angebote/lib/angebot-column-presets.ts` (L132–202).

| Role | Meaning | Input / computed | Required for non-null synthetics |
|------|---------|------------------|----------------------------------|
| `description` | Leistung / Streckenbeschreibung (text) | Input | No |
| `time` | Uhrzeit | Input | No |
| `days` | Wochentage | Input | No |
| `quantity` | Anzahl Fahrten / Einheiten | Input | No (multiplies base when present) |
| `distance_km` | Kilometer | Input | No for tax/gross; **yes for typical km×price net** (defaults to `0` if role absent) |
| `unit_price` | Einheitspreis (€ or €/km semantics in formula) | Input | **Yes for `__net_amount__`** (`computeNetAmount` returns null without it) |
| `flat_rate` | Pauschale | Input | No (adds to base when present) |
| `surcharge` | Zuschlag | Input | No |
| `tax_rate` | MwSt-Satz (percent 0–100) | Input | **Yes for non-null `__tax_amount__`**; gross uses `tax_rate ?? 0` when net exists |
| `net_amount` | Nettobetrag | Computed | No — synthetics written even if column absent |
| `tax_amount` | MwSt-Betrag | Computed | No — synthetics written even if column absent |
| `gross_amount` | Bruttobetrag | Computed | No — synthetics written even if column absent |

**Preset is independent of role:** A column can use `preset: 'betrag'` with `role: 'tax_rate'` (common pattern because `percent` preset is not in the admin “add column” list).

---

### A2 — What column presets exist?

**Source:** `COLUMN_PRESET_SPECS` + `COLUMN_PRESET_UI` in `src/features/angebote/lib/angebot-column-presets.ts`.

| Preset | `pdfRenderType` | Default associated role | Admin-selectable (`COLUMN_PRESET_UI`) |
|--------|-----------------|---------------------------|--------------------------------------|
| `beschreibung` | `text` | None (often `description` if admin assigns) | Yes |
| `betrag` | `currency` | None (often `unit_price`, `flat_rate`, `tax_amount`, …) | Yes |
| `preis_km` | `currency_per_km` | None (often distance/pricing columns) | Yes |
| `notiz` | `text` | None | Yes |
| `anzahl` | `integer` | None (often `quantity`) | Yes |
| `percent` | `percent` | None (intended for `tax_rate`; legacy) | **No** (`adminSelectable: false`) |

**Special layout override:** `resolveColumnLayout` (L243–260) forces `pdfRenderType: 'decimal'` when `col.role === 'distance_km'`, regardless of preset.

**There is no automatic mapping** from preset → role. Preset only affects UI control type, alignment, width, and PDF cell formatting.

---

### A3 — How does the Vorlage editor work?

**File:** `src/features/angebote/components/angebot-vorlagen/angebot-vorlage-editor-panel.tsx`

#### Adding a column

`handleAddColumn` (L255–274) appends:

```typescript
{
  id: crypto.randomUUID(),
  header: h.slice(0, 20),
  preset: newPreset,        // from admin Preset select (ADMIN_PRESETS only)
  required: newRequired,
  role: newRole ?? undefined // manual Role select — NOT derived from preset
}
```

Fields configured: **id** (generated), **header**, **preset**, **required**, **role** (optional).

#### Role assignment

- **Manual** via `RoleSelect` (L206–253): grouped “Eingabe” vs “Berechnet ⚙”.
- **Not** auto-assigned when preset changes (only header may auto-rename from preset via `defaultHeaderForPreset` elsewhere in list).
- Admin **can** assign computed roles (`net_amount`, `tax_amount`, `gross_amount`) to columns; builder then shows those cells read-only and engine fills them.

#### Duplicate roles

`duplicateRoles` (L157–168): counts roles across `editableColumns`; if count ≥ 2, UI warns “Diese Rolle ist bereits vergeben” — **save is not blocked**.

`resolveRoleValues` iterates `columns` in order; if two columns share `tax_rate`, **the later column in the array wins** when both have values (same key `result['tax_rate']` overwritten).

#### Minimum viable Vorlage for correct totals

Engine minimum (see B5):

1. **`unit_price`** role column + dispatcher enters a price.
2. **Non-zero net path:** at least one of:
   - `distance_km` role with km > 0 (typical km×price model), or
   - `flat_rate` / `surcharge` with non-zero value, or
   - `quantity` with base > 0 (base still needs `unit_price`).
3. **`tax_rate`** role column + value (including `0` for tax-exempt) for non-null **`__tax_amount__`**.

**Not required in Vorlage for totals:** `net_amount`, `tax_amount`, `gross_amount` **computed** columns — synthetics are always written by `computeRow` (B7).

**Practical minimum column set in table:** e.g. `description`, `distance_km`, `unit_price`, `tax_rate` — four roles, four visible columns. Admin does **not** need visible Netto/MwSt-Betrag/Brutto columns for the Summenblock to work.

---

### A4 — What is `table_schema_snapshot`?

**Type:** `AngebotRow.table_schema_snapshot: AngebotColumnDef[] | null` (`angebot.types.ts` L147–150).

#### When written

| Event | Location | What is stored |
|-------|----------|----------------|
| **Create offer** | `angebote.api.ts` `createAngebot` L309–316 | Full `payload.tableSchemaSnapshot` from builder (`columnSchema` at create time) |
| **Draft edit save** (optional refresh) | `updateDraftAngebotSchema` L402–414 | Live Vorlage columns passed as `liveColumnSchema` from builder hook |
| **Not updated** | `updateAngebot` | Explicitly immutable after create for non-draft flows |

Builder create payload (`index.tsx` L554):

```typescript
tableSchemaSnapshot: columnSchema,
```

`columnSchema` = selected Vorlage columns (create) or live Vorlage / snapshot (draft edit) — **not a subset**.

#### Filtering / visibility

- **No “visible only” flag** on `AngebotColumnDef`. Every column in the Vorlage list is stored.
- **`col_position` is excluded** from stored schema (`angebot-auto-columns.ts` L4–7; editor filters `ANGEBOT_POSITION_COLUMN_ID` L119–122).
- PDF/builder **inject** Pos. at render: `[ANGEBOT_POSITION_COLUMN, ...userColumns]`.

**Same schema** drives:

- Table rendering (`columnSchema` / `effectiveColumns`)
- `computeRow` / `computeAngebotTotals`
- `resolveRowDataForEngine`

There is **no** separate “totals schema” vs “display schema”.

---

## Part B — Per-row computation

### B5 — Minimum inputs for non-null synthetics

**Pipeline:** `resolveRoleValues(row, columns)` → `computeNetAmount(convertedV)` → tax/gross → synthetic patch.

#### `__net_amount__`

From `computeNetAmount` (L86–97):

```typescript
if (v.unit_price === null || v.unit_price === undefined) return null;
const distanceKm = v.distance_km ?? 0;
// base = distanceKm * v.unit_price + flatRate + surcharge
// × quantity if quantity role present
```

| Requirement | Detail |
|-------------|--------|
| **Schema** | Column with `role: 'unit_price'` |
| **Row data** | Finite number at `row[unit_price_col.id]` |
| **Non-zero net** | Need `distance_km×price + flat + surcharge` > 0 (if only `unit_price` and no km/flat/surcharge, **net = 0**) |

#### `__tax_amount__`

From L161–164:

```typescript
const taxAmount =
  netAmount === null || v.tax_rate === null || v.tax_rate === undefined
    ? null
    : netAmount * (v.tax_rate / 100);
```

| Requirement | Detail |
|-------------|--------|
| **Schema** | Column with `role: 'tax_rate'` |
| **Row data** | Finite tax % at `row[tax_col.id]` |
| **Net** | Non-null `netAmount` |

`tax_rate = 0` → **taxAmount = 0** (valid, not null).

#### `__gross_amount__`

From L165–166:

```typescript
const grossAmount =
  netAmount === null ? null : netAmount * (1 + (v.tax_rate ?? 0) / 100);
```

| Requirement | Detail |
|-------------|--------|
| **Net** | Non-null |
| **Tax rate** | If missing, uses **0%** → gross = net (tax line still null) |

---

### B6 — When `tax_rate` role is absent from `columnSchema`

1. `resolveRoleValues`: no column with `role === 'tax_rate'` → `v.tax_rate` is **`undefined`** (never set on `result`).
2. `taxAmount` = **`null`** (explicit check on L162–163).
3. `grossAmount` = if `netAmount` is a number, `netAmount * (1 + 0/100)` = **net** (not null).
4. Synthetics:

```typescript
patch[SYNTHETIC_NET_KEY] = netAmount;      // may be number or null
patch[SYNTHETIC_TAX_KEY] = taxAmount;      // null
patch[SYNTHETIC_GROSS_KEY] = grossAmount;  // often equals net when net present
```

Summenblock (Fix 2): MwSt row shows **`—`**; Netto and Brutto may show values.

---

### B7 — Output roles absent but input roles present

**Yes — synthetics are always written** (L187–191):

```typescript
// Always write synthetic totals keys regardless of schema columns
patch[SYNTHETIC_NET_KEY] = netAmount;
patch[SYNTHETIC_TAX_KEY] = taxAmount;
patch[SYNTHETIC_GROSS_KEY] = grossAmount;
```

The loop over `columns` (L168–185) only adds **visible column ids** for `net_amount` / `tax_amount` / `gross_amount` roles. Synthetics do **not** depend on those columns existing.

**Totals aggregation** prefers synthetics (`computeAngebotTotals` L247–251).

---

## Part C — Totals pipeline

### C8 — Trace: Vorlage `[description, distance_km, unit_price, tax_rate]` (no computed columns)

Assume column ids: `desc`, `km`, `unit`, `tax`. One row: 10 km, €2/km, 19% MwSt.

#### 1) After builder edit — `item.data`

`updateLineItemWithComputed` (`index.tsx` L240–252) merges:

```typescript
data: { ...mergedData, ...computeRow(mergedData, columnSchema, inputMode) }
```

Example shape:

```json
{
  "desc": "Fahrt A",
  "km": 10,
  "unit": 2,
  "tax": 19,
  "__net_amount__": 20,
  "__tax_amount__": 3.8,
  "__gross_amount__": 23.8
}
```

#### 2) `resolveRowDataForEngine(item, columnSchema)`

`AngebotPdfCoverBody.tsx` L585–604: `coerceLineItemData` + per-column `legacyFallback` if empty. Same keys as above for normal rows.

#### 3) `computeRow(resolvedData, columnSchema, inputMode)`

Recomputes same synthetics (idempotent if inputs unchanged): `__net_amount__`: 20, `__tax_amount__`: 3.8, `__gross_amount__`: 23.8.

#### 4) `rowsForTotals` merge (`AngebotPdfDocument.tsx` L172–177)

```typescript
{ ...resolvedData, ...computeRow(resolvedData, columnSchema, inputMode) }
```

#### 5) `computeAngebotTotals(rowsForTotals, columnSchema)`

Sums `__net_amount__` etc. across rows → e.g. `{ netTotal: 20, taxTotal: 3.8, grossTotal: 23.8 }`.

#### 6) Summenblock display

`AngebotPdfCoverBody` L520–549: three rows with `formatEur(...)` when totals non-null.

**Conclusion:** This Vorlage shape is **fully supported** without visible Netto/MwSt/Brutto columns.

---

### C9 — Trace: Vorlage `[description, unit_price]` only

Example: `unit` = 50, no km column, no tax column.

#### `resolveRoleValues`

- `unit_price` = 50
- `distance_km` **undefined** → treated as **0** in `computeNetAmount`

#### `computeNetAmount`

`base = 0 * 50 + 0 + 0 = 0` → **`netAmount = 0`**

#### Synthetics

- `__net_amount__`: **0**
- `__tax_amount__`: **null** (no `tax_rate` role)
- `__gross_amount__`: **0** (net × 1.0)

#### Summenblock

- Netto: **€0,00**
- MwSt: **—**
- Brutto: **€0,00**

**This is not a data-resolution bug** — the engine treats missing `distance_km` as 0 km, so a lone `unit_price` does not produce a line total unless flat_rate/surcharge/quantity supplies base.

---

### C10 — Where does “visible columns = totals columns” coupling occur?

**No explicit filter** such as “displayed columns only” before `computeRow` or `computeAngebotTotals`.

**Single schema everywhere:**

```typescript
const columnSchema = resolveAngebotPdfColumnSchema(angebot);
// used for: PDF table, resolveRowDataForEngine, computeRow, computeAngebotTotals
```

**Implicit coupling (design):**

| Mechanism | Effect |
|-----------|--------|
| Role must exist **on a column in `columnSchema`** | `resolveRoleValues` only reads roles declared on stored columns |
| No quote-level `tax_rate` | No fallback if admin omits MwSt column |
| `computeNetAmount` formula | Requires `unit_price` role; km defaults to 0 |
| Legacy Vorlagen without roles | Engine sees no roles → all synthetics null (except gross=net when net somehow set) |

**Not coupling:** Hiding `net_amount` / `gross_amount` **computed** columns from the table does **not** hide totals — synthetics still computed (Phase 4b).

**Coupling that remains:** Hiding **`tax_rate`** (never adding the role) → no MwSt total. Hiding **`unit_price`** → no net.

---

## Part D — The real question

### D11 — Missing-data vs missing-column vs both

| Totals line | Category | Why | Minimal fix |
|-------------|----------|-----|-------------|
| **Netto** | **Both** | **Missing-column:** no `unit_price` role → null net. **Missing-data:** role present but empty / legacy row only in typed fields without resolution → null until edit (mitigated by `resolveRowDataForEngine`). **Formula:** `unit_price` only without km/flat → net 0 | Assign `unit_price` (+ usually `distance_km` or flat) in Vorlage; enter values; ensure PDF uses `resolveRowDataForEngine` |
| **MwSt** | **Missing-column** (primary) | `tax_rate` role must exist in `columnSchema` and row must have a value; no global fallback | Add Vorlage column with `role: 'tax_rate'` (preset `betrag` or legacy `percent`) **or** introduce quote-level default rate + engine fallback (new feature) |
| **Brutto** | **Missing-column** (tax) + **depends on net** | Needs non-null net; uses `tax_rate ?? 0` so can equal net without tax role | Same as MwSt + net inputs |

**After recent fixes:** Wrong `—` with **correct table numbers** is mostly **missing-column (roles)** or **formula inputs (km×price)**, not failure to sum visible computed columns.

---

### D12 — Simplest Vorlage for correct non-null totals

**Roles that must exist in `angebot_vorlagen.columns` / `table_schema_snapshot`:**

| Role | Visible in table? | Purpose |
|------|-------------------|---------|
| `unit_price` | Yes (recommended) | Enables net calculation |
| `distance_km` | Yes (typical) | Non-zero km×price net |
| `tax_rate` | **Yes** (required for MwSt line) | MwSt % per row |

Optional: `description`, `quantity`, `flat_rate`, `surcharge` as needed.

**Roles NOT required in table for Summenblock:**

- `net_amount`, `tax_amount`, `gross_amount` — engine synthetics only.

**Forced-visible column for MwSt today:**

- Admin must include a **`tax_rate`** column in the Vorlage if dispatchers should enter % per row and Summenblock should show MwSt.
- There is **no** hidden/global rate; **yes**, admin must expose a column (or build a new default-rate feature).

**Standard seed Vorlage** (`20260413120000_angebot_flexible_table.sql`): legacy columns **without roles** → Summenblock will not work until roles are assigned in the Vorlage editor.

---

## Root cause and minimal fix

The Summenblock is **not** tied to whether Netto/MwSt/Brutto appear as table columns: `computeRow` always writes `__net_amount__`, `__tax_amount__`, and `__gross_amount__`, and `computeAngebotTotals` sums those keys after PDF materialisation via `resolveRowDataForEngine` + `computeRow`. The real break is **semantic configuration of the frozen schema**, not PDF column visibility: totals need **`unit_price`** (and usually **`distance_km`** or flat/surcharge for non-zero net) plus **`tax_rate`** as **roles on columns in `table_schema_snapshot`**, with values in `line_items.data` (or legacy fields resolved by `resolveRowDataForEngine`). When admins omit `tax_rate` from the Vorlage — as in the default “Standard” template without role assignment — `__tax_amount__` is null and the Summenblock shows **—** for MwSt regardless of Fix 1/2.

**Smallest correct fix without new product features:** operational — in Angebotsvorlagen settings, assign roles on the Standard template (at minimum `unit_price`, `distance_km` or pricing model via flat_rate, and `tax_rate`), save, and use/create offers from that template so `table_schema_snapshot` includes those roles. **Smallest code fix if admins must not show MwSt in the table:** add a quote-level `default_tax_rate` (or hidden system column injected only at compute time) — that does not exist today and is a new DB/UI/engine change, not a Summenblock rendering tweak.
