# Pricing engine (Spec C)

Pure resolution for invoice line items: **no database access** inside the cascade. Catalog rules are loaded in the invoice builder (or admin UI), then passed into `resolvePricingRule` and `resolveTripPrice`.

## Priority cascade (locked)

1. **KTS** — `trips.kts_document_applies` forces €0 net with note (`kts_override`).
2. **`clients.price_tag`** — gross → net using the line tax rate; **overrides all billing rules**.
3. **Billing pricing rule** — one active row per scope (variant → billing type → payer); strategy from `billing_pricing_rules.config` (Zod-validated).
4. **`trips.price`** — net fallback.
5. **Unresolved** — `unit_price_net` null (manual entry in the builder).

Rule selection mirrors KTS-style precedence: see `src/features/invoices/lib/resolve-pricing-rule.ts`.

## Rounding

For `tiered_km` and `fixed_below_threshold_then_km`, segment amounts use raw `km × ratePerKm`, then **one** `Math.round(total * 100) / 100` per line (not per segment). Implemented in `src/features/invoices/lib/resolve-trip-price.ts` (`tieredNetTotal`).

## Time-based rules

Weekday and clock use **Europe/Berlin** (via `@date-fns/tz` and `getTripsBusinessTimeZone()`). Holidays compare the trip’s Berlin local calendar date `YYYY-MM-DD` to the config list.

## Persistence

At invoice creation, each `invoice_line_items` row stores:

- `pricing_strategy_used`, `pricing_source`, `kts_override` — query-friendly.
- `price_resolution_snapshot` — full frozen `PriceResolution` JSON for audit.

The builder uses `buildLineItemsFromTrips` → `insertLineItems` in `src/features/invoices/api/invoice-line-items.api.ts`. Manual price edits in step 3 refresh `price_resolution` (strategy `manual_trip_price`) before insert.

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
