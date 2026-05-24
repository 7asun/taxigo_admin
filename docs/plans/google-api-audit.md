# Google API key usage + Routes API feasibility audit

**Date:** 2026-05-20  
**Scope:** Read-only inventory of Google API env vars, proxy routes, lib helpers, client call sites, and fleet-map routing context. No code changes.

---

## Files reviewed

| Path | Status |
| --- | --- |
| `src/app/api/places-autocomplete/route.ts` | Exists |
| `src/app/api/place-details/route.ts` | Exists |
| `src/app/api/geocode-address/route.ts` | Exists (not `geocode/route.ts`) |
| `src/app/api/directions/route.ts` | **Does not exist** |
| `src/app/api/routes/route.ts` | **Does not exist** |
| `src/app/api/trips/driving-metrics/route.ts` | Exists — Directions proxy |
| `src/lib/google/` | **Does not exist** |
| `src/lib/google-geocoding.ts` | Geocoding API wrapper |
| `src/lib/google-directions.ts` | Directions API wrapper + DB cache |
| `env.example.txt` | Present — **no Google keys documented** |
| `.env.local.example` | **Not present** |
| `docs/address-autocomplete.md` | Documents both Google env vars |
| `AGENTS.md` | Documents `GOOGLE_MAPS_API_KEY` only |

---

## 1. Key separation

### Two env var names in code

| Variable | Used in | Google product / endpoint |
| --- | --- | --- |
| `GOOGLE_PLACES_API_KEY` | `POST /api/places-autocomplete`, `GET /api/place-details` | **Places API (New)** — `places:autocomplete`, `places.get` |
| `GOOGLE_MAPS_API_KEY` | `src/lib/google-geocoding.ts`, `src/lib/google-directions.ts`, indirectly `place-details` (PLZ fallback), `POST /api/geocode-address`, cron, server actions | **Geocoding API** (legacy JSON), **Directions API** (legacy JSON) |

### `GOOGLE_PLACES_API_KEY` → features

- **`POST /api/places-autocomplete`** — Autocomplete suggestions while typing (`AddressAutocomplete` in trip forms + fleet map search).
- **`GET /api/place-details?placeId=…`** — Resolves selected place to `lat`, `lng`, structured address fields after user picks a suggestion.

Both routes pass the key as header `X-Goog-Api-Key` to `https://places.googleapis.com/v1/…`.

### `GOOGLE_MAPS_API_KEY` → features

- **Geocoding API** (`https://maps.googleapis.com/maps/api/geocode/json`):
  - `geocodeStructuredAddressToLatLng` → `POST /api/geocode-address`
  - `geocodeAddressLineToStructured` → recurring-rules server actions, cron `generate-recurring-trips`
  - `reverseGeocodeLatLngToPostalCode` → called from `place-details` when German PLZ is incomplete
- **Directions API** (`https://maps.googleapis.com/maps/api/directions/json`):
  - `getDrivingMetrics` / `resolveDrivingMetricsWithCache` → `POST /api/trips/driving-metrics`, trip duplication fallback, cron materialisation

Key passed as query param `key=` on legacy Maps endpoints.

### Same value or genuinely separate?

**Code treats them as two independent env vars.** There is no fallback (e.g. Places route does not read `GOOGLE_MAPS_API_KEY` if Places key is missing).

**Documentation intent:**

- `docs/address-autocomplete.md` lists them as **separate rows** in the env table.
- `docs/driving-metrics-api.md` states Geocoding and Directions share **`GOOGLE_MAPS_API_KEY`** on “the same key” / GCP project.
- `AGENTS.md` only shows `GOOGLE_MAPS_API_KEY=…` in the env snippet; Places key is documented in `address-autocomplete.md` only.

**Repo env templates:** `env.example.txt` omits both Google variables. Whether deployment uses one GCP API key for all enabled APIs or two restricted keys is **environment-specific** — not enforced or detectable from source alone.

**Practical setup (documented):**

- Places key: enable **Places API (New)**.
- Maps key: enable **Geocoding API** + **Directions API** (same key can cover both legacy APIs).

---

## 2. Existing proxy pattern

### Architecture layers

```
Client ('use client')
  └─ fetch('/api/…')  OR  fetchDrivingMetrics()
       └─ Route Handler (some auth, validation)
            └─ lib helper (google-geocoding.ts | google-directions.ts)
                 └─ fetch(Google URL)
```

**No shared `src/lib/google/` folder.** Two flat server-only modules at `src/lib/`:

| Module | Role |
| --- | --- |
| `google-geocoding.ts` | Geocoding forward + reverse; returns typed objects or `null` |
| `google-directions.ts` | Directions call + `route_metrics_cache` lookup/write-back |

### Route handler styles

| Route | Google call location | Base URL / API version |
| --- | --- | --- |
| `places-autocomplete` | **Direct `fetch` in handler** | `https://places.googleapis.com/v1/places:autocomplete` |
| `place-details` | **Direct `fetch` in handler** + `reverseGeocodeLatLngToPostalCode` | `https://places.googleapis.com/v1/places/{id}` |
| `geocode-address` | **Lib** `geocodeStructuredAddressToLatLng` | Legacy Geocoding JSON |
| `trips/driving-metrics` | **Lib** `resolveDrivingMetricsWithCache` | Legacy Directions JSON |

Places routes use **Places API (New)** with field masks and `X-Goog-Api-Key`. Maps lib uses **legacy REST** (`/maps/api/.../json?key=`).

### Server-only direct lib imports (no HTTP proxy)

| Caller | Lib function |
| --- | --- |
| `recurring-rules.actions.ts` | `geocodeRuleAddresses` → `geocodeAddressLineToStructured` |
| `cron/generate-recurring-trips/route.ts` | `geocodeAddressLineToStructured`, `resolveDrivingMetricsWithCache` |
| `duplicate-trips.ts` | `resolveDrivingMetricsWithCache` |

---

## 3. Routes API availability

### Existing route/directions proxies

| Endpoint | Exists? | Purpose |
| --- | --- | --- |
| `/api/directions` | **No** | — |
| `/api/routes` | **No** | — |
| `/api/trips/driving-metrics` | **Yes** | Single origin→destination driving metrics |

### `POST /api/trips/driving-metrics`

**Auth:** `requireAdmin()` + Supabase session with `company_id` (not a public Directions proxy).

**Request body (Zod):**

```json
{
  "originLat": number,
  "originLng": number,
  "destLat": number,
  "destLng": number
}
```

**Response:**

```json
{ "metrics": { "distanceKm": number, "durationSeconds": number, "source": "cache" | "google" } | null }
```

**Google API used:** Legacy **Directions API** (`mode=driving`, `units=metric`). Returns distance and duration only — **no polyline / route geometry** is parsed or returned.

**Caching:** `route_metrics_cache` table keyed on company + rounded coordinates (`COORD_PRECISION = 5`).

### Google Routes API (New)

**Not implemented anywhere.** No references to `routes.googleapis.com`, `computeRoutes`, or Route Matrix endpoints in `src/`.

Internal plan note (`.cursor/plans/driving_metrics_v2_cab9692c.plan.md`) explicitly deferred Routes API unless Directions limits or deprecation force migration.

### Feasibility for fleet “route per online driver”

| Aspect | Current state |
| --- | --- |
| Draw route on map | **Not supported** — no polyline in Directions wrapper |
| N drivers → 1 destination | Would require **N calls** to `/api/trips/driving-metrics` (or new batch endpoint) |
| Batch / matrix | **Not available** — would need Routes API **Compute Route Matrix** or parallel Directions calls |
| Quota / cost | Each uncached pair = 1 Directions billable request; cache helps repeated O/D pairs only |
| Auth pattern to reuse | `requireAdmin()` + company-scoped cache already established for driving-metrics |

---

## 4. Error handling pattern

| Route / layer | Google HTTP error | Google logical error (`status !== OK`) | Missing API key | Handler catch |
| --- | --- | --- | --- | --- |
| `places-autocomplete` | **Not checked** — raw JSON returned with HTTP 200 | Forwarded in body to client | Non-null assertion `!` — likely failed Google request in body | `{ error: 'Internal Server Error' }` **500** |
| `place-details` | **Forwarded** — `NextResponse.json(..., { status: response.status })` | Same (Places error in body) | Same as HTTP failure from Google | `{ error: 'Internal Server Error' }` **500** |
| `geocode-address` | Lib logs, returns `null` → **400** `{ error: 'Unable to geocode address' }` | Lib returns `null` → **400** | Lib logs, returns `null` → **400** | **500** with `error.message` |
| `trips/driving-metrics` | Lib returns `null` → `{ metrics: null }` **200** | Lib returns `null` → `{ metrics: null }` **200** | Lib logs, returns `null` | **500** `{ error: message }` |
| `google-geocoding.ts` | Log + `null` | Log + `null` | Log + `null` | try/catch → `null` |
| `google-directions.ts` | Log + `null` | Log + `null` (`status !== 'OK'`) | Log + `null` | try/catch → `null`; 15s timeout |

**Summary:** Places autocomplete is the outlier (no `response.ok` check, always 200 on success path). Place-details forwards upstream status. Geocoding/Directions libs fail silently with `null`; route handlers translate to 400/200-null/500 depending on endpoint.

**Auth gaps:** `places-autocomplete`, `place-details`, and `geocode-address` have **no** `requireAdmin()` — any caller who can hit the Next.js app can trigger Google quota usage (session may still be required by middleware for dashboard pages, but API routes themselves are unauthenticated).

---

## 5. Client-side usage

### Direct `fetch` to Google proxy routes (no shared service)

| Client module | Routes called |
| --- | --- |
| `trip-address-passenger/address-autocomplete.tsx` | `POST /api/places-autocomplete`, `GET /api/place-details` |
| `create-trip/create-trip-form.tsx` | `POST /api/geocode-address`, `fetchDrivingMetrics` |
| `bulk-upload-dialog.tsx` | `POST /api/geocode-address` (×2 per row), `fetchDrivingMetrics` |
| `bulk-upload/resolve-clients-step.tsx` | `POST /api/geocode-address` |
| `fleet/components/fleet-page-content.tsx` | Uses `AddressAutocomplete` → same Places routes |

### Shared fetch helper (Directions only)

**`src/features/trips/lib/fetch-driving-metrics.ts`** — wraps `POST /api/trips/driving-metrics`.

**Consumers:**

- `create-trip-form.tsx`
- `bulk-upload-dialog.tsx`
- `trip-detail-sheet/lib/build-trip-details-patch.ts`
- `trip-detail-sheet/lib/paired-trip-sync.ts`
- `create-linked-return.ts`

**No shared helper** for Places or Geocoding — each feature uses inline `fetch` or goes through `AddressAutocomplete`.

### Type sharing

`fetch-driving-metrics.ts` imports **types only** from `@/lib/google-directions` (`DrivingMetrics`). It does not call Google from the browser.

---

## 6. Fleet map context (routing feature)

### Online driver set

- **Source:** `useFleetMap()` → `drivers.filter(d => d.is_online)`
- **Online definition:** `updated_at` within `TRACKING_OFFLINE_AFTER_MS` (**60 seconds**) — see `src/lib/tracking/constants.ts`
- **No upper bound in code:** All company rows in `live_locations` are loaded; online count is derived at runtime

### `TRACKING_MAX_DRIVERS` or similar

**Does not exist.** Related constants in `src/lib/tracking/constants.ts`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `TRACKING_OFFLINE_AFTER_MS` | 60_000 | Offline threshold for fleet UI |
| `TRACKING_UPDATE_INTERVAL_MS` | 5_000 | Driver GPS upsert throttle |
| `TRACKING_MAX_AGE_MS` | 5_000 | `watchPosition` maximumAge option |

None cap fleet size or concurrent online drivers.

### Realistic simultaneous online count

**Not configured or documented in code.** Implications:

- Schema: one `live_locations` row per driver (PK `driver_id`); company-scoped via RLS
- Product context: single-company Krankentransport / dispatch admin tool — typically **small fleet** (often single-digit to low tens of drivers)
- Fleet UI already renders **one badge per online driver** with no pagination
- A routing feature requesting **one Directions/Routes call per online driver** scales with active shift count, not total registered drivers

**Worst case for quota planning:** all drivers with an active/on_break shift simultaneously (~ company driver headcount), not a hardcoded constant.

---

## 7. `src/` references to Google env vars

| File | Variable |
| --- | --- |
| `src/app/api/places-autocomplete/route.ts` | `GOOGLE_PLACES_API_KEY` |
| `src/app/api/place-details/route.ts` | `GOOGLE_PLACES_API_KEY` (+ comment re `GOOGLE_MAPS_API_KEY` for PLZ fallback) |
| `src/lib/google-geocoding.ts` | `GOOGLE_MAPS_API_KEY` (×3 functions) |
| `src/lib/google-directions.ts` | `GOOGLE_MAPS_API_KEY` |
| `src/app/api/trips/driving-metrics/route.ts` | Comment only |
| `src/lib/geocode-rule-addresses.ts` | Comment only |

---

## 8. Routes API feasibility summary

| Need | Legacy Directions (current) | Routes API (not in repo) |
| --- | --- | --- |
| Distance + duration for trips DB | ✅ Implemented + cached | Possible via `computeRoutes` |
| Polyline on fleet map | ❌ Not returned | ✅ Route polyline available |
| N drivers → 1 destination | N sequential/parallel HTTP calls to existing proxy | **Route Matrix** batching possible |
| Key | `GOOGLE_MAPS_API_KEY` | Would likely reuse same key; enable Routes API on GCP |
| Auth / proxy pattern | Reuse `requireAdmin` + company scope | New route recommended (e.g. `/api/fleet/routes` or extend driving-metrics) |

**Recommendation for fleet routing (informational only):**

1. **Short term:** Extend `google-directions.ts` or add sibling module to request and return **encoded polyline** from existing Directions API (minimal GCP change if polyline-only).
2. **Medium term:** Add Routes API proxy if matrix batching or future Directions deprecation matters; follow existing `fetchDrivingMetrics` + `requireAdmin` pattern.
3. **Reuse:** `route_metrics_cache` helps repeated O/D pairs but does **not** help “same destination, many driver origins” unless each driver-origin → dest pair is stored separately.

---

## 9. Gaps / risks (audit notes)

1. **`env.example.txt`** does not list `GOOGLE_PLACES_API_KEY` or `GOOGLE_MAPS_API_KEY` — onboarding relies on `docs/address-autocomplete.md` / `AGENTS.md`.
2. **Places routes unauthenticated** — quota abuse risk if routes are reachable without admin session.
3. **`places-autocomplete`** does not check `response.ok` before returning Google error payloads as 200.
4. **No polyline path** — fleet map routing UI would need new API surface regardless of Directions vs Routes choice.
5. **No `TRACKING_MAX_DRIVERS`** — routing batch size must be driven by live `onlineDrivers.length` at query time.
