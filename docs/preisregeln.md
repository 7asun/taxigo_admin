# Preisregeln (`/dashboard/abrechnung/preise`)

Central pricing catalog for all companies. Manages both billing rules (`billing_pricing_rules`) and client price tags (`clients.price_tag`) from a single page and dialog.

## Architecture overview

Two independent data sources are merged into one unified table on the page:

| Row kind | Source table            | Edited via                                  |
| -------- | ----------------------- | ------------------------------------------- |
| `rule`   | `billing_pricing_rules` | `PricingRuleDialog` → rule API              |
| `client` | `clients.price_tag`     | `PricingRuleDialog` → `setClientPriceTag` |

## Price resolution cascade (`resolveTripPrice`)

Priority order (highest wins):

1. **P1 — `clients.price_tag`** (gross brutto value on the client row)  
   Beats every billing rule. Set via the "Kunden-Preis setzen" flow.  
   No approach fee applied on this path.

2. **P2 — `billing_pricing_rules`** matched by scope cascade:  
   `billing_variant` → `billing_type` → `payer`  
   Most specific scope wins. Strategy config is read from `rule.config`.

The `client_price_tag` strategy in `billing_pricing_rules` is a **fallback label**, not a configured price. If P1 did not apply (no tag), this branch falls back to `trip.price` as net. It does not read from `rule.config`.

## Dialog — two-step flow

**Step 1 (create only):** Strategy tile grid (2×3). For `client_price_tag`, client search + brutto price input replaces Step 2 entirely.

**Step 2 (create) / direct (edit):** Strategy-specific config fields → Anfahrtspreis → Zuordnung (scope pickers, create only).

Edit mode always opens directly to Step 2.

## File structure

```
src/features/payers/components/
├── pricing-rule-dialog.tsx          ← Barrel re-export (do not edit)
├── pricing-rule-dialog/
│   ├── index.tsx                      ← Shell: state, effects, submit, Dialog layout
│   ├── pricing-rule-dialog.types.ts   ← Interfaces, form value types, constants
│   ├── pricing-rule-form-helpers.ts   ← Pure helpers: defaults, mappers, buildApiPayload
│   ├── step1-strategy-picker.tsx      ← Tile grid + client_price_tag inline flow
│   ├── step2-rule-config.tsx          ← All strategy config sections + Anfahrtspreis
│   ├── step2-scope-picker.tsx         ← Kostenträger → Familie → Unterart selects
│   └── client-price-search.tsx        ← Search input, filtered list, price input
└── pricing-rules-page.tsx             ← Unified table (rules + client price tags)

src/features/clients/
├── api/clients-pricing.api.ts         ← Slim list + setClientPriceTag
└── hooks/use-clients-for-pricing.ts   ← useClientsForPricing + useSetClientPriceTag
```

## Key design decisions

- **`client_price_tag` bypass:** When the dialog strategy is `client_price_tag` and `!editing`, the submit handler calls `setClientPriceTag()` directly and never touches `billing_pricing_rules`. This is intentional — the price lives on `clients.price_tag`, not in a rule config.

- **No list on open:** `ClientPriceSearch` only shows the results `ul` when `searchQuery.trim().length > 0`. This avoids rendering 100+ clients on every dialog open.

- **Barrel file:** `pricing-rule-dialog.tsx` is a pure re-export barrel. All import sites (`payer-details-sheet.tsx`, `edit-billing-family-dialog.tsx`, `edit-billing-variant-dialog.tsx`, `pricing-rules-page.tsx`) resolve to it unchanged.

- **`form` id + footer submit:** The scrollable form body and the sticky footer are siblings, not nested. The footer `<Button type="submit" form={FORM_ID}>` connects them via the HTML `form` attribute.

## Cache invalidation

| Mutation            | Invalidates                               |
| ------------------- | ----------------------------------------- |
| `createPricingRule` | `allBillingPricingRules`, per-payer rules |
| `updatePricingRule` | `allBillingPricingRules`, per-payer rules |
| `deletePricingRule` | `allBillingPricingRules`, per-payer rules |
| `setClientPriceTag` | `referenceKeys.clients()`                 |

## Adding a new strategy

1. Add the strategy to `PricingStrategy` union in `pricing.types.ts`
2. Add a German label in `pricing-strategy-labels-de.ts`
3. Add a one-line description in `STRATEGY_DESCRIPTION` in `pricing-rule-dialog.types.ts`
4. Add a config section in `step2-rule-config.tsx`
5. Add a `buildApiPayload` case in `pricing-rule-form-helpers.ts`
6. Add a summary branch in `format-pricing-rule-config-summary.ts`
7. Add a Zod schema case in `pricing-rule-config.schema.ts`
