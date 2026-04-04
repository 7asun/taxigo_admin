---
name: Fremdfirma modality
overview: Implement Spec A + Spec B with recurring_rules mirroring in V1 (same pattern as KTS), mandatory fremdfirma_payment_mode chips in trips listing, and rule editor / cron / duplicate-rule behavior per locked decisions.
todos:
  - id: sql-spec-a
    content: "Migrations: payers + billing_variants no_invoice columns; behavior_profile + Zod; trips no_invoice_* + selbstzahler_collected_amount; regenerate types"
    status: completed
  - id: sql-spec-b
    content: "Migrations: fremdfirmen + trips fremdfirma_* ; RLS/GRANTs/COMMENTs; regenerate types"
    status: pending
  - id: sql-recurring-rules
    content: "Migration: extend recurring_rules (no_invoice_*, fremdfirma_*) AFTER fremdfirmen exists; COMMENT ON; regenerate types"
    status: completed
  - id: resolver-no-invoice
    content: Add resolve-no-invoice-required.ts mirroring resolve-kts-default.ts; wire create-trip + detail sheet + recurring rule defaults
    status: completed
  - id: catalog-ui-spec-a
    content: Payer sheet, billing-type-behavior-dialog, variant dialogs — no_invoice cascade like kts_default
    status: pending
  - id: feature-fremdfirmen
    content: src/features/fremdfirmen — service, hooks, CRUD UI, default_payment_mode; dashboard route + nav
    status: completed
  - id: trip-status
    content: Extend trip-status.ts for fremdfirma_id + null driver; inline comment per Spec B
    status: completed
  - id: trip-ui-fremdfirma
    content: trip-fremdfirma-section.tsx — switch, vendor, payment mode, cost rules, KTS/no_invoice hints (shared logic for rules)
    status: pending
  - id: trip-ui-no-invoice
    content: Trip detail + create-trip — Keine Rechnung switch, cascade hints, KTS coexistence warning
    status: pending
  - id: recurring-rule-ui
    content: "Extend recurring rule create/edit: Keine Rechnung + Fremdfirma section (reuse trip patterns); RULE 1–4 same as trip form"
    status: pending
  - id: recurring-cron
    content: generate-recurring-trips/route.ts — mirror new rule columns into trip insert + inline comment block
    status: pending
  - id: recurring-rules-service
    content: recurring-rules.service.ts + types — persist new columns on create/update
    status: pending
  - id: trips-list-mandatory-badge
    content: "columns.tsx (+ listing select): mandatory chip/tooltip for fremdfirma_payment_mode when fremdfirma_id set; DE labels; selbstzahler_collected_amount comment block"
    status: pending
  - id: duplicate-return-trip
    content: duplicate-trips — clear fremd*; copy no_invoice (source manual). build-return-trip-insert — copy no_invoice; omit fremd*
    status: pending
  - id: duplicate-recurring-rule
    content: "If rule duplication exists or is added: clear fremdfirma_*; copy no_invoice_required with no_invoice_source = manual"
    status: pending
  - id: csv-bulk
    content: bulk-upload — columns per Spec A + Spec B (fremdfirma by number resolve)
    status: pending
  - id: invoices-soft-warnings
    content: invoice line items API + step-3 — Keine Rechnung badge + batch warning (Spec A 7.3)
    status: pending
  - id: docs
    content: docs/fremdfirma.md, docs/no-invoice-required.md, feature READMEs; recurring mirroring documented
    status: completed
isProject: false
---

# Integrated plan: Spec A + Spec B (Fremdfirma & Keine Rechnung)

## Source of truth (your specs)

- [implementation-suggestions/spec-a-no-invoice-required.md](implementation-suggestions/spec-a-no-invoice-required.md)
- [implementation-suggestions/spec-b-fremdfirma.md](implementation-suggestions/spec-b-fremdfirma.md)

This plan **merges** both and incorporates **locked V1 decisions** below.

---

## Locked V1 decisions (this update)

1. **Recurring rules mirroring** — **In scope for V1.** Follow the **same pattern** as `kts_document_applies` / `kts_source`: columns on `recurring_rules`, cron copies onto generated trips, rule editor UI for all fields, cross-flag rules identical to the trip form.
2. **Trips listing payment mode** — **Mandatory** (not optional): every row with `fremdfirma_id IS NOT NULL` shows a compact **chip or tooltip** with the German label for `fremdfirma_payment_mode`.
3. `**columns.tsx` comment** — At the **driver / Fremdfirma display** block, add the agreed **inline comment** about `selbstzahler_collected_amount` (no UI in V1).

---

## Strategic sequencing (dependency)

Spec B **RULE 1** needs `**trips.no_invoice_required`** from Spec A. **Migration order:** create `**fremdfirmen`** before `**recurring_rules.fremdfirma_id`** FK (same migration file is fine: `CREATE fremdfirmen` → `ALTER trips` → `ALTER recurring_rules`).

Recommended **merge order**:

1. Spec A: DB + resolver + catalog UI + trip create/detail.
2. Spec B: `fremdfirmen` + trips `fremdfirma_`*.
3. **Recurring rules migration** + **cron** + **rule editor** + **recurring-rules.service**.
4. Listing (mandatory badge), duplicate trip/return, duplicate rule (if applicable), CSV, invoices, docs.

---

## Recurring rules — V1 (implementation contract)

### 1. Migration — extend `recurring_rules`

**Must run after** `public.fremdfirmen` exists (FK).

```sql
ALTER TABLE recurring_rules
ADD COLUMN no_invoice_required BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN no_invoice_source VARCHAR(20) DEFAULT NULL,
ADD COLUMN fremdfirma_id UUID REFERENCES fremdfirmen(id) ON DELETE SET NULL DEFAULT NULL,
ADD COLUMN fremdfirma_payment_mode TEXT DEFAULT NULL
  CHECK (fremdfirma_payment_mode IN (
    'cash_per_trip', 'monthly_invoice', 'self_payer', 'kts_to_fremdfirma'
  )),
ADD COLUMN fremdfirma_cost NUMERIC(10, 2) DEFAULT NULL;

COMMENT ON COLUMN recurring_rules.no_invoice_required IS
  'Gespiegelt auf generierte Fahrten. Gleiche Semantik wie trips.no_invoice_required.';
COMMENT ON COLUMN recurring_rules.fremdfirma_id IS
  'Wenn gesetzt: generierte Fahrten werden dieser Fremdfirma zugewiesen.';
COMMENT ON COLUMN recurring_rules.fremdfirma_payment_mode IS
  'Abrechnungsart der Fremdfirma — wird auf generierte Fahrten gespiegelt.';
COMMENT ON COLUMN recurring_rules.fremdfirma_cost IS
  'Seed-Feld: vereinbarter Betrag — wird auf generierte Fahrten gespiegelt. Kein UI-Enforcement.';
```

Add `**COMMENT ON COLUMN**` for `no_invoice_source` for parity with trips (mirror Spec A vocabulary).

### 2. Cron — extend trip insert payload

In `[src/app/api/cron/generate-recurring-trips/route.ts](src/app/api/cron/generate-recurring-trips/route.ts)`, add to the same object that already sets `kts_document_applies` / `kts_source`:

```typescript
no_invoice_required: rule.no_invoice_required,
no_invoice_source: rule.no_invoice_source,
fremdfirma_id: rule.fremdfirma_id ?? null,
fremdfirma_payment_mode: rule.fremdfirma_payment_mode ?? null,
fremdfirma_cost: rule.fremdfirma_cost ?? null,
```

**Inline comment** (place above or beside the mirrored fields):

```typescript
// no_invoice_required, fremdfirma_id, fremdfirma_payment_mode, fremdfirma_cost
// are mirrored from recurring_rules — same pattern as kts_document_applies.
// Admin can override on individual generated trips after creation.
```

**Cron-generated trips with `fremdfirma_id`:** ensure insert payload also sets `**driver_id: null`**, `**needs_driver_assignment: false`**, and **status** consistent with Spec B (extern = assigned workflow — align with `trip-status` rules so generated rows do not flip to `pending` incorrectly).

### 3. Rule editor UI

**Code anchors (existing):**

- `[src/features/clients/components/recurring-rule-form-body.tsx](src/features/clients/components/recurring-rule-form-body.tsx)`
- `[src/features/clients/components/recurring-rule-billing-fields.tsx](src/features/clients/components/recurring-rule-billing-fields.tsx)` — already “same UX as Neue Fahrt” for Kostenträger; **extend** here or via extracted shared components
- `[src/features/clients/components/recurring-rule-sheet.tsx](src/features/clients/components/recurring-rule-sheet.tsx)` / `[recurring-rule-panel.tsx](src/features/clients/components/recurring-rule-panel.tsx)`
- `[src/features/trips/api/recurring-rules.service.ts](src/features/trips/api/recurring-rules.service.ts)` — **create/update** must include new columns

**Requirements:**

- **Keine Rechnung** switch: same behavior as trip form; cascade pre-fill via `**resolveNoInvoiceRequiredDefault`** when payer/family/variant change.
- **Fremdfirma** block: same as `[trip-fremdfirma-section.tsx](src/features/fremdfirmen/components/trip-fremdfirma-section.tsx)` (switch, vendor, payment mode, cost field). Prefer **shared hooks or subcomponents** so RULE 1–4 do not diverge between trip and rule forms.
- **RULE 1–4** apply **identically** (reactive layer for `no_invoice_required` + `fremdfirma_id` + payment mode + cost visibility).

### 4. Duplicate recurring rule behavior

- **Clear:** `fremdfirma_id`, `fremdfirma_payment_mode`, `fremdfirma_cost`
- **Copy:** `no_invoice_required` with `**no_invoice_source = 'manual'`** (same idea as trip duplication)

**Codebase note:** There is **no** recurring-rule duplicate flow found today (`duplicate` / `clone` rule grep empty). **If** duplication is added later or exists under another name, apply this contract; otherwise treat this todo as **verify + document skip**.

---

## Trips listing — mandatory `fremdfirma_payment_mode` badge

**Requirement:** For **every** row where `**fremdfirma_id IS NOT NULL`**, show a **compact chip** and/or **tooltip** with the payment mode using **German** labels:


| Enum                | Label             |
| ------------------- | ----------------- |
| `cash_per_trip`     | Bar pro Fahrt     |
| `monthly_invoice`   | Monatsrechnung    |
| `self_payer`        | Selbstzahler      |
| `kts_to_fremdfirma` | KTS an Fremdfirma |


**Files:** `[src/features/trips/components/trips-tables/columns.tsx](src/features/trips/components/trips-tables/columns.tsx)` (and ensure `[trips-listing.tsx](src/features/trips/components/trips-listing.tsx)` / mobile card list **select** includes `fremdfirma_payment_mode` + join `fremdfirmen` as needed).

**Centralize** label mapping in a small helper (e.g. `src/features/fremdfirmen/lib/fremdfirma-payment-mode-labels.ts`) to avoid drift between trip form, rule form, and table.

### Inline comment in `columns.tsx` (driver / Fremdfirma block)

```typescript
// V1: selbstzahler_collected_amount exists on trips but has no UI.
// Do not expose in any form field until cash collection feature is scoped.
// Column exists for future cash reporting only.
```

Place this at the **driver / Fremdfirma display** section as requested (not on unrelated columns).

---

## Codebase verification (summary)


| Topic                | Finding                                                                                                  | Plan adjustment                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **KTS → recurring**  | Cron already mirrors KTS from `recurring_rules`                                                          | Extend **same** insert object for no_invoice + Fremdfirma      |
| **Rule UI**          | `[recurring-rule-billing-fields.tsx](src/features/clients/components/recurring-rule-billing-fields.tsx)` | Extend for Keine Rechnung + Fremdfirma + shared RULE logic     |
| **Duplicate trips**  | `[duplicate-trips.ts](src/features/trips/lib/duplicate-trips.ts)`                                        | Clear `fremdfirma_`*; copy `no_invoice_*` with `manual` source |
| **Linked Rückfahrt** | `[build-return-trip-insert.ts](src/features/trips/lib/build-return-trip-insert.ts)`                      | Copy `no_invoice_`*; omit `fremdfirma_*`                       |
| **trip-status**      | `[trip-status.ts](src/features/trips/lib/trip-status.ts)`                                                | Fremdfirma guard when `fremdfirma_id` set                      |


---

## Data model (unchanged summary)

- Spec A: payers / `behavior_profile` / `billing_variants` / `trips` columns for no-invoice cascade.
- Spec B: `fremdfirmen`, `trips.fremdfirma_id`, `fremdfirma_payment_mode`, `fremdfirma_cost`.
- **Plus** `recurring_rules` columns listed above (V1 locked).

**Regenerate** `[src/types/database.types.ts](src/types/database.types.ts)` after migrations.

---

## Interaction matrix (implementation contracts)

Same RULE 1–4 as before; **both** trip forms **and** recurring rule forms must implement them (shared implementation strongly recommended).

---

## UX (trip sheet / create form)

Unchanged from prior plan; **listing** now **requires** payment-mode chip (see above).

---

## CSV, duplicate trip, Rückfahrt

- **CSV:** Spec A + Spec B columns; `fremdfirma_number` resolve.
- **Duplicate trip:** Fremdfirma cleared; no_invoice copied (manual source).
- **Rückfahrt insert:** Copy no_invoice from outbound; Fremdfirma null.

---

## V2 / out of scope / docs

- V2 reconciliation tables (Spec B §11) — still out of V1.
- Kanban Fremdfirma — out of scope.
- **Docs:** Document recurring mirroring and post-generation overrides (cron comment + user-facing `docs/`).

---

## Spec corrections / clarifications (senior review)

1. ~~Recurring mirror optional~~ — **Superseded:** V1 **includes** full recurring mirroring per locked decision.
2. **Spec A** resolver shape should match KTS inputs (payer, family, variant).
3. `**no_invoice_source`** vocabulary consistent across trips, rules, CSV, duplicate paths.
4. **No sentinel driver** — `driver_id = null` + `fremdfirma_id` + status fix.

---

## Implementation order (for execution phase)

1. Migrations Spec A → types.
2. Resolver + catalog UI (Spec A).
3. Trip create/detail: Keine Rechnung + KTS warning.
4. Migrations Spec B (`fremdfirmen` + trips) → types.
5. Migration `**recurring_rules` extension** → types.
6. `fremdfirmen` CRUD + nav + label helper for payment modes.
7. `trip-status` + `**trip-fremdfirma-section`** + create-trip parity.
8. `**recurring-rules.service`** + rule form UI + shared RULE 1–4 logic.
9. **Cron** mirror fields + inline comment.
10. Trips listing: join + **mandatory** payment badge + `**columns.tsx` selbstzahler comment**.
11. Duplicate trip / return; duplicate rule if applicable.
12. CSV + invoices + docs.

