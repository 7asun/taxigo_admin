# Geocoding Normalisation Audit

## Summary

Consolidating geocoding and driving metrics behind a single server-side **`resolveCanonicalRoute`-style** entry point is **directionally sound** and addresses the real bug class (multiple geocoder surfaces → drifting lat/lng → cache misses → divergent `route_metrics_cache` / trip distances). It is **not** a drop-in rename: today **four distinct geocoding surfaces** feed trips (Places Autocomplete + Place Details, `/api/geocode-address` + `geocodeStructuredAddressToLatLng`, `geocodeAddressLineToStructured` in cron, and **no** geocode at all when copying or reusing stored coords). **Top risks:** (1) **client-only paths** must continue to call Google via **Route Handlers** with admin auth — a fat `src/lib` function cannot run in the browser; (2) **forcing one geocoder** for all flows may **move map pins** versus historical Places-based coordinates unless you define whether canonical means “ Places Geometry” vs “Geocoding API structured”; (3) **duplicate / backfill / linked-return** paths often **do not geocode** by design — the handler must specify when to **trust existing coords** vs **re-resolve from address**, or you will churn data and still see inconsistencies.

## Findings

### 1. Geocoding method per write path

**Note on paths:** The CSV flow referenced in the brief lives at `src/features/trips/components/bulk-upload-dialog.tsx` (not `src/features/trips/bulk-upload/...`). Recurring materialisation is `src/app/api/cron/generate-recurring-trips/route.ts` (not `src/app/api/generate-recurring-trips/...`).

**Coordinate rounding:** Trip rows store whatever lat/lng the respective flow produced (full float). **`route_metrics_cache`** keys use coordinates rounded to **`COORD_PRECISION` (5 dp)** inside `resolveDrivingMetricsWithCache` only (`src/lib/google-directions.ts` ~35–44, ~198–213). No extra rounding is applied to coordinates on the `trips` row at write time in the audited files.

| Path | Geocoding method | Stored on row? | Normalised? |
|------|------------------|----------------|-------------|
| Manual create (`create-trip-form.tsx`) | **Google Places Autocomplete** (`/api/places-autocomplete`) and **Place Details** (`/api/place-details`) via `AddressAutocomplete` — populates `AddressResult.lat`/`lng` on address groups (`trip-address-passenger/address-autocomplete.tsx` ~4–7; create form updates groups with `result.lat`/`lng` ~843–858). **Not** `/api/geocode-address`. | **Yes** — `pickup_lat`/`lng`, `dropoff_lat`/`lng` written on `createTrip` from resolved groups (~1375–1384, ~1529–1538, etc.). | **Only in cache layer** (5 dp inside `resolveDrivingMetricsWithCache`), not on stored trip coords. |
| Trip detail sheet (`build-trip-details-patch.ts`) | Same UI stack as create: draft vs persisted address comparison; when pickup/dropoff **address text** changes, structured fields and coords come from `lastPickupResolved` / `lastDropoffResolved` (`AddressResult`) (~122–159). That resolution happens **outside** this file (trip detail UI). | **Yes** — PATCH can include `pickup_lat`/`lng`, `dropoff_lat`/`lng` when resolver supplied coords (~132–135, ~156–159). | Same as above; trip stores raw coords. |
| Paired Gegenfahrt sync (`paired-trip-sync.ts`) | **No independent geocode.** Builds endpoints from drafts + `lastPickupResolved` / `lastDropoffResolved` or falls back to `trip.*` lat/lng (`pickupSideFromDrafts` / `dropoffSideFromDrafts` ~134–188). | **Yes** — swapped route writes `pickup_lat`/`lng`, `dropoff_lat`/`lng` on partner patch (~195–215); metrics from `fetchDrivingMetrics` (~267–286). | Trip coords as above; cache rounding only in resolver behind `fetchDrivingMetrics`. |
| CSV bulk upload (`bulk-upload-dialog.tsx` ~1100–1370) | **`POST /api/geocode-address`** → `geocodeStructuredAddressToLatLng` (`src/app/api/geocode-address/route.ts` ~1–24). | **Yes** — assigns `pickup_lat`/`lng`, `dropoff_lat`/`lng` from JSON (~1163–1173); recomposes `pickup_address` / `dropoff_address` strings (~1194–1213). | Cache layer only for Directions cache. |
| Trip duplication (`duplicate-trips.ts`) | **No geocoding.** `copyRouteAndPassengerFields` copies **addresses + lat/lng + `driving_distance_km`** from source (~267–311). `enrichInsertWithMetrics` uses **inserted coordinates only** if metrics null (~377–401). | **Yes** — coords and metrics copied or filled from resolver. | Same. |
| Recurring cron (`generate-recurring-trips/route.ts` ~145–257) | **`geocodeAddressLineToStructured`** per address line via `resolveGeoLine` (in-memory string cache ~145–157, ~148–157); **not** `/api/geocode-address`. | **Yes** — `pickup_lat`/`lng`, `dropoff_lat`/`lng` from `pickupGeo`/`dropoffGeo` (~291–305). Metrics from `resolveDrivingMetricsWithCache` (~239–249). | Cron also rounds to `COORD_PRECISION` for **in-memory** dedupe keys (~227–234); DB cache still uses resolver rounding. |
| Linked return (`create-linked-return.ts`) | **No geocoding** — uses **outbound row** `dropoff_*` / `pickup_*` coordinates reversed (~34–39). | **Yes** — metrics and coords via `buildReturnTripInsert` + create (see ~47–56). | Same. |
| Backfill (`scripts/backfill-driving-distance.ts`) | **No geocode** — reads existing `pickup_lat`/`lng`, `dropoff_lat`/`lng` from `trips` and calls `resolveDrivingMetricsWithCache` (~279–290 in prior audit context). | **Updates** `driving_distance_km` / `driving_duration_seconds` (and optionally prices) on the row; **does not** rewrite lat/lng in the inspected Pass A block. | Resolver-only rounding for cache keys. |

---

### 2. Coordinate provenance for Directions calls

**Callers always pass numbers into `resolveDrivingMetricsWithCache` / `getDrivingMetrics`.** The resolver **does not** read `trips` or geocode internally (`google-directions.ts` ~190–230).

**Mismatch vs stored row is possible whenever:**

- The browser passes coordinates from **Place Details** while the row on disk still has older coords until PATCH/INSERT completes.
- **Bulk upload** computes metrics on the client from freshly geocoded lat/lng, then inserts — should match if insert uses the same object.
- **Detail sheet** merges `patch.*` with `trip.*` for the metrics block (~231–242): Directions uses **effective** pickup/dropoff after merge. If only one endpoint changed, the other pair comes from the **existing trip** — consistent with “what we will persist.”
- **Duplication** uses copied coords; enrichment uses **insert** coords — same as row about to be written.
- **Cron** passes `pickupGeo.lat`/`lng` from `geocodeAddressLineToStructured` — same values written to the insert payload (~296–305).

So: Directions always uses **caller-supplied** coordinates; those **should** align with the trip row **after** the write for that path, but **not** all paths use the same geocoding API to produce those coordinates.

---

### 3. Feasibility of extending `resolveDrivingMetricsWithCache`

**Current signature** (`google-directions.ts` ~190–197): `(originLat, originLng, destLat, destLng, supabase, companyId)`.

**Could a wrapper accept structured addresses, geocode internally, and return coords + metrics?** **Yes, technically** — e.g. a new function in `src/lib` that:

1. Calls existing helpers from `@/lib/google-geocoding` (structured line geocode or structured fields — match your canonical policy).
2. Calls `resolveDrivingMetricsWithCache` with the resulting lat/lng.

**What would break if geocoding moved inside `resolveDrivingMetricsWithCache` itself?**

- **Separation of concerns:** Many flows **persist coordinates before** metrics (bulk upload, cron, detail patch). Today geocoding failures and metrics failures can be handled separately; merging couples failure modes.
- **Duplicate / linked-return / backfill** paths **depend on already-materialised coords** and sometimes **must not** re-geocode (duplicate verbatim copy; backfill fixes distance only).
- **Caching:** `route_metrics_cache` is keyed by **rounded coords**, not addresses. Moving geocode inside the resolver without an **address-level key** does not alone fix duplicate keys for “same text, different coords” — you still need a **normalisation + hash** strategy or a **second lookup dimension** (see §4).
- **Circular dependency:** Low risk if `google-geocoding.ts` does not import `google-directions.ts` (typical layering: geocoding ↔ directions only via a thin orchestrator).

**Browser use:** Anything in `src/lib` that calls `GOOGLE_MAPS_API_KEY` must stay **server-only** (`google-directions.ts` ~14–17). Client paths must use **`fetch`** to an API route — a consolidated handler therefore belongs **either** as a **Route Handler** (e.g. `POST /api/trips/resolve-canonical-route`) **or** as a **Server Action** callable from server components only — not as a direct import from `'use client'` modules.

---

### 4. `route_metrics_cache` schema

**Migration:** `supabase/migrations/20260417100000_route-metrics-cache.sql`.

**Columns:** `id`, `company_id`, `origin_lat`, `origin_lng`, `dest_lat`, `dest_lng`, `distance_km`, `duration_seconds`, `created_at`.

**Constraints / indexes:** `UNIQUE (company_id, origin_lat, origin_lng, dest_lat, dest_lng)`; index `idx_route_metrics_lookup` on `(company_id, origin_lat, origin_lng, dest_lat, dest_lng)` (~6–20).

**Adding `address_hash` (or origin/dest pair hash):**

- **Feasible** as new nullable columns, e.g. `origin_address_hash`, `dest_address_hash`, or a single `route_address_hash`, plus a **partial unique index** or composite unique including `company_id` — **requires a new migration**.
- **Existing rows:** Adding columns does **not** require backfilling for correctness if application logic **falls back** to coordinate lookup when hash is null; **optional** backfill could populate hashes from normalised address strings for historical rows.
- **Design caveat:** A single SHA-256 of “normalised string” only helps if **normalisation is identical everywhere** (Unicode, abbreviations, house number format). Otherwise two hashes for the same building still miss. Many teams prefer **normalised tuple hash** (street + PLZ + city) with explicit casing/strip rules.

---

### 5. Detail-sheet recomputation trigger

**Exact condition** (`build-trip-details-patch.ts` ~231–249):

- All of: `pickupLat`, `pickupLng`, `dropLat`, `dropLng` are **numbers** (after merging patch with `trip` fallbacks ~231–242).
- **And** `patch.pickup_lat !== undefined || patch.dropoff_lat !== undefined`.

So `fetchDrivingMetrics` runs only when the patch **includes at least one changed pickup or dropoff latitude field** — i.e. the branch that mutates address fields ran and supplied new coords from `lastPickupResolved` / `lastDropoffResolved` when available (~122–159). **Notes-only saves:** if notes are edited elsewhere and do not flow through this patch builder with address keys, **no** `pickup_lat`/`dropoff_lat` on patch → **no** metrics recompute from this function alone.

**Address text change without new lat/lng in patch:** If the pickup/dropoff **text** differs from DB (`normalizeNotes` compare ~122–124) but `lastPickupResolved` has **no** lat/lng, the code still sets address strings and structured fields from `r`; **if** `r?.lat`/`r?.lng` are absent, **`patch.pickup_lat` is not set** (~132–135). Then `patch.pickup_lat` and `patch.dropoff_lat` may both be **undefined** → the condition at ~248 is **false** → **no** `fetchDrivingMetrics` call.

**Invoiced-trip guard:** **None** in `build-trip-details-patch.ts` — no check for invoice linkage or frozen billing before overwriting `driving_distance_km` (~256–258).

---

### 6. Proposed handler contract — validation

**Implementability:** The draft is **implementable** as a **server-only orchestrator** that:

1. Optionally geocodes each endpoint when structured/raw address is provided and coords absent.
2. Calls `resolveDrivingMetricsWithCache` with **canonical** coords (policy-defined).
3. Returns coords + metrics.

**Gaps / corrections:**

| Topic | Assessment |
|-------|------------|
| `SupabaseClient` vs service role | **Both are valid** depending on caller: **Route Handler** with `createClient()` + user session uses **RLS** for `route_metrics_cache` writes under that user’s tenant; **cron** and **backfill** use **service role** and bypass RLS. The handler should accept `SupabaseClient<Database>` and document that **callers must pass a client authorised to upsert** `route_metrics_cache` for `companyId`. |
| Two caches / two keys | **No second table required** if the handler **always** ends in `resolveDrivingMetricsWithCache`. Risk is **logical duplication**: if someone adds a **parallel** address-keyed store **without** migrating lookups off coord keys, you could have **two stored distances** for the same narrative route. Prefer **one write path** into `route_metrics_cache` with an **optional address-hash column** for lookup **or** deterministic coord normalisation before lookup. |
| `source: 'cache' \| 'google'` | With geocode inside the orchestrator, you may want **`geocode_origin` / `metrics_source`** or extend `source` to distinguish **“metrics from DB cache”** vs **“fresh Directions”** vs **“geocode cache”** — otherwise ops cannot debug quota. |
| Paths without Supabase in context | **`fetchDrivingMetrics` (client)** has **no** `SupabaseClient`; it relies on the API route to create one (`driving-metrics/route.ts` ~38–65). A consolidated **`POST /api/...`** could mirror that pattern so **browser paths** stay HTTP-based. **Duplicate/cron/backfill** already have Supabase. |

**Paths needing structural work to adopt “one function”:**

- **All `'use client'` flows** (manual create, bulk dialog, detail sheet, paired sync, linked return from client): today use **`fetchDrivingMetrics`**; they would switch to a **new authenticated API** that accepts addresses and/or coords — **not** a direct `resolveCanonicalRoute` import from `src/lib`.
- **`duplicate-trips.ts`:** Often **should not** re-geocode — contract needs **`mode: 'use_existing_coords' | 'resolve_from_address'`** or separate entry points.

---

### 7. Risk surface

**Browser-first paths (non-trivial):**

- `create-trip-form.tsx`, `bulk-upload-dialog.tsx`, `build-trip-details-patch.ts`, `paired-trip-sync.ts`, `create-linked-return.ts` — all use **`fetchDrivingMetrics`** → **`/api/trips/driving-metrics`**. Consolidation **must** remain behind **Route Handlers** (or server actions invoked from server-only code), not direct `src/lib` imports from clients.

**Cron / scripts:**

- `generate-recurring-trips/route.ts` uses **service role** Supabase + **`geocodeAddressLineToStructured`** — different string-level API than CSV **`geocodeStructuredAddressToLatLng`**. Unifying **will change** coords for some recurring trips vs historical rows unless you **freeze** “canonical” to one API and accept one-time drift.

**Existing stored coordinates:**

- **Duplication** copies coords verbatim — switching duplicate to re-geocode could **shift** endpoints vs source trip.
- **Detail-sheet save** overwrites distance when lat patch keys appear — could change **`driving_distance_km`** after invoicing (no guard — §5).

**Auth / abuse:**

- Any new endpoint that accepts **raw addresses** and calls Google must keep **`requireAdmin`** (or equivalent) like `driving-metrics/route.ts` ~33–36 — same billing/abuse model.

---

## Recommendation

**Implement consolidation, but not only as a single `resolveCanonicalRoute.ts` copy-pasted into eight call sites.**

1. **Define “canonical” explicitly:** Pick **one** geocoding strategy for “dispatcher typed structured address” scenarios (likely **`geocodeStructuredAddressToLatLng`** aligned with `/api/geocode-address`, **or** Places Place Details if you require POI-level precision — you cannot merge both without a priority rule).

2. **Layered API:** Add a **server Route Handler** (e.g. `POST /api/trips/canonical-route-metrics`) that accepts `{ companyId context via session }`, structured endpoints, optional `placeId`, optional **existing coords** to skip geocode, returns **`{ origin, dest, metrics, sources }`**. Internally: normalise → geocode if needed → **`resolveDrivingMetricsWithCache`**. Keep **`resolveDrivingMetricsWithCache`** as the **single** writer to `route_metrics_cache`.

3. **Optional migration:** Add **`route_address_hash`** (or pair of endpoint hashes) **plus** lookup **before** coord-key lookup to collapse “same normalised address, jittery coords” — **migration required**; backfill optional.

**Concrete alternative if the proposed single-function design is too blunt:** **Do not** force Places-based manual entry through Geocoding API; instead **stabilise coords at persistence** (e.g. store **Place `place_id`** and **geometry** from one Details call) and **key `route_metrics_cache` by `hash(place_id_origin, place_id_dest)`** when available, falling back to rounded coords — preserves POI accuracy while deduping metrics for recurring dialysis-style routes.
