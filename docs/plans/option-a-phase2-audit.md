# Option A — Phase 2 audit: `net_price` as generated column + P4 double-counting scope

**Phase 2 implemented (2026-04-25):** `trips.net_price` is a **Postgres `GENERATED ALWAYS … STORED`** column (`supabase/migrations/20260425120000_net_price_generated.sql`); the app **writes** `base_net_price` and `approach_fee_net` only, and **P4** in `resolve-trip-price.ts` uses **`base_net_price`** for the transport snapshot (not combined `net_price`). The sections below remain a **historical** inventory of the pre–Phase-2 state unless you treat them as superseded by the migration + `TripPriceFields` (no `net_price` in `computeTripPrice` return).

**Scope:** Read-only audit of the repository as of the Phase 1 completion state (migrations, types, and application code in tree). **This file was an audit; implementation followed in-tree.**

**Last updated:** 2026-04-25

---

## 1. Every explicit `net_price` write — named key vs `computeTripPrice` spread

### 1.1 Named `net_price` in insert/update payloads (literal key `net_price: …`)

| File | Location | What sets `net_price` | Notes |
|------|----------|------------------------|--------|
| `src/features/invoices/hooks/use-invoice-builder.ts` | `updateTrip` call inside `createMutation` ~272–291 | **Named key** `net_price: netPriceCombined` where `netPriceCombined` = cent-rounded `baseNet + approachNet` from line item (not `price_resolution.net` alone) | `tripsService.updateTrip(item.trip_id!, { ... })` |
| `scripts/backfill-null-trip-net-prices.ts` | `.update({ ... })` ~96–105 | **Named key** `net_price: priceFields.net_price` from `computeTripPrice` return | Together with `gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net` |
| `scripts/backfill-driving-distance.ts` | `.update({ ... })` ~120–128, ~503–509, ~620–629 (three similar blocks) | **Named key** `net_price: priceFields.net_price` from `computeTripPrice` | Log lines ~112, ~495, ~615 reference the same `priceFields` object |

`scripts/backfill-trip-price-split.ts` **does not** write `trips.net_price` in any `.update()` — updates use only `base_net_price` / `approach_fee_net` (e.g. ~148–150, 182, 206–210, 262–264, 288–310). It **reads** `net_price` in the trips `select` (~91) and passes `net_price: trip.net_price` into the resolver **input** object for `resolveTripPrice` (~228–230), which is not a column write.

### 1.2 `net_price: null` in inserts (intentional “no price yet” — then often overwritten)

These objects include **`net_price: null`** as a **named key** in the same literal as **spread of `computeTripPrice(...)`**, so the final insert payload’s `net_price` usually comes from the **spread** (see §2).

| File | Approx. lines | Pattern |
|------|---------------|--------|
| `src/features/trips/components/create-trip/create-trip-form.tsx` | 1347–1358, 1410–1421, 1493–1507, 1576–1590 | `{ ...baseTrip, ...computeTripPrice({ ... , net_price: null, ... }, ctx), ... }` passed to `tripsService.createTrip` |
| `src/features/trips/components/bulk-upload-dialog.tsx` | 1245–1260, 1322–1339 | `{ ...trip, ...computeTripPrice({ ... , net_price: null, ... }, ctx) }` / `pricedPayload` for bulk insert |
| `src/app/api/cron/generate-recurring-trips/route.ts` | 516–532 (outbound), 583–599 (return) | `TripInsert` = `{ ...payload, ...computeTripPrice({ ... , net_price: null, ... }, pricingCtx) }` |
| `src/features/trips/lib/duplicate-trips.ts` | 304–306, 327 (`copyRouteAndPassengerFields` / `toComputeInput` intent) | **Insert** row built with `net_price: null` in `copyRouteAndPassengerFields` **before** `Object.assign` with `computeTripPrice` in ~489–492, 565–567, 590–592 |

If `net_price` becomes **generated**, any insert/update that still includes **`net_price` in the JSON body** (even as `null` or a matching value) is **candidates for rejection** by PostgreSQL/PostgREST (see §8).

### 1.3 No other application `.update({ net_price` / `.insert({ net_price` matches

Repo-wide `net_price:` in `src/` and `scripts/` was enumerated via search; the **only** `trips` table writers with `net_price` in the payload are those above plus all **`computeTripPrice` spread** paths in §2.

---

## 2. `TripPriceFields` shape and all `computeTripPrice` spread sites

### 2.1 `TripPriceFields` and return shape of `computeTripPrice`

**File:** `src/features/trips/lib/trip-price-engine.ts`

- **`TripPriceFields`** (interface ~55–60) includes: `net_price`, `gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net` — all `number | null` except semantics documented in file header (~49–53).
- **`computeTripPrice`** (function ~215–275):
  - Early return **`nullFields`** (~219–224): `net_price: null`, `gross_price: null`, `tax_rate: null`, `base_net_price: null`, `approach_fee_net: null`.
  - Success return (~269–275): `net_price: totalNet`, `gross_price: totalGross`, `tax_rate`, `base_net_price: baseNetPrice`, `approach_fee_net: approachFeeNet` where `totalNet` = `baseNetPrice + approachFeeNet` (~262–264).

`ComputeTripPriceInput` (~194–204) is **separate**; it has **`net_price: number | null`**, passed through to `resolveTripPrice` as `tripInput` (~231–233) — this is the **cascade input** (P3/P4 trip fallback in `resolveTripPrice`), not the DB column. Field name collision is **semantic** only: input `net_price` means “stored trip net **passed into the resolver**”, not “column we are about to write”.

### 2.2 Call sites that merge `computeTripPrice()` into a trip **insert** or **update** object

| File | Line(s) | Mechanism | Target table |
|------|---------|------------|--------------|
| `src/features/trips/api/trips.service.ts` | 87 | `Object.assign(trip, computeTripPrice(tripInput, context))` then `update(trip)` | `trips` |
| `src/features/trips/trip-reschedule/api/reschedule.actions.ts` | 103, 148 | `Object.assign(primaryPatch, …)` / `Object.assign(partnerPatch, …)` | `trips` |
| `src/features/unassigned-trips/api/unassigned-trips.service.ts` | 139 | `Object.assign(patch, computeTripPrice(…))` | `trips` |
| `src/features/trips/components/bulk-upload/resolve-clients-step.tsx` | 190 | `Object.assign(tripPatch, computeTripPrice(…))` | `trips` |
| `src/features/trips/lib/duplicate-trips.ts` | 489–492, 565–567, 590–592 | `Object.assign(insert, computeTripPrice(…))` | `trips` insert |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | 1347–1358, 1410+ , 1493+ , 1576+ | `...computeTripPrice(...)` inside `createTrip` argument | `trips` insert |
| `src/features/trips/components/bulk-upload-dialog.tsx` | 1247–1260, 1324–1339 | `...computeTripPrice(...)` in outbound/return row objects | `trips` insert (bulk) |
| `src/app/api/cron/generate-recurring-trips/route.ts` | 518–532, 585–599 | `...computeTripPrice(...)` in `outboundWithPrice` / `returnWithPrice` | `trips` insert |

**Scripts** use `priceFields` from `computeTripPrice` and **name** `net_price` in `.update` (see §1.1), not `Object.assign` on a generic patch.

**Tests** calling `computeTripPrice` (not a DB write): `src/features/trips/lib/__tests__/trip-price-engine.test.ts` (multiple), `src/features/trips/lib/__tests__/duplicate-trips.test.ts`.

### 2.3 If `net_price` is removed from `TripPriceFields`

- **Type level:** `TripPriceFields` would no longer include `net_price`; every spread above would need to **omit** that key from DB payloads, or `computeTripPrice` would need to return a type **without** `net_price` for DB use.
- **Breakage risk:** any code expecting `result.net_price` from `computeTripPrice` (notably **tests** in `trip-price-engine.test.ts` asserting `result.net_price`) and any consumer using the combined field for **display math** in-process would need to use `base_net_price + approach_fee_net` (or `Row.net_price` read from DB after insert) instead.

---

## 3. `use-invoice-builder.ts` writeback — exact fields (post–Phase 1)

**File:** `src/features/invoices/hooks/use-invoice-builder.ts` ~272–291.

`tripsService.updateTrip(item.trip_id!, { … })` passes:

- **`net_price: netPriceCombined`** — **named key**, value = `Math.round((baseNet + approachNet) * 100) / 100` with `baseNet = item.price_resolution.net`, `approachNet = item.approach_fee_net ?? 0` (~276–281).
- **`gross_price`**, **`tax_rate`**
- **`base_net_price: baseNet`**, **`approach_fee_net: approachNet`**
- Conditionally **`manual_gross_price`** when manual override applies (~288–290).

It **does** set **`net_price` explicitly** as a named key; the value is **combined** (base + approach), not transport-only `price_resolution.net`.

---

## 4. Backfill and maintenance scripts — `net_price` write locations

| Script | Writes `net_price`? | How |
|--------|---------------------|-----|
| `scripts/backfill-null-trip-net-prices.ts` | **Yes** | `.update` ~99: `net_price: priceFields.net_price` from `computeTripPrice` — **named key** |
| `scripts/backfill-driving-distance.ts` | **Yes** (multiple blocks) | `.update` with `net_price: priceFields.net_price` (e.g. ~123, ~506, ~626) — **named key** |
| `scripts/backfill-trip-price-split.ts` | **No** to column | Only `base_net_price` / `approach_fee_net` in `update`; `net_price` used in **read** + resolver input only |

**Phase 2 change (exact lines to touch):** remove **`net_price`** from each `.update({ ... })` in `backfill-null-trip-net-prices.ts` and each equivalent block in `backfill-driving-distance.ts`; keep **`base_net_price`** / **`approach_fee_net`** (and `gross_price` / `tax_rate` as today). Re-test scripts against a generated-column schema.

`backfill-null` **selects** with `.is('net_price', null)` (~46). After `net_price` is generated, that predicate is still valid **if** the **generated expression** yields SQL `NULL` when both `base_net_price` and `approach_fee_net` are null (depends on final `GENERATED` expression, e.g. `NULLIF` / `coalesce` choice — see §6).

---

## 5. P4 double-counting — exact location, variable, and cascade impact

**File:** `src/features/invoices/lib/resolve-trip-price.ts`

- **`TripPriceInput`** (interface ~82–90): `net_price: number | null` (plus `manual_gross_price`, `kts_document_applies`, `driving_distance_km`, `scheduled_at`, `client`).

- **`withApproachFeeFromRule`** (function ~122–128): takes `base: PriceResolution` and `rule`; may set `approach_fee_net` on the **resolution** from `extractApproachFeeNet(rule)`.

- **P3 exit path** (~461–464): if a catalog rule’s `executeStrategy` returns a resolution, it returns `withApproachFeeFromRule(r, rule)`.

- **P4 — stored trip net fallback** (~467–482):
  - Condition: `if (trip.net_price !== null && trip.net_price !== undefined)`.
  - Local: `const n = trip.net_price;`.
  - Return: `withApproachFeeFromRule(resolution({ net: n, strategy_used: 'trip_price_fallback', source: 'trip_price', ... }), rule)`.

So P4’s base transport net for the `resolution` object is taken from **`trip.net_price`**, which, when fed from the **DB row** after Phase 1, is the **combined** `trips.net_price` (base + approach). **`withApproachFeeFromRule`** can then add **`approach_fee_net` from the active rule** again — the documented “double-count” / mismatch risk for combined stored nets.

- **`executeStrategy` also reads `trip.net_price` inside the rule strategy `switch`**, for example:
  - `client_price_tag` branch (~248–256): if `trip.net_price != null`, builds resolution with `net: trip.net_price` (trip price fallback when tag path didn’t have a tag in this “misnamed” branch).
  - `manual_trip_price` branch (~264–275): if `trip.net_price == null` return `null`, else `const n = trip.net_price`.

- **`resolveTripPrice`’s** main P0 (taxameter), P1 (KTS), and P2 (client price tag) blocks (~396–458) do **not** use `trip.net_price` for the main positive paths except where strategies above consume it.

- **File header** (~8–8) still says: “Priority 4: trips.net_price (net) fallback”.

### 5.1 Where does the builder get `trip.net_price` for the cascade?

**File:** `src/features/invoices/api/invoice-line-items.api.ts` ~260–264:

`buildLineItemsFromTrips` calls `resolveTripPricePure` with `net_price: trip.net_price ?? null` in the first argument. **`fetchTripsForBuilder`** selects `net_price` on trips (~146) and does **not** select `base_net_price` in the same `select` list (lines ~139–163). So the resolver currently receives **only** the **combined** column for P3/P4-style behavior.

### 5.2 `TripPriceInput` and repurposing

- **Today:** one field `net_price` on `TripPriceInput` serves (a) **input to strategies** and (b) **P4** “stored net fallback”.
- **For Phase 2 P4 fix:** the audit question is whether **`TripPriceInput` should gain `base_net_price: number | null`** (sourced from `trips.base_net_price` at fetch time) and P4 / relevant strategies use **that** for transport base while the generated `trips.net_price` remains a **read-only report** of combined, **or** whether **`net_price` on the input** should mean “transport-only” everywhere (breaking change to naming vs DB). The code does **not** currently pass `base_net_price` from `fetchTripsForBuilder` into `resolveTripPrice`.

---

## 6. Generated column migration — feasibility (PG, indexes, RLS, types)

### 6.1 RLS, triggers, DB objects that write `trips.net_price`

- **RLS** on `public.trips` (e.g. `20260409170000_add_missing_rls.sql`) uses policies on `company_id` and role patterns — they **do not** assign or mention `net_price` by name in policy expressions found in the reviewed migrations. No migration in the searched set **creates a trigger** that sets `net_price` on `trips`.
- **Migrations** found referring to `trips.net_price` by name: column rename/comment in `20260418120000_trips-price-schema.sql`, split columns in `20260424100000_add_trip_price_split.sql`, plus JSON **defaults in `pdf_vorlagen`** that reference the **string** `"net_price"` as a column *key* for UI config, not a DB write to `trips`.

Conclusion: **no** in-repo RLS or trigger is identified that **assigns** `net_price` outside normal `INSERT`/`UPDATE` from the application. Application and scripts remain the only writers today.

### 6.2 In-place `ALTER` to generated column

PostgreSQL does **not** support a single generic `ALTER COLUMN ... SET GENERATED` that converts **every** existing plain column in all versions without caveats. Typical safe patterns:

1. Add a new generated column and migrate consumers, then drop the old; or  
2. Drop `net_price` and re-add as `GENERATED ALWAYS AS ... STORED` (with downtime / lock), after **`base_net_price` and `approach_fee_net` are backfilled and consistent**.

Expression must match the invariant: e.g. if both parts are `NULL`, whether combined `net_price` should be `NULL` — **`NULL` + numeric in SQL** yields `NULL`; confirm product wants **`NULL` vs 0** for “unpriced” rows.

The user’s spec `GENERATED ALWAYS AS (base_net_price + approach_fee_net) STORED` may need **`coalesce`** if legacy null semantics must match current app rounding.

### 6.3 Indexes on `trips.net_price`

No **`CREATE INDEX … ON public.trips (net_price)`** was found in the provided migration set. **Index found:** `idx_trips_billing_type_id` on `billing_type_id` (`20260418120000_trips-price-schema.sql`). Dropping `net_price` to recreate it could affect **future** or **untracked** DB indexes; production should be checked outside this repo.

### 6.4 Supabase / `database.types.ts` for generated columns

**File:** `src/types/database.types.ts` `trips` `Row` has `net_price` (~1216). `Insert` and `Update` still list **`net_price?: number | null`** (~1290, ~1354).

Supabase `gen types` for PostgreSQL `GENERATED ALWAYS` columns typically:
- still expose the column on **`Row`** (readable),
- often **omit** or mark the column in **`Insert`/`Update`** depending on the generator version.

**Manual follow-up** after regeneration: if `net_price` remains optional on `Insert`/`Update`, **removing** it from generated types is the desired end state; until then, TypeScript will not prevent a mistaken `net_price: x` in an update without discipline or a thin wrapper.

---

## 7. `nullFields` early-return in `computeTripPrice`

**File:** `src/features/trips/lib/trip-price-engine.ts` ~219–224, returned when `!trip.payer_id` or `resolution.net === null` (~254).

Object includes **`net_price: null`** and **`base_net_price: null`**, **`approach_fee_net: null`**, etc.

**After** `net_price` is **generated** from `base` + `approach`:

- **Omit** `net_price` from any `insert`/`update` JSON payload; the **database** will compute it when `base_net_price` and `approach_fee_net` are set (or leave all-null when unresolved).
- Early-return should **not** set a fictional `net_price` in the object merged into `Insert`/`Update` — it should set **`base_net_price` and `approach_fee_net` to `null` only** (and other fields as today), and **strip** `net_price` from the payload sent to PostgREST.

If `gross`/`tax_rate` are still set manually when all-null, the migration must be consistent (today `gross`/`tax` follow `net_price` in app logic — same file ~213).

---

## 8. Supabase client behaviour (payload keys, generated columns)

- **`@supabase/supabase-js`** builds HTTP requests from the **object keys you pass** to `.insert({})` / `.update({})`. It does **not** auto-include “all columns”.
- If the client includes **`net_price`** in the JSON body and the column is **`GENERATED ALWAYS`**, **PostgreSQL** returns an error for illegal assignment to a generated column; **PostgREST** surfaces that to the client (expect a **4xx** with a message about the column).
- **Not silent ignore** for invalid writes in standard PostgreSQL.

**Omitting keys:** the codebase’s main pattern is building `update` / `create` objects from **spread + assign**; there is no shared helper in `trips.service.ts` that strips columns — Phase 2 would require either a **dedicated** mapper from `computeTripPrice` to DB write shape, or **destructuring** to omit `net_price` at each site.

---

## 9. Senior-level recommendation (direct)

9.1 **Safest migration sequence (sketch)**  
1) Freeze app releases with **invariant** `net_price = f(base_net_price, approach_fee_net)` already true (Phase 1 + backfill).  
2) **P4 + fetch fix in application** first: `fetchTripsForBuilder` + `TripForInvoice` + `TripPriceInput` carry **`base_net_price` (and optionally keep passing combined as read-only for display)**; **`resolveTripPrice`** P4 and any strategy that used combined `net_price` as **transport** must use **base** only.  
3) **Remove `net_price` from every** `insert`/`update` payload in app and scripts; adjust `computeTripPrice` to return only writable columns (or split types: `DbTripPriceWrite` vs `ComputedTripDisplay`).  
4) **DB migration:** add or replace `net_price` as **`GENERATED ALWAYS AS (expression) STORED`**, with exact expression and nullability reviewed against production data.  
5) **Regenerate** `database.types.ts` and fix TS errors.  
6) Re-run **integration tests** and a **staging** dry-run of backfill scripts (queries that filter on `net_price` may need review).

9.2 **Minimum application code change set**  
- Strip **`net_price`** from all `trips` insert/update objects (all sites in §1–2 + scripts in §4).  
- **P4 (and any strategy using `trip.net_price` as transport)** + **invoice line fetch** to use **`base_net_price`** from the row.  
- **`computeTripPrice` return value** no longer passed through to PostgREST as `net_price` (or return type refactored).  
- **Tests** updated to not expect writable `result.net_price` on the return object, or to compute combined locally.

9.3 **RLS, queries, real-time**  
- **RLS** policies reviewed here are not column-scoped; **low risk** unless custom policies in prod reference `net_price` in expressions (not found in repo).  
- **SELECT \*** and explicit selects **continue to work**; `net_price` remains readable.  
- **Realtime** should still emit row changes; generated column value updates when **sources** change — no special Supabase quirk identified in static analysis.

9.4 **`TripPriceInput`: add `base_net_price` vs repurpose `net_price`**  
- **Add `base_net_price` (or `trip_base_net` / clear name)** for the **stored transport** amount used in P3/P4, and pass it from `trips.base_net_price` in builder fetch **plus** any other `resolveTripPrice` call sites that today pass DB `net_price` as **`TripPriceInput.net_price`**. **Repurposing** the existing `net_price` field on the input to mean “base only” would confuse every caller that still means “the old combined column” and is a **higher** documentation/test burden. New field is clearer.

9.5 **If this were my codebase**  
Ship **resolver + fetch fix first** (P4 and strategies), with tests, **before** flipping the DB to generated. Then **one mechanical PR** to remove `net_price` from write payloads and shrink `TripPriceFields`. Then the **one migration** to generated. I would **not** make `net_price` generated until **no** code path passes `net_price` in a write — otherwise rollbacks and error noise dominate.

---

*End of audit.*
