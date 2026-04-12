# Preisregeln (`/dashboard/abrechnung/preise`)

Central pricing catalog for all companies. Manages **`billing_pricing_rules`** and **`client_price_tags`** (plus legacy **`clients.price_tag`** for backwards compatibility) from a single page and dialog.

## Architecture overview

Data sources merged into one unified table on the page:

| Row kind | Source table            | Edited via                                      |
| -------- | ----------------------- | ----------------------------------------------- |
| `rule`   | `billing_pricing_rules` | `PricingRuleDialog` → rule API                  |
| `cpt`    | `client_price_tags`     | `PricingRuleDialog` → Kunden-Preis manager / API |

See [client-price-tags.md](client-price-tags.md) for schema, resolution tiers, and migration notes.

## Price resolution cascade (`resolveTripPrice` + `resolvePricingRule`)

1. **P0 — KTS** (unchanged).
2. **P1 — Client gross** — `rule._price_gross` from **`client_price_tags`** (via `resolvePricingRule` STEP 0) if it matches the trip’s `client_id` and scope; else legacy **`clients.price_tag`**. Beats every billing rule. No Anfahrt on this path.
3. **P2 — `billing_pricing_rules`** — variant → billing type → payer (after STEP 0 found no tag).

The `client_price_tag` **strategy** on a **`billing_pricing_rules`** row remains a **catalog fallback** (uses `trip.price` as net when no client gross applies). It does not read a configured price from `rule.config`.

## Dialog — two-step flow

**Step 1 (create only):** Strategy tile grid. For **`client_price_tag`**, choose **Weiter →** to open the manager.

**Step 2 (create):** Either **`ClientPriceTagStep`** (strategy `client_price_tag`) — search Fahrgast, list/edit/add tags with optional Kostenträger → Unterart — or billing rule config → Anfahrt → Zuordnung (scope pickers when creating from the global page).

**Step 2 (edit billing rule):** Opens directly when editing a `billing_pricing_rules` row.

Footer: **Speichern** submits billing rules; **Fertig** closes the Kunden-Preis manager (saves happen inline per row).

## File structure

```
src/features/payers/components/
├── pricing-rule-dialog.tsx          ← Barrel re-export (do not edit)
├── pricing-rule-dialog/
│   ├── index.tsx                      ← Shell: steps, billing submit, Fertig for client flow
│   ├── client-price-tag-step.tsx      ← Kunden-Preis manager (client_price_tags)
│   ├── pricing-rule-dialog.types.ts
│   ├── pricing-rule-form-helpers.ts
│   ├── step1-strategy-picker.tsx      ← Tile grid only
│   ├── step2-rule-config.tsx
│   └── step2-scope-picker.tsx
└── pricing-rules-page.tsx             ← Rules + client_price_tags rows

src/features/payers/api/
├── billing-pricing-rules.api.ts
└── client-price-tags.service.ts       ← list/insert/update + company-wide list

src/features/clients/
├── api/clients-pricing.api.ts         ← listClientsForPricing + setClientPriceTag (syncs global CPT)
└── hooks/use-clients-for-pricing.ts
```

## Key design decisions

- **Global tag sync:** `setClientPriceTag` updates **`clients.price_tag`** and the **global** row in **`client_price_tags`** (`payer_id` and `billing_variant_id` null) so older readers and STEP 0 stay aligned until the legacy column is dropped.

- **Scoped tags:** Payer-only or variant rows are **only** in **`client_price_tags`**; they do not write `clients.price_tag`.

- **Barrel file:** `pricing-rule-dialog.tsx` is a pure re-export barrel.

- **`form` id + footer submit:** Billing rule path uses `<Button type="submit" form={FORM_ID}>`; the client manager saves outside that submit.

## Cache invalidation

| Mutation              | Invalidates                                                                 |
| --------------------- | ----------------------------------------------------------------------------- |
| `createPricingRule`   | `allBillingPricingRules`, per-payer rules                                     |
| `updatePricingRule`   | same                                                                          |
| `deletePricingRule`   | same                                                                          |
| `setClientPriceTag`   | `referenceKeys.clients()`, `allClientPriceTags`, `clientPriceTags` prefix     |
| `client_price_tags` CRUD (manager) | `invalidatePricingRuleCaches` + `allClientPriceTags` + per-client manager key |

## Adding a new strategy

1. Add the strategy to `PricingStrategy` union in `pricing.types.ts`
2. Add a German label in `pricing-strategy-labels-de.ts`
3. Add a one-line description in `STRATEGY_DESCRIPTION` in `pricing-rule-dialog.types.ts`
4. Add a config section in `step2-rule-config.tsx`
5. Add a `buildApiPayload` case in `pricing-rule-form-helpers.ts`
6. Add a summary branch in `format-pricing-rule-config-summary.ts`
7. Add a Zod schema case in `pricing-rule-config.schema.ts`
