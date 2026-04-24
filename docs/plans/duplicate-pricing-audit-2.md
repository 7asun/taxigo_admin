# Audit: Duplicate Pricing — Root Cause Investigation (Round 2)

**Scope:** Read-only analysis of the five listed files plus `resolveTripPrice` behaviour referenced by `computeTripPrice`.  
**Date:** 2026-04-24

---

## Part A — Specific questions (file + line references)

### 1. `enrichInsertWithMetrics` — mutate or return?

**Signature:** `async function enrichInsertWithMetrics` — `duplicate-trips.ts` **377–381**.

- **Return type:** `Promise<void>` — there is **no** return value; the function always ends implicitly after the `if` block or after the inner assignment block (**381–401**). No `return` statement.
- **Behaviour:** The function **mutates** the `insert` object in place (e.g. `insert.driving_distance_km = metrics.distanceKm` at **398–400**).
- **Pair branch:** The caller uses `await enrichInsertWithMetrics(outInsert, supabase, companyId);` (**558**) and the same for `retInsert` (**583**). The **return value of `enrichInsertWithMetrics` is `void` and is not assigned** to anything. The updated metrics live on the same `outInsert` / `retInsert` object references.

---

### 2. `toComputeInput` — full field mapping

**Location:** `duplicate-trips.ts` **315–327**.

**Complete body (fields read from `insert`):**

| `ComputeTripPriceInput` field | Source expression |
|------------------------------|--------------------|
| `payer_id` | `insert.payer_id ?? null` |
| `billing_type_id` | `insert.billing_type_id ?? null` |
| `billing_variant_id` | `insert.billing_variant_id ?? null` |
| `client_id` | `insert.client_id ?? null` |
| `driving_distance_km` | `insert.driving_distance_km ?? null` |
| `scheduled_at` | `insert.scheduled_at ?? null` |
| `kts_document_applies` | `!!insert.kts_document_applies` |
| `net_price` | always `null` (forced) |
| `base_net_price` | always `null` (forced) |
| `manual_gross_price` | `insert.manual_gross_price ?? null` |

**Confirmed** your list: `payer_id`, `client_id`, `billing_type_id`, `billing_variant_id`, `driving_distance_km`, `scheduling_at` are all read (the last as `scheduled_at`).

`toComputeInput` does **not** read `gross_price` or `tax_rate` from the insert (those are outputs of `computeTripPrice`, not inputs).

---

### 3. `buildDuplicateInsert` — field coverage

**Location:** `duplicate-trips.ts` **330–362**, built from `...copyRouteAndPassengerFields(source)` (**341**) plus explicit fields.

**From source (via `copyRouteAndPassengerFields`, 267–310):**

- **`payer_id`:** `source.payer_id` — **yes** (291)
- **`client_id`:** `source.client_id` — **yes** (286)
- **`billing_type_id`:** `source.billing_type_id` — **yes** (306)
- **`billing_variant_id`:** `source.billing_variant_id` — **yes** (292)
- **`driving_distance_km` / `driving_duration_seconds`:** copied from source (307–308)
- **`scheduled_at`:** **not** taken from the source in `copyRouteAndPassengerFields`. It is set only in `buildDuplicateInsert` as `scheduled_at: schedule.scheduled_at` (**350**), i.e. from the **schedule** argument (duplicate target day / mode), not from `source.scheduled_at`.

**Hardcoded / non-copy:** `gross_price: null`, `tax_rate: null` (304–305), `kts_source: 'manual'`, KTS/no-invoice bool coercions (295–298), and link/status fields as in **340–361**.

**Implication:** two legs in a pair can differ in **`scheduled_at` on the insert** because they use different **`outSchedule` vs `retSchedule`** (see pair branch **504–549**, then **551–556** vs **576–580**), while they copy **billing and route** from **different** source rows (`unit.outbound` vs `unit.ret` — **551–556** vs **576–580**). **Billing** fields can also differ if the two source `Trip` rows differ.

---

### 4. Backfill script — input construction

**File:** `scripts/backfill-null-trip-net-prices.ts`

**Query columns:** `select` at **44–45** — `id, company_id, payer_id, billing_type_id, billing_variant_id, client_id, driving_distance_km, scheduled_at, kts_document_applies, manual_gross_price`

**`ComputeTripPriceInput` construction:** **67–78** — explicit object, not `toComputeInput` from an `InsertTrip`. It is **partial in spirit** (same logical fields as duplicate’s `toComputeInput`) and includes:

- `payer_id`, `billing_type_id`, `billing_variant_id`, `client_id`, `driving_distance_km`, `scheduled_at`, `kts_document_applies`, `net_price: null`, `base_net_price: null`, `manual_gross_price`

**Match vs duplicate `toComputeInput`:** For pricing-relevant fields, the same set is **aligned** with `duplicate-trips.ts` **315–327**, modulo `kts_document_applies` (backfill: `?? false` **74**; duplicate: `!!insert.kts_document_applies` **323**). Neither path passes `gross_price` / `base_net_price` as inputs for the calculation (forced null).

**`loadPricingContext` + `computeTripPrice`:** **81–87**

**Unresolved detection:** **88–90** — `if (priceFields.gross_price == null)` then count `unresolved` and skip update (does not treat `0` as null).

---

### 5. `computeTripPrice` null path (with `driving_distance_km` non-null)

**File:** `trip-price-engine.ts` **216–276**

`computeTripPrice` returns the **all-null** `nullFields` object (**220–225**) in exactly two places:

1. **Line 227:** `if (!trip.payer_id) return nullFields;`  
   - Fails if `payer_id` is null, undefined, or `''` (falsy string).

2. **Line 255:** `if (resolution.net === null) return nullFields;`  
   - After `resolveTripPrice` (**253**).

**When `driving_distance_km` is present and non-null,** step 1 does not short-circuit on distance; step 2 requires tracing **`resolveTripPrice`** `resolve-trip-price.ts` **395–505**.

`resolution.net` is **null** at the end of the cascade in **P5** (**494–505**): `net: null` in the returned `withApproachFeeFromRule` payload. P5 runs when P0–P4 did not produce a finite net. With **non-null distance**, common ways to still reach `net === null`:

- **`rule === null`** (no catalog rule in `context.rules` after `resolvePricingRule`, or all steps miss): P3 is skipped; P4 fails if `base_net_price` is null; **P5 gives `net: null`**.
- **`rule` present but P3’s `executeStrategy` returns `null`**, and P4 still has no `base_net_price`: e.g. **`no_price`** returns null from the strategy (`resolve-trip-price.ts` **284–286**); **`time_based`** with **`!sched`** (no / empty `trip.scheduled_at`) returns null (**337**); **`client_price_tag` / `manual_trip_price`** strategies inside `executeStrategy` with missing `base_net_price` can return null (**255–257**, **270–272**); **`parseConfigForStrategy` throws** → `executeStrategy` returns null (**244–247**).
- P2 and P1 can still produce **non-null** `net` (KTS, tags, P0 taxameter); they do not require distance.

**Conclusion for Part A.5:** Non-null `driving_distance_km` does **not** force a price. A **tiered** rule must be **selected** and **executed** successfully; a **time_based** (or `no_price`) match with bad/missing `scheduled_at` or an **empty** rules array will still land in **P5** with `resolution.net === null** (**255** in `trip-price-engine.ts`).

---

## Part B — Independent assessment

### B.1 — What prior audits may have missed (in these five files)

1. **`loadPricingContext` pre-filters** rules in `trip-price-engine.ts` **139–145** with strict `r.payer_id === payerId` and `typeIds` / `variantIds` membership. A payer-wide `billing_pricing_rules` row whose `payer_id` is `undefined` in the mapped object, or a mismatch in reference equality, is **dropped** before `resolvePricingRule` ever runs. The **null/undefined normalisation in `resolve-pricing-rule.ts` does not apply** to that filter. This is in **`trip-price-engine.ts`**, not the duplicate-only path.

2. **Per-leg `billing_type_id` / `billing_variant_id` on the new rows** come from **each** source `Trip` (`unit.outbound` vs `unit.ret` — `copyRouteAndPassengerFields`). Those IDs can differ between legs; **`resolvePricingRule` can therefore pick different active rules** (e.g. variant-level `time_based` vs payer-wide `tiered_km`). “Same getCtx key” is **not** the same as “same resolved rule.”

3. **`scheduled_at` on the duplicate insert** is **not** copied from the source; it is whatever **`outSchedule` / `retSchedule`** build (**350**, **504–549**). In `unified_time` when `payload.unifiedScheduledAtIso` is falsy, `outSchedule` is **`scheduled_at: null`, `requested_date: targetYmd` (**518–521**). If the **selected** active rule is **`time_based`**, `executeStrategy` returns **null** when `!sched` (`resolve-trip-price.ts` **337**), and **`computeTripPrice` returns all-null** (**255** in `trip-price-engine.ts`) even with distance filled.

4. **Duplicate route** swallows `loadPricingContext` failures in **`try`/`catch`** and simply **omits** that key from `contextMap` (`route.ts` **84–95**), so `getCtx` can return **`emptyCtx`** (104) for a key that failed — but you stated **ruling out** different keys between legs, so this is secondary to **rule resolution + strategy + schedule** differences.

5. **Optional / coercion:** `toComputeInput` uses `!!kts_document_applies` — Falsy `undefined` and explicit `false` both become `false` for the flag; `true` only if truthy. String `"false"` from bad JSON would be truthy; unlikely from Supabase.

6. **Backfill** uses `gross_price == null` for unresolved (88). A trip with **KTS** gets `gross: 0`, not `gross: null` — it would be counted as “updated” if not dry-run, not as unresolved. The **4 trips that stay null under backfill** are therefore in the **unresolved** branch of `resolveTripPrice` (P5 or failed strategy with no base), not a gross-null check quirk.

### B.2 — ARZO-specific code paths

**No.** `resolve-pricing-rule.ts` and `trip-price-engine.ts` contain **no** payer name, ARZO, or other payer string checks. All logic is keyed by `payerId` (UUID) and `company_id`, and generic strategy/config handling.

### B.3 — Root cause hypothesis (direct)

- **File / function / lines:** The failure is the interaction between **`computeTripPrice`** `trip-price-engine.ts` **244–255** and **`resolveTripPrice`** + **`executeStrategy`**, in particular `resolve-trip-price.ts` **467–471**, **333–337**, and **493–505**; **duplicate** contributes via **`toComputeInput` inputs** and **`buildDuplicateInsert` schedules** `duplicate-trips.ts` **315–327**, **350**, **504–521**.

- **Exact condition for all-null `TripPriceFields`:** `!trip.payer_id` (227) **or** `resolution.net === null` (255) from **`resolveTripPrice`**, most often **P5** (`net: null`, **496–500**) when **no rule** applies, the **active rule’s strategy returns null** (e.g. `no_price`, or **`time_based` with `!sched`** at **337**), or P3 strategy execution fails.

- **Why some trips in a pair, not others (given same context key):** **Same** `getCtx` / backfill `loadPricingContext` **does not imply same** `resolvePricingRule` result or same **`toComputeInput`**. The **Hin and Rück source rows** can differ in **`billing_type_id` / `billing_variant_id`**, and the **duplicate schedulers** can assign **`scheduled_at: null` to one leg** (`duplicate-trips.ts` **518–521** in `unified_time` without outbound ISO) while the other has a real ISO. If the **winning** rule for one leg is **`tiered_km`**, distance alone prices it; if the **other** leg matches a **variant** rule that is **`time_based`** and **`scheduled_at` is null** on the insert, **`executeStrategy` returns `null`**, and **`computeTripPrice` returns all-null** for that leg. That is consistent with “unpriced leg sometimes outbound, sometimes return” and with **backfill** still seeing null: the **stored row** preserves **per-leg** `scheduled_at` / `billing_variant_id` / `billing_type_id` that reproduces the same resolution.

---

## Final summary (one paragraph each)

### Root cause (condensed)

The duplicate and backfill paths both call `computeTripPrice` with a **per-row** `ComputeTripPriceInput`. **Non-null `driving_distance_km` is insufficient** to get a non-null `resolution.net`: you need a **resolvable** `BillingPricingRuleLike` and a **non-null** `executeStrategy` result (or a tag/KTS/taxameter path). The engine returns all-null when `resolveTripPrice` ends in **P5** or a failed P3 with no P4, especially when the **active rule** is `time_based` and **`trip.scheduled_at` is null** (`resolve-trip-price.ts` **337**), or when **`context.rules` is empty** (filter in `loadPricingContext` or true absence of rules). **Pairwise** differences in **`billing_type_id` / `billing_variant_id` (per source leg)** and **`scheduled_at` on the built insert (schedule math in `buildDuplicateInsert` + `outSchedule`/`retSchedule`)** explain how one leg can price and the other not **without** a different `getCtx` key.

### Recommended fix approach (one paragraph)

Validate **per-leg** the triple (`billing_type_id`, `billing_variant_id`, `scheduled_at`, `driving_distance_km`) on stored rows that fail `computeTripPrice` and compare **outbound vs return** source; align **unified_time** and **retSchedule** so legs are not left with **`scheduled_at: null` when the chosen rule is `time_based`**, or ensure catalog rules for those variants are **`tiered_km`**, or extend **`loadPricingContext`’s** rule filter to use the same **null/undefined** safety as the resolver. After rule/data fixes, re-run the backfill and consider a **test** that duplicates a pair where schedules intentionally differ. **Code changes** are **not** part of this document.

---

## File index (Round 2 scope)

| File | Lines cited (representative) |
|------|------------------------------|
| `src/features/trips/lib/duplicate-trips.ts` | 315–327, 330–362, 377–403, 504–590 |
| `src/features/trips/lib/trip-price-engine.ts` | 97–189 (context load + filter 139–145), 216–255 |
| `src/features/invoices/lib/resolve-pricing-rule.ts` | 21–116 |
| `src/app/api/trips/duplicate/route.ts` | 62–113 |
| `scripts/backfill-null-trip-net-prices.ts` | 42–90 |

**Additional read (not in the five):** `src/features/invoices/lib/resolve-trip-price.ts` **235–505** for `executeStrategy` and P0–P5.
