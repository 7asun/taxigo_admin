# Flutter Driver App — Repository Architecture Assessment

**Date:** 2026-06-03  
**Scope:** Read-only audit of `taxigo_admin` for a potential native Flutter driver app.  
**Method:** Review of root config, `src/` structure, `supabase/` migrations, docs, and CI.

---

## Repository snapshot (baseline)

| Item | Finding |
| --- | --- |
| **Stack** | Next.js 16 (App Router), React 19, TypeScript 5.7, Tailwind v4, shadcn/ui, Bun |
| **Auth / data** | Supabase Auth + PostgREST; `@supabase/ssr` + `@supabase/supabase-js` |
| **Package manager** | Bun preferred (`bun.lock`); `package-lock.json` also present |
| **Supabase local** | `supabase/config.toml` present; **103 SQL migrations**; **no Edge Functions** directory |
| **Source size** | ~6.2 MB `src/`, ~636 KB `supabase/`, ~3.8 MB `docs/` (~1,407 tracked source files excl. `node_modules`/`.next`) |
| **On-disk total** | ~1.4 GB (dominated by `node_modules` + `.next`) |
| **Existing driver UI** | Mobile-first **web** driver portal at `/driver/*` (not Flutter) |
| **Flutter in repo** | None — no `pubspec.yaml`, no Dart sources |

### Key files reviewed

- `package.json` — scripts: `dev`, `build`, `lint`, `test`, `db:types` (generates `src/types/database.types.ts`)
- `next.config.ts` — Sentry wrapper, Turbopack root, image remote patterns; no custom rewrites for mobile
- `env.example.txt` — Supabase URL/anon key, service role, cron secret, Sentry vars only (no Google Maps vars documented here; AGENTS.md references `GOOGLE_MAPS_API_KEY` for server-side geocoding/directions)
- `supabase/config.toml` — Postgres 17, `public` + `graphql_public` schemas exposed, seeds enabled
- `README.md` — starter template docs; project-specific pointers to `docs/access-control.md`, Supabase env setup
- `.github/workflows/ci.yml` — Bun install → lint guard → tests → Next.js build
- `vercel.json` — Bun install/build + daily recurring-trips cron

### Top-level layout

```
taxigo_admin/
├── src/                 # Next.js app (app router under src/app/)
├── supabase/            # migrations + config (shared backend contract)
├── docs/                # 60+ module docs + 170+ plan files
├── scripts/             # backfill / maintenance TS scripts
├── public/              # static assets
├── __CLEANUP__/         # feature removal templates
├── EXAMPLE/             # examples
├── implementation-suggestions/
├── package.json, bun.lock, next.config.ts, vercel.json
└── .github/workflows/ci.yml
```

### `src/features/` modules (24)

`angebote`, `auth`, `bank-reconciliation`, `clients`, `company-settings`, `controlling`, `dashboard`, `driver-management`, `driver-planning`, `driver-portal`, `drivers`, `fleet`, `fremdfirmen`, `invoices`, `letters`, `overview`, `payers`, `rechnungsempfaenger`, `recurring-rules`, `shift-reconciliations`, `storage`, `trips`, `unassigned-trips`, `user-management`

Driver-relevant today: **`driver-portal`**, **`driver-management`**, **`driver-planning`**, **`fleet`**, **`trips`** (read-only driver slice), plus shared **`auth`**.

---

## 1. Project scale and coupling

### How many top-level modules / feature areas?

- **24 feature folders** under `src/features/`.
- **Route groups** under `src/app/`: `auth`, `dashboard` (admin), `driver` (mobile web portal), `api` (17 route handlers), plus marketing pages.
- **Admin surface area is large** (invoicing, controlling, angebote, KTS, recurring rules, bank reconciliation, etc.). The **driver slice is comparatively small** — roughly one feature module (`driver-portal`) plus shared auth, types, and Supabase client helpers.

### Shared utilities a Flutter app would also need

These define **behavioral contracts** beyond UI:

| Domain | Location | Flutter relevance |
| --- | --- | --- |
| Trip statuses | `src/lib/trip-status.ts`, `src/features/driver-portal/types/trips.types.ts` | Status enum + lifecycle (`scheduled` → `in_progress` → `completed`; cancel via RPC) |
| Shift statuses / events | `src/features/driver-portal/types.ts` | `active` \| `on_break` \| `ended`; event types `shift_start`, `break_start`, `break_end`, `shift_end` |
| GPS tracking tunables | `src/lib/tracking/constants.ts` | 5 s upsert interval, `live_locations` table name, busy trip statuses |
| Berlin timezone / day bounds | `src/features/trips/lib/trip-business-date.ts`, `trip-time.ts` | **Critical** — `getZonedDayBoundsIso`, `buildScheduledAt` invariants documented in AGENTS.md |
| Table / column names | `src/types/database.types.ts` (generated) | Single schema truth; regenerate via `bun run db:types` |
| Driver trip read model | `DriverTrip` interface in `driver-portal/types/trips.types.ts` | Column subset drivers may SELECT |
| Driver write paths | `driver-portal/api/driver-trips.service.ts`, `shifts.service.ts` | Documents exact Supabase calls Flutter should mirror |
| Access control | `docs/access-control.md` | Role matrix, RLS summary |

**Not needed on device:** fare/pricing engine (`docs/price-calculation-engine.md`, invoice Zod schemas), bulk upload, PDF generation, controlling RPCs — drivers have **no RLS access** to billing tables.

### Coupling to Supabase schema

**Tight and intentional.**

1. **Generated types:** `src/types/database.types.ts` is produced by `supabase gen types typescript` (`db:types` script). All services type against `Database['public']['Tables'][...]`.
2. **Direct PostgREST:** Driver portal services call `supabase.from('trips')`, `.from('shifts')`, `.rpc('cancel_trip_as_driver')` from the browser client — no BFF abstraction layer.
3. **RLS is the real API:** Documented in migrations + `docs/access-control.md`. App-layer guards (`src/proxy.ts`, `requireAdmin()`) are **admin-only**; drivers rely on RLS + Supabase Auth JWT.
4. **No shared package:** Types and constants live in TypeScript files only — **not consumable by Dart without manual port or codegen**.

**Assessment:** A Flutter app would be coupled to the **same Supabase project and migrations**, not to the Next.js codebase. Schema changes must stay backward-compatible or be coordinated via `supabase/migrations/`.

---

## 2. Supabase schema relevance

### Tables likely relevant to a driver app

| Table | Driver use | RLS (per `access-control.md`) |
| --- | --- | --- |
| `accounts` | Profile, `role`, `company_id`, `is_active` | SELECT/UPDATE own row |
| `driver_profiles` | License, default vehicle, address | SELECT/UPDATE own |
| `trips` | Assigned tours, status updates, notes | SELECT/UPDATE own (`driver_id = auth.uid()` or via `trip_assignments`) |
| `trip_assignments` | Alternate assignment path | Indirect via trips policies |
| `shifts` | Live shift state | Full CRUD own |
| `shift_events` | Audit trail (start/break/end + GPS) | Full CRUD own (via shift ownership) |
| `live_locations` | GPS upsert (~5 s while shift active) | ALL own row |
| `vehicles` | Pick default vehicle at shift start | **Admin only** — drivers may need read access added or join via admin-preloaded profile |
| `driver_day_plans` | Admin schedule (read-only for driver?) | Not listed for drivers — likely **no access today** |
| `notifications` | Exists in `database.types.ts` | **Unused in `src/`** — possible future push/in-app |
| `companies` / `company_profiles` | Branding | **No driver access** |

**Admin-only (Flutter driver must NOT depend on):** `clients`, `payers`, `invoices`, `angebote`, `billing_*`, `recurring_rules`, `fremdfirmen`, `pdf_vorlagen`, etc.

**Legacy / unused:** `rides` table exists in generated types (fare, payment_method, lat/lng) but **no `src/` code references it**. Primary domain entity is **`trips`**, not `rides`. Treat `rides` as dead schema unless a migration plan revives it.

### Edge Functions

**None deployed in this repo.** `supabase/functions/` does not exist. All server logic is:

- PostgREST (table CRUD)
- **Postgres RPCs** in migrations (e.g. `cancel_trip_as_driver`, `get_shift_day_summaries`, `update_driver`)
- **Next.js API routes** (admin-only; see §3)

A Flutter app would call **Supabase directly** (same as the current web driver portal), not Edge Functions.

### RLS and driver role

**Driver role already exists.**

- `public.accounts.role`: `'admin' \| 'driver'` (`docs/access-control.md`)
- RLS policies for driver-scoped tables are in place (trips, shifts, live_locations, accounts, driver_profiles)
- Dedicated driver RPC: `cancel_trip_as_driver(uuid, text)` — SECURITY DEFINER with caller validation
- Auth redirect: drivers → `/driver/*`, admins → `/dashboard/*` (`src/proxy.ts`)

**No new role type required** for a basic driver app. Gaps to verify during Flutter build:

- Whether drivers need **read** access to `vehicles` (for shift vehicle picker)
- Whether `driver_day_plans` should become driver-readable for schedule UX
- Trip cancellation clears `driver_id` — cancelled trips **disappear** from driver SELECT (documented in RPC comment)

---

## 3. Shared type / contract surface

### TypeScript types and Zod schemas

| Layer | Purpose | Driver-relevant? |
| --- | --- | --- |
| `src/types/database.types.ts` | Full DB schema (generated) | **Yes** — port enums/columns to Dart or use `supabase gen types` for Dart if tooling added |
| `src/features/driver-portal/types.ts` | Shift/shift_event constants | **Yes** — primary driver contract |
| `src/features/driver-portal/types/trips.types.ts` | `DriverTrip`, `TRIP_STATUSES` | **Yes** |
| `src/lib/trip-status.ts` | Admin + driver status union, UI labels | Partial — labels are UI; status strings are shared |
| `src/lib/tracking/constants.ts` | GPS intervals, table names | **Yes** |
| Zod schemas (`features/*/types`, `create-trip/schema.ts`, invoice/angebot schemas) | Form validation for admin | **No** for driver MVP |

There is **no `shared/` folder** and **no OpenAPI/Protobuf contract**. Documentation (`docs/driver-portal.md`, `docs/driver-system.md`, `docs/modules/driver-tracking.md`) is the human-readable spec.

### API surface: same as dashboard or separate?

**Different.**

| Consumer | Primary API | Notes |
| --- | --- | --- |
| **Admin dashboard** | Supabase (session client) + **Next.js `/api/*`** (admin-gated) + Google proxy routes | Service role for cron, user creation, exports |
| **Web driver portal** | **Supabase only** (anon key + user JWT) | Direct table/RPC access under RLS |
| **Flutter driver app (recommended)** | **Same as web driver portal** | Supabase Flutter SDK → identical tables/RPCs |

Next.js routes a Flutter driver app would **not** call (all `requireAdmin()` or admin-only):

- `/api/drivers/*`, `/api/users/*`
- `/api/trips/bulk-delete`, `duplicate`, `export`, `driving-metrics`
- `/api/geocode-address`, `places-autocomplete`, `place-details` (admin trip creation; drivers display stored addresses)
- `/api/fleet/routes` (admin fleet map routing)
- `/api/cron/*`

Optional future BFF routes for Flutter (not required today): push notification registration, signed upload URLs — none exist yet.

**Realtime:** Admin fleet map uses `postgres_changes` on `live_locations` + `trips`. Driver portal **writes** `live_locations` but does not subscribe to Realtime in `driver-portal` code — Flutter would mirror that (write-heavy, optional subscribe for dispatch push later).

---

## 4. Monorepo feasibility check

### Existing monorepo tooling

**None.**

- No `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, or `lerna.json`
- Single-root `package.json`; one Next.js application

### Bun + Next.js vs Flutter subfolder

**Compatible with isolation, not with zero config.**

- Next.js App Router lives at **`src/app/`**, not repo-root `/app` — a root-level `apps/driver/` or `flutter/` folder **does not conflict** with Next.js routing.
- Flutter requires its own `pubspec.yaml`, `android/`, `ios/`, `.dart_tool/` — standard sibling layout:

  ```
  taxigo_admin/
  ├── src/                    # Next.js (unchanged)
  ├── supabase/               # shared migrations
  └── apps/driver/            # Flutter (proposed)
      └── pubspec.yaml
  ```

- **No build pipeline conflict:** `bun run build` only compiles Next.js; Flutter uses `flutter build apk/ipa` independently.
- **Shared asset:** `supabase/migrations` + `docs/access-control.md` — the main monorepo win.

### Repo size / bloat

| Metric | Value |
| --- | --- |
| Application source (excl. deps) | ~11 MB (`src` + `supabase` + `docs`) |
| File count (excl. node_modules/.next/.git) | ~1,407 |
| With dependencies | ~1.4 GB |

Adding Flutter (~50–200 MB with platform folders and build artifacts gitignored) is **reasonable** for a product monorepo, especially because **`supabase/` already centralizes the backend**. Without `.gitignore` updates for Dart/Flutter artifacts, repo bloat risk is moderate.

---

## 5. CI/CD and deployment

### Current CI (`.github/workflows/ci.yml`)

On push/PR to `main`:

1. `bun install --frozen-lockfile`
2. `bun run lint:trips-scheduled-at` (trips time guard)
3. `bun test` (invoice/trips unit tests)
4. `bun run build` (Next.js production build)

**Deploy target:** Vercel (`vercel.json` — Bun install, Next.js build, cron for recurring trips).

### Adding Flutter to CI

**Feasible as a parallel job, not a drop-in extension.**

| Aspect | Next.js (today) | Flutter (would need) |
| --- | --- | --- |
| Runner setup | `oven-sh/setup-bun@v2` | `subosito/flutter-action` or custom image |
| Secrets | Supabase, Sentry, CRON, service role (Vercel) | Supabase anon key (build-time config), **Apple/Google signing**, store credentials |
| Deploy | Vercel auto-deploy | App Store / Play Console / Firebase App Distribution |
| Test scope | Bun test + ESLint | `flutter analyze`, `flutter test`, integration tests |

**Recommendation:** Separate CI job `flutter-quality` triggered on changes under `apps/driver/**` (path filter). Do not block Next.js deploy on Flutter build unless release coordination requires it.

**Shared secrets:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` map to Flutter `--dart-define` or env files — same Supabase project, different client SDK.

---

## 6. Risk surface

### Root-level tooling conflicts

| File / tool | Risk | Mitigation |
| --- | --- | --- |
| **`bun run format`** (`prettier --write .`) | Would touch Dart files unless ignored | Add `apps/driver/**` or `**/*.dart` to `.prettierignore` |
| **`lint-staged` / Husky** | Runs Prettier on `*.{js,jsx,tsx,ts,css,...}` — **no Dart** | Low conflict today |
| **ESLint** (`eslint src`) | Scoped to `src/` only | No Dart conflict |
| **`.gitignore`** | Missing Flutter entries (`.dart_tool/`, `build/`, `ios/Pods/`, `android/.gradle/`) | Must extend before first Flutter commit |
| **`tsconfig.tsbuildinfo`** (715 KB) | Already gitignored pattern `*.tsbuildinfo` but file may exist locally | N/A |
| **`package.json` name** | Still `next-shadcn-dashboard-starter` | Cosmetic; consider rename if monorepo |
| **Env files** | `.env*` gitignored; Flutter needs parallel config | Use `apps/driver/.env` + gitignore or CI secrets |
| **Vercel** | Only builds Next.js root | Flutter unaffected |
| **Supabase CLI** | `project_id = "taxigo_admin"` in config.toml | Shared; Flutter uses same remote/local project |

### Naming collision note

Using a subfolder literally named `/app` at repo root is **safe vs Next.js** (which uses `src/app/`), but **`app` is overloaded** in Flutter/Android (`lib/`, `android/app/`). Prefer **`apps/driver`** or **`flutter/driver`** for clarity.

### Existing web driver portal

`/driver/*` is a **functional reference implementation**. Flutter replaces native UX; until cutover, two clients may share the same Supabase backend. Coordinate trip/shift semantics and timezone handling to avoid divergent behavior (especially `getTodaysTrips` in web still uses local `Date` midnight — known divergence from Berlin bounds used on Touren page).

---

## Senior Recommendation

### Lean: **Monorepo** (sibling Flutter app + shared `supabase/`)

**Single strongest reason:** The **backend contract is already co-located** — 103 migrations, driver RLS, and driver-specific RPCs (`cancel_trip_as_driver`, shift tables, `live_locations`) live in this repo and evolve with the product. A Flutter app that talks directly to Supabase **must** stay in lockstep with those migrations; a separate repo splits the one artifact both clients actually share (the database schema) across two PR workflows and doubles migration review risk.

### Acknowledged trade-off (why separate repo is defensible)

There is **zero reusable application code** between TypeScript and Dart — types, enums, and business rules must be **ported or codegen'd**, not imported. CI/CD and app-store deployment are entirely disjoint from Vercel. If the mobile team operates on a different release cadence and owns backend changes end-to-end via Supabase CLI alone, a separate repo is workable **only if** migrations remain canonical in one place (typically this repo) and the Flutter repo becomes a thin consumer.

### Practical starting point if monorepo

1. Add `apps/driver/` with `pubspec.yaml`; extend `.gitignore` + `.prettierignore`.
2. Treat `docs/driver-portal.md` + `src/features/driver-portal/api/*` as the **implementation spec**.
3. Generate or hand-port types from `database.types.ts` for driver tables only.
4. Add path-filtered Flutter CI job; keep Vercel deploy unchanged.
5. Defer Edge Functions unless server-side logic must hide secrets from the device (currently unnecessary for driver flows under RLS).

---

## Appendix: Driver feature parity checklist (from existing web portal)

Routes to replicate in Flutter:

| Web route | Capability |
| --- | --- |
| `/driver/startseite` | Shift widget + today's trips |
| `/driver/touren` | Search/filter assigned trips |
| `/driver/shift` | Manual Schichtenzettel + history (`get_shift_day_summaries` RPC) |
| `/driver/tracking` | GPS upsert to `live_locations` while shift active/on break |

Auth: Supabase email/password (same as admin users; role checked via `accounts.role = 'driver'`).
