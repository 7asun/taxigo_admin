# Phase 4 — Invoice Builder Enhancement

Phase 3 is complete and verified. Please proceed with **Phase 4 — Invoice Builder Enhancement** exactly as specified in the plan.

---

## Before writing any code

1. Confirm `database.types.ts` is current — `billing_pricing_rules`, `rechnungsempfaenger`, and all new FK/column additions from Phase 1 must be present.
2. Read `docs/pricing-engine.md` and `src/features/invoices/lib/README.md` in full before touching the builder. The resolver call order, cascade rules, and config shapes are documented there — do not re-derive them.
3. Read `src/features/invoices/lib/resolve-trip-price.ts`, `resolve-pricing-rule.ts`, and `resolve-rechnungsempfaenger.ts` — understand their signatures before wiring them.

---

## Step 1 — Bug fix: `fetchTripsForBuilder`

In `src/features/invoices/api/invoice-line-items.api.ts`, the function `fetchTripsForBuilder` incorrectly filters by `billing_variant_id` using `params.billing_type_id`. This causes wrong trips to be returned silently.

Fix the filter so it correctly resolves trips by `billing_type_id` via the `billing_variants.billing_type_id` relationship. Use a Supabase `!inner` join on `billing_variants` or prefetch variant IDs for the selected billing type. The fix must not break the existing `per_client` or `single_trip` modes.

---

## Step 2 — Load pricing rules into the builder

At Step 2 (parameter collection), after the dispatcher selects Kostenträger, the builder must fetch all active `billing_pricing_rules` for that payer (company-scoped). Pass the loaded rules array into the line item engine so the resolver has data at Step 3.

Use the existing `useBillingPricingRules` hook / `referenceKeys.billingPricingRules` query key pattern — do not create a new fetch pattern.

---

## Step 3 — Wire resolvers into `buildLineItemsFromTrips`

For every trip being built into a `BuilderLineItem`:

1. Call `resolvePricingRule(payer, billingType, variant, loadedRules)` → gets the active rule
2. Call `resolveTripPrice(trip, client, activeRule)` → gets full `PriceResolution`

Extend `BuilderLineItem` type (in `src/features/invoices/types/invoice.types.ts`) with:

```typescript
price_resolution: PriceResolution;
pricing_strategy_used: PricingStrategy;
pricing_source: 'kts_override' | 'variant' | 'billing_type' | 'payer' | 'trip_price' | 'unresolved';
kts_override: boolean;
no_invoice_warning: boolean; // derived from trips.no_invoice_required — no dismissed state in V1
```

**KTS trips:**
- `kts_override: true`
- `unit_price_net: 0`, `unit_price_gross: 0`
- Line item note: `"Abgerechnet über KTS — kein Rechnungsbetrag"`
- Display: KTS badge on the row (blue, same tone as the existing KTS hint box)
- Contributes €0 to invoice total — still appears in the line item list

**`no_invoice_required` trips:**
- `no_invoice_warning: true`
- Amber warning badge on the row
- No hard exclusion in V1 — dispatcher removes manually if needed
- Does not block progress through the wizard

**Missing price trips (existing behavior — preserve):**
- `unit_price_net: null` → existing amber `missing_price` badge + inline editor unchanged

---

## Step 4 — Recipient resolution in Step 2 UI

After payer + billing_type + billing_variant are selected, call `resolveRechnungsempfaenger(payer, billingType, variant)` and display a preview below the selection fields:

**If resolved:**
```
Rechnungsempfänger: {name} · {city}
(Voreingestellt aus {Kostenträger | Abrechnungsfamilie | Unterart})
```
Use muted text for the source hint — same tone as KTS default hints elsewhere.

**If not resolved:**
```
⚠ Kein Rechnungsempfänger konfiguriert — bitte in Stammdaten prüfen
```
Amber warning, non-blocking.

---

## Step 5 — Step 4 UI (Summary & Confirmation)

Add a **Rechnungsempfänger** confirmation block in Step 4:
- Shows resolved name + full address from the snapshot
- Manual override dropdown: pulls from the full `rechnungsempfaenger` catalog (company-scoped)
- Override stored on `invoices.rechnungsempfaenger_id` — does not change catalog assignments
- If overridden, show: `„Manuell überschrieben"` label next to the name

Add a **pricing strategy tooltip** on each line item row:
- Small info icon next to the price
- Tooltip content: `„Preisstrategie: {PRICING_STRATEGY_LABELS_DE[strategy]} · Quelle: {source}"`
- Use `PRICING_STRATEGY_LABELS_DE` already exported from `pricing-rule-dialog.tsx`

---

## Step 6 — Snapshot capture on invoice creation

In `createInvoice` (`src/features/invoices/api/invoices.api.ts`) and the builder hook/Step 4 submit:

```typescript
// §14 UStG — freeze recipient at creation time, never update
invoices.rechnungsempfaenger_id = resolvedRecipient?.id ?? manualOverride?.id ?? null
invoices.rechnungsempfaenger_snapshot = resolvedRecipient ?? manualOverride ?? null
```

In `insertLineItems`:
```typescript
invoice_line_items.pricing_strategy_used = lineItem.pricing_strategy_used
invoice_line_items.pricing_source = lineItem.pricing_source
invoice_line_items.kts_override = lineItem.kts_override
invoice_line_items.price_resolution_snapshot = lineItem.price_resolution // full frozen PriceResolution JSON
```

Add inline comment at both snapshot points:
```typescript
// §14 UStG: snapshot frozen at invoice creation — never mutate after this point
```

---

## Standards to maintain

- `resolveTripPrice`, `resolvePricingRule`, `resolveRechnungsempfaenger` are **pure functions** — no DB calls inside them. All data is passed in.
- All monetary display uses `Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })`
- `Math.round(rawTotal * 100) / 100` — one rounding call per line item, never per tier segment
- Extend `InvoiceRow`, `InvoiceLineItemRow`, `InvoiceDetail` types to include new DB columns
- The existing `per_client`, `monthly`, and `single_trip` builder modes must all work correctly after the fix in Step 1

---

## Out of scope for Phase 4

- PDF changes (Phase 5)
- Auto-split of trips by billing_type into separate invoices (V2)
- Hard exclusion of `no_invoice_required` trips (V2)
- Price preview on trip detail sheet (V2)

---

## Completion deliverable

Confirm Phase 4 with a summary:
- Files created
- Files modified
- The bug fix result (what the old filter was, what it is now)
- Any deviations from the plan with rationale
