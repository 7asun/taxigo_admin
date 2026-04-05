# `src/features/invoices/lib`

Shared invoice logic (pure where possible).

## Usage pattern (rules → snapshot)

End-to-end order used by the invoice builder (see `useInvoiceBuilder` and `invoice-line-items.api.ts`):

1. **Load rules (canonical cache)** — `queryClient.fetchQuery({ queryKey: referenceKeys.billingPricingRules(payerId), queryFn: () => listPricingRulesForPayer(payerId), staleTime: 30_000 })`. Same key as `useBillingPricingRules` in Kostenträger admin, so invalidations stay in sync. Map DB rows with `mapBillingPricingRuleRowsToLike`.
2. **Load trips** — `fetchTripsForBuilder(params)` (billing-type filter resolves variant IDs via `billing_variants.billing_type_id`, never by comparing type id to `billing_variant_id`).
3. **Pick one rule per trip** — `resolvePricingRule({ rules, payerId, billingTypeId, billingVariantId })` (variant → type → payer).
4. **Resolve price + attach warnings** — `resolveTaxRate` then `resolveTripPrice` inside `buildLineItemsFromTrips`; then `validateLineItems` for step-3 badges.
5. **Freeze on save** — `createInvoice` (header + `rechnungsempfaenger_snapshot`), then `insertLineItems` (`price_resolution_snapshot` + denormalized pricing columns). Both snapshot sites carry the §14 UStG immutability comment in code.

**Optional helper:** `fetchBuilderTripsAndRules(params, preloadedRules)` loads trips and reuses an in-memory rules array when you already fetched via step 1 (avoids a second `listPricingRulesForPayer`).

### German strategy labels (shared module)

`PRICING_STRATEGY_LABELS_DE`, `PRICE_RESOLUTION_SOURCE_LABELS_DE`, and `pricingStrategyUsedLabelDe` live in **`pricing-strategy-labels-de.ts`** (this folder). The Kostenträger Preisregel-Dialog re-exports `PRICING_STRATEGY_LABELS_DE` for backward-compatible imports from `./pricing-rule-dialog`.

## Pricing (Spec C)

- **`pricing-rule-config.schema.ts`** — `z.discriminatedUnion('strategy', …)` for all strategies; `parseConfigForStrategy` validates `config` JSON before rule writes and before execution.
- **`resolve-pricing-rule.ts`** — Picks one active rule: variant scope → type-only → payer-only (rows have exactly one scope FK set).
- **`resolve-trip-price.ts`** — Full P0–P4 cascade, Berlin TZ for `time_based`, tier sums with **one** money round per line. Exports `resolveTripPrice` (returns `PriceResolution`).
- **`resolve-rechnungsempfaenger.ts`** — Catalog-only recipient cascade (variant → type → payer).
- **`price-calculator.ts`** — Thin adapter from `PriceResolution` to legacy `PriceResult` for incremental migration; re-exports `resolveTripPricePure`.

See [docs/pricing-engine.md](../../../../docs/pricing-engine.md).

## Other

- **`invoice-number.ts`** — Sequential `RE-YYYY-MM-NNNN`.
- **`invoice-validators.ts`** — Builder step-3 warnings (`missing_price`, `no_invoice_trip`, …).
- **`storno.ts`** — Stornorechnung creation (negated amounts; copies recipient + pricing metadata).
- **`tax-calculator.ts`** — Tax rate from distance (7% / 19%).
