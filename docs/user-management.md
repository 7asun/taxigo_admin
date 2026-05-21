# User management (Benutzerverwaltung)

> See [access-control.md](access-control.md) for RBAC layers and [accounts-table.md](accounts-table.md) for `public.accounts`.

## Scope

Dashboard route **`/dashboard/users`** lets a company **admin** view all accounts in their tenant (drivers and admins), read **live** email from Supabase Auth (`auth.users`), update **email and/or password** via the Auth Admin API, and **deactivate / reactivate** users by toggling `accounts.is_active` and applying a GoTrue **ban** so login is blocked without deleting the user.

## Routes and feature code

| Piece | Path |
| --- | --- |
| Page | `src/app/dashboard/users/page.tsx` |
| List API | `GET /api/users` → `src/app/api/users/route.ts` |
| Credentials API | `PATCH /api/users/[id]/credentials` → `src/app/api/users/[id]/credentials/route.ts` |
| Status API | `PATCH /api/users/[id]/status` → `src/app/api/users/[id]/status/route.ts` |
| Service-role factory | [`src/lib/supabase/admin.ts`](../src/lib/supabase/admin.ts) — `createAdminClient()` |
| Ban constants | `src/lib/auth/ban-constants.ts` |
| UI | `src/features/user-management/**` |
| Query keys | `userKeys.list()` in [`src/query/keys/users.ts`](src/query/keys/users.ts) |

## Data flow (text)

```text
Benutzerverwaltung UI
  → TanStack Query (userKeys.list) + fetch /api/users
  → requireAdmin() + session Supabase: list accounts by company_id
  → createAdminClient(): auth.admin.getUserById per row → merge email

Credentials form
  → PATCH /api/users/:id/credentials
  → requireAdmin() + tenant guard (session SELECT accounts)
  → auth.admin.updateUserById (then sync accounts.email if email changed)

Status toggle
  → PATCH /api/users/:id/status
  → requireAdmin() + tenant guard; block self-deactivation
  → UPDATE accounts.is_active (service role), then ban_duration on Auth
  → rollback accounts row if ban step fails
```

## Security model

1. **Layer 3:** every handler starts with **`requireAdmin()`** (API only). RSC pages use **`assertAdminOrRedirect()`** (redirect, not `NextResponse`).
2. **Tenant guard:** for any mutation touching `accounts` or calling `auth.admin.*` with a user id, verify the target row’s `company_id` matches **`auth.companyId`** via a **session** (anon) client — RLS restricts what the admin can see, so a missing or foreign id returns 404/403. This is required even when later using `SECURITY DEFINER` RPCs or service role (see `/api/drivers/[id]` fix).
3. **Service role:** `createAdminClient()` must **only** be imported from `src/app/api/**` or `scripts/**`, never from client bundles.
4. **Deactivate:** uses **`ban_duration`** (`876000h` ≈ permanent, `0s` = unban) so the user cannot sign in; **`deleteUser` is not used** — reactivation is possible.
5. **Passwords** are never logged or returned from APIs.

## Deferred / out of scope

- Inviting or creating admins-only (driver create remains under Fahrer).
- Hard-deleting accounts; role promotion UI; last-admin guard.
- Hardening `update_driver` (SQL) or revoking `GRANT EXECUTE … TO anon`.
- Public sign-up orphan `auth.users` without `accounts`.
- Bulk-reconciling stale `accounts.email` for historical rows.
