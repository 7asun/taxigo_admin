# Price engine — trip & distance data audit (read-only)

**Read-only audit.** No application code changes.

**Scope:** How distance flows into **trip snapshot pricing** (`computeTripPrice`) vs **invoice line building** (`buildLineItemsFromTrips`), plus live rows for ARZO payers and four named clients, `client_km_overrides`, and ARZO rule history.

**Database:** Supabase project `etwluibddvljuhkxjkxs` (MCP `execute_sql`).

---

## A. Source code (files read in full)

### A.1 `src/features/trips/lib/trip-price-engine.ts` — distance & overrides

**`computeTripPrice` does not implement `manual_distance_km` or `client_km_overrides`.**

- Input shape `ComputeTripPriceInput` only exposes `driving_distance_km` (no `manual_distance_km` field):

```193:206:src/features/trips/lib/trip-price-engine.ts
export interface ComputeTripPriceInput {
  payer_id: string | null;
  billing_type_id: string | null;
  billing_variant_id: string | null;
  client_id: string | null;
  driving_distance_km: number | null;
  scheduled_at: string | null;
  kts_document_applies: boolean;
  net_price: number | null;
  /** Read from `trips.base_net_price` when replaying; null on new/edit recalc (see `resolveTripForPricing`). */
  base_net_price: number | null;
  /** Persisted taxameter gross on the trip — passed through to resolveTripPrice P0. */
  manual_gross_price: number | null;
}
```

- **VAT rate** and **pricing** both use that single `driving_distance_km` value:

```229:237:src/features/trips/lib/trip-price-engine.ts
  const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);

  const tripInput = {
    kts_document_applies: trip.kts_document_applies,
    net_price: trip.net_price,
    base_net_price: trip.base_net_price,
    manual_gross_price: trip.manual_gross_price ?? null,
    driving_distance_km: trip.driving_distance_km,
```

- **`loadPricingContext`** loads `billing_pricing_rules`, `client_price_tags`, and `clients.price_tag` only — **no** `client_km_overrides` query:

```97:166:src/features/trips/lib/trip-price-engine.ts
export async function loadPricingContext({
  supabase,
  companyId,
  payerId,
  clientId
}: LoadPricingContextParams): Promise<PricingContext> {
  // ...
    clientId
      ? Promise.all([
          supabase
            .from('client_price_tags')
            .select('*')
            .eq('client_id', clientId)
            .eq('is_active', true),
          supabase
            .from('clients')
            .select('price_tag')
            .eq('id', clientId)
            .maybeSingle()
        ])
      : null
```

- **`resolveTripForPricing`** selects `driving_distance_km` from the DB row but **does not** select or merge `manual_distance_km`:

```347:372:src/features/trips/lib/trip-price-engine.ts
  const { data: current, error } = await supabase
    .from('trips')
    .select(
      'company_id, payer_id, billing_type_id, billing_variant_id, client_id, driving_distance_km, scheduled_at, kts_document_applies, net_price, base_net_price, manual_gross_price'
    )
    // ...
    driving_distance_km:
      patch.driving_distance_km ?? current.driving_distance_km ?? null,
```

- **`shouldRecalculatePrice`** lists `driving_distance_km` as pricing-relevant but **not** `manual_distance_km` — so editing manual km alone does **not** trigger `computeTripPrice` on trip update via this helper:

```292:307:src/features/trips/lib/trip-price-engine.ts
const PRICING_RELEVANT_FIELDS = [
  // ...
  // Distance / route
  'driving_distance_km',
  'pickup_lat',
  // ...
] as const;
```

**Conclusion (trip row snapshots):** persisted `gross_price` / `base_net_price` / `tax_rate` on `trips` reflect **`driving_distance_km` (and rules/tags)** as wired today, **not** `resolveEffectiveDistanceKm`.

---

### A.2 `src/features/invoices/lib/resolve-effective-distance.ts`

Priority for **invoice** distance (and VAT on that line):

1. `trips.manual_distance_km` (if positive finite)
2. Else winning **`client_km_overrides`** row for that client (scoped like price tags)
3. Else `trips.driving_distance_km`

```72:120:src/features/invoices/lib/resolve-effective-distance.ts
 * Priority (most specific wins):
 *   1. trips.manual_distance_km — admin override written back from Step 3 on a
 *      previous invoice creation. Takes priority because the admin has explicitly
 *      confirmed this distance.
 *   2. client_km_overrides — variant + payer scope, then payer-wide, then global;
 *      see pickClientKmOverrideRow.
 *   3. trips.driving_distance_km — the routing provider value (Google Directions).
 *      Always the fallback; never modified by this feature.
```

`client_km_overrides` is **not** nested on the trip row; it is loaded in batch beside trips and passed into `resolveEffectiveDistanceKm` as `clientKmOverrides: ClientKmOverrideLike[]`.

---

### A.3 `src/features/invoices/api/invoice-line-items.api.ts` (lines 457–492)

**The distance passed into `resolveTripPricePure` is `effectiveDistanceKm`**, not raw `driving_distance_km`:

```457:492:src/features/invoices/api/invoice-line-items.api.ts
    const effectiveDistanceKm = resolveEffectiveDistanceKm({
      manualDistanceKm: trip.manual_distance_km ?? null,
      drivingDistanceKm: trip.driving_distance_km ?? null,
      clientId: trip.client?.id ?? null,
      payerId: trip.payer_id ?? null,
      billingVariantId: trip.billing_variant_id ?? null,
      clientKmOverrides
    });

    const { rate: taxRate } = resolveTaxRate(effectiveDistanceKm);
    // ...
    const priceResolution = resolveTripPricePure(
      {
        kts_document_applies: trip.kts_document_applies === true,
        net_price: trip.net_price ?? null,
        base_net_price: trip.base_net_price ?? null,
        manual_gross_price: trip.manual_gross_price ?? null,
        driving_distance_km: effectiveDistanceKm,
        scheduled_at: trip.scheduled_at,
        client: trip.client
      },
      taxRate,
      rule
    );
```

So **invoice repricing** can diverge from **trip snapshot** whenever `manual_distance_km` or a **client km override** differs from `driving_distance_km`.

---

### A.4 Type definitions — `manual_distance_km` and overrides

**Invoice fetch shape** — `TripForInvoice` (`client` nested; overrides are **not** on this type — passed separately):

```245:303:src/features/invoices/types/invoice.types.ts
export interface TripForInvoice {
  id: string;
  payer_id: string;
  // ...
  /** Transport net only — P3/P4 in resolveTripPrice. */
  base_net_price: number | null;
  approach_fee_net: number | null;
  /** Taxameter gross on trip — resolveTripPrice P0 when set. */
  manual_gross_price: number | null;
  /** Admin KM override on trip; Phase 2 writeback. NULL = use routing / client catalog. */
  manual_distance_km: number | null;
  driving_distance_km: number | null; // for tax rate calculation
  billing_variant_id: string | null;
  // ...
  client?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    price_tag: number | null;
    reference_fields?: ClientReferenceField[] | null;
  } | null;
```

**DB row** — `trips` includes `manual_distance_km` at top level:

```1371:1378:src/types/database.types.ts
          /** Generated STORED: COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0). Read-only; omit from writes. */
          net_price: number;
          gross_price: number | null;
          tax_rate: number | null;
          base_net_price: number | null;
          approach_fee_net: number | null;
          manual_distance_km: number | null;
```

**Override row shape** for resolver — `ClientKmOverrideLike`:

```6:13:src/features/invoices/lib/resolve-effective-distance.ts
export interface ClientKmOverrideLike {
  client_id: string;
  payer_id: string | null;
  /** When set, row applies only to this Unterart; mirrors client_price_tags scope. */
  billing_variant_id?: string | null;
  distance_km: number | string;
  is_active: boolean;
}
```

---

## B. SQL — Query 1 (as requested) and database response

### B.1 Verbatim execution of user Query 1

```sql
SELECT
  t.id,
  t.scheduled_at,
  t.driving_distance_km,
  t.manual_distance_km,
  t.gross_price,
  t.base_net_price,
  t.approach_fee_net,
  t.tax_rate,
  t.manual_gross_price,
  t.net_price,
  t.payer_id,
  c.name AS client_name
FROM trips t
LEFT JOIN clients c ON c.id = t.client_id
WHERE t.payer_id = '6e52a5d5-ffd4-4a75-a34d-60b054f83030'
  AND c.name ILIKE ANY (ARRAY['%Büntjen%', '%Meyer%', '%Bienert%', '%van den Berg%'])
ORDER BY t.scheduled_at DESC
LIMIT 30;
```

**MCP `execute_sql` result (verbatim error):**

```text
Failed to run sql query: ERROR:  42703: column c.name does not exist
LINE 13:   c.name AS client_name
           ^
HINT:  Perhaps you meant to reference the column "t.note".
```

**Reason:** `public.clients` has `first_name`, `last_name`, `company_name` — no `name` column (see `database.types.ts`).

### B.2 Adapted Query 1 — same intent, name from `clients` fields

Replaced `c.name` with `trim(concat_ws(' ', c.first_name, c.last_name, c.company_name)) AS client_name`.

**MCP `execute_sql` raw JSON (verbatim):**

```text
[{"id":"154b954d-b440-4704-ad46-627fe54ea808","scheduled_at":"2026-05-05 11:45:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"12.63","base_net_price":"8.0000","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"11.8000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"20ab4513-752c-4d34-a30e-c64bdf586855","scheduled_at":"2026-05-05 05:00:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"8.7700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"9fcad5e9-16e4-4fde-8e48-07e63969b1b4","scheduled_at":"2026-05-04 14:30:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"12.63","base_net_price":"8.0000","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"11.8000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"93bc4ae1-ea38-4ae9-97ce-2b26ca96b689","scheduled_at":"2026-05-04 09:00:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"8.7700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"2bbd26dc-c6d9-4daf-beca-f621aee2027c","scheduled_at":"2026-04-30 11:45:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"12.63","base_net_price":"8.0000","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"11.8000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"70a41377-437a-46a9-9433-effa027076bb","scheduled_at":"2026-04-30 05:20:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"8.7700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"abe2c4c3-8f95-413c-80eb-9a645705b624","scheduled_at":"2026-04-29 13:45:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"12.63","base_net_price":"8.0000","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"11.8000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"bd6166c0-8c74-448c-8319-91354bc6b5cf","scheduled_at":"2026-04-29 08:00:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"8.7700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"9c194640-0aff-4d85-a97b-70d06a02aefd","scheduled_at":"2026-04-28 13:00:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"12.63","base_net_price":"8.0000","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"11.8000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"eea078a6-1556-4778-a364-338640c53722","scheduled_at":"2026-04-28 05:00:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"8.7700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"c0cc8a4e-7886-4661-a365-5b2102c15166","scheduled_at":"2026-04-27 11:45:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"12.63","base_net_price":"8.0000","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"11.8000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"aaecea23-70b4-4108-a88a-9e634b0ecea0","scheduled_at":"2026-04-27 05:01:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"8.7700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"b98fad69-bb5e-4f78-8bfe-9b27b73e072d","scheduled_at":"2026-04-24 14:00:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"8.41","base_net_price":"7.8600","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"7.8600","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"f98353b3-9086-4788-8c54-ea19ad924651","scheduled_at":"2026-04-24 12:00:00+00","driving_distance_km":19.164,"manual_distance_km":null,"gross_price":"46.53","base_net_price":"39.6900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"43.4900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Eberhard Bienert"},{"id":"01a451a9-1f76-4507-a34b-6bdb07b8e58b","scheduled_at":"2026-04-24 08:30:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"8.7700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"d01dfb69-9c78-4256-b511-1862f421a8c5","scheduled_at":"2026-04-24 06:00:00+00","driving_distance_km":17.682,"manual_distance_km":null,"gross_price":"42.76","base_net_price":"39.9600","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"39.9600","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Eberhard Bienert"},{"id":"0d1255d2-9581-4a80-a581-93f00c179da4","scheduled_at":"2026-04-23 14:30:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"12.63","base_net_price":"8.0000","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"11.8000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"c781295c-5a34-4d72-b774-dca9f99f0021","scheduled_at":"2026-04-23 11:00:00+00","driving_distance_km":19.164,"manual_distance_km":null,"gross_price":"46.53","base_net_price":"39.6900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"43.4900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Eberhard Bienert"},{"id":"bb0b0d85-472d-45c3-af59-6a3d782baba5","scheduled_at":"2026-04-23 06:00:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"12.5700","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"8d12a4ba-862e-4382-92f6-0f621bdab2e2","scheduled_at":"2026-04-23 05:00:00+00","driving_distance_km":17.682,"manual_distance_km":null,"gross_price":"43.38","base_net_price":"40.5400","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"40.5400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Eberhard Bienert"},{"id":"42a0ba47-b6c3-4c82-b050-9656ffe121a9","scheduled_at":"2026-04-22 14:00:00+00","driving_distance_km":3.566,"manual_distance_km":null,"gross_price":"9.53","base_net_price":"8.9100","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"8.9100","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"ab4c1ce4-0644-4d7f-a23d-97125724b8ec","scheduled_at":"2026-04-22 13:00:00+00","driving_distance_km":19.164,"manual_distance_km":null,"gross_price":"46.53","base_net_price":"39.6900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"43.4900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Eberhard Bienert"},{"id":"ebc5beb9-7337-4036-9a90-1ba7ce3e9d1e","scheduled_at":"2026-04-22 07:30:00+00","driving_distance_km":3.901,"manual_distance_km":null,"gross_price":"10.43","base_net_price":"8.9700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.7700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"1f243050-1e9d-4466-9f87-cf774d65e5e5","scheduled_at":"2026-04-22 05:30:00+00","driving_distance_km":17.682,"manual_distance_km":null,"gross_price":"43.38","base_net_price":"36.7400","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"40.5400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Eberhard Bienert"},{"id":"198d78ab-6ae0-4880-9b0d-67b9f341a1a6","scheduled_at":"2026-04-21 14:00:00+00","driving_distance_km":3.566,"manual_distance_km":null,"gross_price":"12.84","base_net_price":"8.2000","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.0000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"b935e3bd-3b81-4ed1-9125-966af9aa0ab3","scheduled_at":"2026-04-21 07:00:00+00","driving_distance_km":3.901,"manual_distance_km":null,"gross_price":"10.43","base_net_price":"9.7500","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"9.7500","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"3c1506b6-b928-4246-9c5d-66e7f261ab4b","scheduled_at":"2026-04-20 13:00:00+00","driving_distance_km":3.477,"manual_distance_km":null,"gross_price":"12.63","base_net_price":"11.8000","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"11.8000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"5953fadc-e6ff-4751-a051-6a30b68ee410","scheduled_at":"2026-04-20 12:30:00+00","driving_distance_km":19.164,"manual_distance_km":null,"gross_price":"46.53","base_net_price":"39.6900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"43.4900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Eberhard Bienert"},{"id":"b1987ef9-31b4-48a8-af79-9ac35d1e25b4","scheduled_at":"2026-04-20 07:45:00+00","driving_distance_km":3.812,"manual_distance_km":null,"gross_price":"13.45","base_net_price":"8.7700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Iris van den Berg"},{"id":"287f9a81-bf16-4008-84e3-e3122ffbed8f","scheduled_at":"2026-04-20 05:00:00+00","driving_distance_km":17.682,"manual_distance_km":null,"gross_price":"43.38","base_net_price":"36.7400","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"40.5400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Eberhard Bienert"}]
```

**Note:** This 30-row window is dominated by **Iris van den Berg** and **Eberhard Bienert** (most recent activity). **Werner Büntjen** and **Ursula Meyer** do not appear in these 30 rows; see **§B.2a** for an additional fetch by `client_id`.

### B.2a Supplement — ARZO trips for Büntjen & Meyer (30 rows, same columns)

**MCP `execute_sql` raw JSON (verbatim):**

```text
[{"id":"8951c2ef-b58d-41ef-a058-c09737f9b181","scheduled_at":"2026-04-17 13:00:00+00","driving_distance_km":4.927,"manual_distance_km":null,"gross_price":"13.18","base_net_price":"12.3200","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"12.3200","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"01cd7bf3-afe8-490a-81d4-e66424e941fe","scheduled_at":"2026-04-17 05:00:00+00","driving_distance_km":4.9,"manual_distance_km":null,"gross_price":"13.11","base_net_price":"11.2700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.0700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"a261a261-5432-4685-8e09-270643a34b52","scheduled_at":"2026-04-16 11:00:00+00","driving_distance_km":5.016,"manual_distance_km":null,"gross_price":"13.42","base_net_price":"11.5300","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.3300","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"93ceb88a-2986-4c09-96b7-9618ec0d0bb1","scheduled_at":"2026-04-16 05:00:00+00","driving_distance_km":4.989,"manual_distance_km":null,"gross_price":"16.34","base_net_price":"11.4700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.2700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"9b79e8d6-d03d-47c0-92b2-c123a391a695","scheduled_at":"2026-04-15 13:30:00+00","driving_distance_km":5.016,"manual_distance_km":null,"gross_price":"13.42","base_net_price":"11.5300","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.3300","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"710e8c4c-0782-4ae8-963d-7a26bd32094c","scheduled_at":"2026-04-15 11:00:00+00","driving_distance_km":12.534,"manual_distance_km":null,"gross_price":"33.53","base_net_price":"31.3400","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"31.3400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"b2a83eec-6727-4a62-be11-8045c70d646f","scheduled_at":"2026-04-15 08:00:00+00","driving_distance_km":4.989,"manual_distance_km":null,"gross_price":"16.34","base_net_price":"11.4700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.2700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"4618e88f-7a47-49ec-aab0-23bf0533435b","scheduled_at":"2026-04-15 05:40:00+00","driving_distance_km":12.559,"manual_distance_km":null,"gross_price":"33.6","base_net_price":"31.4000","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"31.4000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"a8ff854a-dedf-48c1-8550-4087b19394b5","scheduled_at":"2026-04-14 14:00:00+00","driving_distance_km":5.016,"manual_distance_km":null,"gross_price":"13.42","base_net_price":"11.5300","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.3300","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"fbd85799-7780-4f33-94e8-91c5c29c5029","scheduled_at":"2026-04-14 12:30:00+00","driving_distance_km":12.534,"manual_distance_km":null,"gross_price":"32.41","base_net_price":"26.4900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.2900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"04a2f375-e79b-453b-ac5d-d38382d81599","scheduled_at":"2026-04-14 08:20:00+00","driving_distance_km":4.989,"manual_distance_km":null,"gross_price":"13.34","base_net_price":"11.4700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.2700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"6dc38b7f-7982-4e95-9ae6-a2a56bebb485","scheduled_at":"2026-04-14 06:00:00+00","driving_distance_km":12.559,"manual_distance_km":null,"gross_price":"32.46","base_net_price":"26.5400","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.3400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"7bbf2c4c-7fa2-4d15-9b97-bf1408a22a48","scheduled_at":"2026-04-13 15:00:00+00","driving_distance_km":5.016,"manual_distance_km":null,"gross_price":"13.42","base_net_price":"11.5300","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.3300","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"24c842e8-b23d-4f8e-9f30-e186c7fb4b27","scheduled_at":"2026-04-13 12:30:00+00","driving_distance_km":12.534,"manual_distance_km":null,"gross_price":"32.41","base_net_price":"26.4900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.2900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"85872cce-732b-4c5e-aed1-0588474b269e","scheduled_at":"2026-04-13 08:45:00+00","driving_distance_km":4.989,"manual_distance_km":null,"gross_price":"13.34","base_net_price":"12.4700","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"12.4700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"e90572be-e033-4218-b320-742c8ded55bc","scheduled_at":"2026-04-13 06:30:00+00","driving_distance_km":12.559,"manual_distance_km":null,"gross_price":"33.6","base_net_price":"26.5400","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.3400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"6e9b7d33-fcbe-4cdc-985b-fe37d12534e5","scheduled_at":"2026-04-10 13:30:00+00","driving_distance_km":12.534,"manual_distance_km":null,"gross_price":"32.41","base_net_price":"26.4900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.2900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"d7eb0cd8-7077-4559-b027-b2c1e3d38a04","scheduled_at":"2026-04-10 12:30:00+00","driving_distance_km":5.016,"manual_distance_km":null,"gross_price":"13.42","base_net_price":"12.5400","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"12.5400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"a914f908-00b5-47ca-9d9d-7a2c4795fe28","scheduled_at":"2026-04-10 06:30:00+00","driving_distance_km":4.989,"manual_distance_km":null,"gross_price":"13.34","base_net_price":"11.4700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.2700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"2797e477-7290-4d18-9baa-201df66ad7f8","scheduled_at":"2026-04-10 06:00:00+00","driving_distance_km":12.559,"manual_distance_km":null,"gross_price":"32.46","base_net_price":"26.5400","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.3400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"9125c6e2-06b0-420a-b80c-2dd15dcd3530","scheduled_at":"2026-04-09 14:30:00+00","driving_distance_km":5.016,"manual_distance_km":null,"gross_price":"16.4","base_net_price":"11.5300","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.3300","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"628d319c-9cba-4ca5-8d30-b393b5186764","scheduled_at":"2026-04-09 12:30:00+00","driving_distance_km":12.534,"manual_distance_km":null,"gross_price":"32.41","base_net_price":"26.4900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.2900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"151671d2-d47d-4940-b393-cf86be7fddde","scheduled_at":"2026-04-09 07:00:00+00","driving_distance_km":4.989,"manual_distance_km":null,"gross_price":"13.34","base_net_price":"11.4700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.2700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"57a6f91e-da3a-48ef-b702-c92ebd88b946","scheduled_at":"2026-04-09 06:15:00+00","driving_distance_km":12.559,"manual_distance_km":null,"gross_price":"33.6","base_net_price":"26.5400","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.3400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"fd286e2b-6bc1-4144-ac45-de21bcce6dc1","scheduled_at":"2026-04-08 14:30:00+00","driving_distance_km":5.016,"manual_distance_km":null,"gross_price":"16.4","base_net_price":"11.5300","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.3300","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"47dbf5a5-dab7-42c7-a15f-2fa0f5ac0bb4","scheduled_at":"2026-04-08 14:30:00+00","driving_distance_km":12.534,"manual_distance_km":null,"gross_price":"33.53","base_net_price":"31.3400","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"31.3400","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"f7d9a8bb-1d26-4614-ab3a-9e03ee3c1b1e","scheduled_at":"2026-04-08 08:00:00+00","driving_distance_km":4.989,"manual_distance_km":null,"gross_price":"13.34","base_net_price":"11.4700","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.2700","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"8b348733-187e-40eb-af25-fe2fb496126c","scheduled_at":"2026-04-08 07:30:00+00","driving_distance_km":12.559,"manual_distance_km":null,"gross_price":"33.6","base_net_price":"31.4000","approach_fee_net":null,"tax_rate":"0.07","manual_gross_price":null,"net_price":"31.4000","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"},{"id":"b30c315f-50b1-46fa-afea-154de3912c10","scheduled_at":"2026-04-07 14:00:00+00","driving_distance_km":5.016,"manual_distance_km":null,"gross_price":"16.4","base_net_price":"11.5300","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"15.3300","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Werner Büntjen"},{"id":"2110068b-607d-4c6a-9ddc-58313cc35217","scheduled_at":"2026-04-07 10:30:00+00","driving_distance_km":12.534,"manual_distance_km":null,"gross_price":"32.41","base_net_price":"26.4900","approach_fee_net":"3.8000","tax_rate":"0.07","manual_gross_price":null,"net_price":"30.2900","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","client_name":"Ursula Meyer"}]
```

---

## C. SQL — Query 2 (`client_km_overrides`)

### C.1 Verbatim user query (fails on `c.name`)

Same `42703` error as Query 1.

### C.2 Adapted Query 2 — MCP raw JSON (verbatim)

```text
[{"id":"15b196df-2472-4f5c-ae93-9350c7dfd574","company_id":"8df83726-cd59-4fd0-87df-0bd905915fec","client_id":"9d3b8039-03e6-484f-9b7e-c25d1b713a88","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","distance_km":"20.100","is_active":true,"created_at":"2026-05-06 07:16:55.275592+00","updated_at":"2026-05-06 07:31:51.247+00","billing_variant_id":null,"client_name":"Eberhard Bienert"},{"id":"fc018d96-733a-4e34-8505-f076e26a34dc","company_id":"8df83726-cd59-4fd0-87df-0bd905915fec","client_id":"f598b7c8-acf8-476a-afed-a8b8ec1dcd33","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","distance_km":"4.900","is_active":true,"created_at":"2026-05-06 07:33:40.752296+00","updated_at":"2026-05-06 07:33:40.752296+00","billing_variant_id":null,"client_name":"Iris van den Berg"},{"id":"dc3371b0-f147-4f51-8cf5-be01f05bd97d","company_id":"8df83726-cd59-4fd0-87df-0bd905915fec","client_id":"4f072ce4-c573-4c46-ad33-87596b5aa9de","payer_id":"6e52a5d5-ffd4-4a75-a34d-60b054f83030","distance_km":"13.500","is_active":true,"created_at":"2026-05-06 07:15:46.778452+00","updated_at":"2026-05-06 07:15:46.778452+00","billing_variant_id":null,"client_name":"Ursula Meyer"},{"id":"8be90cb2-bffe-4de2-b2fb-6b866a9cc096","company_id":"8df83726-cd59-4fd0-87df-0bd905915fec","client_id":"234575f5-e900-43ac-ad51-ae3e3194a9fc","payer_id":null,"distance_km":"6.000","is_active":true,"created_at":"2026-05-06 07:16:12.19769+00","updated_at":"2026-05-06 07:16:12.19769+00","billing_variant_id":null,"client_name":"Werner Büntjen"}]
```

---

## D. SQL — Query 3 (ARZO rule history)

**MCP `execute_sql` raw JSON (verbatim):**

```text
[{"id":"84254770-6616-455b-8c89-e8a619a7859c","strategy":"tiered_km","config":{"tiers":[{"to_km":5,"from_km":0,"price_per_km":2.3},{"to_km":null,"from_km":5,"price_per_km":1.99}],"approach_fee_net":3.8},"is_active":true,"created_at":"2026-04-06 07:16:16.283397+00","updated_at":"2026-04-21 22:38:05.778+00"}]
```

Only **one** row exists for this `payer_id` (no inactive history rows returned).

---

## E. Answered questions

### 1) Which distance is used for pricing? Per client: manual on trip? Override row? `resolveEffectiveDistanceKm` vs user km (6 / 13.5 / 20.1 / 4.9)?

**Two different code paths:**

| Path | Distance source |
|------|------------------|
| **Trip snapshot** (`computeTripPrice` on save/edit) | **`trips.driving_distance_km` only** — ignores `manual_distance_km` and **does not load** `client_km_overrides`. |
| **Invoice line build** (`buildLineItemsFromTrips`) | **`resolveEffectiveDistanceKm`**: `manual_distance_km` → **client_km_overrides** → `driving_distance_km`. That value is passed as `driving_distance_km` into `resolveTripPricePure`. |

**All sampled ARZO trips** in §B.2 / §B.2a have **`manual_distance_km`: `null`.**

**Override rows** (§C.2) — created **`2026-05-06`** (all four):

| Client | `distance_km` | `payer_id` on override |
|--------|----------------|-------------------------|
| Werner Büntjen | **6.000** | `null` (global row; still wins for ARZO trips via `pickClientKmOverrideRow` global branch when no variant row) |
| Ursula Meyer | **13.500** | ARZO payer id |
| Eberhard Bienert | **20.100** | ARZO payer id |
| Iris van den Berg | **4.900** | ARZO payer id |

**`resolveEffectiveDistanceKm` today** (manual null, overrides active, trips from April–May 2026):

- Would return **6 / 13.5 / 20.1 / 4.9** respectively for those clients — **matching the canonical km figures** in the prompt **for invoice pricing**.
- **Trip rows** still carry **Google** `driving_distance_km` (e.g. Iris ~3.48–3.90 km; Meyer ~12.53–12.56 km; Bienert ~17.68–19.16 km; Büntjen ~4.9–5.02 km) — **not** the override distances for invoice-time repricing.

**Temporal gap:** Overrides were inserted **after** most listed trips’ `scheduled_at`. So **at the time those trips were last repriced in-app**, overrides likely **did not exist**; snapshots would have used **routing km** only. **After 2026-05-06**, new invoice runs would use **override km** unless `manual_distance_km` is set.

---

### 2) Snapshot consistency: `round((base_net_price + approach_fee_net) * (1 + tax_rate) * 100) / 100` vs `gross_price`

Using **numeric** parsing (`approach_fee_net` null → 0). Formula matches **`computeTripPrice`**:

```265:268:src/features/trips/lib/trip-price-engine.ts
  const totalGross =
    baseNetPrice !== null
      ? Math.round((baseNetPrice + approachFeeNet) * (1 + taxRate) * 100) / 100
      : null;
```

**Rows where formula matches stored `gross_price` (examples):** Iris `20ab4513…` → \((8.77 + 3.8) × 1.07 = 13.4499 → 13.45\). Bienert `f98353b3…` → \((39.69 + 3.8) × 1.07 = 46.5243 → 46.52\) — stored **46.53** (off **€0.01** if base is exactly 39.69; likely DB decimal vs float display).

**Clear inconsistencies (formula vs `gross_price`):**

| Trip id | Client | `gross_price` | Expected from base+approach | Delta |
|---------|--------|---------------|------------------------------|-------|
| `93ceb88a…` | Büntjen | 16.34 | \((11.47+3.8)×1.07 = 16.35\) | **−0.01** |
| `ebc5beb9…` | Iris v.d.B. | 10.43 | \((8.97+3.8)×1.07 = 13.66\) | **−3.23** |
| `9125c6e2…` / `fd286e2b…` / `b30c315f…` | Büntjen | 16.4 | \((11.53+3.8)×1.07 = 16.36\) | **+0.04** |

Several rows also show **`net_price` ≠ `base_net_price + coalesce(approach_fee_net,0)`** (e.g. `ebc5beb9…`: base 8.97 + approach 3.8 = 12.77 but `net_price` 12.77 — actually that adds up; gross still wrong). **`ebc5beb9`** is the worst: **`gross_price` 10.43** implies total net **9.75** at 7% VAT, but **`base_net_price` + `approach_fee_net`** sum to **12.77**.

**Interpretation:** not a single rounding glitch — some rows are **materially inconsistent** between transport net, approach net, combined net, and gross (partial edits, failed recalc, or historical writes outside `computeTripPrice`).

---

### 3) Was ARZO’s rule updated after trips were priced?

Single rule: **`updated_at` = `2026-04-21 22:38:05+00`**.

- Many trips in the extracts have **`scheduled_at` before** that date (e.g. April 7–20) — rule **existed before** those trips.
- **`updated_at` after `scheduled_at`** does **not** automatically restate old trip rows: `computeTripPrice` is not retroactively run when a rule changes unless trips are edited.

**Cannot** conclude “stale snapshot vs old tiers” per trip without knowing **exactly when** each trip’s price columns were last written; schema has no `prices_updated_at`. The **2026-05-06** overrides are **newer** than almost all trips — they affect **invoice distance**, not the stored trip snapshot, until trips are recalculated or manual km is written.

---

### 4) Do `client_km_overrides` differ from routing km / user expectations?

**Yes.** Overrides are exactly **6, 13.5, 20.1, 4.9** — the prompt’s figures. **`driving_distance_km`** on trips is typically **lower** for Iris, **lower** for Meyer/Bienert long trips, and **~5 km** for Büntjen while override says **6**.

So **invoice builder pricing** (post-override) and **trip list gross** (routing-based snapshot) can **diverge by design** until trip recalc incorporates the same distance policy.

---

### 5) `base_net_price` / `approach_fee_net` vs `tieredNetTotal(distance, ARZO tiers)`

**ARZO tiers** from DB: \([0,5)\) @ **2.30** €/km net; \([5,∞)\) @ **1.99** €/km net; **`approach_fee_net` in rule = 3.8** (applied separately in engine, not inside `tieredNetTotal`).

Define \(T(d) = \texttt{tieredNetTotal}(d, \text{tiers})\) (one round on total transport net).

**Examples that reconcile:**

- **Iris**, `driving_distance_km` **3.812**: \(T = \mathrm{round}(3.812×2.3×100)/100 = 8.77\); with approach **3.8**, gross **13.45** ✓.
- **Bienert**, **19.164** km: \(T = 5×2.3 + 14.164×1.99 = 39.68636 → 39.69\); + approach 3.8 → matches **`base_net_price` 39.69** and **`net_price` 43.49** ✓.
- **Meyer**, **12.534** km: \(T = 11.5 + 7.534×1.99 = 26.49266 → 26.49\); matches row `fbd85799…` **`base_net_price` 26.49** with approach 3.8 ✓.

**If invoice used override km instead:**

- **13.5** km: \(T = 11.5 + 8.5×1.99 = 28.415 → 28.42\) (not **26.49** on ~12.53 km rows).
- **20.1** km: \(T = 11.5 + 15.1×1.99 = 41.449 → 41.45\) vs **`39.69`** at **19.164** km routing.
- **6** km: \(T = 11.5 + 1×1.99 = 13.49\) vs **`~11.47–11.53`** at **~5** km routing for Büntjen.
- **4.9** km: \(T = \mathrm{round}(4.9×2.3×100)/100 = 11.27\) vs **`8.77`** at **3.812** km for Iris.

So: **stored `base_net_price` on these trips matches `tieredNetTotal(routing_km, ARZO tiers)`** in the well-formed rows; it does **not** match **`tieredNetTotal(override_km, …)`** — confirming snapshots were built from **routing distance**, while **catalog overrides** encode the **contract km** the user quoted.

---

## F. Senior recommendation

1. **Treat “which km?” as path-dependent:** trip UI / `computeTripPrice` = **`driving_distance_km`**; invoice builder = **`resolveEffectiveDistanceKm`**. Align product expectations (or add `manual_distance_km` / effective km into trip recalc) if the business source of truth is **catalog override km**.
2. **Overrides appeared 2026-05-06** — explain any “spreadsheet vs app” delta for April trips as **pre-override snapshots**.
3. **Investigate inconsistent rows** (e.g. `ebc5beb9…`) as **data integrity** (not formula): `gross_price` does not follow `(base+approach)×(1+tax)`.
