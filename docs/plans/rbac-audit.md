# RBAC & Access Control Audit (Read-Only)

**Audit date:** 2026-05-30  
**Scope:** Auth identity flow, roles/tenants, app-layer guards, Supabase RLS, user-management UI, TypeScript types, risk surface.  
**Primary references:** [`docs/access-control.md`](../access-control.md), [`docs/accounts-table.md`](../accounts-table.md), [`docs/user-management.md`](../user-management.md), [`docs/driver-system.md`](../driver-system.md).

> **Note on requested paths:** There is no root or `src/middleware.ts`. Next.js 16 uses **`src/proxy.ts`** as the edge auth/router guard (see [middleware-to-proxy](https://nextjs.org/docs/messages/middleware-to-proxy)). There is no `hooks/useAuth*`; session is read via Supabase clients. **`AGENTS.md` still describes Clerk**; the running app uses **Supabase Auth only** (no `@clerk` imports in `src/`).

---

## Executive summary

The product implements a **two-role, single-company-tenant** model: `public.accounts.role` is either `admin` or `driver`, scoped by `accounts.company_id` → `companies.id`. Identity is **Supabase Auth** (cookie session, `auth.uid()`), not Clerk orgs or custom JWT role claims in the app layer.

Defense is intentionally layered: **`src/proxy.ts`** (route redirects), **`src/app/dashboard/layout.tsx`** / **`src/app/driver/layout.tsx`** (RSC guards), **`requireAdmin()` / `assertAdminOrRedirect()`** on sensitive APIs and pages, **RLS** on most business tables via `current_user_is_admin()` and `current_user_company_id()`, and **`useFilteredNavItems()`** (UX-only).

**Biggest gaps:** (1) **Public Google proxy API routes** with no session check; (2) **tables without RLS migrations in the repo** (`recurring_rules`, `billing_types` / `billing_variants`, and others) relying on indirect scoping or dashboard-only policies; (3) **open self-service sign-up** that creates `auth.users` without an `accounts` row; (4) **stale template types/nav** (`PermissionCheck`, `requireOrg`) unused for real RBAC; (5) **`requireSession()` metrics APIs** that trust RLS alone and return broad `select('*')` on trips.

**Biggest risks:** Unauthenticated abuse of paid Google APIs; cross-tenant reads if RLS is missing or duplicated permissive policies on a table (documented 42P17 incident in `docs/access-control.md`); service-role usage after weak caller checks; drivers reaching admin-only data if dashboard layout is bypassed but RLS is also misconfigured on a catalog table.

---

## 1. Current auth state

### How the user is identified

| Mechanism | Location | Behavior |
| --- | --- | --- |
| Supabase session (cookies) | `src/lib/supabase/server.ts` (RSC/API), `src/lib/supabase/client.ts` (browser) | `createServerClient` / `createBrowserClient` with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| User id | `supabase.auth.getUser()` | Maps to `auth.uid()` in Postgres RLS |
| App profile | `public.accounts` where `accounts.id = auth.users.id` | Role + `company_id` loaded after session established |

There is **no** app-wide React Auth context. Session is fetched per call site (`getUser()`, `onAuthStateChange`).

**JWT / claims:** Triggers sync `company_id` into `auth.users.raw_app_meta_data` on `accounts` insert/update (`supabase/migrations/20260524151222_harden_account_triggers.sql`, lines 6–75). The Next.js app does **not** read `app_metadata` for authorization; it queries `accounts` explicitly.

### Edge / route layer (Layer 1)

**File:** `src/proxy.ts` (lines 18–89)

- Refreshes session via Supabase SSR cookies.
- For `/dashboard`, `/driver`, `/auth`: loads `accounts.role` (lines 54–60).
- Unauthenticated → `/auth/sign-in` with `redirect` param (lines 63–67).
- Driver on `/dashboard/*` → `/driver/startseite` (lines 70–74).
- Non-driver on `/driver/*` → `/dashboard/overview` (lines 76–80).
- Authenticated on `/auth/*` → role-based home (lines 82–86).
- Matcher includes **`/(api|trpc)(.*)`** (lines 92–96) but **no role logic runs for API paths**—only cookie refresh.

### Server layouts (Layer 2)

| File | Lines | Check |
| --- | --- | --- |
| `src/app/dashboard/layout.tsx` | 30–47 | `getUser()` → `accounts.role === 'admin'` else redirect driver portal or sign-in |
| `src/app/driver/layout.tsx` | 25–39 | If logged in, `accounts.role === 'driver'` else redirect dashboard |

### API helpers (Layer 3)

| File | Lines | Purpose |
| --- | --- | --- |
| `src/lib/api/require-admin.ts` | 16–51 | `requireAdmin()` → 401/403, returns `{ companyId, userId }` |
| `src/lib/api/require-admin.ts` | 58–89 | `assertAdminOrRedirect()` for RSC pages |
| `src/lib/api/require-session.ts` | 16–29 | Any authenticated user |

### Where session is consumed in the UI

| Consumer | File | Lines (approx.) |
| --- | --- | --- |
| Sign-in / sign-up | `src/features/auth/components/sign-in-view.tsx` | 26–52 — password sign-in, then `accounts.role` for redirect |
| User menu / sign-out | `src/components/layout/user-nav.tsx` | 14–44 |
| Sidebar nav filter | `src/hooks/use-nav.ts` | 16–50 — hides nav for drivers |
| Company id (client) | `src/features/payers/lib/session-company-id.ts` | 4–19 |
| Controlling (client) | `src/features/controlling/api/controlling.service.ts` | 21–42 — admin + `company_id` |
| Driver portal | Multiple under `src/features/driver-portal/**` | `getUser()` for shift/trip actions |
| Many feature forms | e.g. `create-trip-form.tsx`, `bulk-upload-dialog.tsx` | ad hoc `getUser()` |

**Privileged server client:** `src/lib/supabase/admin.ts` — `createAdminClient()` with `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Documented server-only in `docs/access-control.md`.

---

## 2. Existing role / tenant data

### Canonical app roles

| Store | Column | Values | Enforced |
| --- | --- | --- | --- |
| `public.accounts` | `role` | `admin`, `driver` (text, not DB enum in generated types) | proxy, layouts, `requireAdmin()`, RLS helpers, RPC guards |
| Docs | — | No separate dispatcher role; dispatchers use `admin` | `docs/access-control.md` lines 5–7 |

### Tenant / company

| Store | Column | Purpose |
| --- | --- | --- |
| `public.accounts` | `company_id` (uuid, FK → `companies.id`) | Primary tenant key for users |
| Most business tables | `company_id` | Tenant isolation in RLS |
| `public.companies` | `id` | Tenant record; RLS uses `id = current_user_company_id()` |
| `auth.users` | `raw_app_meta_data.company_id` | Synced by triggers; not used in app TS guards |

**No** `tenant_id`, `organization_id`, or Clerk org tables in the schema types.

### Other “role” columns (not user RBAC)

- `billing_types`, `angebot` column schemas, recurring rule address `role` (`pickup` / `dropoff`) — domain semantics, not user permissions.
- `src/features/driver-management/**` — roster **role filter** UI (`admin` / `driver` / `all`), not authorization.

### Tables with `company_id` (representative)

From `src/types/database.types.ts` and migrations: `trips`, `clients`, `payers`, `invoices`, `vehicles`, `fremdfirmen`, `live_locations`, `driver_day_plans`, `trip_presets`, `letters`, `angebote`, `shift_reconciliations`, `client_price_tags`, `client_km_overrides`, etc.

**Indirect tenant scope:** `recurring_rules` has **no** `company_id` column; scoped via `client_id` → `clients.company_id` (`database.types.ts` lines 890–1007).

---

## 3. Existing access control (app layer)

### Route / layout guards

| Location | Lines | Logic |
| --- | --- | --- |
| `src/proxy.ts` | 50–87 | Role-based redirects (see §1) |
| `src/app/dashboard/layout.tsx` | 27–47 | Admin-only dashboard tree |
| `src/app/driver/layout.tsx` | 30–39 | Driver-only driver tree |
| `src/app/auth/sign-in/page.tsx` | 17–18 | Logged-in → `/dashboard/overview` (does not role-split; proxy/sign-in-view do) |
| `src/app/auth/sign-up/page.tsx` | 17–18 | Logged-in → `/dashboard/overview` |
| `src/app/page.tsx` | 10–14 | Root → dashboard or sign-in |
| `src/app/dashboard/users/page.tsx` | 23 | `assertAdminOrRedirect()` |
| `src/app/dashboard/fleet/page.tsx` | 11 | `assertAdminOrRedirect()` |

All other `/dashboard/*` pages inherit **dashboard layout admin check** only (no per-page `assertAdmin` unless noted above).

### API route guards

| Route | Guard | File:lines |
| --- | --- | --- |
| `POST /api/drivers/create` | `requireAdmin()` | `src/app/api/drivers/create/route.ts:67` |
| `PATCH /api/drivers/[id]` | `requireAdmin()` + tenant guard | `src/app/api/drivers/[id]/route.ts:35,54–64` |
| `GET /api/users` | `requireAdmin()` | `src/app/api/users/route.ts:20` |
| `PATCH /api/users/[id]/credentials` | `requireAdmin()` + tenant guard | `src/app/api/users/[id]/credentials/route.ts:32,45–55` |
| `PATCH /api/users/[id]/status` | `requireAdmin()` + tenant guard | `src/app/api/users/[id]/status/route.ts:31,51–61` |
| `POST /api/trips/bulk-delete` | `requireAdmin()` | `src/app/api/trips/bulk-delete/route.ts:19` |
| `POST /api/trips/duplicate` | `requireAdmin()` | `src/app/api/trips/duplicate/route.ts:27` |
| `POST /api/trips/export`, `GET .../preview` | `requireAdmin()` | export `route.ts:344`, preview `route.ts:25` |
| `POST /api/trips/driving-metrics` | `requireAdmin()` | `src/app/api/trips/driving-metrics/route.ts:33` |
| `POST /api/fleet/routes` | `requireAdmin()` | `src/app/api/fleet/routes/route.ts:35` |
| `GET /api/trips/metrics` | `requireSession()` only | `src/app/api/trips/metrics/route.ts:9` |
| `GET /api/trips/groups/metrics` | `requireSession()` only | `src/app/api/trips/groups/metrics/route.ts:9` |
| `GET /api/cron/generate-recurring-trips` | `CRON_SECRET` Bearer / header | `src/app/api/cron/generate-recurring-trips/route.ts` (see `docs/access-control.md`) |
| `POST /api/geocode-address` | **None** | `src/app/api/geocode-address/route.ts:4` |
| `POST /api/places-autocomplete` | **None** | `src/app/api/places-autocomplete/route.ts:3` |
| `POST /api/place-details` | **None** | `src/app/api/place-details/route.ts` (no `requireAdmin` / `requireSession`) |

### Server modules with explicit admin checks

| Module | Pattern | File:lines |
| --- | --- | --- |
| Roster RSC | `requireAdmin()` before `getRoster()` | `driver-table-listing.tsx:16–38` |
| Roster loader | `requireAdmin()` | `get-roster.ts:183` (`loadDriverForPanel`) |
| Controlling | `account.role !== 'admin'` | `controlling.service.ts:38–39` |
| Driver planning | `requireAdminContext()` | `driver-planning.service.ts:30–46` |
| Shift reconciliations | `requireAdminContext()` | `shift-reconciliations.service.ts:28–44` |

### UI-only / client checks (not security boundaries)

| Location | File:lines | Note |
| --- | --- | --- |
| Nav empty for drivers | `src/hooks/use-nav.ts:48–49` | Layer 5 UX |
| Sign-in redirect by role | `sign-in-view.tsx:42–48` | Duplicates proxy |
| Driver roster role labels/filters | `driver-list-panel.tsx`, `roster-role-filter.tsx` | Display/filter only |

### Ad hoc email checks

**None found** (`user.email === 'admin@...'` pattern absent in `src/`).

### Stale / unused RBAC template

- `src/types/index.ts` — `PermissionCheck` with `permission`, `plan`, `feature`, `role`, `requireOrg` (lines 3–22).
- `src/config/nav-config.ts` — **no** `access:` properties on nav items (Clerk-era template leftover).

---

## 4. RLS status

### Helpers (SECURITY DEFINER, `row_security = off`)

Defined in `supabase/migrations/20260409180000_fix_rls_helper_recursion.sql` (lines 16–36):

- `current_user_company_id()` — reads `accounts.company_id` for `auth.uid()`
- `current_user_is_admin()` — `accounts.role = 'admin'`
- `trip_company_id(p_trip_id)` — in `20260409190000_fix_trip_assignments_rls_loop.sql` (lines 22–31)

Policies overwhelmingly check **`auth.uid()`** via helpers, **not email**.

### Tables with `ENABLE ROW LEVEL SECURITY` in repo migrations

| Table | Migration (representative) | Policy pattern |
| --- | --- | --- |
| `accounts` | `20260318100000_add_users_driver_profiles_rls.sql` (as `users`), renamed in `20260318130000` | Own row; admin same `company_id` |
| `driver_profiles` | same | Admin company; driver own |
| `trips` | `20260409170000_add_missing_rls.sql` | Admin CRUD by `company_id`; driver select/update own / assignments |
| `trip_assignments` | Policies in `20260409190000` | Admin via `trip_company_id()`; **no `ENABLE RLS` line in repo** |
| `clients`, `payers`, `vehicles`, `companies`, `company_profiles` | `20260409170000` | Admin + `company_id` / `id` |
| `shifts`, `shift_events` | `20260319100000` | Driver own; admin select company |
| `invoices`, `invoice_line_items` | `20260401180000` | Admin company |
| `invoice_text_blocks`, `billing_pricing_rules`, `rechnungsempfaenger`, `fremdfirmen`, `pdf_vorlagen` | various; tightened in `20260409170000` | Admin company |
| `angebote`, `angebot_line_items`, `angebot_vorlagen` | `20260409150000`, `20260413120000` | Admin company |
| `letters` | `20260503140000` | Admin company |
| `live_locations` | `20260520120000` | Driver ALL own; admin SELECT company |
| `client_price_tags` | `20260412140000`, read widened `20260412150000` | Admin ALL; **any authenticated company member SELECT** |
| `client_km_overrides` | `20260505180000` | Admin company |
| `trip_presets` | `20260514150000` | Admin company |
| `driver_day_plans` | `20260524120000` | Admin company |
| `shift_reconciliations` | `20260428120000` | Admin company |
| Storage `company_assets` | `20260402120000_company_assets_storage_rls.sql` | Authenticated company bucket paths |

Controlling RPCs (`get_controlling_*`) use **`SECURITY DEFINER`** with `authorized` CTE checking `current_user_is_admin()` AND `p_company_id = current_user_company_id()` — e.g. `20260530120000_controlling_rpcs.sql` lines 49–52.

### Tables in `database.types.ts` without RLS enablement in repo migrations

Treat as **audit gaps** (may exist only in Supabase dashboard or pre-repo SQL):

| Table | Risk note |
| --- | --- |
| `recurring_rules` | No `company_id`; cron uses service role |
| `recurring_rule_exceptions` | Child of rules |
| `billing_types`, `billing_variants` | Scoped via `payer_id`; migration `20260326120000` says mirror RLS from project |
| `notifications`, `rides`, `route_metrics_cache`, `trip_price_backfill_audit`, `driver_documents` | Present in types; no `ENABLE ROW LEVEL` in tracked migrations |

### Policy checks summary

| Check type | Used for |
| --- | --- |
| `auth.uid()` | Driver own rows (`trips.driver_id`, `shifts.driver_id`, `accounts.id`) |
| `current_user_is_admin()` | Admin-only tables and mutations |
| `current_user_company_id()` | Tenant boundary for admins |
| `trip_company_id()` | `trip_assignments` without trips↔assignments RLS loop |

**Operational warning:** `docs/access-control.md` documents duplicate permissive policies and 42P17 recursion; always `DROP POLICY IF EXISTS` when adding policies and verify `pg_policy` in production.

---

## 5. Multitenancy

**Model:** Single company per user (not multi-org switching).

1. User row: `public.accounts.company_id` → `companies.id` (`docs/accounts-table.md` lines 23–36).
2. Data rows: `company_id` on tenant tables; RLS compares to `current_user_company_id()`.
3. Auth metadata: triggers copy `company_id` to `auth.users.raw_app_meta_data` on account insert (`20260524151222_harden_account_triggers.sql`).

**User creation path:** Admins create users via `POST /api/drivers/create` with `company_id` from `requireAdmin()` session (`src/app/api/drivers/create/route.ts` lines 75, 152–161) — not self-serve tenant assignment.

**No** junction table for user↔multiple companies. **No** Clerk Organizations.

**Indirect scoping:** `recurring_rules` via `clients`; `billing_types` via `payers.company_id`.

---

## 6. User management UI

| Capability | Status | Location |
| --- | --- | --- |
| Company roster (table + column views) | **Implemented** | `/dashboard/users` — `src/app/dashboard/users/page.tsx` |
| Create user (driver or admin) | **Implemented** | `DriverCreateButton` → `POST /api/drivers/create` |
| Edit credentials (email/password) | **Implemented** | `edit-credentials-dialog.tsx` → `PATCH /api/users/[id]/credentials` |
| Activate / deactivate (ban) | **Implemented** | `user-actions.service.ts` → `PATCH /api/users/[id]/status` |
| Role assignment on create | **Implemented** | `role?: 'driver' \| 'admin'` in create API |
| Invitations / email invite flow | **Not found** | Uses admin-set password + `email_confirm: true` |
| Fine-grained permissions UI | **Not found** | Only binary admin/driver |
| Legacy `user-management` feature | **Deprecated bridge** | `docs/user-management.md` lines 53–57 |

Nav: **Account → Benutzer** in `src/config/nav-config.ts` (user management entry under Account group).

---

## 7. Type definitions (verbatim excerpts)

### `PermissionCheck` and `NavItem` — `src/types/index.ts`

```typescript
export interface PermissionCheck {
  permission?: string;
  plan?: string;
  feature?: string;
  role?: string;
  requireOrg?: boolean;
}

export interface NavItem {
  title: string;
  url: string;
  disabled?: boolean;
  external?: boolean;
  shortcut?: [string, string];
  icon?: keyof typeof Icons;
  label?: string;
  description?: string;
  isActive?: boolean;
  items?: NavItem[];
  access?: PermissionCheck;
}
```

### API guard types — `src/lib/api/require-admin.ts`

```typescript
export type RequireAdminResult =
  | { error: NextResponse }
  | { companyId: string; userId: string };
```

### `RequireSessionResult` — `src/lib/api/require-session.ts`

```typescript
export type RequireSessionResult =
  | { error: NextResponse }
  | { user: User; supabase: SupabaseClient<Database> };
```

### `accounts` row — `src/types/database.types.ts` (generated)

```typescript
accounts: {
  Row: {
    company_id: string | null;
    created_at: string | null;
    id: string;
    is_active: boolean | null;
    name: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    role: string;
  };
  // Insert / Update variants omit for brevity
}
```

### Session type

Supabase `User` from `@supabase/supabase-js` (e.g. `require-session.ts` line 8). No custom `AppSession` interface.

### Documented domain role union — `docs/accounts-table.md`

Text convention: `` `role` `` values `` `driver` | `admin` `` — not enforced as a Postgres enum in generated types.

---

## 8. Risk surface (missing or weak access control)

| Area | Severity | Detail |
| --- | --- | --- |
| Google API proxies | **High** | `/api/geocode-address`, `/api/places-autocomplete`, `/api/place-details` — no auth; API key abuse & cost |
| Open sign-up | **High** | `sign-up-view.tsx` calls `supabase.auth.signUp` without creating `accounts` or assigning `company_id` — orphan auth users, confused redirects |
| `recurring_rules` / exceptions RLS | **Medium** | No RLS in repo migrations; cross-tenant read/write if grants are broad |
| `billing_types` / `billing_variants` | **Medium** | Catalog tables; tenant only via payer FK; RLS not in repo |
| `trip_assignments` RLS enablement | **Medium** | Policies exist in migration; `ENABLE ROW LEVEL SECURITY` not in same file — verify production |
| `requireSession()` trip metrics | **Medium** | Returns trip aggregates with `select('*')`; safe only if trips RLS always correct |
| Service role after `requireAdmin()` | **Medium** | bulk-delete, export, duplicate, user ban — tenant guard required on target ids (documented; some routes use service role for reliability) |
| `getRoster()` without internal auth | **Low** | Public function; callers must pass `companyId` from `requireAdmin()` — misuse if imported elsewhere |
| `createService()` factory | **Low** | `src/lib/supabase/service-factory.ts` — generic `getAll()` with no role check (unused in grep) |
| Dashboard pages relying only on layout | **Low** | Acceptable if RLS complete; weak if a table lacks RLS |
| Stale Clerk docs in `AGENTS.md` | **Low** | Misleading for agents; not a runtime bug |
| `client_price_tags_read` | **Info** | Any company member can SELECT (`20260412150000_fix_cpt_rls.sql` lines 16–18) — intentional? |

### API routes without `requireAdmin` (summary)

- **Unauthenticated:** geocode, places-autocomplete, place-details.
- **Authenticated any role:** trips/metrics, trips/groups/metrics.
- **Secret-based:** cron generate-recurring-trips.

### Proxy gap

`src/proxy.ts` does not enforce admin/driver on `/api/*`; each handler must self-guard.

---

## Recommended starting point

A **senior, minimal-disruption path** given the current codebase:

1. **Treat the existing two-layer model as canonical** — Do not introduce Clerk or a parallel permission framework. Extend `accounts.role` only if a third role is truly required (e.g. read-only finance); otherwise keep `admin` / `driver` and document new capabilities in `docs/access-control.md`.

2. **Close the highest-risk holes first (1–2 PRs)**  
   - Add `requireSession()` (or `requireAdmin()` if only dashboard uses maps) to all Google proxy routes; align with `driving-metrics` pattern.  
   - Disable or gate public `sign-up` (Supabase dashboard setting + remove/hide `/auth/sign-up`) until self-serve onboarding defines `company_id` and `accounts` creation.  
   - Inventory production `pg_tables` / `pg_policies` for `recurring_rules`, `billing_types`, `billing_variants`, `trip_assignments` and add migrations with `ENABLE ROW LEVEL SECURITY` + admin/company policies matching `clients` patterns.

3. **Harden the contract between app and DB**  
   - Add Postgres `CHECK (role IN ('admin','driver'))` and optionally an enum.  
   - Tighten `requireSession()` metrics routes to `requireAdmin()` or scope queries explicitly with `company_id` from `accounts`.  
   - Centralize “resolve admin context” (`companyId`, `userId`, supabase client) once; migrate `requireAdminContext` duplicates in features to shared helper.

4. **User management evolution**  
   - Keep `/dashboard/users` + service-role admin APIs; add invite-by-email later as a thin wrapper over existing create/ban flows rather than a new RBAC system.  
   - Enforce “last admin in company” and block self-deactivate in DB or RPC if not already complete.

5. **Documentation cleanup**  
   - Update `AGENTS.md` to Supabase (remove Clerk nav/RBAC).  
   - Remove or wire up `PermissionCheck` on `nav-config` if unused.  
   - Keep `docs/access-control.md` as the single source of truth; link this audit for gap tracking.

6. **Before any large RBAC redesign**  
   Run production policy audit per `docs/access-control.md` Rule 4 (`pg_policy`), fix tables without RLS, then consider granular permissions only if `admin`/`driver` is insufficient — the codebase is already optimized for **company-scoped binary roles + RLS**, which is the cheapest path to production safety.

---

## Files reviewed (index)

| Area | Paths |
| --- | --- |
| Edge auth | `src/proxy.ts` |
| Supabase clients | `src/lib/supabase/client.ts`, `server.ts`, `admin.ts`, `service-factory.ts`, `to-query-error.ts` |
| API guards | `src/lib/api/require-admin.ts`, `require-session.ts` |
| Auth constants | `src/lib/auth/ban-constants.ts` |
| Layouts | `src/app/dashboard/layout.tsx`, `src/app/driver/layout.tsx`, `src/app/auth/layout.tsx`, `src/app/layout.tsx` |
| Auth UI | `src/features/auth/components/sign-in-view.tsx`, `sign-up-view.tsx`, `src/app/auth/**/page.tsx` |
| Nav / session UI | `src/config/nav-config.ts`, `src/hooks/use-nav.ts`, `src/components/layout/user-nav.tsx`, `app-sidebar.tsx` |
| User admin | `src/app/dashboard/users/page.tsx`, `src/features/driver-management/**`, `src/app/api/users/**`, `src/app/api/drivers/**` |
| Types | `src/types/index.ts`, `src/types/database.types.ts` |
| Migrations | `supabase/migrations/**` (RLS-focused subset) |
| Config / env | `supabase/config.toml`, `env.example.txt` (no `seed.sql` in repo) |
| Docs | `docs/access-control.md`, `docs/accounts-table.md`, `docs/user-management.md`, `docs/driver-system.md` |

**No application code was modified** during this audit except creation of this document.
