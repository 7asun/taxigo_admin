---
name: pricing_basis billing rules
overview: Add a DB enum column `pricing_basis` on `billing_pricing_rules`, thread it through `BillingPricingRuleLike` and admin API/UI, and normalize rule `config` to net in `resolveTripPrice` before `executeStrategy`—leaving `approach_fee_net`, client tag, and taxameter paths unchanged.
todos:
  - id: migration-pricing-basis
    content: Add Supabase migration pricing_basis_enum + column on billing_pricing_rules
    status: pending
  - id: types-map-like
    content: Update database.types, BillingPricingRuleLike, mapBillingPricingRuleRowsToLike, synthetic rules
    status: pending
  - id: normalizer-round
    content: Extract roundMoneyOnce; implement normalizeRuleConfigToNet + unit tests
    status: pending
  - id: resolver-wire
    content: Wire normalization in resolve-trip-price P3; keep P0-P2 untouched
    status: pending
  - id: zod-api-ui
    content: Extend billingPricingRuleUpsertSchema, billing-pricing-rules API, dialog form + step2 UI
    status: pending
  - id: tests-docs
    content: Extend resolve-trip-price + trip-price-engine tests; update docs + audit status
    status: pending
isProject: false
---

# Plan: Per-rule `pricing_basis` (`net` | `gross`)

## Scope corrections vs your draft

- **Zod + parse schema path:** The upsert schema lives at [`src/features/invoices/lib/pricing-rule-config.schema.ts`](src/features/invoices/lib/pricing-rule-config.schema.ts), not `src/features/payers/lib/...`.
- **Trip engine:** [`src/features/trips/lib/trip-price-engine.ts`](src/features/trips/lib/trip-price-engine.ts) likely needs **no logic change** if [`mapBillingPricingRuleRowsToLike`](src/features/invoices/api/invoice-line-items.api.ts) copies `pricing_basis` from DB rows into [`BillingPricingRuleLike`](src/features/invoices/types/pricing.types.ts); the resolver already receives the full `rule`.
- **`manual_trip_price` config:** Today it uses **`emptyConfigSchema`** (only optional `approach_fee_net`)—there is **no `price` field** in config ([`pricing-rule-config.schema.ts`](src/features/invoices/lib/pricing-rule-config.schema.ts) lines 95–97). The normalizer is a **no-op** for monetary fields; the UI toggle for “Preisbasis” adds little value for this strategy. **Recommendation:** show the toggle only for **`tiered_km`**, **`fixed_below_threshold_then_km`**, and **`time_based`** to match real data; if you insist on showing it for `manual_trip_price`, it only documents intent for the future.
- **`roundMoneyOnce`:** It is currently **private** inside [`resolve-trip-price.ts`](src/features/invoices/lib/resolve-trip-price.ts). To keep `normalize-rule-config.ts` free of engine imports **and** satisfy “reuse the same rounding”, extract **`roundMoneyOnce`** to e.g. [`src/lib/pricing/round-money-once.ts`](src/lib/pricing/round-money-once.ts) and import it from both the normalizer and `resolve-trip-price.ts`.

## Data flow (after change)

```mermaid
flowchart LR
  DB[billing_pricing_rules row]
  Map[mapBillingPricingRuleRowsToLike]
  ResolveRule[resolvePricingRule]
  ResolvePrice[resolveTripPrice]
  Norm[normalizeRuleConfigToNet]
  Exec[executeStrategy]
  DB --> Map --> ResolveRule --> ResolvePrice
  ResolvePrice --> Norm
  Norm --> Exec
```

- **P0 taxameter / P1 KTS / P2 client tag:** unchanged; **do not** normalize for those branches.
- **P3** (`executeStrategy`): use `normalizedConfig` via a **clone** `ruleWithNetConfig = { ...rule, config: normalizedConfig }` so `extractApproachFeeNet(rule)` in `withApproachFeeFromRule` still reads **original** `rule.config`… **or** rely on the fact that `approach_fee_net` is **identical** in raw and normalized output—either works; prefer **one** `rule` object with normalized `config` only for parsing inside `executeStrategy`, and keep `extractApproachFeeNet` using the **same** `config` object (normalized) so duplication is avoided. Since the normalizer **never changes** `approach_fee_net`, **single normalized `config`** is safe for both `parseConfigForStrategy` in `executeStrategy` **and** `extractApproachFeeNet`.

## Step 1 — Migration

- Add new file [`supabase/migrations/YYYYMMDDHHMMSS_pricing_basis.sql`](supabase/migrations/YYYYMMDDHHMMSS_pricing_basis.sql) exactly as you specified (`CREATE TYPE pricing_basis_enum`, `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 'net'`, `COMMENT`).
- **Note:** Application types in [`src/types/database.types.ts`](src/types/database.types.ts) are hand-maintained here—update them once after the migration shape is fixed (Step 2).

**Gate:** `bun run build` (expect TS errors until types updated in Step 2).

## Step 2 — Types

- Extend [`src/types/database.types.ts`](src/types/database.types.ts) `billing_pricing_rules` **Row / Insert / Update** with `pricing_basis: 'net' | 'gross'` (Insert/Update optional on insert).
- Extend [`BillingPricingRuleLike`](src/features/invoices/types/pricing.types.ts) with `pricing_basis: 'net' | 'gross'` (synthetic STEP 0 objects in [`resolve-pricing-rule.ts`](src/features/invoices/lib/resolve-pricing-rule.ts) should set **`'net'`**—field is ignored for client-tag gross logic).
- Optional: export `type PricingBasis = 'net' | 'gross'` from `pricing.types.ts` (or `src/lib/pricing/types.ts`) to avoid string duplication.

**Gate:** `bun run build`.

## Step 3 — Shared rounding + normalizer

- Add [`src/lib/pricing/round-money-once.ts`](src/lib/pricing/round-money-once.ts) with the existing formula `Math.round(raw * 100) / 100`.
- Refactor [`resolve-trip-price.ts`](src/features/invoices/lib/resolve-trip-price.ts) to import `roundMoneyOnce` from there (behavior unchanged).
- Add [`src/lib/pricing/normalize-rule-config.ts`](src/lib/pricing/normalize-rule-config.ts):
  - **Public API:** `normalizeRuleConfigToNet(config: unknown, strategy: PricingStrategy, pricingBasis: PricingBasis, taxRate: number): unknown`
  - **Why:** `strategy` is required because JSONB shape is strategy-specific; `manual_trip_price` / `no_price` / `client_price_tag` should return **identity** early (or only deep-copy) so callers don’t need to parse first.
  - **`gross`:** divide **`price_per_km`**, **`fixed_price`**, **`fixed_fee`** by `(1 + taxRate)`; each result passed through **`roundMoneyOnce`**. **Never** divide **`approach_fee_net`**.
  - **Constants:** define e.g. `GROSS_TO_NET_DIVISOR_OFFSET = 1` mental model as `1 + taxRate` via a local `const divisor = 1 + taxRate` (no magic `0.07`/`0.19`).
  - Add **focused unit tests** under `src/lib/pricing/__tests__/normalize-rule-config.test.ts` (isolation tests for tiers, fixed+tiers, time_based, approach fee untouched).

**Gate:** `bun run build` (tests optional until Step 7).

## Step 4 — Resolver wiring

In [`resolve-trip-price.ts`](src/features/invoices/lib/resolve-trip-price.ts), in the **P3** block only:

1. If `rule.strategy` is one of the strategies that read monetary config (`tiered_km`, `fixed_below_threshold_then_km`, `time_based`), compute `normalizedConfig = normalizeRuleConfigToNet(rule.config, rule.strategy, rule.pricing_basis ?? 'net', taxRate)`.
2. Call `executeStrategy({ ...rule, config: normalizedConfig }, ...)`.
3. **Do not** change P0/P1/P2 branches.

**Also update** [`mapBillingPricingRuleRowsToLike`](src/features/invoices/api/invoice-line-items.api.ts) to set `pricing_basis: (r.pricing_basis ?? 'net')` so every code path (invoice builder, trip engine) sees the field.

**Gate:** `bun run build` && `bun test`.

## Step 5 — Zod + API

- Extend [`billingPricingRuleUpsertSchema`](src/features/invoices/lib/pricing-rule-config.schema.ts): wrap the discriminated union with **`.and(z.object({ pricing_basis: z.enum(['net', 'gross']).default('net') }))`** so every branch accepts `pricing_basis`.
- **Payload typing:** extend [`CreatePricingRulePayload`](src/features/payers/api/billing-pricing-rules.api.ts) and **parse** `{ strategy, config, pricing_basis }` in `createPricingRule`; include **`pricing_basis`** on the Supabase **insert** object.
- **`updatePricingRule`:** extend patch with optional `pricing_basis`; when only basis changes, merge into **update** row (today’s code often requires strategy+config pair—add a branch that allows `pricing_basis` without resending full config if needed, or always load row and re-parse full payload from dialog—simplest: dialog always sends `pricing_basis` with updates).

**Gate:** `bun run build`.

## Step 6 — Admin UI

- [`pricing-rule-dialog.types.ts`](src/features/payers/components/pricing-rule-dialog/pricing-rule-dialog.types.ts): add `pricing_basis: PricingBasis` to `PricingRuleFormValues`.
- [`defaultFormValues` / `buildApiPayload`](src/features/payers/components/pricing-rule-dialog/pricing-rule-form-helpers.ts): include `pricing_basis` in defaults and return it from `buildApiPayload` (or merge in `onSubmit`—but the API needs the field).
- [`PricingRuleDialog` `onSubmit`](src/features/payers/components/pricing-rule-dialog/index.tsx): pass `pricing_basis` into `createPricingRule` / `updatePricingRule`; on **edit**, seed form from `editing.pricing_basis`.
- [`step2-rule-config.tsx`](src/features/payers/components/pricing-rule-dialog/step2-rule-config.tsx): segmented control **„Preisbasis“**, conditional visibility, dynamic **net/brutto** labels, and **static** Anfahrt copy as specified.

**Gate:** `bun run build` && `bun test`.

## Step 7 — Resolver + engine tests

- [`resolve-trip-price.test.ts`](src/features/invoices/lib/__tests__/resolve-trip-price.test.ts): gross tiered (7% / 19%), gross fixed+below+km + `approach_fee_net` unchanged, net identity. Update test helper `rule()` to accept `pricing_basis`.
- [`trip-price-engine.test.ts`](src/features/trips/lib/__tests__/trip-price-engine.test.ts): gross-basis rule snapshot equation; regression on existing nets.

**Gate:** `bun run build` && `bun test`.

## Step 8 — Docs + audit footer

- Update [`docs/price-calculation-engine.md`](docs/price-calculation-engine.md) and [`docs/pricing-engine.md`](docs/pricing-engine.md) per your outline.
- Update [`docs/plans/price-rule-net-gross-audit.md`](docs/plans/price-rule-net-gross-audit.md): **append** a short **Implementation status** block (implemented / date)—the file currently has no status table; add one.
- Add concise **why** comments at normalizer, P3 call site, and UI as requested.

**Gate:** `bun run build` && `bun test`.

## Hard rules (unchanged from your spec)

- No edits to client-tag or taxameter branches.
- `approach_fee_net` always net; never scaled by `pricing_basis`.
- No hardcoded VAT rates outside `resolveTaxRate` / `tax-calculator.ts` (normalizer receives `taxRate` from caller).
- Deferred items stay out of scope (PDF gross-anchor revisit, per-variant VAT, trips/shift UI).
