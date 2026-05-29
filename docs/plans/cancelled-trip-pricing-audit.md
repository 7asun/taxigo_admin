# Cancelled Trip Pricing Audit

**Date:** 2026-05-28  
**Scope:** `fetchCancelledTripsForBuilder` + `buildCancelledTripBillingState` vs `fetchTripsForBuilder` + `buildLineItemsFromTrips`  
**Status:** Read-only investigation — no code changes

---

## Q1 — SELECT field diff: fetchTripsForBuilder vs fetchCancelledTripsForBuilder

### fetchTripsForBuilder (complete list)

```
id, payer_id, status, scheduled_at,
net_price, base_net_price, approach_fee_net, manual_gross_price,
driving_distance_km, manual_distance_km,
billing_variant_id,
pickup_address, dropoff_address,
kts_document_applies, no_invoice_required,
link_type, linked_trip_id, client_name,
driver:accounts!trips_driver_id_fkey(name),
payer:payers(rechnungsempfaenger_id, manual_km_enabled),
billing_variant:billing_variants(id, code, name, billing_type_id, rechnungsempfaenger_id,
  billing_type:billing_types(name, rechnungsempfaenger_id)),
client:clients(id, first_name, last_name, price_tag, reference_fields)
```

### fetchCancelledTripsForBuilder (complete list)

```
id, payer_id, scheduled_at,
pickup_address, dropoff_address,
canceled_reason_notes,
client_name,
net_price, base_net_price, approach_fee_net, manual_gross_price,
driving_distance_km, manual_distance_km,
billing_variant_id,
kts_document_applies, no_invoice_required,
link_type, linked_trip_id,
driver:accounts!trips_driver_id_fkey(name),
payer:payers(rechnungsempfaenger_id, manual_km_enabled),
billing_variant:billing_variants(id, code, name, billing_type_id, rechnungsempfaenger_id,
  billing_type:billing_types(name, rechnungsempfaenger_id)),
client:clients(id, first_name, last_name, price_tag, reference_fields)
```

### Diff

| Field | fetchTripsForBuilder | fetchCancelledTripsForBuilder |
|---|---|---|
| `status` | ✓ present | ✗ absent |
| `canceled_reason_notes` | ✗ absent | ✓ present |

**Assessment of diff:**

- `status` absent from cancelled fetch: not pricing-relevant. The cancelled fetch always filters `.eq('status', CANCELLED_STATUS)` so the value is known.
- `canceled_reason_notes` present only in cancelled fetch: passive display field. Not pricing-relevant.

**All distance, pricing, and billing_variant fields are identical** between the two selects:  
`net_price`, `base_net_price`, `approach_fee_net`, `manual_gross_price`, `driving_distance_km`, `manual_distance_km`, `billing_variant_id`, `kts_document_applies`, and all joins are character-for-character the same.

The DB-level SELECT is **not** the source of the pricing mismatch.

---

## Q2 — billing_variant join depth

Both fetches use exactly:

```sql
billing_variant:billing_variants(
  id, code, name, billing_type_id, rechnungsempfaenger_id,
  billing_type:billing_types(name, rechnungsempfaenger_id)
)
```

Neither fetch selects anything resembling `rate_rules`, `km_tiers`, or `time_rules` from the `billing_variants` table — because **those fields do not exist as columns or joins on `billing_variants`**. Pricing strategy configuration is stored as JSON in `billing_pricing_rules.config` and loaded separately via `listPricingRulesForPayer(params.payer_id)`.

The billing_variant join depth is **identical** in both fetches. No nested pricing config is missing from the cancelled fetch.

---

## Q3 — Distance fields on TripForInvoice vs CancelledTripRow

### TripForInvoice (`invoice.types.ts` lines 290–291)

```ts
manual_distance_km: number | null;    // required, non-optional
driving_distance_km: number | null;   // required, non-optional
```

No `effective_distance_km` — it is computed at build time by `resolveEffectiveDistanceKm`, never stored on the type.

### CancelledTripRow (`invoice.types.ts` lines 370–371)

```ts
manual_distance_km?: number | null;   // OPTIONAL — undefined if not fetched
driving_distance_km?: number | null;  // OPTIONAL — undefined if not fetched
```

Same two fields. Both are optional because `CancelledTripRow` is shared by narrow (passive €0) fetches and the extended pricing fetch; the narrow fetch does not select them.

### What resolveTripPricePure reads

`resolveTripPricePure` is `resolveTripPrice` from `resolve-trip-price.ts`, imported with alias. Inside `executeStrategy`:

```ts
const dist = trip.driving_distance_km;  // line 247
```

The `driving_distance_km` field on `TripPriceInput` is **not** the raw DB routing distance. Both callers compute the effective distance via `resolveEffectiveDistanceKm` first and then pass the result as `driving_distance_km`:

```ts
// buildLineItemsFromTrips (line 620)
driving_distance_km: effectiveDistanceKm,

// buildCancelledTripBillingState (line 490)
driving_distance_km: effectiveDistanceKm,
```

`resolveTripPricePure` reads whatever was passed in as `driving_distance_km` and uses it directly for all distance-dependent strategies (`tiered_km`, `fixed_below_threshold_then_km`, etc.).

---

## Q4 — Distance field mapping in buildCancelledTripBillingState

### buildCancelledTripBillingState

```ts
const effectiveDistanceKm = resolveEffectiveDistanceKm({
  manualDistanceKm: trip.manual_distance_km ?? null,    // CancelledTripRow field (optional → null)
  drivingDistanceKm: trip.driving_distance_km ?? null,  // CancelledTripRow field (optional → null)
  clientId: trip.client?.id ?? null,
  payerId: trip.payer_id ?? null,
  billingVariantId: trip.billing_variant_id ?? null,
  clientKmOverrides
});
// ...
driving_distance_km: effectiveDistanceKm,   // passed to resolveTripPricePure
```

### buildLineItemsFromTrips

```ts
const effectiveDistanceKm = resolveEffectiveDistanceKm({
  manualDistanceKm: trip.manual_distance_km ?? null,    // TripForInvoice field (required, non-optional)
  drivingDistanceKm: trip.driving_distance_km ?? null,  // TripForInvoice field (required, non-optional)
  clientId: trip.client?.id ?? null,
  payerId: trip.payer_id ?? null,
  billingVariantId: trip.billing_variant_id ?? null,
  clientKmOverrides
});
// ...
driving_distance_km: effectiveDistanceKm,   // passed to resolveTripPricePure
```

The mapping is **structurally identical**. The only syntactic difference is the `?? null` fallback on the cancelled path — required because `CancelledTripRow` fields are typed as optional (`T | undefined`), while `TripForInvoice` fields are typed as required (`T | null`). Both ultimately pass `null` when the DB value is absent.

**No mapping mismatch in the distance path.**

---

## Q5 — Transformations on net_price / manual_gross_price

Neither fetch applies any filter or transformation to `net_price` or `manual_gross_price`. Both select the raw DB column values directly and both callers pass them through identically:

```ts
// buildCancelledTripBillingState (lines 487–488)
net_price: trip.net_price ?? null,
base_net_price: trip.base_net_price ?? null,
manual_gross_price: trip.manual_gross_price ?? null,

// buildLineItemsFromTrips (lines 595–597)
net_price: trip.net_price ?? null,
base_net_price: trip.base_net_price ?? null,
manual_gross_price: trip.manual_gross_price ?? null,
```

Identical. No transformation, no filtering.

---

## Q6 — Senior-level assessment: most likely cause of €2.71 vs €6.11

After exhausting the SELECT diff, join depth, distance mapping, and field transformations, **the mismatch is almost certainly a data-quality issue rather than a code-path issue**: the cancelled trip's `driving_distance_km` is `null` in the database.

### Why this produces the observed prices

**Cancelled trip → €2.71:**

`resolveEffectiveDistanceKm` receives `drivingDistanceKm: null` and `manualDistanceKm: null` (both absent because the trip was cancelled before the routing service ran). It returns `null`.  
`resolveTripPricePure` receives `driving_distance_km: null`.

- **P0** — `manual_gross_price` is `null` → skip
- **P1** — `kts_document_applies` is `false` → skip
- **P2** — no client price tag → skip
- **P3** — `tiered_km` / `fixed_below_threshold_then_km` rule hits `executeStrategy`:
  ```ts
  const dist = trip.driving_distance_km;  // null
  if (dist === null || dist === undefined) return null;  // exits, returns null
  ```
  Strategy returns `null`. `withApproachFeeFromRule` propagates `null`.
- **P4** — `base_net_price` is set (driver app recorded it at trip start): e.g. `€2.53 net`.  
  At 7% VAT: `Math.round(2.53 × 1.07 × 100) / 100 = €2.71`.

**Normal equivalent trip → €6.11:**

Same trip if not cancelled would have `driving_distance_km = 8.x km` from the routing service.  
P3 `tiered_km` strategy runs with real distance → `tieredNetTotal(8.x, tiers)` → e.g. `€5.71 net`.  
At 7% VAT: `€6.11 gross`.

### Why this is NOT the code fix from this session (Fix 1)

Fix 1 addressed missing `clientPriceTags` for clients exclusive to cancelled trips. If Fix 1 were the cause, the wrong price would have been from the **wrong pricing rule** being selected (STEP 0 client tag missed → falls through to STEP 1–3 catalog rule). The catalog rule in that scenario would still have access to `driving_distance_km` if it exists on the trip, so it would likely still price at ~€6.11, just via the wrong rule. Fix 1 cannot explain a €2.71 result from a rule that resolves zero km.

### The actual root cause

**The cancelled trip has `driving_distance_km = null`.**  
This is a data-quality characteristic of cancelled trips, not a bug in the pricing cascade. Trips cancelled before the routing service completes (or trips cancelled before departure) will never have a routing distance. When a km-based rule is active and distance is null, the engine falls through to `base_net_price`, which reflects the driver's meter reading at the time of cancellation — a lower, often partial value.

### Secondary suspect

`payer_id` is typed as `payer_id?: string` (optional, no `| null`) on `CancelledTripRow` vs `payer_id: string` (required) on `TripForInvoice`. `buildCancelledTripBillingState` uses `trip.payer_id ?? ''` as the fallback. If `payer_id` were somehow `undefined` at runtime (should not happen given the DB filter, but possible if the TypeScript cast fails silently), `resolvePricingRule` STEP 3 would search for a rule where `r.payer_id === ''` — finding nothing, returning `null`. Without a rule, P3 skips; P4 again hits `base_net_price`. Same €2.71 outcome. This is a **defensive gap**, not the primary cause, but worth closing: `CancelledTripRow.payer_id` should be typed `payer_id: string` (required), mirroring `TripForInvoice`.

### Summary table

| Diff | Code issue? | Impact on price |
|---|---|---|
| SELECT field list | No — identical for pricing fields | None |
| billing_variant join depth | No — pricing strategy config is not a join | None |
| Distance field mapping | No — identical mapping in both paths | None |
| net_price / manual_gross_price | No — no transformation in either path | None |
| `clientPriceTags` for cancelled-only clients | **Yes — fixed in session (Fix 1)** | Wrong rule selected (minor) |
| `driving_distance_km` null on cancelled trips | **Data quality** — trips cancelled pre-routing | €6.11 → €2.71 (fallback to base_net_price) |
| `payer_id?: string` optionality on CancelledTripRow | Defensive gap in TypeScript type | Same fallback if ever undefined |
