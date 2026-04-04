# `src/features/invoices/lib`

Shared invoice logic (pure where possible).

## Usage pattern (rules → snapshot)

End-to-end order used by the invoice builder (see also `invoice-line-items.api.ts`):

1. **Load rules** — TanStack `fetchQuery` / `referenceKeys.billingPricingRules(payerId)` with `queryFn: () => listPricingRulesForPayer(payerId)` (shared cache with Kostenträger admin).
2. **Load trips** — `fetchTripsForBuilder(params)`; map rows with `mapBillingPricingRuleRowsToLike`. Optional `fetchBuilderTripsAndRules(params, preloadedRules)` skips a second rules fetch when rules are already in memory.
3. **Pick one rule per trip** — `resolvePricingRule({ rules, payerId, billingTypeId, billingVariantId })`.
4. **Resolve price + attach warnings** — `resolveTaxRate` then `resolveTripPrice` inside `buildLineItemsFromTrips`; then `validateLineItems` for step-3 badges.
5. **Freeze on save** — `createInvoice` (header + recipient snapshot), then `insertLineItems` writing `price_resolution_snapshot` and denormalized pricing columns per line.

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
