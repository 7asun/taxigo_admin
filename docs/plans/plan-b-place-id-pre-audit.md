# Plan B — Pre-Audit Findings

Code references use **file:line** as of the audit date. The create-trip implementation lives under `src/features/trips/components/create-trip/create-trip-form.tsx` (there is no `src/features/trips/create-trip-form.tsx` at repo root).

---

## Q1 — place-details API

**Source:** [`src/app/api/place-details/route.ts`](../../src/app/api/place-details/route.ts)

1. **Success JSON keys** (single `NextResponse.json` success branch): `lat`, `lng`, `zip_code`, `street`, `street_number`, `city` — see lines **125–132**.

2. **`place_id` in the response:** Not returned today. Before building that object, the handler already has the Place identifier from the **incoming request**: `placeId` from `searchParams.get('placeId')` (**59**) and `placeResourceId = normalizePlaceIdForPlacesGet(placeId)` (**58–59**, **67–68**) used in the GET URL. Nothing from the Places response body is mapped into the success payload yet; to **echo** `place_id` you would add it explicitly (e.g. from the known request id after normalization).

3. **Google response usage:** The handler reads `data` from `await response.json()` (**84**) and only uses `data.location?.latitude`, `data.location?.longitude` (**94–95**) and `data.addressComponents` (via `postalCodeFromComponents` and street/city lookups **96–123**). There is **no** variable in this file that reads a `place_id` (or `name`) field **from** `data`. The canonical id used for the request is the **`placeResourceId`** string (normalized from the query param), not a field on `data`.

---

## Q2 — route_metrics_cache

**Implementation:** [`src/lib/google-directions.ts`](../../src/lib/google-directions.ts) (`resolveDrivingMetricsWithCache`, **190–266**).  
**Schema:** [`supabase/migrations/20260417100000_route-metrics-cache.sql`](../../supabase/migrations/20260417100000_route-metrics-cache.sql) — this is the **only** migration touching `route_metrics_cache` in `supabase/migrations/`.

1. **Columns and types** (from migration **6–15**):
   - `id` — `uuid`, PK, default `gen_random_uuid()`
   - `company_id` — `uuid` NOT NULL, FK → `companies(id)`
   - `origin_lat` — `decimal(8,5)` NOT NULL
   - `origin_lng` — `decimal(8,5)` NOT NULL
   - `dest_lat` — `decimal(8,5)` NOT NULL
   - `dest_lng` — `decimal(8,5)` NOT NULL
   - `distance_km` — `float8` NOT NULL
   - `duration_seconds` — `int4` NOT NULL
   - `created_at` — `timestamptz`, default `now()`

2. **UNIQUE / conflict target:** Table-level `UNIQUE (company_id, origin_lat, origin_lng, dest_lat, dest_lng)` (**16**). Index `idx_route_metrics_lookup` duplicates those columns (**19–20**). Upsert uses `onConflict: 'company_id,origin_lat,origin_lng,dest_lat,dest_lng'` in code (**250**).

3. **SELECT (cache lookup):** `supabase.from('route_metrics_cache').select('distance_km, duration_seconds').eq('company_id', companyId).eq('origin_lat', rOriginLat).eq('origin_lng', rOriginLng).eq('dest_lat', rDestLat).eq('dest_lng', rDestLng).maybeSingle()` — **205–213**.

4. **INSERT / upsert:** `supabase.from('route_metrics_cache').upsert({ company_id, origin_lat, origin_lng, dest_lat, dest_lng, distance_km, duration_seconds }, { onConflict: 'company_id,origin_lat,origin_lng,dest_lat,dest_lng', ignoreDuplicates: true })` — **237–253**.

5. **`place_id` / address columns on cache:** **None.** The table and resolver are **purely coordinate-keyed** (rounded coords). No `place_id` or address string columns exist today.

---

## Q3 — trip insert payload

**Source:** [`src/features/trips/components/create-trip/create-trip-form.tsx`](../../src/features/trips/components/create-trip/create-trip-form.tsx)

1. **Payload variable naming:** Shared fields are merged from **`baseTrip`** (**1291–1313**). Each creation passes an **object literal** as the sole argument to **`tripsService.createTrip(...)`** — there is no separate named variable holding the full insert payload; the closest reusable name is **`baseTrip`** plus spread fields per path.

2. **`pickup_lat` / `pickup_lng` / `dropoff_lat` / `dropoff_lng`:** **Yes**, all `createTrip` paths set these from the resolved address groups (e.g. anonymous outbound **1375–1384**, anonymous return **1443–1452**, passenger outbound **1529–1538**, passenger return **1617–1626**).

3. **`placeId` from `AddressResult` at assemble time:** **`AddressGroupEntry`** ([`src/features/trips/types.ts`](../../src/features/trips/types.ts) **14–23**) has **no** `placeId` field. `updatePickupAddress` / `updateDropoffAddress` copy address, structured fields, `lat`, `lng` from `AddressResult` but **do not** copy `placeId` (**843–859**, **909–927**). So at `tripsService.createTrip`, **`placeId` is not on** `pickupGroup` / `dropoffGroup`. If autocomplete supplied it, it exists only on the transient **`AddressResult`** inside the update handlers — **not** persisted on the group object used for insert. To expose it at insert, you would extend **`AddressGroupEntry`** and map **`result.placeId`** (see [`address-autocomplete.tsx`](../../src/features/trips/components/trip-address-passenger/address-autocomplete.tsx) **`AddressResult.placeId`** **43**) in those updaters.

4. **Multiple insert paths:**
   - **`!requirePassenger` (anonymous):** one **`tripsService.createTrip`** for outbound (**1347–1389**); optional second **`tripsService.createTrip`** for return (**1411–1461**) when `shouldCreateReturn`.
   - **`requirePassenger`:** **`Promise.all(passengers.map(...))`** — one **`tripsService.createTrip`** per passenger for outbound (**1469–1546**); optional **`Promise.all(outboundTrips.map(...))`** with async IIFEs for return legs (**1550–1638**) when `shouldCreateReturn`.

---

## Q4 — distance field in detail sheet

**Source:** [`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`](../../src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx)

1. **JSX:** A **`Badge`** (`@/components/ui/badge`) in the “Route & Verlauf” section shows distance: **`trip.driving_distance_km`** formatted with `toLocaleString('de-DE', …)` or the fallback text **`'Geplant'`** — **1258–1265**.

2. **Display vs edit:** **Plain read-only display** inside a `Badge`, not an `<Input>` or editable control.

3. **Conditional / disabled:** Only conditional on **whether `trip.driving_distance_km` is truthy** (shows km vs `'Geplant'`). No `disabled` prop; **no** invoice or lock branch around this `Badge` in the audited lines.

4. **`isDistanceLocked` / invoice awareness near this UI:** **`isDistanceLocked`** is computed **only** inside **`handleSaveTripDetails`**’s async **`exec`** (**962–966**) and passed into **`buildTripDetailsPatch`**. It is **not** React state and is **not in scope** at the **Route & Verlauf** `Badge` (~1258). To drive a lock indicator here, you would **thread** new state (e.g. loaded when the sheet opens / trip id changes), a **query hook**, or similar — it is **not** already available next to the distance `Badge`.

---

## Blockers or surprises

- **`/api/place-details`** never echoes `place_id`; Plan B “echo place_id” is an explicit API + client contract change. The request id is already known server-side as **`placeResourceId`** / raw **`placeId`** query param.

- **`route_metrics_cache`** has **no** place-key columns; Plan B’s “prefer place ID key” implies **schema + resolver** changes (new columns and/or alternate lookup path), not a drop-in.

- **Create form** does **not** persist **`AddressResult.placeId`** on **`AddressGroupEntry`**; trip inserts cannot send place IDs until the group type and **`updatePickupAddress` / `updateDropoffAddress`** (and possibly **`ensureGroupHasCoords`**) are extended.

- **Distance UI** is a **`Badge`**, not a field component; any “lock indicator” is additive UI next to or inside that area. **`isDistanceLocked`** from Plan A is **save-path only** — the dispatcher-facing distance display has **no** current linkage to invoice lock without new data loading or state.
