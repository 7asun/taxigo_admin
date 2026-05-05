# Angebot Formula Engine — Architecture & Roles

This document describes the planned role-based formula engine for Angebote (quotes). **Phase 1** introduces the data model (`AngebotColumnRole`) and persistence wiring only; no UI or computations yet.

---

## Architecture overview

- **Column schema** lives in two places:
  - **Template**: `angebot_vorlagen.columns` (JSONB array of `AngebotColumnDef`)
  - **Snapshot**: `angebote.table_schema_snapshot` (frozen copy written at offer creation; draft offers may refresh the snapshot)
- **Line item values** are stored dynamically in `angebot_line_items.data` keyed by `AngebotColumnDef.id`.
- **Preset (`preset`)** is a **presentation concern**: input control type, alignment, PDF render formatting, and column width via `resolveColumnLayout`.
- **Role (`role`)** is a **semantic concern**: it identifies what a column *means* (e.g. `distance_km`, `tax_rate`, `net_amount`) so an engine can infer calculations without user-entered formula strings.
- **Formula (`formula`)** remains a separate “escape hatch” field reserved for future custom expressions (not evaluated today).

### Compute-at-render-time vs persist

For Phase 3, computed values can be produced either:
- **At render time** (UI/PDF): derive values from the current row inputs and the schema roles.
- **At persist time** (snapshot): write computed outputs into `data` before saving so PDFs always match exactly.

Phase 1 does not choose between these; it only enables storing the semantic information (`role`) alongside the schema.

### Snapshot rationale

Angebote keep a frozen schema snapshot (`angebote.table_schema_snapshot`) so:
- PDFs remain stable even if templates change later.
- Draft-only schema refresh can safely adopt newly added columns while editing a draft.

---

## Role reference (Phase 2b/3)

All roles are optional. `null`/`undefined` means “no semantic role assigned”.

### Input roles (admin-entered)

- **`description`**: Leistung / Strecke (text). Typical preset: `beschreibung`.\n
- **`time`**: Uhrzeit (text). Typical preset: `notiz`.\n
- **`days`**: Tage / Wochentage (text). Typical preset: `notiz`.\n
- **`quantity`**: Anzahl Fahrten / Einheiten (integer). Typical preset: `anzahl`.\n
- **`distance_km`**: Kilometer (decimal). Typical preset: (future) currency/number-like; today closest is `betrag` (numeric input) but semantics come from role.\n
- **`unit_price`**: Preis pro Einheit (currency). Typical preset: `betrag`.\n
- **`flat_rate`**: Pauschale (currency). Typical preset: `betrag`.\n
- **`surcharge`**: Zuschlag (currency). Typical preset: `betrag`.\n
- **`tax_rate`**: MwSt-Satz (percent). Typical preset: `percent` (currently legacy / not admin-selectable).

### Computed roles (engine-derived; read-only)

- **`net_amount`**: Nettobetrag.\n
- **`tax_amount`**: MwSt-Betrag.\n
- **`gross_amount`**: Bruttobetrag.\n

Computed roles should be rendered read-only in the builder and derived from other roles in the same row (Phase 3).

---

## Computation hierarchy (Phase 3+)

When producing a value for a cell, the intended precedence is:

1. **`formula`** is set → evaluate expression (future; custom override)\n
2. **`role`** is set → infer from role combination (engine)\n
3. Neither set → manual input, read directly from `data[col.id]` (current behavior)\n

---

## Phase status

- **Phase 1 (done here)**: add `AngebotColumnRole` to `AngebotColumnDef` and wire through normalization + persistence.\n
- **Phase 2 (done here)**: Vorlage editor UI (role picker + duplicate warning + role badges).\n
- **Phase 3 (done here)**: formula engine + builder reactivity + computed/read-only columns.\n
- **Phase 4 (done here)**: PDF totals block (opt-in via `show_totals_block`).
- **Phase 6 (done here)**: Quote-level input mode toggle (Netto/Brutto) via `angebote.input_mode` and gross-mode reinterpretation in `computeRow`.

---

## Phase 2 — Vorlage Editor UI

Phase 2 exposes `AngebotColumnRole` in the Angebotsvorlage editor so admins can assign semantic roles per column. The roles remain **inert**: there is no evaluation, no read-only enforcement, and no totals logic yet.

### Where roles can be set

- **Add form (“Spalte hinzufügen”)**: new “Rolle (optional)” select between Preset and Pflichtfeld.
- **Inline edit list**: per-column “Rolle (optional)” select next to the Preset select.

### Select structure

- **Top option**: “Keine Rolle” (stored as `undefined` on the column; UI uses `null`).
- **Grouped options**:
  - “Eingabe” (admin-entered roles)
  - “Berechnet ⚙” (computed roles; visually muted)

### Duplicate role warning

If the same role is assigned to 2+ columns, each affected column shows a soft warning:
“Diese Rolle ist bereits vergeben”.

### Explicit deferrals (still not in Phase 2)

- No formula engine, calculations, or automatic values
- No builder read-only behavior for computed roles
- No offer totals block and no PDF totals rendering changes

---

## Phase 3 — Formula Engine

Phase 3 introduces a role-based formula engine as a standalone pure-function module and wires it into the builder so computed columns recalculate live on every input change.

### `computeRow` contract

- **Inputs**:
  - `row`: the current row’s `data` map keyed by `AngebotColumnDef.id`
  - `columns`: the active column schema (`AngebotColumnDef[]`) including optional roles
- **Output**:
  - a **patch** object containing only keys for computed-role columns (`net_amount`, `tax_amount`, `gross_amount`)
  - callers merge the patch onto existing row data; the engine never mutates the input row

### Live builder wiring

The builder wraps the existing row update path with `updateLineItemWithComputed` (see `src/features/angebote/components/angebot-builder/index.tsx`):

- merges the dispatcher’s input patch into the row’s `data`
- runs `computeRow(mergedData, columnSchema)`
- merges computed values on top so computed columns always reflect current inputs

### Read-only enforcement

Computed-role columns are rendered as read-only display cells in Step 2. The single enforcement gate is:

- `isComputedColumn(col)` from `src/features/angebote/lib/angebot-formula-engine.ts`

### Deferred (not in Phase 3)

- **Gross-input mode** (Phase 5)
- **PDF totals block** (Phase 4)

---

## Phase 4 — PDF Totals Block

Phase 4 adds an opt-in “Summenblock” (Netto / MwSt / Brutto) to the Angebot PDF.

### Per-quote flag (default false)

- Stored on `angebote` as **`show_totals_block`** (default `false`).\n
- The builder exposes a per-quote switch so existing offers stay unchanged unless explicitly enabled.

### Totals computation contract

- `computeAngebotTotals(rows, columns)` lives in `src/features/angebote/lib/angebot-formula-engine.ts`.\n
- It sums `net_amount`, `tax_amount`, and `gross_amount` across all rows.\n
- Phase 4b makes totals **schema-independent** by introducing reserved synthetic totals keys written into each row’s `data` by `computeRow`, and having `computeAngebotTotals` prefer those keys with a role-column fallback for legacy rows.\n
- It returns `null` for a total if no numeric values were present (so the PDF can suppress rows cleanly).

### Render condition

The totals block renders only if:\n

- `angebot.show_totals_block === true`

### Phase 4b patch — schema-independent totals + editable labels

Phase 4b keeps the Phase 4 behavior, but adds two UX/data improvements:

- **Schema-independent totals**: the engine writes 3 reserved synthetic keys into each line item `data` on every update:\n
  - `__net_amount__`, `__tax_amount__`, `__gross_amount__`\n
  These values are then summed by `computeAngebotTotals` even when the active schema has no computed-role columns. For backwards compatibility, `computeAngebotTotals` falls back to role-column IDs when synthetic keys are absent (rows saved pre-Phase-4b).
- **Editable labels**: when `show_totals_block` is enabled, the builder shows 3 inputs
  to customize the label text for the PDF totals rows (Netto / MwSt / Brutto). The labels
  are stored **per quote** on `angebote` (not on the Vorlage).

#### Notes

- The builder totals toggle is always available (no schema guard).\n
- Live totals display in the builder UI remains deferred.

#### DB storage + fallback chain

- DB columns (nullable text):
  - `angebote.totals_label_net`
  - `angebote.totals_label_tax`
  - `angebote.totals_label_gross`
- **NULL means “use default”**. Defaults are exported from one place only:
  - `DEFAULT_TOTALS_LABEL_NET`
  - `DEFAULT_TOTALS_LABEL_TAX`
  - `DEFAULT_TOTALS_LABEL_GROSS`
  in `src/features/angebote/hooks/use-angebot-builder.ts`
- PDF label resolution:
  - DB value → default constant (for legacy rows and unchanged labels)

### Deferred (not in Phase 4)

- Multi-rate VAT breakdown\n
- Gross-input mode (Phase 5)

---

## Phase 6 — Gross Input Mode (Brutto-Eingabe)

Phase 6 adds a **quote-level** input mode toggle so dispatchers can choose whether they type prices as **net** (default) or **gross** for the entire Angebot.

### Storage (quote-level)

- DB column: `angebote.input_mode` (text, `NOT NULL`, default `'net'`, CHECK constraint for `('net','gross')`).

### Engine contract

`computeRow` gains an optional third argument:

- `computeRow(row, columns, inputMode = 'net')`

### Gross-mode semantics (reinterpretation, not conversion on toggle)

The numeric values typed by the dispatcher are **not converted** when toggling the UI; the engine simply **interprets** them differently.

When `inputMode === 'gross'`, the dispatcher still types into the same input columns (e.g. roles `unit_price`, `flat_rate`, `surcharge`). The engine treats these entered values as **gross prices** and converts them to **net-equivalent** values **before** calling `computeNetAmount`.

### Builder UI (dual-field cell render)

In the Angebot builder Step 2, gross mode uses a dual-field input pattern for the three price roles:

- **Left (editable)**: the dispatcher types the **gross** number. This value is held in **local component state** so it stays visible while typing.
- **Right (read-only)**: the **net** value stored in `item.data[col.id]`, formatted consistently with `renderComputedDisplay`.

The gross value is not persisted directly. On each change, the builder calls `onUpdate` with the typed gross number, and the engine overwrites `item.data[col.id]` with the computed net value so persistence + PDF always use net.

Conversion rule (only when a usable `tax_rate` exists in the same row):

- `net_unit_price = unit_price / (1 + tax_rate / 100)`
- `net_flat_rate  = flat_rate  / (1 + tax_rate / 100)`
- `net_surcharge  = surcharge  / (1 + tax_rate / 100)`

Non-price roles are never converted:

- `distance_km`, `quantity` are units and are passed through unchanged.

After this pre-conversion step, the downstream chain remains identical to net mode:

- `net_amount` computed via `computeNetAmount`
- `tax_amount` computed from net and `tax_rate`
- `gross_amount` computed from net and `tax_rate`

### Missing/invalid tax rate + warning icon

If `inputMode === 'gross'` but `tax_rate` is empty or non-numeric, the engine **skips conversion** and continues with unconverted values. The UI marks the affected **price input cells** (roles `unit_price`, `flat_rate`, `surcharge`) with a warning icon + tooltip:

> “Steuersatz fehlt – Brutto-Rückrechnung nicht möglich.”

`tax_rate = 0` is valid (tax-exempt services) and must not trigger a warning.

