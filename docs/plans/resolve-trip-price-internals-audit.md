# Audit: `resolveTripPrice` internals + production null count

Read-only review. **`computeTripPrice` is not defined in `trips.service.ts`** — that file only imports it from `src/features/trips/lib/trip-price-engine.ts` and applies its return value in `updateTrip`. The sections below for `computeTripPrice` quote **`trip-price-engine.ts`** (the actual implementation).

---

## 1. `resolveTripPrice` — signature and every branch

### 1.1 Function signature

```ts
export function resolveTripPrice(
  trip: TripPriceInput,
  taxRate: number,
  rule: BillingPricingRuleLike | null
): PriceResolution
```

`TripPriceInput` (same file) is:

- `kts_document_applies: boolean`
- `net_price: number | null`
- `driving_distance_km: number | null`
- `scheduled_at: string | null`
- `client?: { price_tag: number | null } | null`

### 1.2 Top-level `resolveTripPrice` (priority chain)

| Order | Condition | What is returned |
|------|-----------|------------------|
| **P0** | `trip.kts_document_applies === true` | A fixed `PriceResolution`: `gross: 0`, `net: 0`, `tax_rate: taxRate`, `strategy_used: 'kts_override'`, `source: 'kts_override'`, `unit_price_net: 0`, `quantity: 1`, `note` for KTS. **No** `withApproachFeeFromRule` at this top level (object returned directly). |
| **P1** | After computing `tagGross` from (a) `rule._price_gross` when `rule?.strategy === 'client_price_tag'` and it is a valid number, else (b) `trip.client?.price_tag` — if `tagGross` is not null/undefined (and the synthetic path requires `> 0` for `syntheticGross` branch) | `net = tagGross / (1 + taxRate)`, `gross: tagGross`, `strategy_used: 'client_price_tag'`, `source: 'client_price_tag'`, `unit_price_net: net`, `quantity: 1`, `tax_rate: taxRate`. **No** `approach_fee` attachment in this block (per file comments: pricetag is all-in). |
| **P2** | `if (rule && rule.is_active)` | `r = executeStrategy(rule, rule.strategy, trip, taxRate)`. If `r` is non-null, **`return withApproachFeeFromRule(r, rule)`** (may add `approach_fee_net` from rule config). If `r` is null, fall through. |
| **P3** | `trip.net_price !== null && trip.net_price !== undefined` | **`return withApproachFeeFromRule(resolution({ net: n, strategy_used: 'trip_price_fallback', source: 'trip_price', unit_price_net: n, quantity: 1 }, taxRate), rule)`** where `n = trip.net_price`. |
| **P4** | Otherwise | **`return withApproachFeeFromRule({ gross: null, net: null, tax_rate: taxRate, strategy_used: 'no_price', source: 'unresolved', unit_price_net: null, quantity: 1 }, rule)`** |

`withApproachFeeFromRule` only adds `approach_fee_net` when the active rule’s config parses a valid non-negative `approach_fee_net`. **P1 and P0** return **without** going through `withApproachFeeFromRule`.

### 1.3 `executeStrategy(rule, strategy, trip, taxRate)` — sub-branches

Only reached from **P2** (and only if `parseConfigForStrategy` succeeds; on catch → returns `null`).

| `strategy` | Condition | Return |
|------------|------------|--------|
| `client_price_tag` | `trip.net_price != null` | `resolution` with `net` / `unit_price_net` = `trip.net_price`, `strategy_used: 'trip_price_fallback'`, `source: 'trip_price'`, `quantity: 1` |
| `client_price_tag` | `trip.net_price == null` | `null` |
| `manual_trip_price` | `trip.net_price == null` | `null` |
| `manual_trip_price` | else | `resolution` with `net` / `unit_price_net` = `trip.net_price`, `strategy_used: 'manual_trip_price'`, `source` = scope (variant / billing_type / payer), `quantity: 1` |
| `no_price` | always | `null` |
| `tiered_km` | `dist` null/undefined | `null` |
| `tiered_km` | else | `resolution` with `tiered_km` totals, `quantity: dist` |
| `fixed_below_threshold_then_km` | `dist` null/undefined | `null` |
| `fixed_below_threshold_then_km` | `dist < threshold_km` | flat `net`, `quantity: 1` |
| `fixed_below_threshold_then_km` | else (≥ threshold) | tiered over full distance, `quantity: dist` |
| `time_based` | `!sched` | `null` |
| `time_based` | inside hours / holiday logic | `net: 0`, `gross: 0`, note *Innerhalb Arbeitszeit* **or** `net: fee`, note *Außerhalb…* |
| `default` | exhaustive | `never` |

After a non-null `r` from `executeStrategy`, the caller wraps with **`withApproachFeeFromRule(r, rule)`** (adds `approach_fee_net` when configured).

### 1.4 Helper `resolution(...)`

Fills `gross` from `partial.gross` if set; else `grossFromNet(net, taxRate)` if `net` is set; else `gross: null`. Always passes through `unit_price_net`, `quantity`, `strategy_used`, `source`, `note`, `tax_rate` (or default `taxRate`).

---

## 2. Where `trip.net_price` is consumed

`trip.net_price` is a **field on the `TripPriceInput` object** (parameter), not a global.

| Place | Role |
|------|------|
| **`executeStrategy` → `client_price_tag` branch** | **Fallback** when the active rule’s strategy is literally `client_price_tag` *but* the real P1 pricetag path did not run (P1 is handled earlier via `syntheticGross` / `legacyTag`). If `trip.net_price` is set, it returns a resolution using that value as `net` and `unit_price_net` with `trip_price_fallback` / `trip_price`. If null, returns `null`. |
| **`executeStrategy` → `manual_trip_price` branch** | **Required** input: if `trip.net_price` is null, returns `null`; else uses it as the **only** price for that strategy. |
| **Top-level P3** | **Direct fallback** after P1 and P2 fail or yield no amount: if `trip.net_price` is not null/undefined, build a `trip_price_fallback` / `trip_price` resolution with `net` and `unit_price_net` = stored value, then **`withApproachFeeFromRule`**. |

So: **parameter** to `resolveTripPrice` / `executeStrategy`; used as **(a)** strategy-internal fallback for the misnamed `client_price_tag` **strategy** path, **(b)** required input for `manual_trip_price`, **(c)** top-level **P3** fallback when nothing else prices the line.

It is **not** read in P0 (KTS) or P1 (client gross tag) successful paths, or in `tiered_km` / `fixed_below_threshold_then_km` / `time_based` / `no_price` (except where those return null and execution falls through to P3).

**Note (outside this function):** In `resolveTripForPricing` (`trip-price-engine.ts`), the merged compute input **forces `net_price: null`** on recalculation so the DB snapshot does not feed P3. Call sites that *do* want P3 (e.g. invoice builder) pass the **actual** `trips.net_price` from the query.

---

## 3. `computeTripPrice` — fields written to `trips` and update payload

**Definition:** `src/features/trips/lib/trip-price-engine.ts`.

### 3.1 Return value shape (`TripPriceFields`)

`computeTripPrice` returns an object with exactly:

| Field | When set |
|-------|----------|
| `net_price` | `null` if `!trip.payer_id`, or if `resolveTripPrice` gives `resolution.net === null`, else **transport net + `approach_fee_net`** (see below). |
| `gross_price` | `null` when `net_price` would be null; else `Math.round(totalNet * (1 + taxRate) * 100) / 100` where `totalNet` is the same sum as `net_price`. |
| `tax_rate` | `null` when unresolved; else the rate from `resolveTaxRate(trip.driving_distance_km)`. |

Implementation detail: `const approachFeeNet = resolution.approach_fee_net ?? 0`; `totalNet = resolution.net + approachFeeNet` (when `resolution.net` is not null). So the **database `trips.net_price`** stores a **combined** net (base + Anfahrt) when a resolution has both.

**Early exit:** if `!trip.payer_id` → `{ net_price: null, gross_price: null, tax_rate: null }`. If `resolution.net === null` → same all-null object.

### 3.2 How `trips.service.updateTrip` applies it

In `updateTrip` (only when `shouldRecalculatePrice(trip)` and `resolveTripForPricing` and `loadPricingContext` succeed):

```ts
Object.assign(trip, computeTripPrice(tripInput, context));
```

The **`trip`** object is the **patch** about to be sent to:

```ts
supabase.from('trips').update(trip).eq('id', id)
```

So the **exact** additional/ overwritten keys from `computeTripPrice` are:

```ts
{
  net_price: number | null,
  gross_price: number | null,
  tax_rate: number | null
}
```

Any other fields the caller put on `trip` (e.g. `driving_distance_km`, `payer_id`) are preserved; the **three** price columns are the ones produced by `computeTripPrice` on that code path.

**Other call sites** (create form, bulk upload, cron, etc.) spread or assign the same return object into an **insert** or **update** shape — the written columns are still those three.

---

## 4. `SELECT COUNT(*) FROM trips WHERE net_price IS NULL`

Executed against the Supabase project configured in **`.env.local`** (via the same `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` pattern as local tooling). **Environment identifier (public only):** host `etwluibddvljuhkxjkxs.supabase.co` (treat as **the project linked in your .env** — use your deployment naming for “production” vs “staging”).

| Result |
|--------|
| **87** rows with `net_price IS NULL` |

(Equivalent to: `from('trips').select(..., { count: 'exact', head: true }).is('net_price', null)` → count **87**.)

To confirm the environment name in your org, check which Supabase project ref matches this URL in the Supabase dashboard; **this audit does not assert prod vs staging** beyond “whatever `.env.local` points to.”

---

## 5. File references

| File | Relevance |
|------|------------|
| `src/features/invoices/lib/resolve-trip-price.ts` | `resolveTripPrice`, `executeStrategy`, `TripPriceInput` |
| `src/features/trips/lib/trip-price-engine.ts` | `computeTripPrice`, return shape, `approach_fee_net` + `net` merge |
| `src/features/trips/api/trips.service.ts` | `Object.assign(trip, computeTripPrice(...))` inside `updateTrip` when pricing-relevant fields change |

---

## Implementation status (2026-04-23)

**Superseded in part:** `resolveTripPrice` now has **P0** — taxameter `manual_gross_price` (before KTS). `TripPriceInput` includes `manual_gross_price`. KTS is P1; stored `net_price` fallback is P4; unresolved P5. P0 returns `approach_fee_net: 0` (no `withApproachFeeFromRule`). See `src/features/invoices/lib/resolve-trip-price.ts` and plan `trip_price_ssot_26690d29` implementation.

*End of audit.*
