# Security Audit A1 — API Route Authentication Coverage

Scope (read-only):
- All `src/app/api/**/route.ts` HTTP handlers
- `src/lib/api/require-admin.ts`
- `src/lib/api/require-session.ts`
- `src/proxy.ts`
- `docs/access-control.md`

## Executive summary

- **Protection coverage**: **14 / 17 handlers (82.4%)** have an explicit guard (admin/session/secret). **3 / 17 (17.6%)** are completely unguarded.
- **Highest risk routes (Critical)**: the **unguarded Google API proxy endpoints**:
  - `POST /api/places-autocomplete` (public proxy to Google Places Autocomplete) (`src/app/api/places-autocomplete/route.ts:3-43`)
  - `GET /api/place-details` (public proxy to Google Places Details + optional reverse-geocode) (`src/app/api/place-details/route.ts:56-135`)
  - `POST /api/geocode-address` (public proxy to Google Geocoding) (`src/app/api/geocode-address/route.ts:4-24`)
  These can be abused by unauthenticated external actors to burn **GCP quota**, generate billing costs, and potentially exfiltrate address lookups via server logs.
- **Tenant isolation on admin mutations**: for routes guarded by `requireAdmin()` that mutate state, **tenant ownership is explicitly checked** either directly in the route or in the called helper (see Q4).
- **CORS & rate limiting**: **no explicit CORS config** and **no rate limiting** were found in `src/` (see Q6–Q7). Browser-based cross-origin calls are therefore typically blocked by default CORS behavior, but server-to-server abuse (curl/bots) remains possible for unguarded endpoints.

## Q1 — Full route inventory (Route | Method | Guard | Notes)

| Route | Method | Guard | Notes |
| --- | --- | --- | --- |
| `/api/drivers/create` (`src/app/api/drivers/create/route.ts`) | `POST` (`:63`) | `requireAdmin()` (`:67-74`) | Uses service role to `auth.admin.createUser` (`:120-137`) and writes `accounts.company_id = auth.companyId` (`:151-162`). |
| `/api/cron/generate-recurring-trips` (`src/app/api/cron/generate-recurring-trips/route.ts`) | `GET` (`:8`) | **Secret**: `CRON_SECRET` via `Authorization: Bearer …` or `x-cron-secret` (`:10-21`) | Fails closed if `CRON_SECRET` unset (`:10-13`). Calls `generateRecurringTrips()` (`:36`). |
| `/api/trips/bulk-delete` (`src/app/api/trips/bulk-delete/route.ts`) | `POST` (`:17`) | `requireAdmin()` (`:19-22`) | Uses service role; explicitly verifies trip ownership by `company_id` before delete (`:56-75`). |
| `/api/geocode-address` (`src/app/api/geocode-address/route.ts`) | `POST` (`:4`) | **No guard** | Public geocoding proxy calling `geocodeStructuredAddressToLatLng()` (`:10-15`). |
| `/api/users/[id]/status` (`src/app/api/users/[id]/status/route.ts`) | `PATCH` (`:26`) | `requireAdmin()` (`:31-34`) | Explicit tenant guard: loads `accounts.company_id` and compares to `auth.companyId` (`:48-63`). Also blocks self-deactivate (`:41-46`). Uses admin client to update + ban/unban (`:76-107`). |
| `/api/users/[id]/credentials` (`src/app/api/users/[id]/credentials/route.ts`) | `PATCH` (`:27`) | `requireAdmin()` (`:32-35`) | Explicit tenant guard: loads `accounts.company_id` and compares (`:42-57`). Uses admin client to update Auth user and then sync cache `accounts.email` (`:105-132`). |
| `/api/place-details` (`src/app/api/place-details/route.ts`) | `GET` (`:56`) | **No guard** | Public Google Places `places.get` proxy (`:71-82`), may call Geocoding reverse lookup (`:107-111`). Sends server-held `GOOGLE_PLACES_API_KEY` (`:76-80`). |
| `/api/places-autocomplete` (`src/app/api/places-autocomplete/route.ts`) | `POST` (`:3`) | **No guard** | Public Google Places autocomplete proxy (`:7-40`) sending `GOOGLE_PLACES_API_KEY` (`:11-14`). |
| `/api/trips/export` (`src/app/api/trips/export/route.ts`) | `POST` (`:342`) | `requireAdmin()` (`:344-348`) | Exports PII to CSV; uses service role; filters by `company_id = auth.companyId` (`:403-416`). |
| `/api/trips/duplicate` (`src/app/api/trips/duplicate/route.ts`) | `POST` (`:25`) | `requireAdmin()` (`:27-31`) | Uses service role. Tenant check enforced inside `fetchTripsExpandedForDuplicate(..., companyId, ...)` (`src/features/trips/lib/duplicate-trips.ts:91-119`) and missing IDs error if not owned (`:440-448`). |
| `/api/users` (`src/app/api/users/route.ts`) | `GET` (`:19`) | `requireAdmin()` (`:20-23`) | Company-scoped via `.eq('company_id', auth.companyId)` (`:33-39`) or via `getRoster({ companyId: auth.companyId })` (`:56-67`). |
| `/api/fleet/routes` (`src/app/api/fleet/routes/route.ts`) | `POST` (`:33`) | `requireAdmin()` (`:35-38`) | No DB mutation; calls Google Directions via `getRoutePolyline()` (`:62-67`). |
| `/api/trips/metrics` (`src/app/api/trips/metrics/route.ts`) | `GET` (`:7`) | `requireSession()` (`:9-13`) | Reads from `trips` with session supabase; relies on RLS (no explicit company filter) (`:15-36`). Returns full trip rows for shortest/longest (`:52-56`). |
| `/api/drivers/[id]` (`src/app/api/drivers/[id]/route.ts`) | `PATCH` (`:30`) | `requireAdmin()` (`:35-38`) | Explicit tenant guard before SECURITY DEFINER RPC `update_driver` (`:50-66`), then executes RPC (`:70-85`). |
| `/api/trips/groups/metrics` (`src/app/api/trips/groups/metrics/route.ts`) | `GET` (`:7`) | `requireSession()` (`:9-13`) | Reads `trips` group distances with session supabase; relies on RLS (no explicit company filter) (`:15-20`). |
| `/api/trips/export/preview` (`src/app/api/trips/export/preview/route.ts`) | `GET` (`:23`) | `requireAdmin()` (`:25-29`) | Uses service role; filters by `company_id = auth.companyId` (`:77-90`, `:111-117`). Returns `sampleTrips` (PII) (`:135-138`). |
| `/api/trips/driving-metrics` (`src/app/api/trips/driving-metrics/route.ts`) | `POST` (`:31`) | `requireAdmin()` (`:33-37`) | Not a public Directions proxy; passes `auth.companyId` into cache-scoped resolver (`:59-66`), uses session supabase client for cache (`:38-66`). |

## Q2 — Unprotected routes (data/service usage + abuse scenario)

### `POST /api/geocode-address` — unguarded

- **What it reads/mutates**: No DB reads/writes. It accepts structured address fields and returns coordinates. (`src/app/api/geocode-address/route.ts:6-24`)
- **External API/service called**: Google Geocoding API via `geocodeStructuredAddressToLatLng` (`src/app/api/geocode-address/route.ts:10-15`), which calls `https://maps.googleapis.com/maps/api/geocode/json` with `GOOGLE_MAPS_API_KEY` (`src/lib/google-geocoding.ts:1-2`, `:150-185`).
- **Realistic abuse scenario**:
  - Unauthenticated attacker scripts high-volume requests to burn **Geocoding API quota/billing** (no auth, no rate limiting).
  - Indirect data exposure: attacker can use your server as a proxy to conceal their origin while geocoding arbitrary addresses; responses are returned verbatim-ish (`:24`), and server logs may capture errors (`:26-29`).

### `POST /api/places-autocomplete` — unguarded

- **What it reads/mutates**: No DB reads/writes. It returns raw Google Places autocomplete response. (`src/app/api/places-autocomplete/route.ts:3-43`)
- **External API/service called**: `https://places.googleapis.com/v1/places:autocomplete` with server-side `GOOGLE_PLACES_API_KEY` header (`:7-14`).
- **Realistic abuse scenario**:
  - Public endpoint becomes a **free autocomplete proxy**: attacker can issue arbitrary queries and burn your Places API quota/costs.
  - Because it forwards raw response (`:42-43`), it can be used for large response amplification and to probe your key’s enabled APIs.

### `GET /api/place-details` — unguarded

- **What it reads/mutates**: No DB reads/writes. Returns lat/lng and structured address fields derived from a Place ID (`src/app/api/place-details/route.ts:56-135`).
- **External API/service called**:
  - Google Places API `places.get` (`:71-92`) with `GOOGLE_PLACES_API_KEY` (`:76-80`)
  - Optional Geocoding reverse lookup via `reverseGeocodeLatLngToPostalCode()` when postal code incomplete (`:100-111` → `src/lib/google-geocoding.ts:256-307`)
- **Realistic abuse scenario**:
  - High-volume place-details calls can be expensive; attacker can burn both **Places** and **Geocoding** quotas.
  - Lets attacker resolve Place IDs to lat/lng via your infrastructure, again hiding their origin and consuming your billable resources.

## Q3 — Partial guards (routes using `requireSession()` that should use `requireAdmin()`?)

Two routes use `requireSession()`:
- `GET /api/trips/metrics` (`src/app/api/trips/metrics/route.ts:9-13`)
- `GET /api/trips/groups/metrics` (`src/app/api/trips/groups/metrics/route.ts:9-13`)

Findings:
- **They do not apply an explicit tenant/company filter**, instead relying on Supabase RLS to scope results (`src/app/api/trips/metrics/route.ts:15-36`, `src/app/api/trips/groups/metrics/route.ts:15-20`).
- **Risk** depends on RLS correctness for `trips`:
  - If a **driver** is allowed to `SELECT` only their own trips, these endpoints will only reflect their own data.
  - If an RLS bug/regression ever grants broader `SELECT`, these endpoints would immediately become a company-wide data leak because they return full trip rows for shortest/longest (`src/app/api/trips/metrics/route.ts:15-30`, `:52-56`).

Recommendation (audit classification):
- **Medium**: consider switching these endpoints to `requireAdmin()` if they are only used by `/dashboard/*` analytics, or (at minimum) change to explicit company scoping queries to reduce blast radius of any future RLS misconfiguration.

## Q4 — Tenant isolation on mutations (requireAdmin + POST/PATCH/DELETE)

Mutation routes guarded by `requireAdmin()`:

- `POST /api/drivers/create`:
  - **Tenant isolation**: does not accept `company_id` from the client; it uses `auth.companyId` (`src/app/api/drivers/create/route.ts:75-76`) and inserts `accounts.company_id = companyId` (`:151-162`).
  - **Ownership check needed?** Not applicable (creates a new user in caller’s tenant).

- `PATCH /api/drivers/[id]`:
  - **Explicit tenant ownership check** before SECURITY DEFINER RPC: loads `accounts.company_id` and compares to `auth.companyId` (`src/app/api/drivers/[id]/route.ts:50-66`), then calls `rpc('update_driver', { p_driver_id: id, ... })` (`:70-85`).

- `PATCH /api/users/[id]/status`:
  - **Explicit tenant ownership check**: loads `accounts.company_id` and compares (`src/app/api/users/[id]/status/route.ts:48-63`), then updates using admin client (`:76-85`) and updates Auth ban (`:92-107`).

- `PATCH /api/users/[id]/credentials`:
  - **Explicit tenant ownership check**: loads `accounts.company_id` and compares (`src/app/api/users/[id]/credentials/route.ts:42-57`), then updates Auth and syncs cached email (`:105-132`).

- `POST /api/trips/bulk-delete`:
  - **Explicit tenant ownership check**: on service role client, selects requested trips filtered by `company_id = auth.companyId` (`src/app/api/trips/bulk-delete/route.ts:56-61`) and rejects if any ID not owned (`:66-75`) before calling hard delete (`:77-79`).

- `POST /api/trips/duplicate`:
  - **Explicit tenant ownership check** is enforced by the helper, not directly in the route:
    - Loader filters by `.eq('company_id', companyId)` (`src/features/trips/lib/duplicate-trips.ts:100-106`)
    - It throws if any requested ID wasn’t loaded (non-existent or not owned) (`src/features/trips/lib/duplicate-trips.ts:440-448`)
  - Route passes `companyId` from `requireAdmin()` into the helper (`src/app/api/trips/duplicate/route.ts:55-60`, `:107-113`).

Conclusion:
- **No requireAdmin mutation route was found that blindly trusts client-supplied IDs without any tenant ownership verification** (either in the handler or in the immediate helper it calls).

## Q5 — `src/proxy.ts` API coverage (beyond cookie refresh) + external origin reachability

### Does `src/proxy.ts` run logic for `/api/*` beyond cookie refresh?

- `proxy()` always creates a Supabase SSR client that can refresh cookies (`src/proxy.ts:18-39`) and calls `supabase.auth.getUser()` (`:41-44`).
- Role-based redirects only apply to `/dashboard/*`, `/driver/*`, `/auth/*` (`src/proxy.ts:46-49`, `:63-87`).
- For `/api/*`, none of those route-prefix checks apply, so the proxy effectively returns `NextResponse.next()` (cookie refresh only) (`src/proxy.ts:89-90`).
- The middleware matcher explicitly includes `/api` paths (`src/proxy.ts:92-97`), but **does not enforce API auth**; it just runs the proxy logic on those requests.

### Could any route be reached via `fetch()` from an external origin without cookies being sent?

- Browser cross-origin `fetch()` **does not send cookies by default** unless `credentials: 'include'` is set.
- Even without cookies, **unguarded routes** are directly callable by any external actor (browser or non-browser):
  - `POST /api/geocode-address` (`src/app/api/geocode-address/route.ts:4`)
  - `POST /api/places-autocomplete` (`src/app/api/places-autocomplete/route.ts:3`)
  - `GET /api/place-details` (`src/app/api/place-details/route.ts:56`)
- Guarded routes that depend on Supabase session cookies will generally return 401 via `requireAdmin()` / `requireSession()` when cookies are absent (`src/lib/api/require-admin.ts:23-27`, `src/lib/api/require-session.ts:23-27`).

## Q6 — CORS configuration

- **No explicit CORS headers** (e.g. `Access-Control-Allow-Origin`) were found in `src/` (`Grep` for “CORS” / `Access-Control-Allow-Origin` returned no matches).
- There is **no `src/middleware.ts`** file (only `src/proxy.ts` is present in this repo; `src/middleware.ts` read attempt returned not found).

Implications:
- For browser clients on other origins, **preflighted requests** (e.g. `Content-Type: application/json` POST) will typically fail because the API does not emit CORS allow headers.
- For non-browser clients (curl, botnets, backend services), CORS is irrelevant; they can call endpoints regardless.

## Q7 — Rate limiting

- **No API rate limiting mechanism** was found in `src/` (no matches for common patterns like “ratelimit”, “upstash”, “throttle” for API handlers; only UI-level throttling references were found in client hooks).

Most exposed routes without rate limiting:
- **Critical**: all **unguarded** Google proxy endpoints (Q2).
- **High** (if abused by authenticated users or compromised accounts):
  - `POST /api/fleet/routes` (can fan out up to 20 Directions calls per request via `Promise.all`) (`src/app/api/fleet/routes/route.ts:17-31`, `:60-76`)
  - `POST /api/trips/driving-metrics` (Directions/DB cache usage) (`src/app/api/trips/driving-metrics/route.ts:59-66`)
  - `POST /api/trips/export` + `GET /api/trips/export/preview` (heavy DB reads + PII responses) (`src/app/api/trips/export/route.ts:403-465`, `src/app/api/trips/export/preview/route.ts:70-138`)

## Risk-ranked remediation list

### Critical
- **`src/app/api/places-autocomplete/route.ts`**: add `requireAdmin()` (or at least `requireSession()`) to prevent public key/quota abuse; optionally add request validation + rate limiting. (`:3-40`)
- **`src/app/api/place-details/route.ts`**: add `requireAdmin()`/`requireSession()`; this is currently a public Places+Geocoding proxy. (`:56-111`)
- **`src/app/api/geocode-address/route.ts`**: add `requireAdmin()`/`requireSession()`; currently a public Geocoding proxy. (`:4-15`)

### High
- **Add rate limiting** to the Google-cost-bearing endpoints (even when authenticated): `/api/fleet/routes`, `/api/trips/driving-metrics`, and the three address/places endpoints. (See Q7 route references.)

### Medium
- **Reassess `requireSession()` usage for trip metrics** endpoints. If they’re dashboard-only, upgrade to `requireAdmin()`; if drivers legitimately need them, add explicit scoping (e.g. company/driver) to reduce RLS-regression blast radius. (`src/app/api/trips/metrics/route.ts:15-30`, `src/app/api/trips/groups/metrics/route.ts:15-20`)

### Low
- **Proxy/middleware clarity**: document that `src/proxy.ts` matches `/api/*` but does not enforce API auth; API handlers must guard themselves. (`src/proxy.ts:92-97`, `docs/access-control.md:11-17`, `:31-50`)

