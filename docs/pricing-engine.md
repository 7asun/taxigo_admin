# Pricing engine (Spec C)

Pure resolution for invoice line items: **no database access** inside the cascade. Catalog rules are loaded in the invoice builder (or admin UI), then passed into `resolvePricingRule` and `resolveTripPrice`.

## Priority cascade (locked)

1. **KTS** — `trips.kts_document_applies` forces €0 net with note (`kts_override`).
2. **Client gross (negotiated)** — gross → net using the line tax rate; **overrides all billing rules**.  
   Source order inside `resolveTripPrice` P1: **`rule._price_gross`** when `resolvePricingRule` matched a row in **`client_price_tags`** (STEP 0: variant-scoped → payer-scoped → global for that `client_id`); otherwise legacy **`clients.price_tag`**. See [client-price-tags.md](client-price-tags.md).
3. **Billing pricing rule** — one active row per scope (variant → billing type → payer); strategy from `billing_pricing_rules.config` (Zod-validated). **STEP 0** in `resolve-pricing-rule.ts` runs **before** this catalog waterfall when the trip has a `client_id` and matching tags were loaded.
4. **`trips.price`** — net fallback.
5. **Unresolved** — `unit_price_net` null (manual entry in the builder).

Rule + tag selection: `src/features/invoices/lib/resolve-pricing-rule.ts` (tags + billing cascade).

## Rounding

Gross-anchor (`client_price_tag`) vs net-anchor strategies, `insertLineItems`, and `calculateInvoiceTotals`: **[pricing-engine-3.md](pricing-engine-3.md)**.

For `tiered_km` and `fixed_below_threshold_then_km`, segment amounts use raw `km × ratePerKm`, then **one** `Math.round(total * 100) / 100` per line (not per segment). Implemented in `src/features/invoices/lib/resolve-trip-price.ts` (`tieredNetTotal`).

## Time-based rules

Weekday and clock use **Europe/Berlin** (via `@date-fns/tz` and `getTripsBusinessTimeZone()`). Holidays compare the trip’s Berlin local calendar date `YYYY-MM-DD` to the config list.

## Persistence

At invoice creation, each `invoice_line_items` row stores:

- `pricing_strategy_used`, `pricing_source`, `kts_override` — query-friendly.
- `price_resolution_snapshot` — full frozen `PriceResolution` JSON for audit.

The `price_resolution_snapshot` field is JSONB. PostgREST may return it as a string at runtime — `coerceLineItemJsonbSnapshots` in `src/features/invoices/components/invoice-pdf/pdf-column-layout.ts` handles this transparently before PDF rendering.

**Line net on the PDF (grouped and flat):** use **column math** — `(unit_price × quantity) + (approach_fee_net ?? 0)` — not `price_resolution_snapshot.net`, which is **base transport only** and may be null for some strategies. For a full-line gross check, `total_price` on the row already reflects tax on base + Anfahrt.

Persisted columns:

- `invoice_line_items.approach_fee_net` — optional net add-on per line (frozen at invoice creation).
- `price_resolution_snapshot.approach_fee_net` — mirrors the resolver when present.

The builder uses `buildLineItemsFromTrips` → `insertLineItems` in `src/features/invoices/api/invoice-line-items.api.ts`. Manual price edits in step 3 refresh `price_resolution` (strategy `manual_trip_price`) before insert.

## Anfahrtspreis (Approach Fee)

A flat per-trip **net** add-on configured on billing rules as `billing_pricing_rules.config.approach_fee_net` (optional, Zod-validated with every strategy config). It is **not** part of `PriceResolution.net` / `gross` — those remain **base transport only**.

**Which strategies receive it from the resolver:** all paths **except**:

- **`client_price_tag`** — the P1 `price_tag` is an **all-in** negotiated gross; adding Anfahrt would break the agreed amount.
- **`kts_override`** — KTS lines are €0; Anfahrt must not apply.

For every other resolution (including `tiered_km`, `fixed_below_threshold_then_km`, `time_based`, `manual_trip_price`, `trip_price_fallback`, `no_price` with rule present, etc.), if the active rule’s config contains a valid `approach_fee_net`, it is copied onto the returned `PriceResolution.approach_fee_net`.

**Price math (per line):**

- `total_line_net = (unit_price × quantity) + (approach_fee_net ?? 0)` (base from pricing strategy + optional Anfahrt).
- `total_price` (DB gross) = `total_line_net × (1 + tax_rate)` (same rounding as `insertLineItems`).

**Where stored:** `invoice_line_items.approach_fee_net` and `price_resolution_snapshot.approach_fee_net`.

**Invariant:** `PriceResolution.net` = base transport only (never includes Anfahrt).

More detail: [anfahrtspreis.md](anfahrtspreis.md).

## Builder integration

The invoice wizard does **not** call the resolvers from React with ad hoc fetches. All catalog rules for the selected Kostenträger are loaded once, cached under TanStack Query, then passed into pure functions.

### Trip fetch when filtering by Abrechnungsfamilie

`fetchTripsForBuilder` returns **`{ trips, clientPriceTags }`**. It must never compare `trips.billing_variant_id` to `billing_types.id` (different identifiers). The correct pattern: load all `billing_variants.id` for the selected `billing_type_id`, then `.in('billing_variant_id', variantIdsForType)`. If the family has no variants, the function returns an empty trip list (and empty tags). After trips load, **active** `client_price_tags` for all distinct `trip.client.id` values are loaded in one query for STEP 0 resolution.

### Loading rules (shared cache)

In `useInvoiceBuilder`, the trips query uses:

- `queryClient.fetchQuery({ queryKey: referenceKeys.billingPricingRules(payerId), queryFn: () => listPricingRulesForPayer(payerId), staleTime: 30_000 })`

That is the **same key** as `useBillingPricingRules` on the Kostenträger admin screen (`src/features/payers/hooks/use-billing-pricing-rules.ts`), so pricing rule edits invalidate one cache entry for both UIs. Rows are mapped to `BillingPricingRuleLike` via `mapBillingPricingRuleRowsToLike` in `invoice-line-items.api.ts`.

### Zentrale Preisregelverwaltung (`/dashboard/abrechnung/preise`)

The **Preisregeln** page under Abrechnung lists and edits every `billing_pricing_rules` row for the current company without opening each Kostenträger sheet.

1. **`listAllPricingRules`** (`src/features/payers/api/billing-pricing-rules.api.ts`) — company-scoped global load in **one** Supabase round-trip (RLS limits rows to the session tenant). It complements per-payer **`listPricingRulesForPayer`**, which Kostenträger admin and the builder still use.
2. **Join shape** — PostgREST nested embeds resolve display names along **payer → billing_type → billing_variant** (for variant-scoped rules, the embed includes the variant’s `billing_type` and that type’s `payer`, so breadcrumbs and `payer_id_for_scope` are always derivable).
3. **`BillingPricingRuleWithContext`** — enriched list row type: adds `scope_level`, `breadcrumb`, and `payer_id_for_scope` in the API mapper (**not** DB columns).
4. **`PricingRuleDialog`** — accepts **`scope: null`** when creating a rule from this page so the user picks Kostenträger → optional Familie → optional Unterart. Kostenträger / family / variant dialogs keep passing a fixed `PricingRuleScope` (no picker).
5. **Cache invalidation** — `useAllPricingRules` (`src/features/payers/hooks/use-all-pricing-rules.ts`) and `invalidatePricingRuleCaches` invalidate **`referenceKeys.allBillingPricingRules()`** and the **`['reference', 'billingPricingRules']`** prefix after mutations so per-payer caches and open Kostenträger sheets stay in sync with the catalog.

### `buildLineItemsFromTrips` call order

For each `TripForInvoice`:

1. **`resolveTaxRate(trip.driving_distance_km)`** — VAT rate for the line (7% / 19%).
2. **`resolvePricingRule({ rules, payerId, billingTypeId, billingVariantId, clientId, clientPriceTags })`** — **STEP 0** picks the best **`client_price_tags`** hit (variant → payer → global) and synthesizes a `BillingPricingRuleLike` with `strategy: 'client_price_tag'` and **`_price_gross`**; otherwise **STEP 1–3**: billing rules **variant → billing type → payer** (see `resolve-pricing-rule.ts`). `billingTypeId` / `billingVariantId` come from the joined `billing_variant` on the trip.
3. **`resolveTripPrice(tripInput, taxRate, rule | null)`** — applies the locked P0–P4 price cascade and returns a full **`PriceResolution`** (strategy, source, net, gross, `unit_price_net`, `quantity`, optional `note`). P1 prefers **`_price_gross`** on the resolved rule over **`trip.client.price_tag`**.

`buildLineItemsFromTrips` then maps that into a **`BuilderLineItem`**: `unit_price` from `unit_price_net`, `kts_override` when `strategy_used === 'kts_override'`, `no_invoice_warning` from `trips.no_invoice_required`, and attaches `warnings` from `validateLineItems`.

### Persisting to `invoice_line_items`

On **Rechnung erstellen**, `insertLineItems` writes one row per line:

| Column | Source |
|--------|--------|
| `pricing_strategy_used` | `price_resolution.strategy_used` (after freezing manual edits) |
| `pricing_source` | `price_resolution.source` |
| `kts_override` | `BuilderLineItem.kts_override` |
| `price_resolution_snapshot` | Full `PriceResolution` JSON (immutable audit trail) |

Manual unit price edits in step 3 run through `applyManualUnitNetToResolution` so the snapshot stays consistent with the edited net before insert.

### Builder validation: KTS and `zero_price`

Step 3 warnings come from `validateLineItem` in `invoice-validators.ts`. A line with **`unit_price === 0`** normally gets a **`zero_price`** advisory — except when **`kts_override === true`**. KTS lines are intentionally €0 net; skipping `zero_price` avoids a misleading “Preis ist 0 €” flag for legally correct KTS rows.

## Worked examples (numerical)

Assumptions are stated per row. Tax rate is only needed where gross ↔ net applies. Rounding follows the implementation (`Math.round(x * 100) / 100` where documented in code).

### `client_price_tag` (cascade P1 — not driven by a rule row)

| Input | Value |
|--------|--------|
| `kts_document_applies` | `false` |
| `client.price_tag` | `119` (gross €) |
| `tax_rate` | `0.19` |
| No conflicting higher priority | — |

**Output:** `unit_price_net = 100.00`, `quantity = 1`, `net = 100.00`, `gross = 119.00`, `strategy_used = client_price_tag`.

### `tiered_km`

| Input | Value |
|--------|--------|
| `driving_distance_km` | `12` |
| Tiers | `[{ from_km: 0, to_km: 10, price_per_km: 1.0 }, { from_km: 10, to_km: null, price_per_km: 0.5 }]` |

Segment raw: `10 × 1.00 + 2 × 0.50 = 11.00` → one round → **`net = 11.00`**. **`quantity = 12`**, **`unit_price_net = roundMoneyOnce(11 / 12) = 0.92`**.

### `fixed_below_threshold_then_km`

**Below threshold** — `threshold_km = 15`, `fixed_price = 25`, `driving_distance_km = 8` (note: `dist < threshold`):

**Output:** `unit_price_net = 25.00`, `quantity = 1`, `net = 25.00`.

**Above threshold** — same rule, `driving_distance_km = 20`, `km_tiers` e.g. single tier `0–∞` at `0.40` €/km:

Raw `20 × 0.40 = 8.00` → **`net = 8.00`**, **`quantity = 20`**, **`unit_price_net = 0.40`**.

### `time_based`

| Input | Value |
|--------|--------|
| `fixed_fee` | `45` |
| `working_hours.mon` | `{ start: '07:00', end: '18:00' }` |
| `scheduled_at` | Any instant whose **Europe/Berlin** local time falls on a weekday with `working_hours` configured and clock **inside** `07:00–18:00` |
| Not a listed holiday with `holiday_rule: 'closed'` blocking the window | — |

**Output:** `unit_price_net = 0`, `quantity = 1`, `net = 0`, `gross = 0`, note `Innerhalb Arbeitszeit`.

Same fee and window, **`scheduled_at` chosen so Berlin local clock is **after** `18:00` on that weekday:** **`unit_price_net = 45.00`**, `net = 45.00`, note `Außerhalb Arbeitszeit / Feiertag`.

### `manual_trip_price`

| Input | Value |
|--------|--------|
| Active rule `strategy` | `manual_trip_price` |
| `trips.price` | `67.25` (net €) |
| No `price_tag` / not KTS | — |

**Output:** `unit_price_net = 67.25`, `quantity = 1`, `net = 67.25`, `strategy_used = manual_trip_price`.

### `no_price`

| Input | Value |
|--------|--------|
| Active rule `strategy` | `no_price` |
| `client.price_tag` | `null` |
| `trips.price` | `null` |

Rule execution yields no amount → cascade ends unresolved.

**Output:** `unit_price_net = null`, `quantity = 1`, `net = null`, `strategy_used = no_price`, `source = unresolved`.

## Related code

| Area | Path |
|------|------|
| Zod config union | `src/features/invoices/lib/pricing-rule-config.schema.ts` |
| Rule pick | `src/features/invoices/lib/resolve-pricing-rule.ts` |
| Price cascade | `src/features/invoices/lib/resolve-trip-price.ts` |
| Legacy `PriceResult` adapter | `src/features/invoices/lib/price-calculator.ts` |
| Types | `src/features/invoices/types/pricing.types.ts` |
| Tests | `src/features/invoices/lib/__tests__/resolve-trip-price.test.ts` |
