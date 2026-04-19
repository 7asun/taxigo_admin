# Price Calculation Engine — Audit

> Read-only audit. No code was changed.  
> Date: 2026-04-17

---

## Q1 — Schema: `billing_pricing_rules`

### Exact column list

| Column | DB type (inferred) | TS type | Purpose |
|--------|--------------------|---------|---------|
| `id` | `uuid PK` | `string` | Primary key |
| `company_id` | `uuid NOT NULL` | `string` | Tenant FK → `companies` |
| `payer_id` | `uuid` | `string \| null` | Scope: Kostenträger level |
| `billing_type_id` | `uuid` | `string \| null` | Scope: Abrechnungsfamilie level |
| `billing_variant_id` | `uuid` | `string \| null` | Scope: Unterart level (most specific) |
| `strategy` | `text NOT NULL` | `string` | Enum (see below) — DB CHECK constraint |
| `config` | `jsonb NOT NULL DEFAULT '{}'` | `Json` | Strategy-specific parameters (Zod-validated on write) |
| `is_active` | `boolean NOT NULL DEFAULT true` | `boolean` | Soft-disable; only active rules are resolved |
| `created_at` | `timestamptz NOT NULL` | `string` | Insert time |
| `updated_at` | `timestamptz NOT NULL` | `string` | Last update time |

Source: `src/types/database.types.ts` lines 17–84; `supabase/migrations/20260405100000_billing_pricing_rules.sql`.

### `strategy` enum

Enforced by a DB `CHECK` constraint in the migration (line 12–19):

```sql
strategy text NOT NULL CHECK (strategy IN (
  'client_price_tag',
  'tiered_km',
  'fixed_below_threshold_then_km',
  'time_based',
  'manual_trip_price',
  'no_price'
))
```

TypeScript definition in `src/features/invoices/types/pricing.types.ts` lines 5–14:

```typescript
export const PRICING_STRATEGIES = [
  'client_price_tag',
  'tiered_km',
  'fixed_below_threshold_then_km',
  'time_based',
  'manual_trip_price',
  'no_price'
] as const;
export type PricingStrategy = (typeof PRICING_STRATEGIES)[number];
```

### Tier structure

Tiers are **not** a child table. They are stored in the `config` JSONB column as an array under the key `tiers`. One tier entry (from `src/features/invoices/types/pricing.types.ts` lines 32–36 and `pricing-rule-config.schema.ts` lines 15–21):

```typescript
interface KmTier {
  from_km: number;     // inclusive lower bound
  to_km: number | null; // exclusive upper bound; null = unlimited tail
  price_per_km: number;
}
```

Example `config` for `tiered_km`:

```json
{
  "tiers": [
    { "from_km": 0,  "to_km": 10,   "price_per_km": 1.00 },
    { "from_km": 10, "to_km": null,  "price_per_km": 0.50 }
  ],
  "approach_fee_net": 3.50
}
```

The `approach_fee_net` field is optional on every strategy config (Zod: `z.number().min(0).nullable().optional()`). It is a flat net Anfahrtspreis added on top of the base transport price.

### Scope exclusivity constraint

A single row is scoped to **exactly one** level — the DB enforces this:

```sql
CONSTRAINT billing_pricing_rules_exactly_one_scope CHECK (
  (CASE WHEN payer_id         IS NOT NULL THEN 1 ELSE 0 END)
+ (CASE WHEN billing_type_id  IS NOT NULL THEN 1 ELSE 0 END)
+ (CASE WHEN billing_variant_id IS NOT NULL THEN 1 ELSE 0 END) = 1
)
```

A rule cannot simultaneously cover two scope levels. The hierarchy is enforced purely by the resolver, not by FK nesting.

Additionally, partial unique indexes enforce one active rule per scope:

- `uq_pricing_rule_variant` — one active rule per `billing_variant_id`
- `uq_pricing_rule_billing_type` — one active rule per `billing_type_id` (with variant null)
- `uq_pricing_rule_payer` — one active rule per `payer_id` (with type and variant null)

### Existing calculation logic

**Yes — a full, unit-tested, pure pricing engine already exists.** It is wired exclusively into the invoice builder today, not into trip creation.

| File | Role |
|------|------|
| `src/features/invoices/lib/resolve-pricing-rule.ts` | Picks the winning rule or tag for a trip (pure, no I/O) |
| `src/features/invoices/lib/resolve-trip-price.ts` | Applies the cascade and returns `PriceResolution` (pure, no I/O) |
| `src/features/invoices/lib/pricing-rule-config.schema.ts` | Zod schemas for strategy/config union — validates at write time |
| `src/features/invoices/lib/price-calculator.ts` | Legacy adapter (`PriceResult`) wrapping the pure resolver |
| `src/features/invoices/lib/tax-calculator.ts` | `resolveTaxRate(distanceKm)` — 7% below 50 km, 19% at or above |
| `src/features/invoices/lib/__tests__/resolve-trip-price.test.ts` | Unit tests for the above |

---

## Q2 — Schema: `client_price_tags`

### Exact column list

| Column | DB type | TS type | Purpose |
|--------|---------|---------|---------|
| `id` | `uuid PK` | `string` | Primary key |
| `company_id` | `uuid NOT NULL` | `string` | Tenant FK → `companies` |
| `client_id` | `uuid NOT NULL` | `string` | FK → `clients` (always required) |
| `payer_id` | `uuid` | `string \| null` | Optional FK → `payers`; null = not payer-scoped |
| `billing_variant_id` | `uuid` | `string \| null` | Optional FK → `billing_variants`; null = not variant-scoped |
| `price_gross` | `numeric(10,2)` | `number` | Negotiated gross price (brutto inkl. MwSt) |
| `is_active` | `boolean` | `boolean` | Soft-disable |
| `created_at` | `timestamptz` | `string` | Insert time |
| `updated_at` | `timestamptz` | `string` | Last update time |

Source: `src/types/database.types.ts` lines 272–336; `supabase/migrations/20260412140000_client_price_tags.sql`; `docs/client-price-tags.md`.

**Note:** Supabase may return `numeric` columns as strings at runtime. The service already handles this: `toNumberGross()` in `src/features/payers/api/client-price-tags.service.ts` lines 19–23 coerces to `number` before the value is used.

### Client + payer relationship

Direct FKs:
- `client_id` → `clients.id` (NOT NULL — always client-scoped)
- `payer_id` → `payers.id` (nullable — optional Kostenträger scope)
- `billing_variant_id` → `billing_variants.id` (nullable — optional Unterart scope)

Uniqueness rules (from the migration): one active tag per `(client_id)` global, per `(client_id, payer_id)` payer-scoped, and per `(client_id, billing_variant_id)` variant-scoped. Enforced by partial unique indexes.

### Stored value

A flat gross euro amount (`price_gross: number`). Not a rule reference. There is no tiered or distance-based logic in `client_price_tags` — it is always a single fixed gross price.

### Code that reads from this table

| File | Where |
|------|-------|
| `src/features/invoices/lib/resolve-pricing-rule.ts` | STEP 0 — picks a matching tag and synthesises a `BillingPricingRuleLike` with `_price_gross` |
| `src/features/invoices/api/invoice-line-items.api.ts` | Line 107 — loads tags alongside trips for the invoice builder |
| `src/features/payers/api/client-price-tags.service.ts` | Full CRUD: list, insert, update, delete |
| `src/features/clients/api/clients-pricing.api.ts` | `setClientPriceTag` — global tag sync that also writes `clients.price_tag` for backwards compatibility |
| `src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx` | Admin UI manager |

There is also a **legacy column** `clients.price_tag` (`number | null`). The comment in `database.types.ts` line 197–198 explicitly says: _"Default price for all trips of this client. Takes precedence over trip.price."_ Both `clients.price_tag` and `client_price_tags` feed into P1 of the cascade. `setClientPriceTag` keeps both in sync for global (un-scoped) tags.

---

## Q3 — Schema: `trips` table (billing-relevant columns)

### `price` column

```typescript
// database.types.ts line 1216
price: number | null;         // Row
price?: number | null;        // Insert
price?: number | null;        // Update
```

TypeScript maps to `number`, meaning the Postgres column is `float8` (or `numeric` coerced). It is optional and nullable at insert. Currently **never written by any creation path** (see Q4).

**Semantic:** used as a NET fallback in the invoice builder at P3 (`trips.price` = net €). It is NOT a gross value.

### Billing-related columns present on `trips`

| Column | Type | Purpose |
|--------|------|---------|
| `payer_id` | `string \| null` | FK → `payers` |
| `billing_variant_id` | `string \| null` | FK → `billing_variants` (Unterart) |
| `client_id` | `string \| null` | FK → `clients`; null for anonymous trips |
| `billing_betreuer` | `string \| null` | Label field for invoice |
| `billing_calling_station` | `string \| null` | Label field for invoice |
| `kts_document_applies` | `boolean` (NOT NULL) | Forces €0 price (KTS hard override at P0) |
| `kts_source` | `string \| null` | Audit: how kts_document_applies was set |
| `no_invoice_required` | `boolean` (NOT NULL) | Flags lines as non-billable |
| `price` | `number \| null` | Net price fallback (P3) |
| `driving_distance_km` | `number \| null` | Input for km-tier strategies + tax rate |
| `payment_method` | `string \| null` | Selbstzahler / Kostenträger / etc. |
| `selbstzahler_collected_amount` | `number \| null` | Cash collected when self-pay |

**Critical: There is NO `billing_type_id` column on the `trips` table.** The Abrechnungsfamilie is resolved only through the join:
`billing_variant_id → billing_variants.billing_type_id`

Any price engine that calls `resolvePricingRule` (which needs `billingTypeId` for STEP 2) must join through `billing_variants` to obtain it.

### `driving_distance_km` type

`number | null` in TypeScript — confirmed as `float8` / numeric. Now reliably populated for new trips (after the driving metrics fix).

---

## Q4 — Existing `price` references

### Write references (INSERT / UPDATE to `price`)

| File | Line | What happens |
|------|------|-------------|
| `src/features/trips/lib/duplicate-trips.ts` | 254, 296 | `price: source.price` — copies the existing price from the source trip |

**That is the only write.** Duplication copies whatever `price` was on the original (likely `null` for all existing trips). There is no calculation.

### No writes in creation paths

| File | `price` reference | Finding |
|------|------------------|---------|
| `src/features/trips/components/create-trip/create-trip-form.tsx` | **None** | `price` is never set on manual creation |
| `src/features/trips/components/bulk-upload-dialog.tsx` | **None** | Bulk upload never sets `price` |
| `src/app/api/cron/generate-recurring-trips/route.ts` | **None** | Cron-materialised trips have no `price` |

### Read references (UI display)

| File | Line | What happens |
|------|------|-------------|
| `src/features/trips/components/csv-export/csv-export-constants.ts` | 101 | `{ key: 'price', label: 'Preis', category: 'billing' }` — column available in the CSV export picker |

The column is selectable in CSV export but will always produce an empty/null value for every row today.

### TypeScript type

```typescript
// InsertTrip (database.types.ts line 1281)
price?: number | null;   // optional, nullable — never required
```

---

## Q5 — Waterfall resolution: gaps and edge cases

### Can a trip have `billing_variant_id` but no `billing_type_id`?

Yes — and this is the normal situation. The `trips` table has **no `billing_type_id` column**. When `resolvePricingRule` is called and STEP 2 needs `billingTypeId`, the caller must supply it by joining: `billing_variant_id → billing_variants.billing_type_id`.

For trips where `billing_variant_id` is null, `billingTypeId` will also be null (no variant → no type), and STEP 2 is skipped. STEP 3 still runs for the payer-level fallback if `payer_id` is set.

### Can a trip have `billing_type_id` (as parameter to resolver) but no `payer_id`?

Yes — if `billing_variant_id` is set and the variant's type has a rule, STEP 2 will resolve. `payer_id` being null on the trip only means STEP 3 (payer-wide fallback) finds nothing. The cascade is non-blocking: a null result at one step simply falls through to the next.

### Can `client_id` be null on a trip?

Yes — `client_id: string | null` (trips Row line 1175). Anonymous trips have no client. In `resolvePricingRule` (line 38): `if (clientId && clientPriceTags?.length)` — STEP 0 is correctly skipped when `clientId` is null or undefined. Level 4 (client_price_tags) cannot apply to anonymous trips.

### Trips with null `driving_distance_km` but still priceable

Yes — strategies that do NOT need `driving_distance_km`:

| Strategy | Distance required? |
|----------|--------------------|
| `client_price_tag` | No |
| `time_based` | No (uses `scheduled_at` only) |
| `manual_trip_price` | No (reads `trips.price` as-is) |
| `no_price` | No (returns null intentionally) |
| `tiered_km` | **Yes** — returns null when distance is null |
| `fixed_below_threshold_then_km` | **Yes** — returns null when distance is null |

For backfill scope: trips without distance can still be priced if their rule uses `client_price_tag`, `time_based`, or `manual_trip_price`. Only `tiered_km` and `fixed_below_threshold_then_km` strategies would skip them and leave `price` null.

---

## Q6 — Calculation complexity

### Tiered rules: cumulative, not bracket

`tieredNetTotal` in `src/features/invoices/lib/resolve-trip-price.ts` lines 167–187 is **cumulative** (analogous to income tax brackets, not a flat-rate lookup). It walks from km=0 to the trip's full distance and accumulates `km × price_per_km` per segment:

```typescript
// For a 15 km trip with tiers [{0–10, €1.00/km}, {10–∞, €0.50/km}]:
// 10 × 1.00 + 5 × 0.50 = 11.00   (NOT 15 × 1.00 = 15.00)
// One round at end: roundMoneyOnce(11.00) = 11.00
```

The `tieredNetTotal` test in `resolve-trip-price.test.ts` (line 24–33) confirms: _"sums segments then rounds once"_.

### Surcharges and modifiers

**`approach_fee_net` (Anfahrtspreis):** a flat net add-on stored in `billing_pricing_rules.config.approach_fee_net`. Optional on every strategy. Present on the resolution as `PriceResolution.approach_fee_net`. NOT included in `PriceResolution.net` — the net field is base transport only. The invoice line total is `(unit_price × quantity) + (approach_fee_net ?? 0)`.

**`time_based`:** configurable working-hours windows per weekday (HH:mm–HH:mm) plus a holiday list. The trip's `scheduled_at` is converted to Europe/Berlin local time. Outside the configured window = `fixed_fee` net; inside = €0 net.

**No night surcharge, passenger count multiplier, or weekend rate fields exist** anywhere in the current schema beyond what `time_based` provides through its `working_hours` configuration.

### VAT — net vs gross

`trips.price` is stored as **net** (P3 fallback). `client_price_tags.price_gross` is stored as **gross** (P1). `clients.price_tag` is **gross** (P1 legacy).

Tax rate is resolved by `src/features/invoices/lib/tax-calculator.ts`:

```typescript
// Legal basis: §12 Abs. 2 Nr. 10 UStG
// < 50 km  → 7%  (Ermäßigter Steuersatz)
// ≥ 50 km  → 19% (Regelsteuersatz)
// null km  → 7%  with confidence: 'fallback'
export const DISTANCE_THRESHOLD_KM = 50;
```

If `driving_distance_km` is null at price-calculation time, `resolveTaxRate` returns 7% with `confidence: 'fallback'`. This means trips created before geocoding completes (or trips where distance could not be determined) will have their price computed assuming the reduced rate. For the invoice builder this is re-resolved fresh each time with the actual distance. If we write `trips.price` at creation time, the stored value may reflect the wrong tax rate — but since `trips.price` is NET only, and the invoice builder applies its own `resolveTaxRate` to derive gross, this inconsistency does not directly corrupt invoice totals. It is still a semantic risk (see Q7.4).

---

## Q7 — Own findings

### 7.1 The pricing engine already exists and is complete — it is just not called at trip creation

`resolvePricingRule` + `resolveTripPrice` are pure TypeScript functions with no I/O. They already implement the full four-level waterfall. They are unit-tested. They are Zod-validated on the write path. Nothing needs to be designed from scratch — only a thin calling layer is missing that:

1. Loads the required data (payer rules, client tags, billing_variant → billing_type join)
2. Calls the pure functions
3. Writes the resulting `net` value to `trips.price`

### 7.2 `billing_type_id` is not on the `trips` table — every creation path must join to get it

The resolver STEP 2 needs `billingTypeId`. The trips table has only `billing_variant_id`. To call `resolvePricingRule` correctly, the implementation must either:

- Join `billing_variants` at trip-creation time (select `id, billing_type_id` where `id = trip.billing_variant_id`)
- Or pass `billingTypeId: null` and accept that type-level rules are never applied

Passing `null` would silently skip any `billing_type`-scoped rule even when one exists, which is a correctness bug. The join must be done.

### 7.3 `resolvePricingRule` requires pre-loaded rules — an extra query per creation

The function signature is `resolvePricingRule({ rules: BillingPricingRuleLike[], payerId, billingTypeId, billingVariantId, clientId, clientPriceTags })`. The `rules` array must already be loaded by the caller. For a creation-time engine, this means one additional Supabase query to `billing_pricing_rules` (filtered by `company_id`). Similarly, if `client_id` is set, active `client_price_tags` for that client must also be fetched.

### 7.4 Semantic ambiguity: `trips.price` is both input and output

In the current invoice builder, `trips.price` at P3 is a **net fallback** used when no catalog rule resolves to a price. If we write the resolved net to `trips.price` at creation time, then on a trip where `billing_pricing_rules` resolves to (say) €23.50 net via `tiered_km`:

- P2 fires first in the invoice builder → `trips.price` is ignored → correct
- If the rule is later deleted, P3 kicks in and `trips.price = 23.50` is used as fallback → arguably correct (price was calculated from that rule at creation time)
- If the rule is changed after the trip was created, `trips.price` still reflects the old rate → could be stale

This is the intended design (write once, use as fallback). It is not a bug, but callers should understand that `trips.price` is a snapshot of the calculated price at creation time, not a live-calculated value.

### 7.5 No `billing_type_id` on trips is an architectural gap for the resolver

Because `billing_type_id` is not stored directly on the trip, every call to `resolvePricingRule` that needs STEP 2 requires a join or an in-memory lookup of the variant's type. In the invoice builder this is handled by joining `billing_variants` in the trip SELECT. In a creation-time or backfill engine this is a mandatory extra data load. If the variant is changed after trip creation (unlikely, but possible), the historical `billing_type_id` used at creation time is lost.

### 7.6 Legacy `clients.price_tag` and `client_price_tags` are two separate code paths for P1

The `resolveTripPrice` function at P1 checks **two sources** in order:
1. `rule._price_gross` — synthetic rule built by STEP 0 from `client_price_tags` (via `resolvePricingRule`)
2. `trip.client.price_tag` — legacy `clients.price_tag` column (gross)

The creation-time engine must supply `trip.client` (joined from `clients`) to enable the legacy path. If the trip is anonymous (`client_id: null`), `trip.client` should be `null` or `undefined` — both paths will be skipped correctly.

### 7.7 `time_based` rule requires `scheduled_at` — which may be null on some trips

`resolveTripPrice`'s `time_based` branch returns `null` when `trip.scheduled_at` is null (line 327: `if (!sched) return null`). Looking at the trips Insert type: `scheduled_at?: string | null`. Trips where `scheduled_at` is null will skip `time_based` rules and fall through to P3 or P4.

### 7.8 `no_price` strategy intentionally leaves price null — backfill must handle this

For payers where the active rule is `no_price`, the resolver returns null. The backfill engine should NOT overwrite any existing non-null `trips.price` for these trips, and should leave `price = null` for new ones. There is no bug here, but the backfill script must not assume that a null result is an error.

### 7.9 `price_gross` in `client_price_tags` may be returned as a string by Supabase

`numeric(10,2)` in Postgres is sometimes returned as a string by the Supabase JS client. The existing `toNumberGross()` in `client-price-tags.service.ts` already guards against this. Any new code loading `client_price_tags` rows must apply the same coercion before passing them to the resolver.

### 7.10 The `strategy: 'client_price_tag'` on a `billing_pricing_rules` row is a catalog-level fallback, not a tag fetch

When a `billing_pricing_rules` row has `strategy = 'client_price_tag'` and STEP 0 found no matching tag, `executeStrategy` in `resolve-trip-price.ts` (lines 243–258) reads `trip.price` as net and returns it. This is the `trip_price_fallback` path — it does NOT look up `client_price_tags` again. The naming is confusing but documented in `docs/preisregeln.md` line 22.

### 7.11 No VAT-related column on `trips` or `billing_pricing_rules`

There is no `tax_rate` column on `trips`, `billing_pricing_rules`, or `billing_variants`. The tax rate is always derived at query time from `resolveTaxRate(driving_distance_km)`. The price stored in `trips.price` is always NET. The gross equivalent is only ever materialised at invoice creation time (in `invoice_line_items.total_price`).

### 7.12 CSV export exposes `price` — today it will always be null for every row

`csv-export-constants.ts` line 101 includes `{ key: 'price', label: 'Preis', category: 'billing' }`. Every exported cell is null today. After the engine is built and backfill is run, this column will start being populated — a low-effort UX win.

### 7.13 Cron-generated trips and recurring rules have no price hooks

`src/app/api/cron/generate-recurring-trips/route.ts` — no mention of `price`. Recurring trips are materialised without a price. Any creation-time pricing engine must also cover the cron path, or prices for materialised recurring trips will remain null until a backfill runs.

### 7.14 The engine lives in `src/features/invoices/` but is needed for trip creation

`resolve-trip-price.ts`, `resolve-pricing-rule.ts`, `tax-calculator.ts`, and the Zod schemas are all under `src/features/invoices/`. If price calculation at creation time is the goal, these pure functions can be imported from anywhere — the location is not a blocker. However, the `tax-calculator.ts` is the canonical and only allowed source of tax rates (its own comment: "ALL MwSt logic lives here and ONLY here").

---

## Summary table

| Area | Finding |
|------|---------|
| Pricing engine completeness | Fully implemented and tested — lives in `src/features/invoices/lib/` |
| Trip creation writes to `price` | **None** today (create form, bulk upload, cron, duplication all skip it) |
| `trips` missing `billing_type_id` | Must join `billing_variants` at call time to get `billingTypeId` for STEP 2 |
| `client_price_tags.price_gross` type | Numeric — may be string at runtime; coercion already in service layer |
| VAT | 7% below 50 km, 19% at/above; null distance → 7% fallback; `price` is always NET |
| Tier math | Cumulative (bracket-style), one round at end per trip line |
| Additional surcharges | `approach_fee_net` on any rule config; no night/weekend/passenger multipliers |
| Anonymous trips (client_id null) | Level 4 (client_price_tags) correctly skipped; no fix needed |
| Distance-null trips | Fixed-rate + time_based + client_price_tag strategies still work; km strategies skip |
| Backfill scope | All trips; skip where strategy returns null (e.g. `no_price` or km-strategy with null distance) |
| Cron recurring trips | Currently no price hook — must be added |
