---
name: Phase 4 Invoice Builder
overview: The codebase already implements the core of Phase 4 (trip fetch fix, rules + resolvers in `buildLineItemsFromTrips`, line-item persistence, recipient snapshot on `createInvoice`). Remaining work aligns TanStack cache with `referenceKeys.billingPricingRules`, completes Step 2/4 UX from the prompt (recipient preview, confirmation block, pricing tooltips), small copy/comment polish, and optional type/doc hygiene.
todos:
  - id: verify-types-docs
    content: Verify database.types + read pricing docs/resolvers; grep KTS note consumers if changing copy
    status: cancelled
  - id: cache-billing-rules
    content: Wire builder trips query to referenceKeys.billingPricingRules via ensureQueryData/fetchQuery
    status: cancelled
  - id: step2-recipient-preview
    content: Extend new invoice page payer select; Step2 resolveRechnungsempfaenger + UI (type→payer only)
    status: cancelled
  - id: step4-recipient-pricing
    content: "Step4: recipient summary block, manual-override label, compact lines + strategy/source tooltips"
    status: cancelled
  - id: polish-labels-comments
    content: "Optional: move PRICING_STRATEGY_LABELS_DE to shared module; KTS note + §14 comments"
    status: cancelled
isProject: false
---

# Phase 4 — Invoice Builder Enhancement (status vs [implementation-suggestions/phase4-prompt.md](implementation-suggestions/phase4-prompt.md))

## Preconditions (prompt “before code”)

- **Types**: Confirm `[src/types/database.types.ts](src/types/database.types.ts)` includes `billing_pricing_rules`, `rechnungsempfaenger`, invoice recipient + line-item pricing columns (matches migrations). If anything is missing, regenerate when Supabase is available (`bun run db:types`).
- **Read (no re-derivation)**: `[docs/pricing-engine.md](docs/pricing-engine.md)`, `[src/features/invoices/lib/README.md](src/features/invoices/lib/README.md)`, and resolver signatures in `[resolve-trip-price.ts](src/features/invoices/lib/resolve-trip-price.ts)`, `[resolve-pricing-rule.ts](src/features/invoices/lib/resolve-pricing-rule.ts)`, `[resolve-rechnungsempfaenger.ts](src/features/invoices/lib/resolve-rechnungsempfaenger.ts)`.

---

## Already implemented (verify only; no duplicate work)


| Prompt step                       | Evidence in repo                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Step 1** `fetchTripsForBuilder` | `[invoice-line-items.api.ts](src/features/invoices/api/invoice-line-items.ts)` prefetches variant IDs by `billing_type_id`, then `.in('billing_variant_id', variantIdsForType)` — fixes the old “compare variant id to type id” bug. Empty variant list returns `[]`.                                                                                                    |
| **Step 2 load rules**             | `[fetchBuilderTripsAndRules](src/features/invoices/api/invoice-line-items.api.ts)` loads trips + `listPricingRulesForPayer` in parallel; `[useInvoiceBuilder](src/features/invoices/hooks/use-invoice-builder.ts)` uses it in the trips query.                                                                                                                           |
| **Step 3 resolvers**              | `[buildLineItemsFromTrips](src/features/invoices/api/invoice-line-items.api.ts)`: `resolvePricingRule` then `resolveTripPrice`; `no_invoice_warning`, `kts_override`, `price_resolution` on `[BuilderLineItem](src/features/invoices/types/invoice.types.ts)`.                                                                                                           |
| **KTS / no-invoice**              | KTS: resolver sets €0 + note; step 3 shows KTS badges + banner; validators skip `zero_price` when `kts_override`. `no_invoice_required` → warning, non-blocking.                                                                                                                                                                                                         |
| **Step 6 snapshots**              | `[createInvoice](src/features/invoices/api/invoices.api.ts)`: `rechnungsempfaenger_id` + `rechnungsempfaenger_snapshot` via `RechnungsempfaengerService.getById` + `rechnungsempfaengerRowToSnapshot`. `[insertLineItems](src/features/invoices/api/invoice-line-items.api.ts)`: `pricing_strategy_used`, `pricing_source`, `kts_override`, `price_resolution_snapshot`. |
| **Update vs create pricing**      | (From prior work) `[PricingRuleDialog](src/features/payers/components/pricing-rule-dialog.tsx)` uses `updatePricingRule` when `editing` is set — no change needed for Phase 4.                                                                                                                                                                                           |


**Note on prompt’s `BuilderLineItem` extension:** `pricing_strategy_used` / `pricing_source` are already carried inside `[PriceResolution](src/features/invoices/types/pricing.types.ts)` and written to the DB from `frozen.strategy_used` / `frozen.source`. Adding duplicate top-level fields is optional sugar for the UI; not required for persistence.

---

## Gaps to implement (remaining Phase 4)

### A) TanStack Query: align with `referenceKeys.billingPricingRules`

**Prompt:** use `useBillingPricingRules` / `referenceKeys.billingPricingRules` — do not introduce a parallel fetch pattern.

**Current gap:** Rules are fetched only inside `fetchBuilderTripsAndRules` → `listPricingRulesForPayer`; the payers admin cache is not populated/invalidated from the same key for the builder query.

**Plan:** In `[useInvoiceBuilder](src/features/invoices/hooks/use-invoice-builder.ts)` `queryFn`, call `queryClient.ensureQueryData` (or `fetchQuery`) with `queryKey: referenceKeys.billingPricingRules(payerId)` and `queryFn: () => listPricingRulesForPayer(payerId)`, then pass the returned rules into `buildLineItemsFromTrips` (or keep `fetchBuilderTripsAndRules` but have it accept pre-fetched rules from the cache-only path). Goal: **one canonical key** for pricing rules per payer.

### B) Step 2 — Rechnungsempfänger preview (prompt Step 4)

**Prompt:** After payer + billing_type + billing_variant, show resolved recipient + source hint; amber warning if none.

**Reality:** The wizard has **no billing_variant picker** — only optional `billing_type_id`. Variant-level FK is only known from **loaded trips**.

**Plan:**

1. Extend the server query in `[src/app/dashboard/invoices/new/page.tsx](src/app/dashboard/invoices/new/page.tsx)`: include `payers.rechnungsempfaenger_id` and `billing_types.rechnungsempfaenger_id` (nested select), and thread through `[InvoiceBuilder](src/features/invoices/components/invoice-builder/index.tsx)` `Payer` type.
2. In `[step-2-params.tsx](src/features/invoices/components/invoice-builder/step-2-params.tsx)`, when `payer_id` (and for non–`per_client`, `billing_type_id`) are set, call `**resolveRechnungsempfaenger`** with **variant id = undefined** (treat as null): cascade = type → payer only.
3. Resolve display name/city: reuse `[useRechnungsempfaengerOptions](src/features/rechnungsempfaenger/hooks/use-rechnungsempfaenger-options.ts)` (or a small lookup from the same catalog) to map id → `{ name, city }`.
4. **Copy:** Muted source line: `Voreingestellt aus Kostenträger | Abrechnungsfamilie` (no “Unterart” until trips exist). Optional follow-up: after step 3 load, could show a one-line note that final invoice recipient used **first trip’s** cascade — only if product wants it; otherwise document as intentional deviation.

### C) Step 4 — Rechnungsempfänger block + override label (prompt Step 5)

**Current:** `[step-4-confirm.tsx](src/features/invoices/components/invoice-builder/step-4-confirm.tsx)` has recipient `<Select>` + short description; no read-only resolved block, no “Manuell überschrieben”.

**Plan:**

1. Pass into Step 4: `catalogRecipientId` (already available as `defaultRechnungsempfaengerId`) **and** optional resolved row or id list from options to render **name + full address** (from catalog row matching the effective default).
2. Watch `rechnungsempfaenger_id` in the form: if user selects a UUID **different** from `catalogRecipientId`, show `**Manuell überschrieben`** next to the preview.
3. Keep behavior: override only sets `invoices.rechnungsempfaenger_id` + snapshot at create time (already correct in `[createInvoice](src/features/invoices/api/invoices.api.ts)`).

### D) Step 4 — Pricing tooltip per line (prompt Step 5)

**Current:** Step 4 has **no line-item table**; strategy is visible in Step 3 only.

**Plan:** Add a **compact** read-only list in Step 4 (description + price + `Info` icon): tooltip text  
`Preisstrategie: {label} · Quelle: {source}` using `**PRICING_STRATEGY_LABELS_DE`** for strategy and a small **German map** for `PriceResolution.source` (`kts_override`, `variant`, `billing_type`, `payer`, `trip_price`, `unresolved`, …).

**Layering:** Importing `PRICING_STRATEGY_LABELS_DE` from `[pricing-rule-dialog.tsx](src/features/payers/components/pricing-rule-dialog.tsx)` couples invoices → payers UI. **Preferred deviation:** move the constant to a shared module under `src/features/invoices/lib/` (or `types/`) and import it from both payers dialog and invoice builder — same strings, cleaner graph.

### E) Small spec polish

- **KTS note:** Align `[resolve-trip-price.ts](src/features/invoices/lib/resolve-trip-price.ts)` note with prompt: `Abgerechnet über KTS — kein Rechnungsbetrag` (if PDF/detail already rely on shorter text, grep usages first).
- **§14 UStG comments:** Add one-line comments at snapshot sites in `[createInvoice](src/features/invoices/api/invoices.api.ts)` and `[insertLineItems](src/features/invoices/api/invoice-line-items.api.ts)` as requested.

---

## Out of scope (per prompt)

PDF (Phase 5), auto-split by billing type, hard exclusion of `no_invoice_required`, trip-detail price preview.

---

## Suggested completion deliverable

After implementation: short summary listing files created/modified, Step 1 before/after (already fixed: filter by variants of selected `billing_type_id`), and explicit notes on **billing_variant** not being a Step 2 field and how recipient preview works.