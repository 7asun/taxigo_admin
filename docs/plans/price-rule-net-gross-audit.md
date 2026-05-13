# Audit — Price Rule Net/Gross Configuration (Read-Only)

**Date:** 2026-05-13  
**Scope:** Data model, calculation engine, VAT, admin UI, documents, tests, docs. **No code changes.**

## Summary of current state

This codebase does **not** define a SQL table named `price_rules`. Configurable catalog pricing lives in **`billing_pricing_rules`** (`strategy` + `config` JSONB), with **client-specific negotiated amounts** in **`client_price_tags`** (`price_gross`) and legacy **`clients.price_tag`**. There is **no column or flag** on `billing_pricing_rules` that states whether configured rates are net or gross; convention is **implicit**: km tiers, fixed prices, time-based fees, and `approach_fee_net` are treated and labeled as **net** in the admin UI and engine, while client price tags are **gross**. VAT rates (**7%** / **19%**) come from **`resolveTaxRate(driving_distance_km)`** in a single TypeScript module—**not** from the database, env, or per rule. Trip rows store **`base_net_price`**, **`approach_fee_net`**, a **generated `net_price`**, plus **`gross_price`** and **`tax_rate`** snapshots.

---

## Full price rule column list (`billing_pricing_rules`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `uuid` (PK, default `gen_random_uuid()`) | Primary key. |
| `company_id` | `uuid` (FK → `companies`, ON DELETE CASCADE) | Tenant scope for RLS and rule loading. |
| `payer_id` | `uuid` nullable (FK → `payers`) | Scope: whole Kostenträger (exactly one of payer / billing_type / variant must be set). |
| `billing_type_id` | `uuid` nullable (FK → `billing_types`) | Scope: all variants under one Abrechnungsfamilie. |
| `billing_variant_id` | `uuid` nullable (FK → `billing_variants`) | Scope: single Unterart (most specific). |
| `strategy` | `text` (CHECK enum) | One of: `client_price_tag`, `tiered_km`, `fixed_below_threshold_then_km`, `time_based`, `manual_trip_price`, `no_price`. |
| `config` | `jsonb` (default `{}`) | Strategy parameters + optional `approach_fee_net`; validated in app (Zod) before write. |
| `is_active` | `boolean` (default `true`) | Inactive rules ignored; partial unique indexes enforce one active rule per scope. |
| `created_at` | `timestamptz` (default `now()`) | Audit. |
| `updated_at` | `timestamptz` (default `now()`) | Audit. |

**Source:** `supabase/migrations/20260405100000_billing_pricing_rules.sql`, `src/types/database.types.ts` (`billing_pricing_rules.Row`).

**Related table (not `billing_pricing_rules`, but pricing-related):** `client_price_tags` — `price_gross`, scope via `client_id` + optional `payer_id` / `billing_variant_id`, `is_active`, timestamps (`supabase/migrations/20260412140000_client_price_tags.sql`).

---

## VAT handling map

| Stage | File / area | What happens |
|--------|----------------|--------------|
| **Rate resolution** | `src/features/invoices/lib/tax-calculator.ts` | `resolveTaxRate(distanceKm)`: **0.07** if distance &lt; 50 km or missing (**fallback**), **0.19** if ≥ 50 km. Constants `TAX_RATES`, `DISTANCE_THRESHOLD_KM`. Commented future hooks (vehicle, variant override). **Not** DB or env. |
| **Pure resolution (transport only)** | `src/features/invoices/lib/resolve-trip-price.ts` | For **net-anchored** strategies, `resolution()` sets `gross = roundMoneyOnce(net * (1 + taxRate))` unless `partial.gross` is supplied. **`approach_fee_net` is never inside `PriceResolution.gross`** (documented in-file). |
| **Gross-anchored paths in resolver** | Same | **P0** `manual_gross_price`: net = gross / (1 + taxRate). **P2** client tag: gross fixed, net = gross / (1 + taxRate). **P1 KTS**: net/gross 0, `tax_rate` still populated. **time_based** inside hours: explicit `gross: 0`. |
| **Trip row snapshot** | `src/features/trips/lib/trip-price-engine.ts` | After `resolveTripPrice`, **VAT applied once** to `(base_net_price + approach_fee_net)` → `gross_price`; `tax_rate` stored when base net resolved. |
| **Invoice lines** | `src/features/invoices/api/invoice-line-items.api.ts` (see existing audit in `docs/plans/price-engine-vat-audit.md`) | Line `total_price`: **gross-anchor** path for `client_price_tag` vs **net-anchor** `(unit × qty + approach_net) × (1 + tax_rate)`. Totals: `calculateInvoiceTotals` buckets by rate. |
| **Invoice PDF** | `invoice-pdf-cover-body.tsx` | **Summe Nettobeträge**, **zzgl. Umsatzsteuer** per rate, **Bruttobetrag (Zahlungsbetrag)**. |

---

## Admin UI field inventory

**Primary component:** `src/features/payers/components/pricing-rule-dialog/index.tsx` — **`PricingRuleDialog`**.

**Create flow**

1. **`Step1StrategyPicker`** (`step1-strategy-picker.tsx`): tile buttons for each `PRICING_STRATEGIES` entry.
2. **`Step2RuleConfig`** (`step2-rule-config.tsx`), strategy-dependent:
   - **`tiered_km`:** per row — `from_km`, `to_km`, `price_per_km` (label **„€/km netto“**), append/remove tier.
   - **`fixed_below_threshold_then_km`:** `threshold_km`, `fixed_price` (label **„Festpreis unter Schwelle (netto)“**), `km_tiers[]` same as tiered (€/km netto).
   - **`time_based`:** `fixed_fee` (**netto**), per-weekday `Switch` + `start`/`end` time, `holiday_rule` select, holiday date list (DatePicker + add/remove).
   - **`client_price_tag` (edit only):** informational text (amount from Fahrgast **Brutto**).
   - **`manual_trip_price` / `no_price`:** informational text only.
   - **Shared (all strategies except `client_price_tag`):** `approach_fee_net` — **„Anfahrtspreis (Netto, optional)“**.
3. **`Step2ScopePicker`** (when creating from global Preisregeln page): Kostenträger → optional Abrechnungsfamilie → optional Unterart.

**`client_price_tag` create path:** **`ClientPriceTagStep`** (`client-price-tag-step.tsx`) — client search/select, scope picker, **„Preis brutto (€)”**, list rows with **„… brutto“**, active toggle, edit/delete.

**`client_km_override`:** **`ClientKmOverrideStep`** — separate KM override manager (not persisted on `billing_pricing_rules` as a strategy in DB per project docs).

**API writes:** `src/features/payers/api/billing-pricing-rules.api.ts` — `createPricingRule` / `updatePricingRule` via Supabase client from the browser; config validated with `billingPricingRuleUpsertSchema` (`pricing-rule-config.schema.ts`). **No Supabase Edge Functions** present under `supabase/functions` in this repo for pricing.

---

## Document / display surface inventory

| Location | What is shown | Net / gross labeling |
|----------|----------------|----------------------|
| **Trips data table** | `gross_price`, optional `net_price` | Columns titled **„Brutto“** and **„Netto“** (`trips-tables/columns.tsx`). |
| **Trip detail sheet** | `gross_price` in route header badge | **Unlabeled** amount + € (no „Brutto“ in badge text) (`trip-detail-sheet.tsx`). |
| **Kanban** | _(no price fields found in `kanban/` grep)_ | — |
| **Shift reconciliation trips table** | Column **„Betrag“**: `manual_gross_price` if set, else `gross_price`; edits write **`manual_gross_price`** (gross / taxameter semantics per field names) (`shift-trips-table.tsx`). | **„Betrag“** — no net/brutto qualifier on the column header. |
| **Invoice builder UI** | Line amounts, MwSt breakdown when row expanded | **MwSt** rate and net/VAT breakdown (`step-3-line-items.tsx` per codebase grep). |
| **Invoice PDF cover** | Totals block | **Summe Nettobeträge**, **zzgl. Umsatzsteuer X%**, **Bruttobetrag (Zahlungsbetrag)** (`invoice-pdf-cover-body.tsx`). |
| **Invoice PDF columns** | Configurable columns via catalog | Includes tax rate / net derivation from persisted line gross in `pdf-column-catalog.ts` (descriptions reference Netto/Brutto/MwSt.). |

**German tax-style breakdown on invoices:** **Yes** — PDF cover shows net subtotal, VAT by rate, and gross payment amount (see table above).

---

## Answers to numbered questions

### Data Model

**1. What columns does the `price_rules` table currently have?**  
There is **no** `price_rules` table. The equivalent catalog table is **`billing_pricing_rules`**; see the column table above (10 columns).

**2. Is there currently any column or flag that distinguishes net from gross pricing?**  
**No.** `billing_pricing_rules` has no `is_gross`, `pricing_type`, or similar. Behavior is **implicit**: JSON amounts and UI copy assume **net** for catalog rules; **gross** is explicit only on **`client_price_tags.price_gross`** / legacy **`clients.price_tag`**, and on **`trips.manual_gross_price`** (taxameter).

**3. What VAT/tax rate is currently applied, and where is it defined?**  
**7%** or **19%** as decimal fractions (`0.07` / `0.19`), from **`src/features/invoices/lib/tax-calculator.ts`** (`TAX_RATES`, `DISTANCE_THRESHOLD_KM` = 50 km). **Hardcoded** in TS; **not** DB, **not** env (for this rate logic). **Single global rule** by distance (with `null` distance → 7% fallback). **Not** per price rule or per trip row at definition time beyond storing resolved `tax_rate` on **`trips`** and line items.

### Calculation Engine

**4. At what point in the calculation is VAT applied?**  
- **Inside `resolveTripPrice`:** After strategy computes **transport net**, `resolution()` derives **transport gross** as `net × (1 + tax)` (unless gross supplied, e.g. client tag / taxameter). **Not** applied inside km summation loops—tiers sum **net** first (`tieredNetTotal`), then gross is applied once on that total **in `resolution()`** (`resolve-trip-price.ts`).  
- **Trip snapshot (`computeTripPrice`):** VAT applied **again at trip level** to **`(resolution.net + approach_fee_net)`** → `trips.gross_price` (`trip-price-engine.ts`).  
- **Invoicing:** VAT at **line total** when persisting `total_price` and in **`calculateInvoiceTotals`** (see `docs/plans/price-engine-vat-audit.md`).

**5. Is VAT applied unconditionally to every trip, or is there conditional logic?**  
**Rate** is always one of 7% / 19% for normal pricing paths. **Amount:** **KTS** → 0 / 0 (no VAT money). **time_based** inside working hours → 0 / 0. **Unresolved** → null prices, `tax_rate` may still appear on `PriceResolution` in P5 null case **with** rate in object; trip engine sets `tax_rate` null when `base_net_price` unresolved (`computeTripPrice`). **Conditional** in the sense of **zero-amount branches**, not “VAT disabled” as a separate flag.

**6. How is final `gross_price` stored on the trip? Net also stored?**  
**Stored:** `gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net`. **`net_price`** is a **generated column**: `COALESCE(base_net_price,0) + COALESCE(approach_fee_net,0)` (`20260425120000_net_price_generated.sql`). So **combined net** is always derivable; **components** are stored separately.

### Admin UI

**7. Which component renders the price rule create/edit form?**  
**`PricingRuleDialog`** — `src/features/payers/components/pricing-rule-dialog/index.tsx`. Fields are listed in **Admin UI field inventory** above (strategy picker, `Step2RuleConfig` fields by strategy, scope picker, `ClientPriceTagStep` / `ClientKmOverrideStep`).

**8. Is there any existing UI for toggling or selecting pricing modes (net vs gross for rule rates)?**  
**No** global toggle. The UI **labels** catalog monetary fields as **net** (and **brutto** only for client price tags / client manager), but there is **no** control to switch interpretation of `billing_pricing_rules.config` amounts.

### Documents & Display

**9. Where is the trip price displayed or printed?**  
- **Trips table:** Brutto + Netto columns.  
- **Trip detail:** badge with gross amount; **unlabeled** as brutto in the badge itself.  
- **Shift reconciliation:** **„Betrag“** column — `manual_gross_price` or `gross_price` (see display table).  
- **Invoice builder (Step 3):** line pricing, Taxameter badge, MwSt breakdown on expand.  
- **Invoices / PDF:** line and summary amounts with explicit net / VAT / gross labels on the PDF cover.  
Kanban cards were **not** found to surface price fields in this repo snapshot.

**10. Does any invoice or document output require both net and gross separately (German compliance style)?**  
**Yes** — invoice PDF cover shows **Summe Nettobeträge**, **Umsatzsteuer** by rate, and **Bruttobetrag (Zahlungsbetrag)** (`invoice-pdf-cover-body.tsx`).

---

## Existing tests for price calculation logic

| Test file | Focus |
|-----------|--------|
| `src/features/trips/lib/__tests__/trip-price-engine.test.ts` | `computeTripPrice`, `shouldRecalculatePrice` (Bun test). |
| `src/features/invoices/lib/__tests__/resolve-trip-price.test.ts` | `tieredNetTotal`, `resolveTripPrice` cascade (P0 taxameter, KTS, tags, tiers, etc.). |
| `src/features/invoices/lib/__tests__/line-item-net-display.test.ts` | Line net display math. |
| `src/features/invoices/components/invoice-pdf/lib/__tests__/build-invoice-pdf-summary-billing-label.test.ts` | PDF summary / tax_rate grouping. |
| `src/features/angebote/lib/angebot-formula-engine.test.ts` | Separate **Angebot** formula engine with gross→net conversion scenarios (not the trip `billing_pricing_rules` engine). |

---

## `docs/` references (pricing / VAT)

- `docs/price-calculation-engine.md` — architecture, `loadPricingContext`, `computeTripPrice`, wiring, VAT reference to `tax-calculator.ts`.  
- `docs/pricing-engine.md` — catalog cascade, `resolvePricingRule`, approach fee.  
- `docs/preisregeln.md` — central Preisregeln page, dialog behavior.  
- `docs/plans/price-engine-vat-audit.md` — VAT application loci (trip snapshot vs invoice lines vs resolver).  
- `docs/plans/price-calculation-audit.md`, `docs/plans/price-engine-resolution-audit.md`, and related plan files — historical audits.

---

## Senior recommendation: adding per-rule `is_gross` (or `pricing_type`)

**Goal alignment:** Today **implicit contracts** split three ways: (a) catalog **`config` numbers = net**, (b) **client tags = gross**, (c) **taxameter field = gross**. A flag on **`billing_pricing_rules`** only helps (a); it must **not** contradict (b)(c) without a wider spec.

**Safest approach**

1. **Schema:** Add nullable **`pricing_basis`** enum or boolean with **default `net`** (or `NULL` meaning net for backward compatibility). Migration must document: existing rows = **net** semantics (matches current engine).  
2. **Backward compatibility:** Default **`net`** preserves all existing numeric interpretations. **No mass data rewrite** of `config` values if default is net.  
3. **Engine branching (high-touch):**  
   - In **`executeStrategy`** (and anywhere `approach_fee_net` is read), if **`gross` basis**: interpret tier rates, fixed fees, threshold flat, and possibly **`approach_fee_net`** as **gross** → convert to net via **`/(1 + taxRate)`** before summing tiers or attaching approach, **or** define precisely whether approach stays net (product decision).  
   - **`trip-price-engine.ts`** already grosses up `(baseNet + approachNet)`; inputs to that sum must remain **net** after conversion.  
   - **`insertLineItems` / gross-anchor detection** must treat new “rule config is gross” analogously to **`client_price_tag`** if final line semantics need to anchor on gross (today’s **two-path** invoice math).  
4. **UI:** `Step2RuleConfig` needs a clear control; labels (“€/km netto”) must switch or clarify when gross mode is on. **Validation:** Zod may stay the same (numbers are nonnegative; semantics shift).  
5. **Tests:** Extend `resolve-trip-price.test.ts` and `trip-price-engine.test.ts` for one gross rule with 7% and 19% distances; add invoice line parity tests if gross-anchor path is used.  
6. **Risk notes:**  
   - **Rounding order:** gross-tier vs net-tier rounding can change totals; lock rules in tests.  
   - **Approach fee:** today explicitly **net**; mixing gross base + net approach without a spec is error-prone.  
   - **Client tag precedence** still **overrides** catalog rule for price **amount** when tag wins in cascade—flag on catalog row must not confuse that path.  
   - **Trip vs invoice parity:** two loci already differ slightly (see VAT audit); gross rules could widen gaps unless both paths share one normalization helper.

**Honest recommendation:** Prefer a single explicit **`pricing_basis`** enum on **`billing_pricing_rules`** (`net` | `gross` for **config numerics**), default **`net`**, implement **one shared “normalize rule config to net”** function used by **`resolveTripPrice`** and invoice building, and **decide approach fee in writing** (likely **always net** even when km/fixed are gross, for consistency with today's Anfahrt docs). If product instead wants **all-in gross including approach**, treat that as a larger contract change.

---

**No code changes were made in producing this audit.**
