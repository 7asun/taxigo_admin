# Driver Location Tracking — Audit

**Date:** 2026-05-20  
**Mode:** Read-only (no code changes except this document)  
**Scope:** Baseline inventory for driver location tracking (auth, Supabase clients, routing, PWA, maps/geolocation, schema, dependencies, build health).

---

## App directory structure (`src/app/`)

The user-requested path `app/` maps to **`src/app/`** in this repo (Next.js App Router).

```
src/app/
├── layout.tsx                    # Root layout (theme, providers, no PWA manifest links)
├── page.tsx                      # Redirect: authed → /dashboard/overview, else → /auth/sign-in
├── global-error.tsx
├── not-found.tsx
├── about/page.tsx
├── privacy-policy/page.tsx
├── terms-of-service/page.tsx
├── auth/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── sign-in/page.tsx
│   └── sign-up/page.tsx
├── driver/                       # Driver-facing area (separate layout)
│   ├── layout.tsx
│   ├── page.tsx                  # → /driver/startseite
│   ├── startseite/page.tsx
│   ├── touren/page.tsx
│   └── shift/page.tsx
├── dashboard/                    # Admin dashboard (sidebar + KBar layout)
│   ├── layout.tsx
│   ├── page.tsx
│   ├── overview/                 # Parallel routes (@area_stats, @bar_stats, …)
│   ├── trips/, clients/, drivers/, users/, invoices/, …
│   └── …
└── api/
    ├── cron/generate-recurring-trips/
    ├── drivers/create/, drivers/[id]/
    ├── users/, users/[id]/credentials/, users/[id]/status/
    ├── trips/…, geocode-address/, place-details/, places-autocomplete/
    └── …
```

**Key files read:** `src/app/layout.tsx`, `src/app/dashboard/layout.tsx`, `src/app/driver/layout.tsx`, `src/app/auth/sign-in/page.tsx`, `src/app/page.tsx`.

**Note:** There is **no** `middleware.ts` at repo root or under `src/`. Route protection uses **`src/proxy.ts`**, which Next.js 16 reports as **“Proxy (Middleware)”** in the build output.

---

## 1. Auth & sessions

### What we found

- **Auth provider:** Supabase Auth (not Clerk). Sessions are cookie-based via `@supabase/ssr`.
- **Client session access:** Components call `createClient()` from `src/lib/supabase/client.ts`, then `supabase.auth.getUser()` and/or `supabase.auth.onAuthStateChange()`.
- **No** `useUser()` hook (Clerk-style) and **no** `createClientComponentClient()` (legacy auth-helpers). The browser client uses **`createBrowserClient()`** inside a module singleton.
- **Server session access:** `createClient()` from `src/lib/supabase/server.ts` + `supabase.auth.getUser()`.
- **Role is not on the JWT/session user object.** After `getUser()`, code loads `role` from **`public.accounts`** (formerly `users`):

```typescript
const { data: profile } = await supabase
  .from('accounts')
  .select('role')
  .eq('id', user.id)
  .single();
```

- **Role values:** `admin` | `driver` (documented in `docs/access-control.md`, `docs/accounts-table.md`).
- **Sign-in redirect:** `src/features/auth/components/sign-in-view.tsx` queries `accounts.role` and sends drivers to `/driver/shift`, others to `/dashboard/overview`.
- **Nav RBAC (client):** `src/hooks/use-nav.ts` — `useFilteredNavItems()` loads `accounts.role` and returns an empty nav for drivers.

### User/profile shape

| Source | Shape | Includes `role`? |
| --- | --- | --- |
| `supabase.auth.getUser()` | `@supabase/supabase-js` `User` (id, email, …) | **No** |
| `accounts` table row | `Database['public']['Tables']['accounts']['Row']` | **Yes** (`role: string`) |
| Combined pattern | Auth user + separate `accounts` query | Role from DB only |

`accounts` columns (from `src/types/database.types.ts`): `id`, `company_id`, `name`, `first_name`, `last_name`, `email`, `phone`, `role`, `is_active`, `created_at`.

There is **no** `profiles` table in the current schema; it was renamed to **`accounts`** (`supabase/migrations/20260318130000_rename_users_to_accounts.sql`).

### Files

- `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`
- `src/components/layout/user-nav.tsx` — `getUser()` + `onAuthStateChange`
- `src/features/auth/components/sign-in-view.tsx` — role-based post-login redirect
- `src/hooks/use-nav.ts` — role for sidebar filtering
- `src/app/dashboard/layout.tsx`, `src/app/driver/layout.tsx` — server role guards
- `docs/access-control.md`, `docs/accounts-table.md`

### Blockers / open questions

- Any tracking UI must **fetch `accounts.role` explicitly**; do not assume role exists on `User`.
- `src/app/auth/sign-in/page.tsx` redirects already-authed users to `/dashboard/overview` **without** role check (proxy may correct on next navigation, but sign-in page itself is inconsistent with `sign-in-view.tsx`).

---

## 2. Supabase client pattern

### What we found

| Context | Pattern | File |
| --- | --- | --- |
| Browser | `createBrowserClient(url, anonKey)` via singleton `createClient()` | `src/lib/supabase/client.ts` |
| Server (RSC, route handlers) | `createServerClient` + cookies | `src/lib/supabase/server.ts` |
| Service role (admin API, cron) | `createClient(url, serviceRoleKey)` | `src/lib/supabase/admin.ts` |
| Generic CRUD factory | `createService(tableName)` | `src/lib/supabase/service-factory.ts` |

**Not used:** `createClientComponentClient()`, `@supabase/auth-helpers-nextjs`.

### Realtime usage

**Yes** — exclusively **`postgres_changes`** on the `trips` table (and related dashboard hooks). **No** Realtime **Broadcast** usage found (`broadcast`, `watchPosition` not present).

| File | Channel / pattern |
| --- | --- |
| `src/features/trips/components/trips-realtime-sync.tsx` | `trips-realtime-sync` — INSERT/UPDATE on `trips` → debounced `refreshTripsPage()` |
| `src/features/trips/hooks/use-trips.ts` | `trips-all-changes` — `event: '*'` on `trips` → invalidate `tripKeys.all` |
| `src/features/trips/hooks/use-trips.ts` | `trip-${id}-changes` — per-trip detail invalidation |
| `src/features/trips/hooks/use-upcoming-trips.ts` | `schema-db-changes-${filter}` |
| `src/features/dashboard/hooks/use-unplanned-trips.ts` | `unplanned-trips-changes` |
| `src/features/dashboard/hooks/use-timeless-rule-trips.ts` | `timeless-rule-trips-changes` |
| `src/query/realtime-bridge.ts` | Shared debounced invalidation helpers |

**Pattern:** `createClient()` → `.channel(name).on('postgres_changes', { schema, table, event }, handler).subscribe()` → cleanup with `removeChannel` + debounce (~350–450 ms).

### Files

- `src/lib/supabase/client.ts`, `server.ts`, `admin.ts`, `service-factory.ts`, `to-query-error.ts`
- Realtime consumers listed above
- `src/query/README.md`, `docs/server-state-query.md` (referenced by trips realtime)

### Blockers / open questions

- A **Broadcast**-based location channel would be a **new** pattern; existing code only documents `postgres_changes` + TanStack Query invalidation.
- Realtime for `trips` must be enabled in Supabase project settings; location tracking would need its own publication/RLS design if using `postgres_changes` on a new table instead of Broadcast.

---

## 3. Routing & layouts

### What we found

**Separate layouts exist** — not everything uses the admin dashboard shell.

| Area | Layout | Characteristics |
| --- | --- | --- |
| Root | `src/app/layout.tsx` | Theme, `Providers`, `NuqsAdapter`, `Toaster` — shared by all routes |
| Admin | `src/app/dashboard/layout.tsx` | Sidebar, KBar, header; **requires `accounts.role === 'admin'`** |
| Driver | `src/app/driver/layout.tsx` | Mobile-first, `DriverHeader`, safe-area; **requires `role === 'driver'`** (redirects admins to dashboard) |
| Auth | `src/app/auth/layout.tsx` | Pass-through children only |

**Route protection (`src/proxy.ts` — Layer 1):**

- Matcher runs on almost all paths (excludes static assets) **and** `/(api|trpc)(.*)`.
- **`/dashboard/*` and `/driver/*`:** require authenticated user; unauthenticated → `/auth/sign-in?redirect=…`
- **Role redirects:** drivers on dashboard → `/driver/shift`; non-drivers on driver routes → `/dashboard/overview`
- **`/auth/*`:** authenticated users redirected by role to driver or dashboard home
- **Not globally auth-gated:** `/`, `/about`, `/privacy-policy`, `/terms-of-service` are outside dashboard/driver prefixes (root page does its own redirect logic)

**Layer 2:** `dashboard/layout.tsx` redirects non-admin and missing role to sign-in or `/driver/shift`.

**API routes:** Mixed — sensitive routes use `requireAdmin()`; metrics use `requireSession()`; cron uses `CRON_SECRET`. Geocode/places routes should be verified individually before exposing driver location APIs.

### Files

- `src/proxy.ts`
- `src/app/dashboard/layout.tsx`, `src/app/driver/layout.tsx`
- `docs/access-control.md`, `docs/driver-portal.md`

### Blockers / open questions

- There is **no** `middleware.ts` file; implementations referencing “middleware” should target **`src/proxy.ts`** (Next.js 16 proxy convention).
- A **standalone driver layout already exists** — location tracking UI likely belongs under `/driver/*`, not `/dashboard/*`.
- New admin “live map” pages would need **`/dashboard/...`** + admin layout + RLS allowing admins to read location data.

---

## 4. PWA readiness

### What we found

| Item | Status |
| --- | --- |
| `public/manifest.json` | **Does not exist** (`public/` only has `robots.txt`, `vercel.svg`) |
| PWA meta in `src/app/layout.tsx` | **No** `manifest` link, `apple-mobile-web-app-*`, or `mobile-web-app-capable` — only `viewport.themeColor` and theme script |
| `next-pwa` / Workbox | **Not** in `package.json` |
| Service worker | **None** configured in `next.config.ts` |

`next.config.ts`: Sentry wrapper, image remote patterns, `transpilePackages: ['geist']` — no PWA plugin.

### Files

- `src/app/layout.tsx`
- `next.config.ts`
- `package.json`
- `public/` (no manifest)

### Blockers / open questions

- Full PWA (installable, offline shell) requires **new** manifest, icons, and likely a service worker strategy — nothing is pre-wired.
- Driver tracking on mobile may work as a **responsive web app** without PWA, but background GPS and screen-wake policies depend on install/permissions.

---

## 5. Existing map or geolocation usage

### What we found

#### Geolocation (browser)

| File | API | Pattern |
| --- | --- | --- |
| `src/features/driver-portal/components/startseite/shift-status-card.tsx` | `navigator.geolocation.getCurrentPosition` | One-shot, 2 s timeout, best-effort on shift start/pause/end |
| `src/features/driver-portal/components/shift-tracker.tsx` | Same | **Deprecated** component; 5 s timeout |

**No** `watchPosition` anywhere in the codebase.

GPS coordinates are passed into `shiftsService` and stored on **`shift_events.lat` / `shift_events.lng`** (not continuous tracking).

#### Google Maps (server-side)

| File | Purpose |
| --- | --- |
| `src/lib/google-geocoding.ts` | Geocoding API |
| `src/lib/google-directions.ts` | Directions API (distance/duration) |
| `src/app/api/trips/driving-metrics/route.ts` | Admin-proxied Directions |
| `src/app/api/geocode-address/route.ts`, `place-details/`, `places-autocomplete/` | Address helpers |

#### Google Maps (client links only)

- `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` — `googleMapsSearchUrl()` opens Maps in new tab
- `src/features/trips/components/print-trips-button.tsx` — map search URLs for addresses

#### Leaflet / Mapbox

| Library | In `package.json`? | Used in source? |
| --- | --- | --- |
| `leaflet` + `@types/leaflet` | **Yes** (`^1.9.4`) | **No imports** in `src/` |
| Mapbox | No | No |

### Files

- Driver geolocation: `shift-status-card.tsx`, `shift-tracker.tsx`
- `src/features/driver-portal/api/shifts.service.ts` — persists `lat`/`lng` on `shift_events`
- Google: `src/lib/google-geocoding.ts`, `src/lib/google-directions.ts`, API routes above

### Blockers / open questions

- **Leaflet is a dormant dependency** — safe to use for a map UI, but no existing map component to extend.
- Current geolocation is **event-based** (shift actions), not a streaming driver position pipeline.
- Continuous tracking would need **`watchPosition`** (new) and a storage/broadcast strategy.

---

## 6. Database schema

### Migrations inventory

**93 files** under `supabase/migrations/` (timestamped SQL + `05-kundennummer-system.sql`).

**Most recent migration (by filename timestamp):**  
`20260519103000_angebot_default_tax_rate.sql` — adds nullable `default_tax_rate` to `angebote` only.

### `profiles` table

**Does not exist** under that name. App profiles live in **`public.accounts`** (renamed from `users` in `20260318130000_rename_users_to_accounts.sql`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK = `auth.users.id` |
| `company_id` | uuid | Tenant FK |
| `role` | text | **`admin` \| `driver`** |
| `name`, `first_name`, `last_name`, `email`, `phone` | text | Profile |
| `is_active` | boolean | Soft deactivate |
| `created_at` | timestamptz | |

Role is **not** a JWT custom claim in code paths reviewed; it is always read from **`accounts`**.

### Driver- and trip-related tables (existing)

| Table | Relevance to location tracking |
| --- | --- |
| `accounts` | Driver identity, `role`, `company_id` |
| `driver_profiles` | Static address `lat`/`lng` (home/base), not live GPS |
| `shifts`, `shift_events` | Shift lifecycle; **`shift_events` has `lat`, `lng`** per event |
| `trips` | Trip addresses, `driving_distance_km`, coords on clients/rules |
| `live_locations` | **In `database.types.ts` only** — see below |
| `vehicles` | Optional on shifts / live_locations |
| `route_metrics_cache` | Cached origin/dest lat/lng pairs (routing, not live tracking) |

### `live_locations` (important)

Typed in `src/types/database.types.ts`:

- `driver_id` (PK, 1:1 with `accounts`)
- `company_id`, `vehicle_id`
- `lat`, `lng`, `status`, `updated_at`

**No migration in `supabase/migrations/`** creates or alters `live_locations`. Documented in `docs/driver-system.md` as intended for admin visibility on shift events, but **no `src/` code reads or writes this table**.

### Blockers / open questions

- Before relying on `live_locations`, confirm it exists in the **target Supabase project** and add a repo migration if missing (types may be ahead of migrations).
- Decide: extend **`live_locations`**, new **`driver_positions`** table, or **Broadcast-only** ephemeral positions (no DB).
- RLS policies for any new/updated location table are **required** (admins read company drivers; drivers write own row only).

---

## 7. Dependency conflicts

### `package.json` review

| Package | Status |
| --- | --- |
| `nosleep.js` | **Installed** (`^0.12.0`) — **zero imports** in `src/` |
| `leaflet` / `@types/leaflet` | Installed — **unused** in application code |
| `@supabase/ssr` | `^0.5.2` |
| `@supabase/supabase-js` | `^2.58.0` |
| `next-pwa` | **Not installed** |

No duplicate Supabase client major versions detected (single `@supabase/supabase-js` + `@supabase/ssr`).

### Potential friction (not hard blockers)

- **Leaflet + React 19 / Next 16:** No existing integration pattern in repo; will need dynamic import and CSS handling when first used.
- **`nosleep.js`:** Must be wired in a client component with user gesture; tree-shaking unused until imported.
- **ESLint 8 + `eslint-config-next` 16:** Pre-existing toolchain mismatch; build still passes.

### Files

- `package.json`, `bun.lock`

### Blockers / open questions

- None critical for starting implementation; unused deps are opportunities, not conflicts.

---

## 8. Build health

### Command

```bash
bun run build
```

### Result (2026-05-20)

**Exit code: 0 — success**

Notable output:

- Repeated warning: `[baseline-browser-mapping] The data in this module is over two months old…` (suggests updating devDependency `baseline-browser-mapping`; non-fatal).
- `✓ Compiled successfully in 15.7s`
- TypeScript check passed
- Static generation: `106` pages
- Build lists **`ƒ Proxy (Middleware)`** — confirms `src/proxy.ts` is active
- **No compile errors or TypeScript errors**

Full route list emitted for `app` routes (dashboard, driver, api, auth, legal pages) — all built successfully.

### Blockers / open questions

- None from build; environment-specific runtime failures (missing Supabase env) are not exercised during `next build`.

---

## Docs module inventory (`docs/`)

**Total:** 196 markdown files.

**Top-level module docs (non-`plans/`):** include but are not limited to:

`access-control.md`, `accounts-table.md`, `address-autocomplete.md`, `abrechnung-overview.md`, `anfahrtspreis.md`, `angebote-module.md`, `angebot-builder.md`, `angebote-vorlagen.md`, `angebot-formula-engine.md`, `billing-families-variants.md`, `bulk-trip-upload.md`, `bulk-upload-behavior-rules.md`, `client-price-tags.md`, `clients.md`, `color-system.md`, `company-logo-upload.md`, `csv-export-feature.md`, `date-picker.md`, `dispatch-inbox.md`, `driver-portal.md`, `driver-system.md`, `driving-metrics-api.md`, `feature-folder-structure.md`, `fremdfirma.md`, `invoice-text-templates.md`, `invoices-module.md`, `kanban-view.md`, `kts-architecture.md`, `kundennummer-system.md`, `letters-module.md`, `manual-km-overrides.md`, `mobile-ui.md`, `navigation.md`, `no-invoice-required.md`, `panel-layout-system.md`, `pdf-vorlagen.md`, `preisregeln.md`, `pricing-engine.md`, `print-trips-export.md`, `rechnungsempfaenger.md`, `server-state-query.md`, `shift-reconciliations.md`, `storage-upload-troubleshooting.md`, `SUPABASE_INTEGRATION.md`, `trip-detail-sheet-editing.md`, `trip-linking-and-cancellation.md`, `trip-reschedule-v1.md`, `trip-status-helper.md`, `trips-date-filter.md`, `trips-duplicate.md`, `trips-filters-bar.md`, `trips-inline-editing.md`, `trips-performance.md`, `trips-presets.md`, `trips-page-rsc-refresh.md`, `trips-rueckfahrt-detail-sheet.md`, `urgency-indicator.md`, `user-management.md`, plus `docs/features/recurring-rules-overview.md`.

**`docs/plans/`:** 140+ audit/plan documents (including `approach-b-audit.md`, `drivers-page-audit.md`, `mobile-primitives-audit.md`, etc.).

**Driver/location-adjacent docs:** `driver-portal.md`, `driver-system.md`, `accounts-table.md`, `access-control.md`, `driving-metrics-api.md`, `address-autocomplete.md`.

---

## Senior Recommendation

### Blockers to resolve before implementation

1. **`live_locations` schema drift** — Table appears in generated types and docs but has **no migration** and **no application writes**. Confirm production schema and add migration + RLS before using it as the SSOT for live GPS.
2. **Realtime strategy choice** — Codebase only uses **`postgres_changes`**; a plan based on **Supabase Realtime Broadcast** is greenfield here (no examples, no channel naming conventions).
3. **PWA / background tracking** — No manifest, service worker, or `nosleep.js` integration. Continuous tracking while screen-locked requires explicit PWA + permission UX work.
4. **Auth sign-in page inconsistency** — `auth/sign-in/page.tsx` vs `sign-in-view.tsx` role redirects should be aligned before drivers rely on a new tracking entry route.

### Conflicts with proposed architecture

| Proposed piece | Current codebase |
| --- | --- |
| Supabase Realtime **Broadcast** | Only **`postgres_changes`** on `trips` |
| **`watchPosition`** | Only **`getCurrentPosition`** on shift actions |
| **Leaflet** map | Dependency present, **zero UI usage** |
| **NoSleep.js** | Installed, **not wired** |
| **Standalone driver layout** | **Already exists** at `/driver/*` — aligns well |
| **`profiles.role`** | Use **`accounts.role`** instead |
| **`middleware.ts`** | Use **`src/proxy.ts`** |
| **`live_locations` updates on shift** | Documented in `driver-system.md` but **not implemented** in `shifts.service.ts` |

### Confidence level

**Medium** that a driver location tracking plan can proceed **with adjustments**:

- **High** confidence on: Supabase auth/session patterns, role model (`accounts`), separate driver routes/layout, server/admin vs driver split, build stability, shift event `lat`/`lng` precedent.
- **Lower** confidence on: Broadcast-based live map, PWA background GPS, and `live_locations` without a migration + RLS pass and admin map UI (Leaflet from scratch).

**Recommendation:** Prefer Phase 1 using existing primitives — driver portal route, `createClient()` singleton, optional persistence to `live_locations` or new table with `postgres_changes` for admin dashboard — then add Broadcast/PWA/watchPosition only where product requirements exceed what RSC + debounced invalidation already solve.

---

## Reference index

| Topic | Path |
| --- | --- |
| Proxy / “middleware” | `src/proxy.ts` |
| Browser Supabase client | `src/lib/supabase/client.ts` |
| Driver layout | `src/app/driver/layout.tsx` |
| Admin layout | `src/app/dashboard/layout.tsx` |
| Realtime (trips) | `src/features/trips/components/trips-realtime-sync.tsx` |
| Geolocation (shift) | `src/features/driver-portal/components/startseite/shift-status-card.tsx` |
| Accounts / role | `docs/accounts-table.md`, `docs/access-control.md` |
| Driver portal | `docs/driver-portal.md` |
| DB types | `src/types/database.types.ts` |
| Latest migration | `supabase/migrations/20260519103000_angebot_default_tax_rate.sql` |
