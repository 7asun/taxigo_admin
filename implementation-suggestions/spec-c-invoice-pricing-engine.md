# Spec C — Pricing Engine, Recipient Catalog & Invoice Builder Enhancement
## Architecture & Implementation Spec

**Project:** TaxiGo Admin Dashboard
**Prepared after:** Strategic brainstorming session, 04.04.2026
**Scope:** V1 implementation spec + V2 roadmap
**Status:** Locked — ready for Cursor implementation
**Related specs:** KTS Spec (03.04.2026) | Spec A no_invoice_required | Spec B Fremdfirma

---

## 1. Executive Summary

The current invoice system has a partial invoice builder (System 3) but lacks the two systems it depends on:
- **System 1 — Pricing Engine:** How much does each trip cost?
- **System 2 — Recipient Catalog:** Who receives the invoice?

Without these, the dispatcher manually resolves both questions for every invoice — which is the primary source of time waste. This spec builds all three systems in the correct dependency order and establishes a fully dynamic, admin-configurable pricing architecture designed to scale.

---

## 2. Architectural Overview

```
SYSTEM 1 — Pricing Engine
  billing_pricing_rules table
  resolveTripPrice() enhanced cascade
  Admin UI: pricing rule editor per payer/billing_type/billing_variant

SYSTEM 2 — Recipient Catalog
  rechnungsempfaenger table
  Linked to payers, billing_types, billing_variants (flexible)
  V2: linked to clients for per-office resolution

SYSTEM 3 — Invoice Builder (enhanced)
  Auto-resolution of price + recipient at line item build time
  KTS line items: €0 + note
  no_invoice_required: soft warning (hard exclusion V2)
  Aggregation by billing_type: manual split (auto-split V2)
```

---

## 3. System 1 — Pricing Engine

### 3.1 The Six Pricing Strategies

Every trip price is resolved by executing exactly one of six strategies. The strategy is declared on the catalog entry (payer, billing_type, or billing_variant level — see Section 3.3).

| Strategy Enum | Name | Description |
|---|---|---|
| `client_price_tag` | Client fixed rate | Uses `clients.price_tag` as gross amount. Reverse-calculates net. |
| `tiered_km` | Per-km tiered | Calculates from `trips.driving_distance_km` using configured tiers. |
| `fixed_below_threshold_then_km` | Threshold + km | Fixed price below N km, per-km calculation above N km (Konsil). |
| `time_based` | Time-based fixed fee | Fixed fee when trip falls outside configured working hours. €0 during hours. |
| `manual_trip_price` | Manual trip price | Uses `trips.price` field directly as net amount. |
| `no_price` | No price | Resolves to null → missing_price warning + inline editor. |

**KTS override is not a strategy — it is a pre-resolver rule** (see Section 3.2).

### 3.2 The Full Pricing Cascade

```
STEP 0 — KTS hard override (pre-resolver):
  if trips.kts_document_applies = true
  → price = €0.00, note = "Abgerechnet über KTS"
  → skip all strategy resolution
  → STOP

STEP 1 — Resolve active pricing rule:
  Find the most specific billing_pricing_rule for this trip
  (variant → billing_type → payer — most specific wins, same cascade as KTS/no_invoice)

STEP 2 — Execute strategy:
  switch(rule.strategy):
    'client_price_tag'                    → use clients.price_tag (gross)
    'tiered_km'                           → calculate from driving_distance_km + rule.tiers
    'fixed_below_threshold_then_km'       → if distance < rule.threshold_km: rule.fixed_price
                                            else: calculate per-km from rule.tiers (restart)
    'time_based'                          → if trip in working_hours: €0
                                            else: rule.fixed_fee
    'manual_trip_price'                   → use trips.price (net)
    'no_price'                            → null

STEP 3 — Fallback:
  No rule found for this trip's catalog combination
  → try trips.price (net) if set
  → else null → missing_price warning
```

### 3.3 Pricing Rule Scope — The Cascade Level Decision

The pricing strategy can be declared at **any level** of the billing catalog:
- `payer` level — applies to all trips for this Kostenträger unless overridden
- `billing_type` level — applies to all trips for this Familie unless overridden
- `billing_variant` level — most specific, always wins

This mirrors the KTS and no_invoice_required cascade pattern exactly. The same tri-level precedence applies. This gives maximum flexibility without nesting.

**Example:**
```
Kostenträger: Rehazentrum
  billing_type: Abreise → pricing_strategy: tiered_km (configured here)
  billing_type: Konsil  → pricing_strategy: fixed_below_threshold_then_km
  billing_type: Labor   → pricing_strategy: time_based
  (no billing_variant needed — strategy declared at billing_type level)

Kostenträger: FTO
  (no billing_type, no variant)
  → pricing at payer level: client_price_tag

Kostenträger: Rechnungsfahrt
  billing_type: AE
    billing_variant: Schulamt → pricing_strategy: client_price_tag
    billing_variant: Arbeitsamt → pricing_strategy: client_price_tag
```

### 3.4 New Table: `billing_pricing_rules`

```sql
CREATE TABLE public.billing_pricing_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Scope (at least one must be set; most specific wins at resolution time)
  payer_id            UUID REFERENCES payers(id) ON DELETE CASCADE DEFAULT NULL,
  billing_type_id     UUID REFERENCES billing_types(id) ON DELETE CASCADE DEFAULT NULL,
  billing_variant_id  UUID REFERENCES billing_variants(id) ON DELETE CASCADE DEFAULT NULL,

  -- Strategy declaration
  strategy            TEXT NOT NULL CHECK (strategy IN (
                        'client_price_tag',
                        'tiered_km',
                        'fixed_below_threshold_then_km',
                        'time_based',
                        'manual_trip_price',
                        'no_price'
                      )),

  -- Strategy config (JSONB — shape depends on strategy)
  config              JSONB NOT NULL DEFAULT '{}',

  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.billing_pricing_rules IS
  'Preisregeln pro Kostenträger / Abrechnungsfamilie / Unterart. Bestimmt die Preisstrategie für Fahrten bei der Rechnungserstellung.';
COMMENT ON COLUMN public.billing_pricing_rules.strategy IS
  'Preisstrategie: client_price_tag, tiered_km, fixed_below_threshold_then_km, time_based, manual_trip_price, no_price';
COMMENT ON COLUMN public.billing_pricing_rules.config IS
  'Strategiespezifische Konfiguration als JSONB. Struktur hängt von der gewählten Strategie ab.';

CREATE INDEX idx_billing_pricing_rules_company ON billing_pricing_rules(company_id);
CREATE INDEX idx_billing_pricing_rules_payer ON billing_pricing_rules(payer_id) WHERE payer_id IS NOT NULL;
CREATE INDEX idx_billing_pricing_rules_billing_type ON billing_pricing_rules(billing_type_id) WHERE billing_type_id IS NOT NULL;
CREATE INDEX idx_billing_pricing_rules_variant ON billing_pricing_rules(billing_variant_id) WHERE billing_variant_id IS NOT NULL;
```

### 3.5 Config JSONB Shapes Per Strategy

The `config` column stores strategy-specific parameters. Each shape is validated via Zod in the UI and service layer.

**`tiered_km`:**
```json
{
  "tiers": [
    { "from_km": 0, "to_km": 50, "price_per_km": 2.50 },
    { "from_km": 50, "to_km": null, "price_per_km": 1.80 }
  ]
}
```
- `to_km: null` means "all distances above from_km"
- Supports N tiers (not just two)
- All km thresholds are admin-configurable

**`fixed_below_threshold_then_km`:**
```json
{
  "threshold_km": 4,
  "fixed_price": 15.00,
  "km_tiers": [
    { "from_km": 0, "to_km": null, "price_per_km": 2.50 }
  ]
}
```
- If `driving_distance_km < threshold_km` → use `fixed_price`
- If `driving_distance_km >= threshold_km` → restart calculation from 0km using `km_tiers`
- Both `threshold_km` and `fixed_price` are admin-configurable

**`time_based`:**
```json
{
  "fixed_fee": 45.00,
  "working_hours": {
    "mon": { "start": "07:00", "end": "18:00" },
    "tue": { "start": "07:00", "end": "18:00" },
    "wed": { "start": "07:00", "end": "18:00" },
    "thu": { "start": "07:00", "end": "18:00" },
    "fri": { "start": "07:00", "end": "18:00" },
    "sat": null,
    "sun": null
  },
  "holiday_rule": "closed",
  "holidays": ["2026-01-01", "2026-12-25", "2026-12-26"]
}
```
- `null` for a day = entire day is outside working hours → billable
- `holiday_rule`: `"closed"` (billable) | `"normal"` (treat as working day)
- `holidays`: explicit date list, admin-managed

**`client_price_tag`:**
```json
{}
```
No config needed — uses `clients.price_tag` directly.

**`manual_trip_price`:**
```json
{}
```
No config needed — uses `trips.price` directly.

**`no_price`:**
```json
{}
```
No config — always resolves to null.

### 3.6 Resolver Function

```typescript
// src/features/invoices/lib/resolve-trip-price.ts

type PriceResolution = {
  gross: number | null;
  net: number | null;
  tax_rate: number; // 0.07 or 0.19
  strategy_used: PricingStrategy;
  source: 'kts_override' | 'variant' | 'billing_type' | 'payer' | 'trip_price' | 'unresolved';
  note?: string; // e.g. "Abgerechnet über KTS"
}

function resolveTripPrice(
  trip: Trip,
  client: Client | null,
  pricingRule: BillingPricingRule | null
): PriceResolution
```

The resolver is a pure function — no side effects, fully testable in isolation. Used by:
- Invoice builder Step 3 (line item engine)
- CSV export
- Trip detail sheet (preview price before invoicing)

### 3.7 Tax Rate Logic (unchanged from current system)

```
trips.driving_distance_km < 50  → 7% MwSt.
trips.driving_distance_km >= 50 → 19% MwSt.
distance missing                → 7% (conservative fallback)
```

---

## 4. System 2 — Recipient Catalog

### 4.1 The Problem

Invoice recipients (Rechnungsempfänger) are currently not stored in the system. The dispatcher manually knows who to address. This must be automated.

The recipient (who receives and pays the invoice) is independent of:
- The Kostenträger (who authorizes the trip)
- The passenger (who is transported)

They can be the same entity (FTO pays their own invoices) or different entities (Schulamt pays for students' trips).

### 4.2 New Table: `rechnungsempfaenger`

```sql
CREATE TABLE public.rechnungsempfaenger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  address_line1 TEXT DEFAULT NULL,
  address_line2 TEXT DEFAULT NULL,
  city          TEXT DEFAULT NULL,
  postal_code   TEXT DEFAULT NULL,
  country       TEXT DEFAULT NULL DEFAULT 'DE',
  email         TEXT DEFAULT NULL,
  notes         TEXT DEFAULT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rechnungsempfaenger IS
  'Rechnungsempfänger-Katalog. Unabhängig von Kostenträgern — ein Empfänger kann mehreren Kostenträgern/Varianten zugeordnet sein.';

CREATE INDEX idx_rechnungsempfaenger_company ON rechnungsempfaenger(company_id);
```

### 4.3 Linking Recipients to the Billing Catalog

Recipients are linked at any level of the billing catalog — same flexibility as pricing rules:

```sql
-- Add to payers table
ALTER TABLE payers
ADD COLUMN rechnungsempfaenger_id UUID REFERENCES rechnungsempfaenger(id) ON DELETE SET NULL DEFAULT NULL;

-- Add to billing_types table
ALTER TABLE billing_types
ADD COLUMN rechnungsempfaenger_id UUID REFERENCES rechnungsempfaenger(id) ON DELETE SET NULL DEFAULT NULL;

-- Add to billing_variants table
ALTER TABLE billing_variants
ADD COLUMN rechnungsempfaenger_id UUID REFERENCES rechnungsempfaenger(id) ON DELETE SET NULL DEFAULT NULL;

COMMENT ON COLUMN payers.rechnungsempfaenger_id IS
  'Standard-Rechnungsempfänger für diesen Kostenträger. Kann auf Familien- oder Unterart-Ebene überschrieben werden.';
COMMENT ON COLUMN billing_variants.rechnungsempfaenger_id IS
  'Überschreibt den Empfänger des Kostenträgers/der Familie für diese Unterart (z.B. Arbeitsamt-Variante → Arbeitsamt-Adresse).';
```

**Resolution cascade (most specific wins):**
```
billing_variants.rechnungsempfaenger_id
    ↓ (if null)
billing_types.rechnungsempfaenger_id
    ↓ (if null)
payers.rechnungsempfaenger_id
    ↓ (if null)
→ payer address used directly (fallback for standard payers like FTO)
```

### 4.4 V2 — Client-Level Recipient Resolution

When a billing_variant maps to a recipient that varies by regional office (e.g., different Arbeitsamt locations):

```sql
-- V2 only — do not build in V1
ALTER TABLE clients
ADD COLUMN rechnungsempfaenger_id UUID REFERENCES rechnungsempfaenger(id) ON DELETE SET NULL DEFAULT NULL;
```

V2 resolution cascade:
```
clients.rechnungsempfaenger_id          ← most specific
    ↓ (if null)
billing_variants.rechnungsempfaenger_id
    ↓ ...
```

---

## 5. System 3 — Invoice Builder Enhancements

### 5.1 What Changes in the Builder

The existing 4-step wizard is structurally sound. The enhancements are:

| Step | Current | Enhanced |
|------|---------|----------|
| Step 1 | Mode selection | + Recipient auto-resolved and shown as preview |
| Step 2 | Parameters | + Pricing rule preview per catalog selection |
| Step 3 | Line items | + Price auto-resolved via resolveTripPrice() cascade; KTS items show €0 + note; no_invoice_required soft warning |
| Step 4 | Summary | + Recipient confirmation; + pricing strategy breakdown tooltip |

### 5.2 Line Item Engine Changes

The `BuilderLineItem` type gains new fields:

```typescript
type BuilderLineItem = {
  // existing fields...
  price_resolution: PriceResolution;        // full resolution result
  pricing_strategy_used: PricingStrategy;   // which strategy fired
  pricing_source: string;                   // 'variant' | 'billing_type' | 'payer' | etc.
  kts_override: boolean;                    // true if KTS forced €0
  no_invoice_warning: boolean;              // true if no_invoice_required = true
}
```

### 5.3 KTS Line Items

When `kts_document_applies = true` on a trip:
- Price resolves to €0.00 (gross and net)
- Line item note: "Abgerechnet über KTS — kein Rechnungsbetrag"
- Displayed with a distinct KTS badge on the line item row
- Included in the invoice (Kostenträger sees the trip was done)
- Does NOT contribute to invoice total

### 5.4 no_invoice_required Line Items (V1 — Soft Warning)

When `no_invoice_required = true` on a trip:
- Trip appears in the line item list with an amber warning badge
- Warning: "Diese Fahrt ist als 'Keine Rechnung' markiert"
- Dispatcher can remove it from the invoice manually
- No hard exclusion in V1

### 5.5 Recipient Display in Builder

At Step 2 (parameter collection), after the dispatcher selects Kostenträger + billing_type + billing_variant:
- Resolve and display: "Rechnungsempfänger: {resolved name + address preview}"
- If no recipient resolved: amber warning "Kein Empfänger konfiguriert — bitte in Stammdaten prüfen"
- Recipient can be overridden manually for this invoice only (stored on invoice, not on catalog)

### 5.6 Aggregation — Manual Split (V1)

The dispatcher manually selects which billing_type to invoice in Step 2. The system does not auto-split. V2 will introduce auto-split by billing_type.

---

## 6. Database Schema — Summary of All Changes

### 6.1 New Tables

```
billing_pricing_rules    — pricing strategy + config per catalog level
rechnungsempfaenger      — recipient catalog
```

### 6.2 Altered Tables

```
payers                   + rechnungsempfaenger_id (FK, nullable)
billing_types            + rechnungsempfaenger_id (FK, nullable)
billing_variants         + rechnungsempfaenger_id (FK, nullable)
invoices                 + rechnungsempfaenger_id (FK, nullable — invoice-level override)
                         + rechnungsempfaenger_snapshot JSONB (frozen at invoice creation)
invoice_line_items       + pricing_strategy_used TEXT
                         + pricing_source TEXT
                         + kts_override BOOLEAN NOT NULL DEFAULT FALSE
```

### 6.3 Invoice Snapshot Extension

The existing snapshot pattern must capture the resolved recipient at invoice creation time:

```sql
ALTER TABLE invoices
ADD COLUMN rechnungsempfaenger_id UUID REFERENCES rechnungsempfaenger(id) ON DELETE SET NULL,
ADD COLUMN rechnungsempfaenger_snapshot JSONB DEFAULT NULL;

COMMENT ON COLUMN invoices.rechnungsempfaenger_snapshot IS
  'Eingefrierene Empfängerdaten zum Zeitpunkt der Rechnungserstellung (§14 UStG Unveränderlichkeit).';
```

---

## 7. Admin UI — Pricing Rule Editor

### 7.1 Location

New section in the billing catalog admin area. Accessible from:
- Payer detail page → "Preisregeln" tab
- Billing type detail → "Preisregeln" tab
- Billing variant detail → "Preisregeln" tab

### 7.2 UI Behavior Per Strategy

**`tiered_km` editor:**
- Dynamic list of tier rows: [From km] [To km] [€ per km]
- Add/remove tier rows
- Validation: tiers must be contiguous, no gaps, last tier has `to_km = ∞`

**`fixed_below_threshold_then_km` editor:**
- [Schwellenwert km] [Festpreis unter Schwellenwert €]
- Same tier editor as tiered_km for the above-threshold calculation

**`time_based` editor:**
- Per-weekday toggle + start/end time picker
- [Außerhalb Arbeitszeiten Festpreis €]
- Holiday list: add/remove dates
- Holiday rule: Feiertag = geschlossen / normal

**`client_price_tag` / `manual_trip_price` / `no_price`:**
- No config UI — strategy selection only

### 7.3 Recipient Editor

New "Rechnungsempfänger" section in admin settings (parallel to Fremdfirmen):
- CRUD list of recipients with name + full address
- Assign recipient to payer/billing_type/billing_variant from their respective detail pages
- Shows "currently assigned to: [list of catalog entries]" for each recipient

---

## 8. Resolver Functions

All resolvers are pure functions in `src/features/invoices/lib/`:

```
resolve-trip-price.ts          — full pricing cascade (new)
resolve-rechnungsempfaenger.ts — recipient cascade (new)
resolve-pricing-rule.ts        — finds most specific billing_pricing_rule (new)
```

Existing `resolveTripPrice()` in the codebase is replaced/extended by the new implementation. The function signature must remain backward-compatible.

---

## 9. Implementation Order for Cursor

**Phase 1 — Foundation (do first, nothing else works without this)**
1. Migration: `rechnungsempfaenger` table + RLS + GRANTs + COMMENTs
2. Migration: `billing_pricing_rules` table + RLS + GRANTs + COMMENTs
3. Migration: alter `payers`, `billing_types`, `billing_variants` → add `rechnungsempfaenger_id`
4. Migration: alter `invoices` → add `rechnungsempfaenger_id` + `rechnungsempfaenger_snapshot`
5. Migration: alter `invoice_line_items` → add `pricing_strategy_used`, `pricing_source`, `kts_override`
6. Regenerate `database.types.ts`

**Phase 2 — Resolver Layer**
7. `resolve-pricing-rule.ts` — finds most specific rule for a trip's catalog combination
8. `resolve-trip-price.ts` — full cascade including KTS override and all six strategies
9. `resolve-rechnungsempfaenger.ts` — recipient cascade
10. Unit tests for all three resolvers with all strategy combinations

**Phase 3 — Admin UI**
11. `rechnungsempfaenger` CRUD page + nav item (parallel to Fremdfirmen)
12. Recipient assignment on payer detail, billing_type detail, billing_variant detail
13. Pricing rule editor per catalog level — all six strategies with their config UIs
14. Zod schemas for all config JSONB shapes

**Phase 4 — Invoice Builder Enhancement**
15. Step 2: recipient preview + missing recipient warning
16. Step 3: wire `resolveTripPrice()` into line item engine; KTS badge + €0 display; no_invoice_required warning badge
17. Step 4: recipient confirmation + pricing strategy breakdown tooltip
18. Snapshot: capture `rechnungsempfaenger_snapshot` on invoice creation

**Phase 5 — PDF**
19. Update `buildInvoicePdfSummary` to use `rechnungsempfaenger_snapshot` for recipient address block

---

## 10. V2 Roadmap

| Feature | Notes |
|---------|-------|
| Client-level recipient (`clients.rechnungsempfaenger_id`) | Solves regional office problem (different Arbeitsamt locations per client) |
| Auto-split by billing_type | Invoice builder auto-generates separate invoices per billing_type for the same Kostenträger |
| Hard exclusion of `no_invoice_required` trips | Remove from invoice batches entirely |
| Price preview on trip detail | Show resolved price before invoicing |
| Pricing audit log | Track when pricing rules change and how it affected historical invoices |

---

## 11. What Is Explicitly Out of Scope (V1)

- Client-level recipient resolution
- Auto-split of trips by billing_type into separate invoices
- Hard exclusion of no_invoice_required trips from invoice builder
- Automatic pricing on trip creation (pricing only resolves at invoice build time)
- Fremdfirma inbound invoice reconciliation (Spec B V2)
- Price preview on trip detail sheet

---

## 12. Open Product Decisions (Confirm Before Implementation)

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Price cascade priority: client_price_tag vs tiered_km | Does a client with a price_tag override the billing_type's tiered_km rule? | **Yes — client_price_tag always wins after KTS override.** Admin can remove price_tag if km pricing should apply. |
| Missing pricing rule fallback | If no rule exists, use trips.price or show warning? | Use `trips.price` if set, then null → warning |
| Invoice recipient override at invoice level | Can dispatcher override recipient for a single invoice without changing catalog? | **Yes — store override on `invoices.rechnungsempfaenger_id`** |

---

*Document generated: 04.04.2026 — TaxiGo Strategic Architecture Session*
*See also: KTS Spec (03.04.2026) | Spec A no_invoice_required | Spec B Fremdfirma*
