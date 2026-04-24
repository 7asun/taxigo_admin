# Phase 5 Pre-Implementation — Architecture State Check

**Date:** 2026-04-24  
**Scope:** Read-only audit of pricing/bulk-upload paths. No code changes.

---

## Q1 — Database schema: `trips` table price columns

Source: `src/types/database.types.ts` (`trips.Row`, `trips.Insert`, `trips.Update`).

### All price-related columns on `trips.Row`

| Column | Type (Row) | Nullability (Row) | Notes |
|--------|------------|-------------------|--------|
| `net_price` | `number` | non-null in Row type | JSDoc: **Generated STORED** — `COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0)`. Read-only in app terms; omit from writes. |
| `gross_price` | `number \| null` | nullable | Standalone column. |
| `tax_rate` | `number \| null` | nullable | Standalone column. |
| `base_net_price` | `number \| null` | nullable | Writable transport net. |
| `approach_fee_net` | `number \| null` | nullable | Writable Anfahrt net. |
| `manual_gross_price` | `number \| null` | nullable | Taxameter / admin gross (pricing input). |

Additional monetary columns on the same row (not the core “trip price snapshot” trio but price-related): `fremdfirma_cost`, `selbstzahler_collected_amount` (both `number | null`).

### Specific confirmations

**a) `net_price`:** Still present on **`Row`**. It is **not** listed on **`Insert`** (or **`Update`** in the generated types) — consistent with a **generated/computed** column, not client-writable. Comments in code describe it as DB-generated from `base_net_price` + `approach_fee_net`.

**b) `base_net_price` and `approach_fee_net`:** Both exist. **`number | null`** on Row; optional on Insert/Update (`number | null`).

**c) `gross_price`:** Yes — **`number | null`**, standalone column on Row and optional on Insert/Update.

**d) `tax_rate`:** Yes — **`number | null`**, standalone column on Row and optional on Insert/Update.

**e) Other new/changed price-related fields vs an “original” schema:** This audit only reflects the current types file. Beyond the split net columns, **`manual_gross_price`** is part of the current pricing model; **`net_price`** as a generated sum is the architectural shift called out in comments elsewhere.

---

## Q2 — `computeTripPrice` return type

Sources: `src/features/trips/lib/trip-price-engine.ts`, `src/features/invoices/types/pricing.types.ts` (only for cross-reference; return type is defined in the engine file).

### a) Exact return type (verbatim)

```ts
export interface TripPriceFields {
  gross_price: number | null;
  tax_rate: number | null;
  base_net_price: number | null;
  approach_fee_net: number | null;
}
```

Function signature:

```ts
export function computeTripPrice(
  trip: ComputeTripPriceInput,
  context: PricingContext
): TripPriceFields {
```

### b) Fields returned; `net_price` vs split nets

`computeTripPrice` returns **`gross_price`**, **`tax_rate`**, **`base_net_price`**, and **`approach_fee_net`** — **not** a single `net_price` for persistence. Combined net is intended to come from the DB generated column when reading rows.

Implementation detail: it sets `baseNetPrice = resolution.net` and `approachFeeNet = resolution.approach_fee_net ?? 0`, then computes `totalGross` from `(baseNetPrice + approachFeeNet) * (1 + taxRate)` (rounded to cents).

### c) Adapter between engine output and DB write

No separate adapter module. Callers **`{ ...trip, ...computeTripPrice(...) }`** (object spread). The spread fields align with `trips.Insert` (`gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net`). **`net_price` is not part of `TripPriceFields`** and is absent from Insert typings.

---

## Q3 — `resolve-trip-price.ts`: `approach_fee_net` handling

Source: `src/features/invoices/lib/resolve-trip-price.ts`.

### a) Where and how it is calculated

- **`extractApproachFeeNet(rule)`** — parses the active rule’s config via `parseConfigForStrategy`, reads **`approach_fee_net`** from **`ApproachFeeConfig`**, validates (non-negative number), applies **`roundMoneyOnce`**.
- **`withApproachFeeFromRule(base, rule)`** — if a fee exists, returns `{ ...base, approach_fee_net: fee }`.
- **P0 (`manual_gross_price`):** returns an explicit **`approach_fee_net: 0`** (taxameter all-in; no rule approach).
- **P1 (KTS):** no approach field on the returned object (undefined).
- **P2 (client price tag / legacy tag):** no approach — all-in gross path.
- **P3+ (catalog strategies):** **`executeStrategy`** result is wrapped with **`withApproachFeeFromRule(..., rule)`** when a fee is configured.
- **P4/P5 fallbacks:** same **`withApproachFeeFromRule`** pattern where applicable.

### b) Separate field vs folded into `net_price`

**Separate optional field** on **`PriceResolution`**: `approach_fee_net?: number | null`. Documentation in `pricing.types.ts` states it is **not** included in **`net`** or **`gross`** on the resolution; **`net`** is base transport net only.

### c) `ResolutionResult` / distinct `base_net_price` on resolution type

The resolver’s output type is **`PriceResolution`**. It has **`net`** (base transport net) and optional **`approach_fee_net`**. It does **not** expose a field named **`base_net_price`** — the trip input type uses **`base_net_price`** for P3/P4; the resolution uses **`net`** for that role.

---

## Q4 — `bulk-upload-dialog.tsx`: current price write path

Source: `src/features/trips/components/bulk-upload-dialog.tsx`.

### a) Fields written at upload time

There is **no single static object literal** passed to Supabase in one place. The pipeline is:

1. **Draft row (`InsertTrip`)** built in the CSV loop (excerpt below).
2. After geocoding/metrics and pricing context load, each outbound row becomes **`{ ...trip, ...computeTripPrice({ ... }, ctx) }`** (`pricedOutboundTrips`).
3. **`tripsService.bulkCreateTrips(pricedOutboundTrips)`** performs the insert (and the same pattern for return legs with **`pricedPayload`**).

**Initial trip object literal (before `computeTripPrice` spread)** — verbatim from the file:

```ts
{
  payer_id: payer.id,
  billing_variant_id: billingVariantId,
  client_id: resolvedClientId,
  client_name: matchedClient
    ? `${matchedClient.first_name || ''} ${
        matchedClient.last_name || ''
      }`.trim() || null
    : fullNameFromCsv,
  client_phone: parsedRow.phone || null,
  scheduled_at: scheduled_at
    ? scheduled_at.toISOString()
    : null,
  requested_date: requested_date,
  pickup_address,
  pickup_street:
    pickupStreetParts.street || parsedRow.pickup_street || null,
  pickup_street_number: pickupStreetParts.streetNumber,
  pickup_zip_code: parsedRow.pickup_zip || null,
  pickup_city: parsedRow.pickup_city || null,
  pickup_lat: null,
  pickup_lng: null,
  pickup_station: parsedRow.pickup_station || null,
  dropoff_address,
  dropoff_street:
    dropoffStreetParts.street ||
    parsedRow.dropoff_street ||
    null,
  dropoff_street_number: dropoffStreetParts.streetNumber,
  dropoff_zip_code: parsedRow.dropoff_zip || null,
  dropoff_city: parsedRow.dropoff_city || null,
  dropoff_lat: null,
  dropoff_lng: null,
  dropoff_station: parsedRow.dropoff_station || null,
  is_wheelchair:
    (parsedRow.is_wheelchair || '').toUpperCase() === 'TRUE',
  notes: parsedRow.notes || null,
  greeting_style: parsedRow.greeting_style || null,
  billing_calling_station: parsedRow.anrufstation?.trim()
    ? parsedRow.anrufstation.trim()
    : null,
  billing_betreuer: parsedRow.betreuer?.trim()
    ? parsedRow.betreuer.trim()
    : null,
  status,
  company_id: companyId,
  created_by: user?.id || null,
  group_id: finalGroupId,
  stop_order: finalStopOrder,
  stop_updates: [],
  has_missing_geodata: true,
  driver_id: driverId,
  needs_driver_assignment: needsDriverAssignment,
  ingestion_source: 'csv_bulk_upload',
  kts_document_applies: ktsDocumentApplies,
  kts_source: ktsSource,
  billing_type_id: matchedType?.id || null,
  gross_price: null,
  tax_rate: null
}
```

**Pricing overlay (verbatim spread):**

```ts
return {
  ...trip,
  ...computeTripPrice(
    {
      payer_id: trip.payer_id ?? null,
      billing_type_id: trip.billing_type_id ?? null,
      billing_variant_id: trip.billing_variant_id ?? null,
      client_id: trip.client_id ?? null,
      driving_distance_km: trip.driving_distance_km ?? null,
      scheduled_at: trip.scheduled_at ?? null,
      kts_document_applies: trip.kts_document_applies ?? false,
      net_price: null,
      base_net_price: null,
      manual_gross_price: null
    },
    ctx
  )
};
```

So at insert time the row includes whatever **`computeTripPrice`** adds: **`gross_price`**, **`tax_rate`**, **`base_net_price`**, **`approach_fee_net`**. It does **not** set **`net_price`** (generated in DB).

### b) Current `billing_type_id` derivation (verbatim)

```ts
billing_type_id: matchedType?.id || null,
```

`matchedType` comes from **`billingTypeTree`** filtered by payer, matched by CSV **`abrechnungsart`** text to **`BillingTypeTreeRow.name`** (case-insensitive), with single-type defaulting when the cell is empty. If **`matchedType`** is null (missing/unknown type), **`billing_type_id`** becomes **`null`** even when **`billing_variant_id`** might still be set in edge paths — Phase 5 aims to fix derivation using the resolved variant.

### c) In-memory data at CSV parse time

- **`billingTypeTree`** — loaded in **`useEffect`** from Supabase (`billing_types` with nested `billing_variants`).
- **`payers`** — from **`useTripFormData(null)`**.
- During the **`for`** loop over CSV rows, **`billingTypeTree`** is read from React state; on the **first** parse after open, it may still be **`[]`** until the effect completes (race: types/variants not yet loaded while user uploads quickly).

### d) Billing variants list: name and shape

State:

```ts
const [billingTypeTree, setBillingTypeTree] = React.useState<
  BillingTypeTreeRow[]
>([]);
```

Type definition in the same file:

```ts
type BillingTypeTreeRow = {
  id: string;
  name: string;
  payer_id: string;
  behavior_profile: unknown;
  billing_variants: {
    id: string;
    name: string;
    code: string;
    sort_order: number;
    kts_default: boolean | null;
  }[];
};
```

**Note:** The Supabase **select string** includes **`billing_type_id`** on nested **`billing_variants`**, but the **TypeScript** nested shape above does **not** declare **`billing_type_id`**. At runtime the field may still be present on objects; Phase 5 should align types with the query for safety.

---

## Q5 — Other creation paths (reference parity)

`src/features/trips/components/create-trip-form.tsx` re-exports **`./create-trip/create-trip-form`** — billing derivation lives in **`create-trip/create-trip-form.tsx`**.

### a) `create-trip-form.tsx` — `billing_type_id` derivation

**`baseTrip` and all `computeTripPrice` inputs** use:

```ts
billing_type_id: ktsVariantRow?.billing_type_id || null,
```

(`ktsVariantRow` is the selected billing variant row from form/catalog data — not a text match on type name.)

Line references in-repo: **`billing_type_id: ktsVariantRow?.billing_type_id || null`** appears in **`baseTrip`** (~1294) and inside each **`computeTripPrice`** call (~1352, ~1416, and further paths in the same file per grep).

### b) `generate-recurring-trips/route.ts` — `billing_type_id` derivation

**`buildTripPayload`** is called with:

```ts
billing_type_id: rule.billing_variants?.billing_type_id || null
```

(lines ~511 and ~579 in the audited file).

**`computeTripPrice`** uses:

```ts
billing_type_id: outboundPayload.billing_type_id ?? null,
```

and the same for return (~521, ~589).

### c) Do they write `base_net_price` and `approach_fee_net` separately?

They do **not** set those columns manually. They **`...computeTripPrice(...)`** into the insert payload, which supplies **`base_net_price`** and **`approach_fee_net`** (and **`gross_price`**, **`tax_rate`**) the same way as bulk upload.

---

## Q6 — Senior recommendation

### a) Is bulk upload still writing the old `net_price` column?

**No.** The bulk path spreads **`computeTripPrice`** output only; **`net_price` is not in `TripPriceFields`** and is not on **`Insert`**. Combined net is **generated in Postgres** from **`base_net_price`** + **`approach_fee_net`**.

### b) Minimal field set for Phase 5 parity

To match create form and cron:

- Keep **`...computeTripPrice(...)`** (already provides **`gross_price`**, **`tax_rate`**, **`base_net_price`**, **`approach_fee_net`**).
- Fix **`billing_type_id`** so it is **derived from the same source of truth as the variant** (e.g. `billing_type_id` on the matched variant row from **`billing_variants`**, or `matchedType.id` only when it is the parent of that variant), **instead of** relying solely on **`matchedType?.id`** from a **name-based** type match that can fail independently of **`billing_variant_id`**.

### c) Risks / surprises before implementation planning

1. **`billingTypeTree` load race:** CSV processing can run before **`useEffect`** fills **`billingTypeTree`**, yielding empty type lists and wrong/missing matches.
2. **Type/query drift:** Query selects **`billing_variants.billing_type_id`** but **`BillingTypeTreeRow`** typings omit it — easy to assume the data is unavailable in TS when it is present at runtime.
3. **`billing_type_id` vs `billing_variant_id` mismatch:** Today **`billing_type_id`** is tied to **`matchedType`** from CSV **Abrechnungsart** text; **`billing_variant_id`** can be resolved from variant cell or defaults. If the type name does not match but the variant does, **`billing_type_id`** can be **`null`** while **`billing_variant_id`** is set — undermining **`resolvePricingRule`** STEP 2 and any UI/reporting that expects both.
4. **`gross_price` / `tax_rate` contract:** **`computeTripPrice`** sets **`gross_price`** to the **total** gross including approach fee; **`tax_rate`** applies to that combined grossing-up. This matches the comment that approach is excluded from **`PriceResolution.gross`** but included in the **trip snapshot** total.

---

*End of pre-audit.*

---

## Phase 5 — Applied (2026-04-24)

Bulk CSV upload now aligns with the manual create form and recurring-trips cron: **`billing_type_id` on each inserted row is taken from the nested **`billing_variants.billing_type_id`** of the already-resolved **`billing_variant_id`** whenever a variant is present, with **`matchedType?.id`** retained only as a fallback for variant-less rows. The **`BillingTypeTreeRow`** TypeScript shape now includes that FK so it matches the Supabase nested select. Upload is blocked with a German toast if **`billingTypeTree`** is still empty, avoiding the silent “all null **`billing_type_id`**” outcome when the user starts a parse before the **`useEffect`** load finishes.

---

*End of document.*
