# Audit: ARZO/RZO Pricing Rule — Missing `net_price` / `base_net_price` on Some Trips

**Scope:** Original pass was read-only; subsequent diagnostic SQL + code fix (see below).  
**Date:** 2026-04-24  
**Codebase:** `taxigo_admin` (Next.js admin; Supabase Postgres).

### Root cause — confirmed (post-diagnostic)

Diagnostic SQL showed payer-wide `tiered_km` rules for ARZO/RZO and non-null `driving_distance_km` on affected trips. The failure was **not** missing catalog rows but **`resolvePricingRule`** (`src/features/invoices/lib/resolve-pricing-rule.ts`):

1. **Null vs `undefined`:** Nullable FKs on trip payloads and rule rows often arrive as `undefined` after JSON/JS merges. Strict `=== null` on **rule** fields (and mismatches in tag matching) excluded the payer-wide row even when it existed.
2. **STEP 1 / documentation:** The intended behaviour was always “variant if present, else fall through to payer-wide.” The implementation already fell through when no variant rule matched; the practical gap was STEP 3 not matching until rule columns were normalised. Comments now state explicitly that missing variant rules must not block STEP 3.

### Fix applied (2026-04-24)

| Area | Change |
|------|--------|
| Trip inputs | `billingTypeId` / `billingVariantId` normalised with `?? null` at top of `resolvePricingRule` (lines ~28–35 in the post-fix file) so omitted keys behave like SQL null. |
| Rule matching | Every `.find` predicate that compared to `null` now uses `(r.<field> ?? null) === null` or `(r.<field> ?? null) === <normalised id>` so catalogue rows deserialised with `undefined` still match payer-wide and type-level rules. |
| STEP 0 tags | Tag lookups use `?? null` for consistent variant / payer matching. |
| Tests | `src/features/invoices/lib/__tests__/resolve-pricing-rule.test.ts` — two cases: omitted trip billing keys + variant id with no variant rule but payer-wide present. |

**Build:** `bun run build` — pass. **Tests:** `bun test` — pass (48 tests).

**Data repair:** Run `bun run scripts/backfill-null-trip-net-prices.ts` against an environment with `SUPABASE_SERVICE_ROLE_KEY` (confirm with the team before production) to re-stamp trips that were inserted while the resolver returned null.

---

## Executive summary

Pricing for **all** payers (including ARZO and RZO — there is **no** payer-specific branch in code) is computed in application TypeScript via `loadPricingContext` → `resolvePricingRule` → `resolveTripPrice` → `computeTripPrice` (`src/features/trips/lib/trip-price-engine.ts`, `src/features/invoices/lib/resolve-pricing-rule.ts`, `src/features/invoices/lib/resolve-trip-price.ts`). ARZO/RZO are **not** named in source; behavior is entirely data-driven.

Trips with `base_net_price IS NULL` and generated `net_price = 0` indicate the engine returned **no** successful net resolution (`resolution.net === null`), so `computeTripPrice` emitted the all-null price snapshot (except `net_price` is still **derived in the database** as zero when both components are null). That pattern matches **unresolved** pricing, not a successfully evaluated €0 fare (KTS and other zero-net paths still **stamp** `base_net_price` / `gross_price` / `tax_rate`).

The most plausible root causes for ARZO/RZO subset gaps—aligned with existing analysis in `docs/plans/price-engine-resolution-audit.md`—are: **(A)** missing **payer-wide** rule row (`billing_type_id` and `billing_variant_id` both null), **(B)** **orphaned** rule rows (`payer_id` + `billing_type_id` set, `billing_variant_id` null), which the resolver never matches, and **(C)** **distance-dependent** strategies (`tiered_km`, `fixed_below_threshold_then_km`) with `driving_distance_km IS NULL`. **(D)** Failed or skipped `loadPricingContext` (no `companyId`, or thrown/caught error) forces an **empty** rule set and produces the same symptom **without** throwing to the user.

**Update (2026-04-24):** For the ARZO/RZO cases investigated with SQL, the catalog was valid; the resolver bug (null vs `undefined` on trip and rule rows, see section “Root cause — confirmed” above) explained trips that should have matched STEP 3 or received payer-wide pricing after a missing variant rule.

---

## Findings per question

### 1. Where is the pricing rule for ARZO/RZO applied? Creation vs later step vs status?

**There is no dedicated ARZO/RZO rule in code.** Rules come from `billing_pricing_rules` (plus client price tags) loaded by `loadPricingContext` and selected by `resolvePricingRule`.

**Application at insert (creation):**

- **Manual create:** `create-trip-form.tsx` loads pricing contexts per `(payer_id, client_id)` (lines ~1170–1199), then spreads `computeTripPrice(...)` into each `tripsService.createTrip` payload (e.g. lines ~1347–1363, ~1497–1516, ~1582–1600). `tripsService.createTrip` itself **does not** compute price; it only inserts (`trips.service.ts` lines 42–51).
- **Bulk CSV upload:** `bulk-upload-dialog.tsx` Pass 0b loads contexts (lines ~1200–1238) and applies `computeTripPrice` before `bulkCreateTrips` (lines ~1241–1262, return legs ~1319–1341).
- **Recurring cron:** `src/app/api/cron/generate-recurring-trips/route.ts` loads context per `(companyId, payerId, clientId)` (lines ~360–407) and spreads `computeTripPrice` into generated inserts (lines ~516–533, ~584–600).
- **Duplicate:** `src/app/api/trips/duplicate/route.ts` preloads contexts (lines ~62–105); `duplicate-trips.ts` calls `computeTripPrice` at insert sites (see grep / file comments ~303, ~488–595).

**After creation (updates):**

- **`tripsService.updateTrip`** (`trips.service.ts` lines 62–100): if `shouldRecalculatePrice(trip)` is true, it runs `resolveTripForPricing` → `loadPricingContext` → `computeTripPrice` and merges fields into the update. **Status changes are not** in `PRICING_RELEVANT_FIELDS` (`trip-price-engine.ts` lines 292–307, `shouldRecalculatePrice` lines 319–322), so a normal status-only update does **not** reprice.

**Conclusion:** Rules are applied at **trip row construction** for each creation path above, and again on **updates that touch pricing-relevant fields**—not on arbitrary status transitions.

---

### 2. What conditions must hold for the rule to be evaluated? Guards, flags, required fields?

**Entry / short-circuit:**

- `computeTripPrice`: immediate all-null if `!trip.payer_id` (`trip-price-engine.ts` lines 227, 220–225).
- `loadPricingContext`: returns empty rules/tags if `!payerId` (lines 103–107). If `loadPricingContext` throws, callers typically catch, log, and use an **empty** context (e.g. `create-trip-form.tsx` lines 1187–1197; `trips.service.ts` `updateTrip` lines 71–85) — equivalent to “no rules.”

**Rule selection (`resolve-pricing-rule.ts`):**

- STEP 0: client price tags (requires `clientId` and matching tags with positive gross) — lines 38–77.
- STEP 1: variant rule — requires `billingVariantId` truthy — lines 81–86.
- STEP 2: billing **type** rule — requires `billingTypeId` **and** rule row with `r.payer_id === null`, `r.billing_type_id === billingTypeId`, `r.billing_variant_id === null` — lines 89–97.
- STEP 3: payer-wide rule — `r.payer_id === payerId`, `r.billing_type_id === null`, `r.billing_variant_id === null` — lines 100–108.

**Strategy execution (`resolve-trip-price.ts` `executeStrategy`, lines 235–393):**

- `tiered_km` / `fixed_below_threshold_then_km`: returns `null` if `driving_distance_km` is null/undefined (lines 288–289, 305–306).
- `time_based`: returns `null` if `scheduled_at` is missing (line 337).
- `no_price`: always `null` (lines 284–286).
- Invalid/parseable config: `parseConfigForStrategy` throws → caught → `null` (lines 243–247).

**KTS / taxameter / tags:**

- P0 `manual_gross_price` wins (lines 402–422).
- P1 KTS: `kts_document_applies === true` forces €0 net/gross (lines 425–437) — **stamped** values, not “unresolved nulls.”

**Conclusion:** Silent “no price” happens when no **resolvable** rule + strategy returns a net, and P4 cannot use `base_net_price` (always null on fresh compute). Common silent cases: **no matching rule row**, **orphaned** rule shape, **km strategies without distance**, **time_based without schedule**, **empty context** after failed load.

---

### 3. Difference between trips that get a price and those that do not (flows / API paths)?

All major paths use the **same** `computeTripPrice` + `loadPricingContext` stack (see `docs/price-calculation-engine.md` “Wired creation paths”, lines 148–155). Differences are **inputs**, not a separate ARZO/RZO code path:

| Path | File | Risk factors for missing price |
|------|------|--------------------------------|
| Manual create | `create-trip-form.tsx` | No `companyId` → no context load; geocoding/metrics failure → `driving_distance_km` null for km rules; wrong/missing billing variant or type vs catalog rules |
| Bulk upload | `bulk-upload-dialog.tsx` | Same engine; rows may lack coords/metrics or billing linkage |
| Recurring cron | `generate-recurring-trips/route.ts` | `client.company_id` missing skips context (lines 387–407); timeless outbound `scheduled_at` null breaks `time_based` |
| Duplicate | `duplicate/route.ts` + `duplicate-trips.ts` | Failed context load → empty rules |
| Edit | `trips.service.ts` `updateTrip` | Only reprices when patch keys match `shouldRecalculatePrice` |

**Conclusion:** There is no alternate “bypass” API for ARZO/RZO in-repo. A priced vs unpriced row reflects **payer/billing/distance/client/context** data and **engine resolution**, not import vs form **per se**.

---

### 4. Why is `base_net_price` null (not `"0.0000"`)? Default vs “never called”?

**Semantics:**

- `computeTripPrice` defines **unresolved** output as all-null for `gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net` (`trip-price-engine.ts` lines 220–225, 255).
- **Early exit** when `resolution.net === null` (line 255) **before** any non-null snapshot — so the trip was priced through the engine but **no net** was produced.

**Schema:**

- `base_net_price` is nullable; migration `20260424100000_add_trip_price_split.sql` adds columns with **no** default (lines 3–5).
- **Database does not** auto-fill `base_net_price` on insert; only application payloads and backfill scripts set it.

**Distinguishing “never ran” vs “ran and unresolved” from a row alone:** You cannot always tell. If the insert spread omitted price fields, columns stay SQL `NULL`. If the engine ran and returned nulls, result is also `NULL`. **Downstream evidence:** if `gross_price` and `tax_rate` are also null alongside `base_net_price` null, that matches the **nullFields** return from `computeTripPrice` (unresolved or no payer).

**`net_price` still shows `0.0000`:** The column is **generated** as `COALESCE(base_net_price,0) + COALESCE(approach_fee_net,0)` (`20260425120000_net_price_generated.sql`, lines 20–24). So **both** null components yield **zero** read-side while `base_net_price` remains null — exactly the reported pattern.

---

### 5. Is `approach_fee_net: "0"` a default or calculated? Where set?

- **When pricing succeeds:** `approachFeeNet = resolution.approach_fee_net ?? 0` (`trip-price-engine.ts` lines 263–264). Many strategies omit `approach_fee_net`; the coalesce yields **numeric 0** for storage math.
- **P0 taxameter** explicitly sets `approach_fee_net: 0` on the resolution (`resolve-trip-price.ts` lines 401–422).
- **When pricing fails** (`resolution.net === null`): `computeTripPrice` returns **nullFields** with `approach_fee_net: null` (lines 220–225, 255) — not zero.

**String `"0"` in exports/UI:** Supabase/PostgREST often returns `numeric` as **strings**. A displayed `"0"` can be a **coerced** zero (e.g. `?? 0` in UI) or a **real** stored `0` from successful resolution with no separate Anfahrt line. For **unresolved** rows, the canonical DB state for the column is **NULL** unless something else wrote 0.

---

### 6. Triggers, Edge Functions, background jobs to backfill or recalc?

- **Postgres triggers on `trips` for pricing:** None found in migrations (only RLS, indexes, schema changes). **No** trigger recalculates `base_net_price` on insert/update.
- **Supabase Edge Functions** in this repo: **None** (no `supabase/functions` in tree).
- **Jobs / scripts (application-level):**
  - `scripts/backfill-null-trip-net-prices.ts` — targets trips with `base_net_price` and `approach_fee_net` both null; uses `loadPricingContext` + `computeTripPrice`.
  - `scripts/backfill-driving-distance.ts` — distance + repricing (multiple passes; see `docs/price-calculation-engine.md` lines 210–227).
  - Cron `generate-recurring-trips` applies pricing **at materialization**, not as a follow-up pass.

**Error handling:** `loadPricingContext` is documented as “Never throws” in spirit, but `createTrip` path uses `try/catch` on each context load; failures log and continue with **empty** rules. `updateTrip` catches failed `loadPricingContext` and **skips** merging price fields (lines 71–88), so the row can be saved **without** updated prices. **Silent** from the user’s perspective unless they watch logs.

**Conclusion:** There is **no** guaranteed post-insert repricing. An underpriced create stays underpriced until a **pricing-relevant** edit, a **script**, or manual DB fix.

---

### 7. Senior-level root cause hypothesis

**Primary (data + contract alignment):** For some ARZO/RZO trips, **`resolvePricingRule` returns no applicable row** (missing payer-wide row, only orphaned `payer_id`+`billing_type_id` rows, or type/variant on the trip that does not match any STEP 1/2 row), so P3 never runs a successful strategy. This matches the dedicated analysis in `docs/plans/price-engine-resolution-audit.md` (Hypotheses A–B, lines 198–216) for similar payer/trip patterns.

**Strong co-cause (distance / schedule):** If the **active** rule uses `tiered_km` or `fixed_below_threshold_then_km`, **`driving_distance_km` must be non-null** (`resolve-trip-price.ts` lines 288–289, 305–306). Bulk/import/geocoding failures often leave distance null. **`time_based`** requires `scheduled_at` (line 337); recurring “timeless” rows may have null `scheduled_at`.

**Operations / context:** **Failed or skipped `loadPricingContext`** (missing `companyId` on create, network error, caught and ignored) yields **zero rules** and the same null snapshot.

**Not the leading explanation** for `base_net_price` **null** vs a **successful** zero fare: KTS and taxameter paths **set** concrete nets (and `approach_fee_net` handling differs, see `resolve-trip-price.ts` P0–P1). The observed **null `base_net_price` + generated `net_price` 0** matches **unresolved** engine output + generated column semantics, not a correctly applied zero-price rule.

---

## Files involved (role in pricing flow)

| File | Role |
|------|------|
| `src/features/trips/lib/trip-price-engine.ts` | `loadPricingContext`, `computeTripPrice`, `shouldRecalculatePrice`, `resolveTripForPricing` — central engine |
| `src/features/invoices/lib/resolve-pricing-rule.ts` | Variant → type → payer rule chain (STEP 0–3) |
| `src/features/invoices/lib/resolve-trip-price.ts` | P0–P5 cascade, `executeStrategy` per `tiered_km`, `time_based`, etc. |
| `src/features/invoices/lib/tax-calculator.ts` | VAT rate for `resolveTaxRate` |
| `src/features/trips/api/trips.service.ts` | `createTrip` / `bulkCreateTrips` **raw insert**; `updateTrip` **reprices** when `shouldRecalculatePrice` |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | Manual create: context load + `computeTripPrice` on each insert |
| `src/features/trips/components/bulk-upload-dialog.tsx` | Bulk insert: same pattern |
| `src/features/trips/components/bulk-upload/resolve-clients-step.tsx` | Patches with repricing on client link |
| `src/app/api/cron/generate-recurring-trips/route.ts` | Recurring trip materialization + pricing |
| `src/app/api/trips/duplicate/route.ts` + `src/features/trips/lib/duplicate-trips.ts` | Duplicate flow + fresh `computeTripPrice` |
| `src/features/trips/trip-reschedule/api/reschedule.actions.ts` | Reschedule repricing |
| `src/features/unassigned-trips/api/unassigned-trips.service.ts` | Assign variant repricing |
| `scripts/backfill-null-trip-net-prices.ts`, `scripts/backfill-driving-distance.ts` | Offline / CLI repricing and distance backfill |
| `supabase/migrations/20260424100000_add_trip_price_split.sql` | Nullable `base_net_price` / `approach_fee_net` |
| `supabase/migrations/20260425120000_net_price_generated.sql` | Generated `net_price` from coalesced components |
| `src/types/database.types.ts` | `trips` Row/Insert/Update typings (incl. generated `net_price` comment ~1216) |
| `docs/price-calculation-engine.md` | Module overview and wired paths |
| `docs/plans/price-engine-resolution-audit.md` | Prior audit: orphaned rules, missing payer-wide row, null distance |
| `docs/plans/resolve-trip-price-internals-audit.md` | `computeTripPrice` / P3–P4 behavior notes |

---

## Recommended next steps (planning; not implemented here)

1. **Run diagnostic SQL** (adapt from `docs/plans/price-engine-resolution-audit.md` lines 249–273) scoped to **ARZO and RZO** `payer_id` values: count payer-wide rules, orphaned rules, trips with null `driving_distance_km`, and null `billing_type_id` / `billing_variant_id`.
2. **Validate catalog data:** Ensure at least one **resolvable** rule row per payer/scenario (payer-wide and/or type-level rows that the resolver can actually match; fix **orphaned** `payer_id`+`billing_type_id`+null variant rows if present).
3. **Validate trip inputs:** For km-based rules, ensure **metrics** (or backfill) so `driving_distance_km` is set when pricing runs; for `time_based`, ensure `scheduled_at` when the rule needs it.
4. **Optionally re-run** `scripts/backfill-null-trip-net-prices.ts` or targeted repricing after data fixes (service-role, per project ops).
5. **Optional product hardening (future):** surface a visible warning when `computeTripPrice` returns all-null on create, or when `loadPricingContext` fails — today failures are **logged** and can leave trips **unpriced** without UI signal (`create-trip-form.tsx` ~1195–1197, `trips.service.ts` ~77–85).

---

## References (line numbers in repository at audit time)

- `computeTripPrice` null return: `src/features/trips/lib/trip-price-engine.ts` 216–275  
- `shouldRecalculatePrice` fields: same file, 292–322  
- Rule chain: `src/features/invoices/lib/resolve-pricing-rule.ts` 21–108  
- `resolveTripPrice` P0–P5: `src/features/invoices/lib/resolve-trip-price.ts` 395–505  
- Generated `net_price`: `supabase/migrations/20260425120000_net_price_generated.sql` 18–24  
- `updateTrip` repricing: `src/features/trips/api/trips.service.ts` 62–100  
- Manual create spread: `src/features/trips/components/create-trip/create-trip-form.tsx` 1347–1363  
