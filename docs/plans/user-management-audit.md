# Audit: Admin User Management — Auth + Accounts Integration

**Date:** 2026-05-20  
**Mode:** Read-only (no code changes)  
**Scope:** `accounts` ↔ `auth.users`, RLS, service-role usage, admin gating, existing driver-management UI/API, gaps for a future user-management feature.

---

## Methodology & docs coverage

| Source | Finding |
| --- | --- |
| `docs/` | **191** markdown files under `docs/` (module docs, plans, audits). There is **no** `supabase/schema.sql`; schema is defined only via `supabase/migrations/*.sql`. |
| Auth / accounts docs read in full | [`docs/access-control.md`](../access-control.md), [`docs/accounts-table.md`](../accounts-table.md), [`docs/driver-system.md`](../driver-system.md), [`docs/driver-portal.md`](../driver-portal.md), [`docs/SUPABASE_INTEGRATION.md`](../SUPABASE_INTEGRATION.md) |
| Supabase | All migrations referencing `accounts` / `users`; no `supabase/functions/` directory in repo |
| App code | `src/lib/supabase/*`, `src/proxy.ts`, `src/lib/api/require-admin.ts`, driver-management feature, `src/app/api/drivers/*` |
| Edge Functions | **None** in repository (`supabase/functions/` absent; `supabase/config.toml` has no deployed function definitions in tree) |

**Note:** Initial `CREATE TABLE public.users` DDL is **not** in this repo (same limitation noted in [`docs/plans/reporting-audit.md`](reporting-audit.md)). Column structure is inferred from migrations + [`src/types/database.types.ts`](../../src/types/database.types.ts).

---

## 1. Schema & relationship

### 1.1 Exact column structure of `public.accounts`

From generated types and migrations (effective after `20260318130000_rename_users_to_accounts.sql` + `20260318000000_add_driver_extended_fields.sql`):

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NO | Primary key |
| `company_id` | `uuid` | YES | FK → `public.companies.id` (`accounts_company_id_fkey`) |
| `name` | `text` | NO | Display name |
| `first_name` | `text` | YES | Added in `20260318000000` |
| `last_name` | `text` | YES | Added in `20260318000000` |
| `email` | `text` | YES | **Cached** copy for admin UI; comment: “Email from auth.users, cached for admin display” |
| `phone` | `text` | YES | |
| `role` | `text` | NO | Values used in app: `'driver'` \| `'admin'` |
| `is_active` | `boolean` | YES | Soft deactivation |
| `created_at` | `timestamptz` | YES | |

Documented in [`docs/accounts-table.md`](../accounts-table.md).

### 1.2 How `accounts` links to `auth.users`

- **Mechanism:** **Shared UUID** — `public.accounts.id` is intended to equal `auth.users.id`.
- **Not** joined by email in the database layer.
- **No** `user_id` column on `accounts`; the PK *is* the auth user id.

Migration comment (`20260318130000_rename_users_to_accounts.sql`):

```sql
COMMENT ON TABLE public.accounts IS 'App user accounts (role, company_id, profile). Links to auth.users by id. ...';
```

On create, the app sets `accounts.id = newAuthUser.user.id` and copies email from the auth response ([`src/app/api/drivers/create/route.ts`](../../src/app/api/drivers/create/route.ts) lines 96–106).

### 1.3 Foreign key to `auth.users` — enforced or soft?

- **Soft reference (application-level only).**  
  `database.types.ts` shows **only** FK: `accounts_company_id_fkey` → `companies`.  
  **No** `REFERENCES auth.users(id)` in repo migrations.
- Postgres cannot FK into `auth.users` from `public` in all Supabase setups without extra plumbing; this project relies on **convention + admin API** to keep ids aligned.

### 1.4 Intermediate tables between `accounts` and `auth.users`

| Table | Relationship |
| --- | --- |
| **`driver_profiles`** | `user_id` → `accounts.id` (FK `driver_profiles_user_id_fkey`). Driver-specific fields only; **not** an auth bridge. |
| **`companies`** | `accounts.company_id` → `companies.id` (tenant scope). |

No other table sits between `accounts` and `auth.users`. Operational data (`trips.driver_id`, `shifts.driver_id`, etc.) references `accounts.id` directly.

---

## 2. RLS policies

### 2.1 Policies on `public.accounts`

Defined in `20260318100000_add_users_driver_profiles_rls.sql` (on `users`), renamed/recreated in `20260318130000_rename_users_to_accounts.sql`:

| Policy | Command | Role | Expression (summary) |
| --- | --- | --- | --- |
| `accounts_select_own` | SELECT | `authenticated` | `id = auth.uid()` |
| `accounts_select_company_admin` | SELECT | `authenticated` | `current_user_is_admin()` AND `company_id = current_user_company_id()` |
| `accounts_update_own` | UPDATE | `authenticated` | `id = auth.uid()` |
| `accounts_update_company_admin` | UPDATE | `authenticated` | Admin + same `company_id` |

**There is no INSERT or DELETE policy** on `accounts` in migrations.

**Grants** (same migration):

```sql
GRANT SELECT, UPDATE ON public.accounts TO authenticated;
GRANT SELECT, UPDATE ON public.accounts TO anon;
```

### 2.2 Service-role client vs RLS

- Clients created with `SUPABASE_SERVICE_ROLE_KEY` use the **`service_role`** Postgres role, which **bypasses RLS** entirely.
- **No** policy can block service role from reading/writing all rows.
- Inserts into `accounts` in production are done only via service role in `POST /api/drivers/create` (authenticated admins cannot INSERT under RLS).

### 2.3 `auth.uid()` and admin access

- Admin **SELECT/UPDATE** of **other** users in the **same company** uses `auth.uid()` indirectly via helpers:
  - `current_user_is_admin()` → `role = 'admin' FROM accounts WHERE id = auth.uid()`
  - `current_user_company_id()` → `company_id FROM accounts WHERE id = auth.uid()`
- Helpers were fixed for recursion in `20260409180000_fix_rls_helper_recursion.sql` with `SECURITY DEFINER` + `SET row_security = off`.
- **Cross-company admin access is denied** by RLS for session-bound clients (admin A cannot SELECT/UPDATE accounts where `company_id` ≠ A’s company).

### 2.4 Related: `update_driver()` RPC bypasses RLS

`public.update_driver(...)` is **`SECURITY DEFINER`** (see `20260318120000_add_update_driver_function.sql`). It updates `accounts` + `driver_profiles` **without** company checks inside the function. Authorization is documented as API-layer only — see **Section 7** (security risk).

---

## 3. Auth admin operations

### 3.1 `supabase.auth.admin.*` usage

| Location | Methods |
| --- | --- |
| [`src/app/api/drivers/create/route.ts`](../../src/app/api/drivers/create/route.ts) | `auth.admin.createUser({ email, password, email_confirm: true })` |
| Same file (rollback) | `auth.admin.deleteUser(id)` on failed `accounts` / `driver_profiles` insert |

**Not used anywhere in repo:** `listUsers`, `getUserById`, `updateUserById`, `generateLink`, password reset admin APIs.

### 3.2 Service-role client initialization

**No** shared `lib/supabase/admin.ts` (or similar). Service role is instantiated **inline** per route/script:

| File | Pattern |
| --- | --- |
| `src/app/api/drivers/create/route.ts` | `createClient<Database>(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })` |
| `src/app/api/trips/export/route.ts` | `createAdminClient` from `@supabase/supabase-js` |
| `src/app/api/trips/export/preview/route.ts` | Same |
| `src/app/api/trips/duplicate/route.ts` | Same |
| `src/app/api/trips/bulk-delete/route.ts` | Same |
| `src/app/api/cron/generate-recurring-trips/route.ts` | Same |
| `scripts/backfill-*.ts`, `scripts/duplicate-trips-dev-cli.ts` | Same |

**Session clients (anon key + cookies):**

| File | Key |
| --- | --- |
| [`src/lib/supabase/server.ts`](../../src/lib/supabase/server.ts) | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| [`src/lib/supabase/client.ts`](../../src/lib/supabase/client.ts) | Same (browser) |

[`src/lib/supabase/service-factory.ts`](../../src/lib/supabase/service-factory.ts) is a **CRUD factory for browser anon client**, not service role.

### 3.3 Edge Functions as auth proxy

**None.** `supabase/functions/` does not exist in the repository. No Edge Function references `auth.users`, `accounts`, email, or password.

---

## 4. Environment & secrets

### 4.1 Variable names (values never logged)

| Variable | In `env.example.txt` | In local `.env.local` (names only) |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Present |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Present |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (comment: server-side admin only) | Present |

Also in `.env.local` (unrelated to Supabase auth): `CRON_SECRET`, Sentry, Google Maps keys.

**Clerk:** `env.example.txt` documents **Supabase** auth only. `AGENTS.md` still mentions Clerk historically; runtime auth in `src/features/auth` and `src/proxy.ts` is **Supabase**.

### 4.2 Anon vs service-role separation

| Concern | Status |
| --- | --- |
| Public anon key | `NEXT_PUBLIC_*` — used in browser and server session clients |
| Service role | **Server-only** env var, no `NEXT_PUBLIC_` prefix |
| Leak risk | Service key only referenced in API routes, cron, and `scripts/` — **not** imported from client components |

---

## 5. Existing admin gating

### 5.1 How admin role is determined

- **Source of truth:** `public.accounts.role` column (`'admin'` \| `'driver'`).
- **Not** Supabase JWT custom claims in application code.
- **Not** Clerk org roles (Clerk not wired in current auth paths).

Documented in [`docs/access-control.md`](../access-control.md): five layers.

### 5.2 Route / middleware gating

There is **no** `middleware.ts`. Next.js uses **[`src/proxy.ts`](../../src/proxy.ts)** (Layer 1):

| Condition | Behavior |
| --- | --- |
| `/dashboard/*` without session | Redirect → `/auth/sign-in` |
| `/dashboard/*` + `role === 'driver'` | Redirect → `/driver/shift` |
| `/driver/*` + non-driver | Redirect → `/dashboard/overview` |
| `/auth/*` + signed in | Redirect by role to dashboard or driver home |

**Layer 2:** [`src/app/dashboard/layout.tsx`](../../src/app/dashboard/layout.tsx) — server redirect to `/driver/shift` if `account.role !== 'admin'`.

**Layer 3:** [`src/lib/api/require-admin.ts`](../../src/lib/api/require-admin.ts) — loads session via anon server client, reads `accounts.role` + `company_id`; returns **401** / **403**.

**Layer 5:** [`src/hooks/use-nav.ts`](../../src/hooks/use-nav.ts) — hides nav for drivers.

### 5.3 No separate `app/admin/` tree

- Admin UI lives under **`/dashboard/*`** (50 `page.tsx` routes under `src/app/dashboard/`).
- **No** `app/admin/`, `app/(admin)/`, or `pages/admin/`.

### 5.4 Non-admin hitting admin routes

| Path | Result |
| --- | --- |
| Driver → `/dashboard/trips` | Proxy redirect to `/driver/shift`; layout also redirects |
| Unauthenticated → `/dashboard/*` | Redirect to sign-in |
| Driver calling `POST /api/drivers/create` | **403** from `requireAdmin()` |
| Admin → `/driver/shift` | Proxy redirect to `/dashboard/overview` |

**Gap:** API routes are in the proxy `matcher`, but **proxy does not call `requireAdmin()`** — only session presence and page-level role redirects. Sensitive routes rely on **per-handler** `requireAdmin()` (correct for listed admin APIs).

---

## 6. Current gaps

### 6.1 Page listing all users with emails

| What exists | Limitation |
| --- | --- |
| **`/dashboard/drivers`** ([`src/app/dashboard/drivers/page.tsx`](../../src/app/dashboard/drivers/page.tsx)) | Lists **`accounts` where `role = 'driver'`** only ([`drivers.service.ts`](../../src/features/driver-management/api/drivers.service.ts) line 39). Shows **email** column. |
| **No** dedicated “all users” or “admins” page | Company **admin** accounts are not listed in the Fahrer UI |

### 6.2 Email / password update UI or API

| Capability | Status |
| --- | --- |
| **Create** email + password | Yes — create form → `POST /api/drivers/create` → `auth.admin.createUser` |
| **Edit** email | UI field is **read-only** in edit mode ([`driver-form-body.tsx`](../../src/features/driver-management/components/driver-form-body.tsx) ~365–384); PATCH body **does not** send email |
| **Edit** password | **No** flow (no reset, no `updateUserById`) |
| **Sync** `accounts.email` with auth | Only set on create; no update path when auth email changes |

### 6.3 Other missing pieces before a safe “user management” feature

1. **Admin user CRUD** — create/list/edit/deactivate **admin** accounts (today create API can set `role: 'admin'` but UI is driver-centric).
2. **Auth admin APIs** — `updateUserById` (email/password), `listUsers`, invite, ban/disable auth user.
3. **Tenant guard on PATCH** — `PATCH /api/drivers/[id]` does **not** verify target `id` belongs to `auth.companyId` before calling `update_driver()` (RPC bypasses RLS). **Must fix before expanding user admin.**
4. **`update_driver` hardening** — add `company_id` check inside RPC or drop SECURITY DEFINER in favor of RLS-only updates.
5. **DELETE / deactivate auth** — soft deactivate sets `is_active = false` on `accounts` only; **no** `auth.admin.deleteUser` on deactivate; auth user can still sign in.
6. **INSERT policy** — intentional absence means all new accounts need service role; any new “invite admin” flow must use the same pattern as `drivers/create`.
7. **Self-service sign-up** — [`sign-up-view.tsx`](../../src/features/auth/components/sign-up-view.tsx) calls `auth.signUp` only; **no** `accounts` insert in app and **no** auth trigger in repo migrations → risk of **orphan `auth.users`** without `accounts` row.
8. **Email cache drift** — `accounts.email` can diverge from `auth.users.email`.
9. **Centralized admin Supabase client** — repeated inline `createClient(url, SERVICE_ROLE_KEY)` increases risk of copy-paste mistakes.
10. **No Edge Function layer** — all auth admin must be added in Next.js API routes (or new functions) explicitly.

### 6.4 Components inventory

| Path | Role |
| --- | --- |
| `src/features/driver-management/**` | Full admin UI for **drivers** (table, column view, form, deactivate) |
| `src/components/layout/user-nav.tsx`, `nav-user.tsx`, `user-avatar-profile.tsx` | **Current session** user menu — not user management |
| **No** `components/users/` or `components/accounts/` |

---

## 7. Senior recommendation

### 7.1 Next.js API route vs Supabase Edge Function

**Recommendation: Next.js API routes with service-role client (same as `POST /api/drivers/create`).**

| Reason | Detail |
| --- | --- |
| **Existing pattern** | Only auth admin usage today is in `src/app/api/drivers/create/route.ts` with `requireAdmin()` + inline service role. |
| **No Edge Functions** | Zero functions in repo; introducing Edge Functions adds deploy/auth secret plumbing without current payoff. |
| **Defense in depth** | `requireAdmin()` + `company_id` checks belong next to handlers; cron/export already use API routes for privileged DB access. |
| **Consistency** | Trip export, bulk delete, duplicate, cron all use API + service role — one operational model for Vercel. |

Use Edge Functions only if you later need **database webhooks** (e.g. sync `accounts.email` on `auth.users` update) without round-tripping through Vercel.

**Suggested structure for new endpoints:**

- `src/lib/supabase/admin.ts` — single factory: `createAdminClient()` reading `SUPABASE_SERVICE_ROLE_KEY`, never exported to client bundles.
- Routes under `src/app/api/users/` or extend `src/app/api/drivers/` with explicit naming (`/api/users/[id]/credentials`).
- Every handler: `requireAdmin()` first, then **verify target account `company_id === auth.companyId`**, then `auth.admin.*`, then update `accounts` cache columns.

### 7.2 Security risks to address before building

| Risk | Severity | Notes |
| --- | --- | --- |
| **`update_driver` cross-tenant IDOR** | **High** | SECURITY DEFINER + no `company_id` check; PATCH only checks caller is *some* admin. |
| **`update_driver` granted to `anon`** | **Medium** | `GRANT EXECUTE ... TO anon` in `20260318120000`; callable if anon key used with a session JWT. |
| **Service role in API routes** | **High** (operational) | Key must never reach client; audit any new route for missing `requireAdmin()`. |
| **Orphan auth users** | **Medium** | Public sign-up without `accounts` provisioning. |
| **`accounts.email` stale** | **Low** | Misleading admin UI; not a direct auth bypass. |
| **Deactivate ≠ auth disable** | **Medium** | `is_active = false` does not revoke Supabase sessions or block login. |
| **Role escalation via PATCH** | **Medium** | Admin can set `role: 'admin'` on driver via form + `update_driver`; no guard against removing last admin or cross-tenant if IDOR fixed only partially. |
| **`GRANT ... TO anon` on `accounts`** | **Low–Medium** | Unusual; review whether `anon` role needs UPDATE on `accounts` at all. |

### 7.3 Minimum viable “user management” checklist

1. Fix **tenant scoping** on all user mutations (API + optional RPC rewrite).
2. Add **`createAdminClient()`** helper and document in `access-control.md`.
3. Implement **list users** (`accounts` for `company_id`, all roles) — session client + RLS is enough for read.
4. Implement **email/password change** via **`auth.admin.updateUserById`** in API routes only; sync `accounts.email`.
5. Implement **auth disable** on deactivate (`ban` or password reset + session revoke per Supabase API).
6. Decide **sign-up policy** (disable public sign-up or add trigger/RPC to create `accounts` row).
7. Add UI route (e.g. `/dashboard/users` or expand Fahrer → “Benutzer”) with tests for Layer 1–3.

---

## Appendix A — Supabase client files

| File | Role |
| --- | --- |
| `src/lib/supabase/client.ts` | Browser, anon key |
| `src/lib/supabase/server.ts` | Server Components / Route Handlers, anon key + cookies |
| `src/lib/supabase/service-factory.ts` | Generic CRUD on anon client (not service role) |
| `src/lib/supabase/to-query-error.ts` | Error helper |

## Appendix B — Admin API routes using `requireAdmin()`

- `POST /api/drivers/create`
- `PATCH /api/drivers/[id]`
- `POST /api/trips/bulk-delete`
- `POST /api/trips/duplicate`
- `POST /api/trips/export`
- `GET /api/trips/export/preview`
- `POST /api/trips/driving-metrics`

## Appendix C — Key migrations

| Migration | Topic |
| --- | --- |
| `20260318000000_add_driver_extended_fields.sql` | `first_name`, `last_name`, `email` on `users` |
| `20260318100000_add_users_driver_profiles_rls.sql` | Initial RLS + helpers |
| `20260318120000_add_update_driver_function.sql` | `update_driver()` SECURITY DEFINER |
| `20260318130000_rename_users_to_accounts.sql` | Rename + policies + `update_driver` body |
| `20260409180000_fix_rls_helper_recursion.sql` | `row_security = off` on helpers |

## Appendix D — Auth stack clarification

- **Production auth:** Supabase (`signInWithPassword`, cookie session via `@supabase/ssr`).
- **Roles:** `public.accounts.role`, not JWT app_metadata in code paths reviewed.
- **AGENTS.md / template** may still mention Clerk; **not** used in `src/proxy.ts`, dashboard layout, or `requireAdmin()`.
