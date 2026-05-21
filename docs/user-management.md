# User management (Benutzerverwaltung)

> See [access-control.md](access-control.md) for RBAC layers and [accounts-table.md](accounts-table.md) for `public.accounts`.

## Scope

Dashboard route **`/dashboard/users`** is the canonical company roster. It is powered by the **`driver-management`** feature (table + column views, all account roles, live Auth email, credentials, ban-aware status). The thin **`UsersTable`** UI in this folder was retired as part of Approach B Phase 2.

## Routes and feature code

| Piece | Path |
| --- | --- |
| Page (roster UI) | `src/app/dashboard/users/page.tsx` — `driver-management` components |
| Legacy redirect | `src/app/dashboard/drivers/page.tsx` → redirects to `/dashboard/users` |
| List API | `GET /api/users` → `src/app/api/users/route.ts` |
| Credentials API | `PATCH /api/users/[id]/credentials` → `src/app/api/users/[id]/credentials/route.ts` |
| Status API | `PATCH /api/users/[id]/status` → `src/app/api/users/[id]/status/route.ts` |
| Service-role factory | [`src/lib/supabase/admin.ts`](../src/lib/supabase/admin.ts) — `createAdminClient()` |
| Ban constants | `src/lib/auth/ban-constants.ts` |
| Roster UI (active) | `src/features/driver-management/**` |
| Credentials dialog + status hooks | `src/features/driver-management/components/edit-credentials-dialog.tsx`, `api/user-actions.service.ts` |
| Deprecated bridges | `src/features/user-management/**` — `useUsers`, `CompanyUser`, re-exports |
| Query keys | `userKeys.list()` in [`src/query/keys/users.ts`](src/query/keys/users.ts) |

## Data flow (text)

```text
Benutzerverwaltung UI (/dashboard/users)
  → driver-management: RSC DriverTableListing fetch GET /api/users?page&perPage
  → requireAdmin() + session Supabase: list accounts by company_id
  → createAdminClient(): auth.admin.getUserById per page row → merge email

Credentials form (EditCredentialsDialog in driver-management)
  → PATCH /api/users/:id/credentials
  → requireAdmin() + tenant guard (session SELECT accounts)
  → auth.admin.updateUserById (then sync accounts.email if email changed)

Status toggle (useUpdateStatus in user-actions.service)
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

## Deprecated (Phase 2)

- **`UsersTable`** — deleted; roster uses `driver-management` table/column views.
- **`user-management` feature folder** — deprecated; `useUsers` and `CompanyUser` remain as bridges pending a future cleanup pass.
- **API routes** under `src/app/api/users/**` are unchanged and remain the server layer for list, credentials, and status.

## Deferred / out of scope

- Copy pass (“Neuer Fahrer” → “Neuer Benutzer” across all UI strings).
- Hard-deleting accounts; last-admin guard.
- Removing `CompanyUser` type and `user-management` bridges entirely.
- Column view showing all roles (column view remains driver-only by design).
