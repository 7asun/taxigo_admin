# Spec B — Fremdfirma (External Company) Assignment
## Architecture & Implementation Spec

**Project:** TaxiGo Admin Dashboard  
**Prepared after:** Strategic brainstorming session, 04.04.2026  
**Scope:** V1 implementation spec + V2 roadmap  
**Status:** Locked — ready for Cursor implementation  
**Related specs:** KTS Spec (03.04.2026), no_invoice_required Spec A (04.04.2026)

---

## 1. Executive Summary

A Fremdfirma is an external transport company that TaxiGo assigns trips to when internal driver capacity is unavailable. The Fremdfirma layer is **independent of the billing catalog** — assigning a trip to a Fremdfirma never changes how TaxiGo bills the Kostenträger (always full normal rate). It only changes who executes the trip and how TaxiGo compensates the external company.

This spec covers: the `fremdfirmen` catalog, the `fremdfirma_id` trip assignment, the four-mode payment enum, cost tracking seeds, driver/status logic fixes, and the V2 reconciliation roadmap.

---

## 2. Problem Statement

### 2.1 What Exists Today

Trips are always executed by an internal driver. When a trip must be outsourced, there is no system record of which company handled it, what was agreed, or how the financial relationship is settled.

### 2.2 Why Not Use Kostenträger or a Fake Driver?

**Kostenträger approach (rejected):** The Kostenträger represents who TaxiGo bills. Outsourcing does not change who TaxiGo bills — it changes who drives. Encoding Fremdfirma as a payer would corrupt billing reports and create a false link between execution and revenue.

**Fake driver approach (rejected):** A Fremdfirma is a company, not a person. One Fremdfirma may send different drivers on different days. A sentinel `accounts` row creates auth coupling and cannot express company-level attributes (payment mode, cost tracking, reconciliation).

**Correct approach:** A separate `fremdfirmen` catalog linked to trips via `fremdfirma_id`. Billing catalog untouched.

---

## 3. The Four Payment Scenarios

This is the most domain-specific part of the Fremdfirma model. Every outsourced trip has exactly one of four financial relationships between TaxiGo and the Fremdfirma:

| Mode | Enum Value | Description |
|------|-----------|-------------|
| Cash per trip | `cash_per_trip` | TaxiGo pays Fremdfirma cash after each trip |
| Monthly invoice | `monthly_invoice` | Fremdfirma invoices TaxiGo at end of month |
| Self-payer | `self_payer` | Patient pays Fremdfirma directly. TaxiGo is financially out of the loop. Always set when `no_invoice_required = true`. |
| KTS to Fremdfirma | `kts_to_fremdfirma` | Fremdfirma receives the KTS document/payment directly from the patient. TaxiGo is out of the KTS billing loop for this trip. **Manual-only — never auto-resolved.** |

### 3.1 Critical Rule: Annual KTS Scenario

In the majority of KTS + Fremdfirma cases, **TaxiGo holds the patient's annual KTS** and the Fremdfirma bills TaxiGo normally (`cash_per_trip` or `monthly_invoice`). The `kts_to_fremdfirma` mode is the rare exception where the patient hands the Fremdfirma the KTS directly.

**Therefore: KTS + Fremdfirma does NOT auto-default to `kts_to_fremdfirma`.**  
The default is inherited from `fremdfirmen.default_payment_mode` (catalog default).  
The admin selects `kts_to_fremdfirma` manually when the rare case occurs.  
A soft hint is shown when KTS is active on a Fremdfirma trip: *"KTS aktiv — bitte Abrechnungsart mit Fremdfirma prüfen."*

---

## 4. Database Schema Changes

### 4.1 New Table: `fremdfirmen`

```sql
CREATE TABLE public.fremdfirmen (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  number                TEXT DEFAULT NULL,
  sort_order            INTEGER DEFAULT 0,
  default_payment_mode  TEXT NOT NULL DEFAULT 'monthly_invoice'
                        CHECK (default_payment_mode IN (
                          'cash_per_trip', 'monthly_invoice', 'self_payer', 'kts_to_fremdfirma'
                        )),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fremdfirmen IS
  'Externe Transportunternehmen (Fremdfirmen), an die Fahrten vergeben werden können. Getrennt vom Abrechnungskatalog.';
COMMENT ON COLUMN public.fremdfirmen.default_payment_mode IS
  'Standard-Abrechnungsart für neue Fahrten dieser Fremdfirma. Kann pro Fahrt überschrieben werden.';
COMMENT ON COLUMN public.fremdfirmen.number IS
  'Optionale interne Kennnummer der Fremdfirma (z.B. für Berichte oder CSV-Export).';

CREATE INDEX idx_fremdfirmen_company_id ON public.fremdfirmen(company_id);
CREATE INDEX idx_fremdfirmen_company_active ON public.fremdfirmen(company_id, is_active);
```

### 4.2 `trips` Table — New Columns

```sql
ALTER TABLE trips
ADD COLUMN fremdfirma_id UUID REFERENCES fremdfirmen(id) ON DELETE SET NULL DEFAULT NULL,
ADD COLUMN fremdfirma_payment_mode TEXT DEFAULT NULL
           CHECK (fremdfirma_payment_mode IN (
             'cash_per_trip', 'monthly_invoice', 'self_payer', 'kts_to_fremdfirma'
           )),
ADD COLUMN fremdfirma_cost NUMERIC(10, 2) DEFAULT NULL;

CREATE INDEX idx_trips_fremdfirma_id ON public.trips(fremdfirma_id)
  WHERE fremdfirma_id IS NOT NULL;

COMMENT ON COLUMN trips.fremdfirma_id IS
  'Wenn gesetzt: Fahrt wurde an diese Fremdfirma vergeben. driver_id wird auf NULL gesetzt.';
COMMENT ON COLUMN trips.fremdfirma_payment_mode IS
  'Wie wird die Fremdfirma für diese Fahrt vergütet: cash_per_trip, monthly_invoice, self_payer, kts_to_fremdfirma.';
COMMENT ON COLUMN trips.fremdfirma_cost IS
  'Seed-Feld: vereinbarter Betrag für diese Fahrt an die Fremdfirma. V1: kein UI-Enforcement. Für späteres Margin-Reporting.';
```

**Semantics:** A trip is "outsourced" when `fremdfirma_id IS NOT NULL`. Billing/Kostenträger columns stay completely unchanged.

### 4.3 RLS and GRANTs

Apply same RLS pattern as `payers` — policies scoped by `company_id = current_user_company_id()` for SELECT/INSERT/UPDATE/DELETE for admin users. Apply same GRANTs as `billing_variants` migration.

---

## 5. Driver and Status Logic

### 5.1 Driver Field Behavior

When `fremdfirma_id` is set:
- Set `driver_id = null`
- Set `needs_driver_assignment = false`
- Show driver field as **read-only label**: `"Extern · {fremdfirma.name}"`
- Disable driver select

When Fremdfirma is removed (switch turned off):
- Re-enable driver select
- Re-evaluate `needs_driver_assignment`

### 5.2 Status Logic Fix (Critical)

Extend `getStatusWhenDriverChanges` in `src/features/trips/lib/trip-status.ts`:

> When `fremdfirma_id IS NOT NULL`, unassigning `driver_id` (setting it to null) must **not** revert trip status from `assigned` to `pending`. Treat "extern zugewiesen" as an assigned state for all workflow purposes.

Document this rule with an inline comment in `trip-status.ts` — it is the subtlest part of this feature and the most likely source of future bugs if not clearly explained.

### 5.3 Hin/Rück Independence

`fremdfirma_id` is **not** automatically copied to the partner leg (Rückfahrt). Each leg is assigned independently. Common scenario: TaxiGo has no driver for Hinfahrt → assign to Fremdfirma. TaxiGo has availability for Rückfahrt → keep internal. This is by design.

---

## 6. Interaction Matrix (Full Three-Flag Model)

| KTS | No Invoice | Fremdfirma | `fremdfirma_payment_mode` | System Behavior |
|-----|-----------|------------|--------------------------|-----------------|
| ✅ | ❌ | ❌ | — | KTS trip, TaxiGo handles clearing |
| ❌ | ✅ | ❌ | — | Selbstzahler, TaxiGo collects (`selbstzahler_collected_amount`) |
| ❌ | ❌ | ✅ | `cash_per_trip` or `monthly_invoice` | Outsourced, bill Kostenträger, pay Fremdfirma |
| ❌ | ✅ | ✅ | `self_payer` (auto, overridable) | Fremdfirma collects from patient, TaxiGo is out |
| ✅ | ❌ | ✅ | Inherits from `fremdfirmen.default_payment_mode` + soft hint | KTS active — admin must verify payment mode with Fremdfirma |
| ✅ | ❌ | ✅ | `kts_to_fremdfirma` (manual only) | Fremdfirma receives KTS directly — TaxiGo out of KTS loop |
| ❌ | ✅ | ❌ | — | Selbstzahler, TaxiGo collects cash |
| ✅ | ✅ | any | — | Soft warning: "KTS und Keine Rechnung gleichzeitig aktiv — bitte prüfen" |

### 6.1 Interaction Rules (Implementation Contracts)

```
RULE 1 — no_invoice_required + fremdfirma:
  if (no_invoice_required && fremdfirma_id) → auto-set fremdfirma_payment_mode = 'self_payer'
  admin can override manually
  hide fremdfirma_cost field (show if admin overrides payment mode)

RULE 2 — kts + fremdfirma:
  NO auto-default to kts_to_fremdfirma
  Inherit default_payment_mode from fremdfirmen catalog
  Show soft hint: "KTS aktiv — bitte Abrechnungsart mit Fremdfirma prüfen"
  admin selects kts_to_fremdfirma manually for the rare case

RULE 3 — kts_to_fremdfirma selected:
  fremdfirma_cost = null / hidden (TaxiGo pays nothing — Fremdfirma keeps KTS payment)
  admin can override

RULE 4 — fremdfirma removed (switch off):
  clear fremdfirma_id, fremdfirma_payment_mode, fremdfirma_cost
  re-enable driver select
  re-evaluate needs_driver_assignment
```

---

## 7. Trip Form UI (Neue Fahrt / Fahrt bearbeiten)

### 7.1 The Fremdfirma Section

Place next to the existing Fahrer block in `trip-detail-sheet.tsx`:

- **Switch:** "Fremdfirma" — when on, show required Select of active `fremdfirmen` for the company
- **Fremdfirma Select:** Required when switch is on. Populated from `fetchActiveFremdfirmen()`
- **Payment Mode Select:** Pre-filled from `fremdfirmen.default_payment_mode`. Always editable.
  - Options: Cash pro Fahrt / Monatsrechnung / Selbstzahler / KTS an Fremdfirma
- **Cost Field:** `fremdfirma_cost` — optional decimal input. Label: "Vereinbarter Betrag (optional)". Hidden when `payment_mode = self_payer` or `kts_to_fremdfirma` (unless admin overrides)
- **Driver field:** Read-only label "Extern · {name}" when Fremdfirma is active. Driver select disabled.

### 7.2 Hints and Warnings

| Trigger | Message |
|---------|---------|
| KTS active + Fremdfirma set | "KTS aktiv — bitte Abrechnungsart mit Fremdfirma prüfen" |
| `no_invoice_required` + Fremdfirma | "Keine Rechnung aktiv — Fremdfirma erhält Zahlung direkt vom Patienten" |
| `kts_to_fremdfirma` selected | "Fremdfirma erhält KTS-Zahlung direkt — kein Betrag an TaxiGo" |

### 7.3 Trips List Display

- Join `fremdfirma:fremdfirmen(name)` in listing query
- Driver column: if `fremdfirma_id` present, show **"Extern · {name}"** instead of empty
- Add optional filter `fremdfirma_id IS NOT NULL` (toggle: "Nur Fremdfahrten") in trips filter bar
- Add `fremdfirma_payment_mode` badge on trip row (visible in expanded view or tooltip)

---

## 8. App Architecture

| Area | Location |
|------|----------|
| Feature module (CRUD + hooks + types) | `src/features/fremdfirmen/` (parallel to `src/features/payers/`) |
| Trip UI section | `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx` |
| Status / assignment rules | `src/features/trips/lib/trip-status.ts` (extend with comment) |
| Trip fetch / patch | `src/features/trips/api/trips.service.ts` (add fremdfirma join) |
| Reference data | Extend `trip-reference-data.ts` + `use-trip-reference-queries.ts` |
| Navigation | New item under Account next to Kostenträger in `src/config/nav-config.ts` |
| Route | `src/app/dashboard/fremdfirmen/page.tsx` |

**Service layer:** `FremdfirmenService` mirroring `PayersService` patterns.  
**Query keys:** Add `fremdfirmen` list keys to central query key factory.

---

## 9. CSV, Recurring, Duplicate

| Area | Behavior |
|------|----------|
| CSV import | Add `fremdfirma_id` (or `fremdfirma_number`) + `fremdfirma_payment_mode` + `fremdfirma_cost` as optional columns. If absent: no Fremdfirma assignment. Document "set in detail sheet" as fallback. |
| Recurring trips | Mirror `fremdfirma_id`, `fremdfirma_payment_mode` from rule to generated trips |
| Duplicate trips | **Clear** `fremdfirma_id`, `fremdfirma_payment_mode`, `fremdfirma_cost` on duplicate (trip-specific assignment, not inherited) |
| Rückfahrt | **Do not copy** `fremdfirma_id` — each leg assigned independently |

---

## 10. Implementation Order for Cursor

1. **Migration:** `fremdfirmen` table + `trips.fremdfirma_id` + `trips.fremdfirma_payment_mode` + `trips.fremdfirma_cost` + indexes + RLS + GRANTs + COMMENT ON. Regenerate `database.types.ts`.
2. **Feature module:** `src/features/fremdfirmen/` — service, hooks, list UI, types
3. **Dashboard route + nav:** `fremdfirmen/page.tsx` + nav-config.ts
4. **Status logic fix:** Extend `trip-status.ts` with Fremdfirma-assigned guard + inline comment
5. **Trip detail UI:** `trip-fremdfirma-section.tsx` — switch, select, payment mode, cost field, driver read-only, interaction rules
6. **Cross-flag interaction rules:** Wire `no_invoice_required` ↔ Fremdfirma and KTS ↔ Fremdfirma reactive logic in trip form
7. **Trips listing:** Add join, display rule, optional filter
8. **Duplicate logic:** Clear fremdfirma fields in `duplicate-trips.ts`
9. **Recurring:** Mirror fields in recurring generation
10. **CSV:** Add columns to import schema
11. **Docs:** `docs/fremdfirma.md` + `src/features/fremdfirmen/README.md`

---

## 11. V2 — Fremdfirma Invoice Reconciliation

### 11.1 `fremdfirma_invoices` Table

```sql
CREATE TABLE public.fremdfirma_invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id),
  fremdfirma_id    UUID NOT NULL REFERENCES fremdfirmen(id),
  invoice_number   TEXT,
  invoice_date     DATE NOT NULL,
  total_amount     NUMERIC(10, 2) NOT NULL,
  paid_at          TIMESTAMPTZ DEFAULT NULL,
  notes            TEXT DEFAULT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 11.2 Trip Linkage

```sql
ALTER TABLE trips
ADD COLUMN fremdfirma_invoice_id UUID REFERENCES fremdfirma_invoices(id) ON DELETE SET NULL;
-- Set when trip is reconciled into a monthly invoice
```

### 11.3 Reconciliation Flow

- Admin opens Fremdfirma detail page → "Monatsabrechnung erstellen"
- Select period → system lists all `cash_per_trip` and `monthly_invoice` trips for that Fremdfirma in period
- Admin confirms → creates `fremdfirma_invoices` row → links each trip via `fremdfirma_invoice_id`
- Mark as paid → sets `paid_at`
- Reporting: cost vs. billing comparison per Fremdfirma, per period

---

## 12. What Is Explicitly Out of Scope (V1)

- Fremdfirma inbound invoice upload or PDF parsing
- Margin dashboard (cost vs. billing comparison — V2)
- Kanban badges or column changes for Fremdfirma trips
- Rate engine (per-km calculation, fixed rate per trip type) — separate future feature
- Clearing department access to Fremdfirma records (V4/V5)
- Automatic payment triggers

---

*Document generated: 04.04.2026 — TaxiGo Strategic Architecture Session*  
*See also: KTS Spec (03.04.2026) | no_invoice_required Spec A (04.04.2026)*
