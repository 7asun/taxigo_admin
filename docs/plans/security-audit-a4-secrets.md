# Security Audit A4 — Service Role Usage & Secret Handling

Scope (read-only):

- `src/lib/supabase/admin.ts`
- `src/lib/supabase/service-factory.ts`
- Every `src/` import of `createAdminClient` or inline service-role `createClient`
- `env.example.txt`
- `next.config.ts`
- All `src/app/api/**/route.ts` (admin-client and error-response patterns)
- `docs/access-control.md` — service role section

**Note:** The codebase exports `createService` from `service-factory.ts` (not `createServiceFactory`). It is unused anywhere in `src/` and uses the **browser anon** client — not the service role.

---

## Executive summary

- **Service role containment:** `SUPABASE_SERVICE_ROLE_KEY` is **never** prefixed `NEXT_PUBLIC_`. All runtime usages in `src/` are in API route handlers, `'use server'` modules, or server-only libs (`src/lib/recurring-trip-generator.ts`). **No Client Component imports `createAdminClient()` directly.** Next.js will not inline non-`NEXT_PUBLIC_` env vars into client bundles, so the key itself is **not shipped to browsers** via the normal build path.
- **Convention breach (medium):** `src/features/driver-management/api/get-roster.ts` imports `createAdminClient` despite `docs/access-control.md` restricting imports to `src/app/api/**` or `scripts/**`. The file is `'use server'` and callers enforce `requireAdmin()` — functionally safe, architecturally risky.
- **Latent hazard (medium):** `src/features/trips/components/pending-assignments/debug-queries.ts` references `SUPABASE_SERVICE_ROLE_KEY` under `components/`. It is **not imported** anywhere today, but its location makes accidental client bundling more likely than a `scripts/` file.
- **No `NEXT_PUBLIC_` secrets:** Every `NEXT_PUBLIC_*` variable in `src/` is intentionally public (Supabase URL/anon key, Sentry DSN, business timezone). **Zero critical `NEXT_PUBLIC_` secret findings.**
- **Google API keys:** `GOOGLE_MAPS_API_KEY` and `GOOGLE_PLACES_API_KEY` are **server-only** (no `NEXT_PUBLIC_`). Client components call `/api/*` proxies, not Google directly. **However**, three Google proxy routes remain **unguarded** (see [A1](security-audit-a1-api-routes.md)), enabling quota/billing abuse with server-held keys.
- **Error leakage (medium):** Several routes return raw Supabase `error.message`, Google API payloads, or Supabase Auth `details` — useful for debugging, informative for attackers probing schema/constraints.
- **Env documentation gaps:** `env.example.txt` omits `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, and `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE` used in `src/`.
- **Build-time exposure:** `next.config.ts` does **not** use `env:` or `publicRuntimeConfig` to inject secrets. Sentry plugin reads `NEXT_PUBLIC_SENTRY_ORG` / `NEXT_PUBLIC_SENTRY_PROJECT` at build time only (non-secret identifiers).

---

## Q1 — Service role import map

### `createAdminClient()` via `@/lib/supabase/admin`

| File | Lines | Operation | Guard before call |
| --- | --- | --- | --- |
| `src/lib/supabase/admin.ts` | 13–23 | Factory: `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` | N/A (definition) |
| `src/app/api/users/[id]/status/route.ts` | 76–101 | `accounts.update(is_active)`; `auth.admin.updateUserById` ban/unban | `requireAdmin()` (`:31-34`); tenant guard on target `accounts.company_id` (`:48-63`); blocks self-deactivate (`:41-46`) |
| `src/app/api/users/[id]/credentials/route.ts` | 105–122 | `auth.admin.updateUserById` (email/password); sync `accounts.email` | `requireAdmin()` (`:32-35`); tenant guard (`:42-57`) |
| `src/features/driver-management/api/get-roster.ts` | 67–72 | `auth.admin.getUserById` per roster row (live email merge) | **No guard inside function.** Callers: `requireAdmin()` in `GET /api/users` (`src/app/api/users/route.ts:20-23`) and `DriverTableListing` RSC (`driver-table-listing.tsx:16-19`) |
| `src/features/driver-management/api/get-roster.ts` | 168–170 | `auth.admin.getUserById` for single driver panel | `loadDriverForPanel` calls `requireAdmin()` first (`:183-186`) |
| `src/lib/recurring-trip-generator.ts` | 81 | Default Supabase client for full cron/on-demand materialisation (reads/writes `recurring_rules`, `trips`, cache, etc.) | **Inside generator — no auth.** Callers: cron `CRON_SECRET` (`cron/generate-recurring-trips/route.ts:10-21`); `triggerGenerationForRule` → `requireAdminContext()` + `assertRuleBelongsToCompany` (`recurring-rules.actions.ts:130-131`) |

### Inline service-role `createClient(url, SUPABASE_SERVICE_ROLE_KEY)`

Several API routes alias `createClient as createAdminClient` from `@supabase/supabase-js` instead of using the shared factory:

| File | Lines | Operation | Guard before call |
| --- | --- | --- | --- |
| `src/app/api/drivers/create/route.ts` | 120–218 | `auth.admin.createUser`; `accounts.insert`; `driver_profiles.insert`; rollback `auth.admin.deleteUser` | `requireAdmin()` (`:67-74`); writes scoped to `auth.companyId` (`:160`) |
| `src/app/api/trips/bulk-delete/route.ts` | 54–77 | Verify trip ownership; `hardDeleteTripsByIds` | `requireAdmin()` (`:19-22`); ownership check `.eq('company_id', companyId)` (`:56-75`) |
| `src/app/api/trips/duplicate/route.ts` | 49–119 | `fetchTripsExpandedForDuplicate` + `executeDuplicateTrips` inserts | `requireAdmin()` (`:27-31`); company filter in fetch (`duplicate-trips.ts:100-104`, `:440-447`) |
| `src/app/api/trips/export/route.ts` | 396–470 | Bulk `trips` SELECT with joins; CSV generation (PII) | `requireAdmin()` (`:344-348`); `.eq('company_id', companyId)` (`:413`) |
| `src/app/api/trips/export/preview/route.ts` | 70–138 | Preview count + sample trips | `requireAdmin()` (`:25-29`); `.eq('company_id', companyId)` (`:87`) |

### Indirect admin usage (no direct import in caller)

| File | Lines | Operation | Guard before call |
| --- | --- | --- | --- |
| `src/app/api/cron/generate-recurring-trips/route.ts` | 36 | `generateRecurringTrips()` → internal `createAdminClient()` | `CRON_SECRET` bearer / `x-cron-secret` (`:10-21`); fails closed if unset (`:11-13`) |
| `src/features/trips/api/recurring-rules.actions.ts` | 133 | `generateRecurringTrips({ ruleId })` | `requireAdminContext()` + `assertRuleBelongsToCompany` (`:130-131`) |

### Ad-hoc service role (not via `admin.ts`)

| File | Lines | Operation | Guard before call |
| --- | --- | --- | --- |
| `src/features/trips/components/pending-assignments/debug-queries.ts` | 3–6 | Top-level `createClient(url, SERVICE_ROLE_KEY)`; debug SELECT on `trips` | **None** — standalone script; **not imported** by any `src/` file |

### `service-factory.ts`

| File | Lines | Operation | Guard |
| --- | --- | --- | --- |
| `src/lib/supabase/service-factory.ts` | 15–73 | `createService(table)` — CRUD via **browser** `createClient()` (anon key) | **Unused** in `src/` — no runtime exposure |

### Scripts (out of `src/` scope, for completeness)

`scripts/backfill-*.ts`, `scripts/duplicate-trips-dev-cli.ts` read `SUPABASE_SERVICE_ROLE_KEY` directly. Expected for local/CI maintenance; not bundled by Next.js.

---

## Q2 — Server-only enforcement

| File | Runtime context | Marker / path | `SUPABASE_SERVICE_ROLE_KEY` exposure risk |
| --- | --- | --- | --- |
| `src/lib/supabase/admin.ts` | Server module | Not in `app/` but only imported server-side | **Low** — key read at call time on server |
| API routes (8 files above) | Route Handler | `src/app/api/**/route.ts` — never client-bundled | **None** |
| `src/lib/recurring-trip-generator.ts` | Server lib | Comment: "Never import from client components" (`:1-4`). Imported by cron route + `'use server'` actions only | **Low** — constant `RECURRING_TRIP_GENERATION_HORIZON_DAYS` imported by `recurring-rule-submit-flow.ts` (used from client sheets); bundler should tree-shake `createAdminClient`, but coupling is a smell |
| `src/features/driver-management/api/get-roster.ts` | Server Actions module | `'use server'` (`:1`) | **Low** — not client-bundled; violates import-location policy in `access-control.md` |
| `debug-queries.ts` | Standalone script in `components/` | No `'use server'`; not imported | **Medium (latent)** — if ever imported from a Client Component, Next would still omit the key value in client JS, but the **call pattern** would fail or encourage misuse |

### Client-bundle cross-contamination checks

| Concern | Finding |
| --- | --- |
| Client Component → `createAdminClient` | **Not found** |
| Client Component → `duplicate-trips.ts` | **Yes** — `duplicate-trips-dialog.tsx` (`'use client'`, `:1`) imports `pickOutboundAndReturn`, `tryGetOutboundReturnPairFromTrips` (`:33-36`). Module also imports `resolveDrivingMetricsWithCache` from `google-directions.ts` (`duplicate-trips.ts:33`). Bundler likely tree-shakes server-only exports, but **server-only Google/Supabase code shares a module with client UI helpers** — refactor risk |
| Client → Google APIs directly | **No** — `address-autocomplete.tsx`, `fetch-driving-metrics.ts`, bulk upload, etc. use `/api/*` |
| `SUPABASE_SERVICE_ROLE_KEY` in client-reachable `process.env` | **No `NEXT_PUBLIC_` prefix** anywhere |

**Verdict:** Service role is **contained to server execution paths** in production. No file was found where the service role key would be embedded in client JavaScript. Policy/convention gaps (`get-roster.ts`, `debug-queries.ts`, shared `duplicate-trips.ts` module) should be tightened to prevent future regressions.

---

## Q3 — `NEXT_PUBLIC_` variable audit

All `process.env.NEXT_PUBLIC_*` references under `src/`:

| Variable | Files (representative) | Classification | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `client.ts:9`, `server.ts:6`, `admin.ts:14`, `proxy.ts:6`, API routes | **Safe (public)** | Supabase project URL — designed for client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `client.ts:10`, `server.ts:7`, `proxy.ts:7` | **Safe (public)** | Anon key — RLS must enforce access (see A2) |
| `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE` | `trip-business-date.ts:13-15` | **Safe (public)** | IANA timezone string; used client+server for date filters |
| `NEXT_PUBLIC_SENTRY_DSN` | `instrumentation.ts:5`, `instrumentation-client.ts:8` | **Safe (public)** | Sentry DSN is intentionally client-visible |
| `NEXT_PUBLIC_SENTRY_DISABLED` | `instrumentation.ts:21`, `instrumentation-client.ts:6` | **Safe (public)** | Feature flag string |

Also referenced in `next.config.ts` (build-time, not `src/`):

| Variable | Classification |
| --- | --- |
| `NEXT_PUBLIC_SENTRY_ORG` | **Safe** — org slug for Sentry upload plugin |
| `NEXT_PUBLIC_SENTRY_PROJECT` | **Safe** — project name for Sentry upload plugin |

**Critical finding:** **None.** No service role, Google keys, `CRON_SECRET`, or `SENTRY_AUTH_TOKEN` use the `NEXT_PUBLIC_` prefix.

---

## Q4 — Google API key exposure

### Storage

| Env variable | Used in | Prefix |
| --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | `src/lib/google-geocoding.ts` (`:38`, `:156`, `:260`); `src/lib/google-directions.ts` (`:125`, `:193`); `POST /api/geocode-address` (via geocoding helper); `GET /api/place-details` PLZ fallback (`:107-111`) | **Server-only** |
| `GOOGLE_PLACES_API_KEY` | `POST /api/places-autocomplete` (`:13`); `GET /api/place-details` (`:78`) | **Server-only** |

Documented in `docs/address-autocomplete.md` (`:165-166`) and `docs/driving-metrics-api.md` (`:155-159`). **Not listed in `env.example.txt`.**

### Client direct calls

**None.** Client paths:

- `AddressAutocomplete` → `POST /api/places-autocomplete`, `GET /api/place-details`
- `fetchDrivingMetrics` → `POST /api/trips/driving-metrics` (guarded `requireAdmin()`)
- Bulk upload / trip forms → `/api/geocode-address` or driving-metrics proxy
- Fleet map → `POST /api/fleet/routes` (guarded `requireAdmin()`)

Invoice builder map links use `https://www.google.com/maps/dir/?api=1&...` (no API key) per `docs/invoices-module.md`.

### GCP Console restrictions (docs only — not verified externally)

From project documentation:

- `docs/driving-metrics-api.md:159` — recommends **API key restrictions** (Directions + Geocoding APIs; IP or referrer scope) and budget alerts.
- `docs/address-autocomplete.md:165-166` — states keys are server-side only; enable Geocoding + Directions on the Maps key project.
- `docs/plans/google-api-audit.md` — notes two independent env vars; whether deployment uses one GCP key or two is **environment-specific**; **not enforced in repo**.

**No IaC or committed GCP restriction config** was found — operational posture depends on console settings outside this repository.

### Unguarded proxy risk (cross-reference A1)

| Route | Key used | Auth |
| --- | --- | --- |
| `POST /api/places-autocomplete` | `GOOGLE_PLACES_API_KEY` | **None** |
| `GET /api/place-details` | `GOOGLE_PLACES_API_KEY` (+ Maps for PLZ fallback) | **None** |
| `POST /api/geocode-address` | `GOOGLE_MAPS_API_KEY` | **None** |

Keys stay server-side, but unauthenticated callers can burn quota via these routes.

---

## Q5 — Secret leakage via error responses

Scan of all 17 `src/app/api/**/route.ts` handlers:

### High-signal leakage

| Route | Lines | What is returned | Risk |
| --- | --- | --- | --- |
| `POST /api/drivers/create` | 52–58 (`stepErrorResponse`) | `{ error, step, code, details }` — `details` from Supabase Auth/PostgREST | **Medium–High** — may expose constraint names, column hints, Auth error payloads |
| `GET /api/place-details` | 86–91 | `{ error, details: data }` — full Google Places error JSON | **Medium** — Google error structure; on non-OK upstream |
| `POST /api/places-autocomplete` | 42–43 | **Raw Google response body** forwarded | **Low–Medium** — includes suggestions on success; error shapes on failure |
| `POST /api/geocode-address` | 27–29 | `error.message` from caught exception | **Low** |

### Supabase `error.message` in JSON (schema/table hints possible)

| Route | Lines |
| --- | --- |
| `GET /api/users` | 42, 70–71 |
| `PATCH /api/users/[id]/status` | 56, 84, 104, 112 |
| `PATCH /api/users/[id]/credentials` | 50, 113, 127, 137 |
| `PATCH /api/drivers/[id]` | 59, 89, 97 |
| `POST /api/trips/bulk-delete` | 63, 82 |
| `GET /api/trips/export/preview` | 130, 143 |
| `POST /api/trips/export` | 478–481 |
| `GET /api/cron/generate-recurring-trips` | 47 |
| `GET /api/trips/metrics` | 60 |
| `GET /api/trips/groups/metrics` | 66 |
| `POST /api/trips/driving-metrics` | 71 |
| `POST /api/trips/duplicate` | 122 |

Postgres/Supabase messages often mention relation/column names (e.g. `"column xyz of relation trips"`).

### Safer patterns observed

| Route | Lines | Pattern |
| --- | --- | --- |
| `POST /api/fleet/routes` | 79–84 | Generic `'Internal Server Error'` in catch |
| `POST /api/places-autocomplete` | 44–49 | Generic message in catch (but success path forwards raw Google JSON) |
| `GET /api/place-details` | 136–141 | Generic catch; upstream error path still leaks `details` |

### Stack traces

**No route** serializes `error.stack` into HTTP responses. Stacks go to `console.error` server-side only.

**Verdict:** No direct secret leakage in error JSON, but **information disclosure** via Supabase/Google error bodies is plausible — especially `drivers/create` `details` and `place-details` `details: data`.

---

## Q6 — Environment variable completeness

### `process.env.*` used in `src/` vs `env.example.txt`

| Variable | In `src/` | In `env.example.txt` | Status |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | OK |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | OK |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Yes | OK |
| `CRON_SECRET` | Yes | Yes | OK |
| `NEXT_PUBLIC_SENTRY_DSN` | Yes | Yes | OK |
| `NEXT_PUBLIC_SENTRY_DISABLED` | Yes | Yes | OK |
| `NEXT_PUBLIC_SENTRY_ORG` | No (`next.config.ts` only) | Yes | OK for build |
| `NEXT_PUBLIC_SENTRY_PROJECT` | No (`next.config.ts` only) | Yes | OK for build |
| `SENTRY_AUTH_TOKEN` | No (`next.config.ts` / CI only) | Yes | OK for build |
| `GOOGLE_MAPS_API_KEY` | Yes | **Missing** | **Gap** — document + enable Directions/Geocoding |
| `GOOGLE_PLACES_API_KEY` | Yes | **Missing** | **Gap** — document + enable Places (New) |
| `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE` | Yes | **Missing** | **Gap** — optional override (defaults `Europe/Berlin`) |
| `NODE_ENV` | `instrumentation.ts:8` | N/A (runtime) | Built-in |
| `NEXT_RUNTIME` | `instrumentation.ts:22,27` | N/A | Built-in |

### Potentially stale entries in `env.example.txt`

All documented variables appear **used** either in `src/`, `next.config.ts`, or Sentry build pipeline. None are obvious dead secrets — the Google keys are the inverse problem (**used but undocumented**).

`AGENTS.md` documents `GOOGLE_MAPS_API_KEY` but not `GOOGLE_PLACES_API_KEY`; `docs/address-autocomplete.md` documents both.

---

## Q7 — Build-time secret exposure

`next.config.ts` review:

| Mechanism | Present? | Notes |
| --- | --- | --- |
| `env: { ... }` | **No** | Secrets not injected into `process.env` for client at build time |
| `publicRuntimeConfig` | **No** | |
| `serverRuntimeConfig` | **No** | |
| `withSentryConfig` | Yes (`:24-56`) | Uses `NEXT_PUBLIC_SENTRY_ORG`, `NEXT_PUBLIC_SENTRY_PROJECT` — public identifiers for source-map upload |
| `transpilePackages` / `images` | Yes | No secret injection |

Next.js default: only `NEXT_PUBLIC_*` vars are inlined into client bundles. `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `GOOGLE_*`, and `SENTRY_AUTH_TOKEN` are **not** baked into static client output by configuration reviewed here.

**Caveat:** Server chunks in `.next/server/` will contain server code paths that reference `process.env.SUPABASE_SERVICE_ROLE_KEY` — this is expected and not served as static JS to browsers.

---

## Critical findings first

Ordered by severity. **No `NEXT_PUBLIC_` secret or client-embeddable service role key was found.** Top risks are abuse paths and error disclosure.

### 1. Unguarded Google API proxies (High — quota/billing abuse)

**Routes:** `POST /api/places-autocomplete`, `GET /api/place-details`, `POST /api/geocode-address`

**Issue:** Server-held `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` usable by anyone who can reach the deployment (see [A1](security-audit-a1-api-routes.md)).

**Fix:**

1. Add `requireSession()` minimum, or `requireAdmin()` if only admins need address tools.
2. Add rate limiting (per-IP / per-user) on these routes.
3. In GCP Console: restrict keys to server IP(s), enable only required APIs, set budget alerts (`docs/driving-metrics-api.md:159`).

### 2. `POST /api/drivers/create` returns Supabase `details` (Medium–High — info disclosure)

**File:** `src/app/api/drivers/create/route.ts:52-58`

**Issue:** `stepErrorResponse` forwards `err.details` from Supabase Auth/DB errors to the client.

**Fix:** Return generic German error messages to clients; log full `error`/`details` server-side only.

### 3. `GET /api/place-details` forwards Google error payload (Medium)

**File:** `src/app/api/place-details/route.ts:86-91`

**Issue:** `details: data` exposes upstream Google JSON on failure.

**Fix:** Return `{ error: 'Places lookup failed' }` with status code only; log `data` server-side.

### 4. Service role in feature module + debug script location (Medium — convention / future regression)

**Files:**

- `src/features/driver-management/api/get-roster.ts` — `createAdminClient` (`:12`, `:67`, `:168`) vs policy in `docs/access-control.md:29`
- `src/features/trips/components/pending-assignments/debug-queries.ts` — direct service role (`:3-6`)

**Fix:**

1. Move live-email merge to `src/app/api/users/` helper or `src/lib/` server-only module; keep `get-roster` on session client + explicit admin helper.
2. Delete or move `debug-queries.ts` to `scripts/`; never under `components/`.

### 5. Shared `duplicate-trips.ts` imported from Client Component (Medium — bundle hygiene)

**Files:** `duplicate-trips-dialog.tsx:33-36` imports from `duplicate-trips.ts:33` (`google-directions`)

**Issue:** Client UI and server-only Google/cache logic share one module.

**Fix:** Split pure UI helpers (`pickOutboundAndReturn`, etc.) into `duplicate-trips-ui.ts` with no server imports; keep `executeDuplicateTrips` server-only.

### 6. Raw Supabase `error.message` in API responses (Low–Medium)

**Issue:** Widespread pattern across admin routes (see Q5 table) can leak table/column/constraint names.

**Fix:** Map known error codes to user-safe messages; generic fallback for 500s.

### 7. `env.example.txt` incomplete (Low — operational)

**Missing:** `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`

**Fix:** Add documented entries mirroring `docs/address-autocomplete.md` env table.

---

## References

- Service role policy: `docs/access-control.md:27-52`, `:83-88`
- Admin factory: `src/lib/supabase/admin.ts:1-23`
- Prior API auth audit: `docs/plans/security-audit-a1-api-routes.md`
- Google key inventory: `docs/plans/google-api-audit.md`
