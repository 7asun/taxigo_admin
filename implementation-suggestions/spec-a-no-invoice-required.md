# Spec A — `no_invoice_required` Flag
## Architecture & Implementation Spec

**Project:** TaxiGo Admin Dashboard  
**Prepared after:** Strategic brainstorming session, 04.04.2026  
**Scope:** V1 implementation spec + V2 roadmap  
**Status:** Locked — ready for Cursor implementation  
**Related specs:** KTS Architecture Spec (03.04.2026), Fremdfirma Spec B (04.04.2026)

---

## 1. Executive Summary

`no_invoice_required` is the second operational flag in TaxiGo's three-flag trip model, following the same cascade architecture as `kts_document_applies`. It signals that a trip does **not** generate an invoice to a Kostenträger — either because the patient pays directly (Selbstzahler), or for any other reason the admin designates at the catalog level (charity, internal, test, etc.).

The flag is **billing-catalog-driven** with a cascade default, always overridable by the admin, and feeds directly into the Fremdfirma payment mode logic (Spec B).

---

## 2. Problem Statement

### 2.1 What Exists Today

`Selbstzahler` already exists as a Payer, billing_type, or billing_variant in the catalog. The admin selects it like any other Kostenträger. However, the system has no behavioral flag that tells downstream processes: *"do not generate an invoice for this trip."*

### 2.2 What Is Missing

A trip-level flag that:
- Is pre-resolved from the billing catalog at trip creation
- Prevents incorrect invoice batch inclusion (soft warning v1, hard exclusion v2)
- Signals to the Fremdfirma layer that the external company collects directly from the patient
- Plants a seed for cash collection tracking (`selbstzahler_collected_amount`)

### 2.3 Why Not Encode This in the Billing Catalog Alone?

The billing catalog answers: *"Who pays you and how is the trip categorized?"*  
`no_invoice_required` answers: *"Should an invoice even be generated for this trip?"*  
These are different questions. A catalog entry named "Selbstzahler" does not automatically instruct the invoice engine — only an explicit behavioral flag on the trip can do that reliably.

---

## 3. Cascade Model

### 3.1 Tri-State at Each Catalog Level

Identical pattern to `kts_document_applies`. Use tri-state (`yes | no | unset`) at every billing catalog level. Most specific level that is not `unset` wins.

**Precedence (most specific wins):**

```
billing_variants.no_invoice_required_default
    ↓ (if unset)
billing_types.behavior_profile.no_invoice_required_default
    ↓ (if unset)
payers.no_invoice_required_default
    ↓ (if unset)
false  ← system default
```

### 3.2 Resolver Function

Single shared function, used everywhere (trip create, trip edit, CSV import, recurring generation):

```typescript
function resolveNoInvoiceRequiredDefault(
  payer: Payer,
  family: BillingType,
  variant: BillingVariant | null
): { value: boolean; source: 'variant' | 'familie' | 'payer' | 'system_default' }
```

Same logic pattern as `resolveKtsDefault()` — see KTS spec for reference implementation.

---

## 4. Database Schema Changes

### 4.1 `payers` Table

```sql
ALTER TABLE payers
ADD COLUMN no_invoice_required_default BOOLEAN DEFAULT NULL;
-- NULL = unset (inherit), TRUE = yes, FALSE = no
COMMENT ON COLUMN payers.no_invoice_required_default IS
  'Cascade seed: wenn TRUE, wird für Fahrten mit diesem Kostenträger standardmäßig keine Rechnung erstellt (z.B. Selbstzahler). NULL = vererben.';
```

### 4.2 `billing_types` — `behavior_profile` JSON Extension

Extend the existing `behavior_profile` JSONB column and Zod schema:

```typescript
type BillingTypeBehavior = {
  // ... existing fields (kts_default, etc.) ...
  no_invoice_required_default: 'yes' | 'no' | 'unset'; // NEW
};
```

Default for existing records: `'unset'` — fully backward-compatible.

### 4.3 `billing_variants` Table

```sql
ALTER TABLE billing_variants
ADD COLUMN no_invoice_required_default BOOLEAN DEFAULT NULL;
-- NULL = unset (inherit), TRUE = yes, FALSE = no
COMMENT ON COLUMN billing_variants.no_invoice_required_default IS
  'Unterart-Ebene: überschreibt Familien- und Kostenträger-Standard für no_invoice_required.';
```

### 4.4 `trips` Table

```sql
ALTER TABLE trips
ADD COLUMN no_invoice_required BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN no_invoice_source VARCHAR(20) DEFAULT NULL,
ADD COLUMN selbstzahler_collected_amount NUMERIC(10, 2) DEFAULT NULL;

-- no_invoice_source values: 'variant' | 'familie' | 'payer' | 'manual' | 'system_default'

COMMENT ON COLUMN trips.no_invoice_required IS
  'TRUE = für diese Fahrt wird keine Rechnung an den Kostenträger erstellt (z.B. Selbstzahler, interne Fahrt).';
COMMENT ON COLUMN trips.no_invoice_source IS
  'Gibt an, woher no_invoice_required gesetzt wurde: variant, familie, payer, manual oder system_default.';
COMMENT ON COLUMN trips.selbstzahler_collected_amount IS
  'Seed-Feld: vom Patienten direkt kassierter Betrag (Selbstzahler ohne Fremdfirma). V1: kein UI-Enforcement. Für späteres Cash-Reporting.';
```

**Note on `selbstzahler_collected_amount`:** No UI field in v1. No enforcement. The column exists purely as a data foundation for future cash collection reporting. Do not expose it in the trip form until the cash collection feature is scoped.

---

## 5. Interaction with Fremdfirma (Spec B)

This is the most important cross-spec rule:

```
no_invoice_required = true AND fremdfirma_id IS NOT NULL
    → auto-set fremdfirma_payment_mode = 'self_payer'
    → hide fremdfirma_cost field (admin can override in edge cases)
```

**Implementation:** This logic lives in the trip form's `useEffect` / reactive layer — when both conditions are true, pre-select `self_payer` and show hint: *"Keine Rechnung aktiv — Fremdfirma erhält Zahlung direkt vom Patienten."* Admin can still override `fremdfirma_payment_mode` manually.

---

## 6. Interaction with KTS

`no_invoice_required` and `kts_document_applies` can technically coexist (rare edge case acknowledged). The system does **not** block this combination. Instead:

- Show a **soft validation warning** on the trip form when both are active:  
  *"KTS und Keine Rechnung sind gleichzeitig aktiv — bitte prüfen ob dies korrekt ist."*
- Warning is dismissible. No hard block.
- Both flags are saved independently.

---

## 7. Trip Form UI

### 7.1 The Switch

- **Label:** `Keine Rechnung erforderlich`
- **Position:** Billing/Abrechnung section, after Unterart, alongside KTS switch
- **Visibility:** Always visible when a payer is selected
- **Default state:** Pre-filled by `resolveNoInvoiceRequiredDefault()`

### 7.2 Hint and Warning Behavior

| Situation | UI Behavior |
|-----------|-------------|
| Cascade resolves `true` | Pre-checked + hint: "Voreingestellt aus {source level}: {name}" |
| Admin manually overrides cascade-`true` to `false` | Soft warning: "Dieser Wert wurde automatisch gesetzt. Bitte nur deaktivieren wenn begründet." |
| Both `no_invoice_required` AND `kts_document_applies` active | Soft validation warning (see Section 6) |
| `no_invoice_required` + `fremdfirma_id` set | Hint: "Keine Rechnung aktiv — Fremdfirma erhält Zahlung direkt vom Patienten." |

### 7.3 Invoice Batch Behavior (V1)

Option B: Soft warning. KTS trips (`no_invoice_required = true`) can still be added to invoice batches. The system shows:
- A `Keine Rechnung` badge on the trip row in billing/invoice views
- Inline warning if included in a batch: *"Diese Fahrt ist als 'Keine Rechnung' markiert — bitte vor Versand prüfen."*

---

## 8. CSV, Recurring, Duplicate

| Area | Behavior |
|------|----------|
| CSV import | Add `no_invoice_required` column (nullable boolean). Blank = apply cascade. Present = explicit override, `no_invoice_source = 'manual'`. |
| Recurring trips | Mirror `no_invoice_required` and `no_invoice_source` from rule to generated trips |
| Duplicate / Rückfahrt | Copy both columns. Set `no_invoice_source = 'manual'` on duplicate (inherited via duplication, not fresh cascade resolution) |

---

## 9. Implementation Order for Cursor

1. **Migration:** `payers.no_invoice_required_default`, `billing_variants.no_invoice_required_default`, extend `behavior_profile` Zod schema, `trips.no_invoice_required` + `trips.no_invoice_source` + `trips.selbstzahler_collected_amount`
2. **Resolver function:** `src/features/trips/lib/resolve-no-invoice-required.ts`
3. **Catalog UI:** Extend payer form, billing-type-behavior-dialog.tsx, billing_variant form — same pattern as KTS
4. **Trip form:** Switch + hint + soft warnings + KTS coexistence warning + Fremdfirma interaction
5. **Duplicate/Rückfahrt logic:** Extend existing duplicate helpers
6. **Recurring:** Mirror flag in recurring generation
7. **CSV:** Add column to import schema
8. **Invoice/billing views:** Add badge + soft warning
9. **Docs:** `docs/no-invoice-required.md`

---

## 10. V2 Roadmap

| Feature | Notes |
|---------|-------|
| Hard exclusion from invoice batches (Option C) | Exclude `no_invoice_required = true` trips from batch generation entirely |
| `selbstzahler_collected_amount` UI | Cash collection entry field on trip detail, cash report per period |
| Cash collection report | Sum of `selbstzahler_collected_amount` by driver, date range, payer |

---

## 11. What Is Explicitly Out of Scope (V1)

- Cash collection UI (`selbstzahler_collected_amount` column exists, no form field)
- Hard invoice batch exclusion (soft warning only in v1)
- Any changes to invoice PDF generation
- Kanban badges or column changes

---

*Document generated: 04.04.2026 — TaxiGo Strategic Architecture Session*  
*See also: KTS Spec (03.04.2026) | Fremdfirma Spec B (04.04.2026)*
