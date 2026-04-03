# KTS (Krankentransportschein) — Architecture & Implementation Spec

> **Canonical doc:** The maintained specification lives in **[`docs/kts-architecture.md`](../docs/kts-architecture.md)**. The implementation plan is **[`.cursor/plans/kts_document_workflow.plan.md`](../.cursor/plans/kts_document_workflow.plan.md)**. Keep this file as a session snapshot only; edit the `docs/` and plan files when the design changes.

**Project:** TaxiGo Admin Dashboard  
**Prepared after:** Strategic brainstorming session, 03.04.2026  
**Scope:** V1 implementation spec + V2 roadmap  
**Status:** Locked — ready for Cursor implementation

---

## 1. Executive Summary

KTS (Krankentransportschein) must be treated as an **operational billing-mode switch** on every trip — independent of, but informed by, the existing billing catalog (Kostenträger → Abrechnungsfamilie → Unterart). A trip flagged `kts_document_applies = true` follows a completely different downstream process from a standard invoice trip. The goal of this spec is to:

1. Add a catalog-driven cascade that auto-resolves the KTS flag at trip creation
2. Store the flag explicitly on every trip with full source transparency
3. Lay the correct schema foundation so the V2 review pipeline can be added without breaking changes
4. Keep the UI flexible enough for edge cases (e.g., non-KTS payer but KTS Schein)

---

## 2. Problem Statement

### 2.1 What Exists Today

The billing catalog (`payers → billing_types → billing_variants`) classifies trips for invoicing and reporting. It answers: *"Who pays, and how is this categorized?"*

### 2.2 What Is Missing

A separate operational layer that answers: *"Does this trip require a Krankentransportschein, and what is the current status of that Schein?"*

These two layers diverge in practice:
- A hospital payer (`Kostenträger = Klinikum XY`) can send a patient whose payment is via KTS — without advance notice.
- A `billing_variant` named "Dialyse KTS" implies KTS, but the system has no explicit flag to act on.
- KTS trips are **not billed via invoice** — they follow a separate clearing process managed by the billing/clearing department.
- Without an explicit flag, KTS trips can enter the invoice pipeline silently, or correction tracking lives in someone's head or a spreadsheet.

### 2.3 Design Constraints

- **Flexibility first:** Any payer can produce a KTS trip. The system must support this edge case cleanly.
- **Cascade defaults:** Known KTS combinations (payer, Familie, Unterart) should auto-resolve to avoid redundant manual entry.
- **Substitute-admin proof:** Any status, decision, and history must be readable by someone who didn't create the trip.
- **Append-friendly:** New payers, families, and variants must inherit sensible defaults without touching old records.
- **Non-destructive foundation:** V1 schema must not require breaking changes when V2 review pipeline is added.

---

## 3. Cascade Model

### 3.1 Tri-State at Each Catalog Level

Use a tri-state (`yes | no | unset`) at every level of the billing catalog. `unset` means "inherit from parent." The most specific level that is not `unset` wins.

**Precedence (most specific wins):**

```
billing_variants.kts_default
    ↓ (if unset)
billing_types.behavior_profile.kts_default
    ↓ (if unset)
payers.kts_default
    ↓ (if unset)
false  ← system default
```

### 3.2 Why Unterart-Level Is Mandatory

A confirmed real-world example: `billing_variant = "Dialyse KTS"` and `billing_variant = "Dialyse Standard"` exist under the same Familie. Without Unterart-level control, you cannot express different KTS defaults within the same Familie. The `billing_variants` column is mandatory in V1.

### 3.3 Resolver Function

A single shared function, used everywhere (trip create, trip edit, CSV import, recurring trip generation):

```typescript
function resolveKtsDefault(
  payer: Payer,
  family: BillingType,
  variant: BillingVariant | null
): { value: boolean; source: 'variant' | 'familie' | 'payer' | 'system_default' }
```

**Logic:**
```typescript
if (variant?.kts_default !== null) return { value: variant.kts_default, source: 'variant' };
if (family?.behavior_profile?.kts_default !== 'unset') return { value: family.behavior_profile.kts_default === 'yes', source: 'familie' };
if (payer?.kts_default !== null) return { value: payer.kts_default, source: 'payer' };
return { value: false, source: 'system_default' };
```

---

## 4. Database Schema Changes

### 4.1 `payers` Table

```sql
ALTER TABLE payers
ADD COLUMN kts_default BOOLEAN DEFAULT NULL;
-- NULL = unset (inherit), TRUE = yes, FALSE = no
```

### 4.2 `billing_types` Table — `behavior_profile` JSON Extension

Extend the existing `behavior_profile` JSONB column. Add `kts_default` to the Zod schema and the behavior dialog:

```typescript
// BillingTypeBehavior (existing type — extend it)
type BillingTypeBehavior = {
  // ... existing fields ...
  kts_default: 'yes' | 'no' | 'unset'; // NEW
};
```

Default value for existing records: `'unset'` (backward-compatible, no migration needed for existing data).

### 4.3 `billing_variants` Table

```sql
ALTER TABLE billing_variants
ADD COLUMN kts_default BOOLEAN DEFAULT NULL;
-- NULL = unset (inherit), TRUE = yes, FALSE = no
```

### 4.4 `trips` Table

```sql
ALTER TABLE trips
ADD COLUMN kts_document_applies BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN kts_source VARCHAR(20) DEFAULT NULL;
-- kts_source values: 'variant' | 'familie' | 'payer' | 'manual' | 'system_default'
```

**`kts_source`** records how `kts_document_applies` was set. This is critical for:
- Transparency: admin can see if the flag came from the catalog or was set manually
- Debugging: when a trip is incorrectly flagged, source tells you which catalog level to fix
- Substitute admin clarity: "this was set manually by dispatcher" vs. "this was set by the Unterart"

**Note on V2 readiness:** Do NOT add `kts_review_status` to `trips` in V1. It will be managed via the `kts_reviews` sub-table in V2. Reserve the column name — do not use it for anything else.

### 4.5 Recurring Rules

Mirror `kts_document_applies` from the rule to generated trips — consistent with the existing `billing_calling_station` pattern. Admin can override on individual trips after generation.

### 4.6 Duplicate / Rückfahrt Logic

Copy `kts_document_applies` and `kts_source` in `duplicate-trips.ts` and `build-return-trip-insert.ts`, same as other billing metadata. `kts_source` on a duplicated trip should be set to `'manual'` to indicate it was inherited via duplication, not fresh catalog resolution.

---

## 5. Trip Form UI (Neue Fahrt / Fahrt bearbeiten)

### 5.1 The Switch

Add a single switch control to the trip creation and edit form:

- **Label:** `KTS / Krankentransportschein`
- **Position:** Within the billing/Abrechnung section of the form, after Unterart selection
- **Visibility:** Always visible when a payer is selected — never hidden
- **Default state:** Pre-filled by `resolveKtsDefault()` when payer/Familie/Unterart are selected

### 5.2 Behavior When Cascade Resolves to `true`

- Switch is pre-checked
- Show an inline hint below the switch (same tone as other behavior-driven hints):
  - If source = `variant`: `"Voreingestellt aus Unterart: {variant.name}"`
  - If source = `familie`: `"Voreingestellt aus Abrechnungsfamilie: {family.name}"`
  - If source = `payer`: `"Voreingestellt aus Kostenträger: {payer.name}"`
- Switch remains **editable** — admin can uncheck it
- If admin unchecks a cascade-resolved `true`: show a soft warning tooltip: *"Dieser Wert wurde automatisch aus der Abrechnung gesetzt. Bitte nur deaktivieren wenn begründet."*
- On save: `kts_source = 'manual'` (override recorded)

### 5.3 Behavior When Cascade Resolves to `false`

- Switch is unchecked
- No hint shown
- Admin can check it freely — this is the "unexpected KTS from non-KTS payer" case
- On save: `kts_source = 'manual'`

### 5.4 Re-evaluation on Payer/Familie/Unterart Change

Whenever the admin changes payer, Familie, or Unterart during trip creation, re-run `resolveKtsDefault()` and update the switch and hint accordingly. Do not re-evaluate if the admin has already manually overridden the switch.

---

## 6. CSV Import

Add `kts_document_applies` as an explicit column in the CSV schema:

| Column | Type | Behavior |
|--------|------|----------|
| `kts_document_applies` | Boolean (true/false/1/0) | Optional. If absent or blank: apply `resolveKtsDefault()` cascade silently. If present: treat as explicit override, set `kts_source = 'manual'`. |

The cascade must be applied at import time using the same `resolveKtsDefault()` function — not a separate implementation.

---

## 7. Billing / Invoice Pipeline (V1 Behavior)

**V1 uses Option B: Soft Warning.**

KTS trips (`kts_document_applies = true`) can still be added to invoice batches. The system shows a contextual warning:

- On the trip row in any invoice/billing view: display a `KTS` badge
- If a KTS trip is included in an invoice batch: show an inline warning — *"Diese Fahrt hat KTS — bitte separat über die Abrechnungsabteilung abrechnen."*
- No hard block in V1 — dispatchers retain full control

**V2 will move to Option C:** KTS trips are automatically excluded from invoice batch generation and routed to a separate "KTS Fahrten" clearing queue.

---

## 8. V2 Review Pipeline (Roadmap — Do Not Build in V1)

### 8.1 State Machine

The KTS review lifecycle follows this cycle (the `→ Fehlerhaft` loop is intentional — a Schein can require multiple correction rounds):

```
kts_document_applies = true
        ↓
   [ Fehlerhaft ]  ←─────────────────────┐
        ↓                                │
  [ In Korrektur ]                       │
        ↓                                │
   [ Korrigiert ] ── still wrong? ───────┘
        ↓
   [ Abgegeben ]
        ↓
   [ Bezahlt ]
```

### 8.2 `kts_reviews` Sub-Table

```sql
CREATE TABLE kts_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  -- values: 'fehlerhaft' | 'in_korrektur' | 'korrigiert' | 'abgegeben' | 'bezahlt'
  previous_status VARCHAR(20) DEFAULT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) DEFAULT NULL,
  -- NULL = system/auto; FK to users when clearing dep. gets login (V4/V5)
  created_by_label VARCHAR(100) DEFAULT NULL,
  -- Free text fallback for V1/V2: "Admin", "Clearing: Maria", etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Design decisions:**
- Rows are **insert-only** — never updated. Full immutable audit trail.
- Current status = most recent row: `SELECT * FROM kts_reviews WHERE trip_id = ? ORDER BY created_at DESC LIMIT 1`
- `created_by` is nullable FK — populated when clearing dep. gets a system login in V4/V5
- `created_by_label` is a free-text field for V1/V2: admin records on behalf of clearing dep. ("Clearing: Thomas hat Fehler gemeldet")
- `previous_status` is stored on write for quick audit display without self-join

### 8.3 UI (V2)

On trip detail, a collapsible **"KTS-Status"** section, only visible when `kts_document_applies = true`:

- Current status as a colored badge:
  - `Fehlerhaft` → red
  - `In Korrektur` → orange
  - `Korrigiert` → green
  - `Abgegeben` → blue
  - `Bezahlt` → teal (primary)
- Full chronological timeline below the badge: timestamp + author + notes per row
- Action button: "Status ändern" → opens a modal with status selector + notes field
- Both forward and backward transitions are valid (loop is explicit)

### 8.4 Clearing Department Access (V4/V5)

When the clearing department receives a login:
- `created_by` FK on `kts_reviews` becomes populated
- Role-based permissions: clearing dep. can change status and add notes, but not edit the trip itself
- No schema migration needed — `created_by` is already nullable and typed as FK from day one

---

## 9. Implementation Order for Cursor

Execute in this order to avoid breaking changes:

1. **Migrations:** `payers.kts_default`, `billing_variants.kts_default`, extend `behavior_profile` Zod schema, `trips.kts_document_applies` + `trips.kts_source`
2. **Resolver function:** `src/features/trips/lib/resolve-kts-default.ts` — shared, tested in isolation
3. **Catalog UI:** Extend payer form (kts_default toggle), billing-type-behavior-dialog.tsx (new kts_default field), billing_variant form (kts_default toggle)
4. **Trip form:** KTS switch + hint + soft warning on override
5. **Duplicate/Rückfahrt logic:** Extend `duplicate-trips.ts` and `build-return-trip-insert.ts`
6. **Recurring:** Mirror flag in recurring trip generation
7. **CSV:** Add `kts_document_applies` column to import schema + apply resolver at import time
8. **Billing/invoice views:** Add KTS badge + soft warning on KTS trips in invoice batches
9. **Docs:** Update `docs/billing-families-variants.md` with cascade description and trip column

---

## 10. Open Decisions for V2 (Deferred)

| Decision | Notes |
|----------|-------|
| Who can trigger a status change in V2? | Admin only for now. Clearing dep. in V4/V5 via login. |
| Notification when status changes? | Not in scope for V2 — evaluate after clearing dep. has login |
| Automatic billing route for KTS trips | V2: Option C — exclude from invoice batch, route to KTS clearing queue |
| Reporting: KTS Scheine dashboard | V2: filter by status, date range, payer, clearing agent |
| `created_by_label` migration to FK | V4/V5: when clearing dep. login is added, backfill or leave as-is |

---

*Document generated: 03.04.2026 — TaxiGo KTS Architecture Brainstorming Session*
